import { parseQuestPacket } from '../protocol/inbound-packets.js';
import { DEFAULT_FLAGS, GAME_QUEST_CMD, GAME_QUEST_TABLE_CMD } from '../config.js';
import { getBagQuantityByTemplateId, normalizeInventoryState } from '../inventory/index.js';
import { normalizePets } from '../pet-runtime.js';
import { buildQuestPacket, buildQuestTableSyncPacket } from '../protocol/gameplay-packets.js';
import { isQuest2DefinitionId } from '../quest2/definitions.js';
import { dispatchQuestEventToSession } from '../quest2/runtime.js';
import { normalizeQuestState as normalizeQuestStateV2 } from '../quest2/state.js';
import {
  buildQuest2SyncState,
  replayQuest2TrackerScripts,
  sendQuest2AcceptWithState,
  sendQuest2Marker,
  sendQuest2UpdateWithState,
  type Quest2SyncState,
  usesQuest2TrackerMarkerPacket,
} from '../quest2/sync.js';
import type { GameSession, QuestSyncMode } from '../types.js';
import { sanitizeQuestDialogueText, type UnknownRecord } from '../utils.js';

type QuestSyncOptions = {
  mode?: QuestSyncMode;
};

type QuestMonsterDefeatResult = {
  handled: boolean;
  grantedItems: Array<{ templateId: number; quantity: number }>;
};

function supportsQuestTableTaskId(taskId: number): boolean {
  const normalizedTaskId = Number.isInteger(taskId) ? (taskId >>> 0) : 0;
  return normalizedTaskId > 0 && (normalizedTaskId < 0x321 || normalizedTaskId === 811);
}

function sendQuestUpdate(session: GameSession, taskId: number, status: number): void {
  session.writePacket(
    buildQuestPacket(0x08, taskId, status, 'u16'),
    DEFAULT_FLAGS,
    `Sending quest update cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x08 taskId=${taskId} status=${status}`
  );
}

function sendQuestProgress(session: GameSession, objectiveId: number, status: number): void {
  session.writePacket(
    buildQuestPacket(0x0b, objectiveId, status, 'u16'),
    DEFAULT_FLAGS,
    `Sending quest progress cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x0b objectiveId=${objectiveId} status=${status}`
  );
}

function sendQuestComplete(session: GameSession, taskId: number): void {
  session.writePacket(
    buildQuestPacket(0x04, taskId),
    DEFAULT_FLAGS,
    `Sending quest complete cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x04 taskId=${taskId}`
  );
}

function sendQuestAbandon(session: GameSession, taskId: number): void {
  session.writePacket(
    buildQuestPacket(0x05, taskId),
    DEFAULT_FLAGS,
    `Sending quest abandon cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x05 taskId=${taskId}`
  );
}

function sendQuestHistory(session: GameSession, taskId: number, historyLevel = 0): void {
  session.writePacket(
    buildQuestPacket(0x0e, taskId, historyLevel & 0xff, 'u8'),
    DEFAULT_FLAGS,
    `Sending quest history cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x0e taskId=${taskId} history=${historyLevel}`
  );
}

function sendQuestTableStateSync(
  session: GameSession,
  syncState: Quest2SyncState[],
  completedTaskIds: number[]
): void {
  const supportedQuests = syncState
    .filter((quest) => supportsQuestTableTaskId(quest.taskId))
    .slice(0, 0x10)
    .map((quest) => ({
      taskId: quest.taskId >>> 0,
      step: Math.max(1, (quest.stepIndex >>> 0) + 1),
      extraA: quest.maxAward >>> 0,
      extraB: quest.taskStep >>> 0,
    }));
  const historyEntries = completedTaskIds
    .filter((taskId) => supportsQuestTableTaskId(taskId))
    .map((taskId) => ({
      taskId: taskId >>> 0,
      state: 0,
    }));

  session.writePacket(
    buildQuestTableSyncPacket({
      playerRuntimeId: session.runtimeId >>> 0,
      subtype: 0x08,
      quests: supportedQuests,
      history: historyEntries,
    }),
    DEFAULT_FLAGS,
    `Sending quest table sync cmd=0x${GAME_QUEST_TABLE_CMD.toString(16)} sub=0x08 player=0x${(session.runtimeId >>> 0).toString(16)} quests=${supportedQuests.length} history=${historyEntries.length} skipped=${Math.max(0, syncState.length - supportedQuests.length)}`
  );
}

function syncQuestStateToClient(session: GameSession, options: QuestSyncOptions = {}): void {
  const mode: QuestSyncMode = options.mode || 'runtime';
  const syncState = buildQuest2SyncState(session.questStateV2).sort((left, right) => {
    if ((left.acceptedAt >>> 0) !== (right.acceptedAt >>> 0)) {
      return (left.acceptedAt >>> 0) - (right.acceptedAt >>> 0);
    }
    return (left.taskId >>> 0) - (right.taskId >>> 0);
  });
  const completedTaskIds = Array.isArray(session.questStateV2?.completed)
    ? session.questStateV2.completed.filter(Number.isInteger).map((taskId: number) => taskId >>> 0).sort((left, right) => left - right)
    : [];

  session.log(
    `Quest sync mode=${mode} quest2Active=${syncState.length} quest2Completed=${completedTaskIds.length}`
  );

  sendQuestTableStateSync(session, syncState, completedTaskIds);
  for (const taskId of completedTaskIds) {
    sendQuestHistory(session, taskId, 0);
  }

  for (const quest of syncState) {
    const shouldSendFullUpdateState =
      quest.stepMode === 'kill' ||
      (quest.stepIndex >>> 0) > 0 ||
      (quest.status >>> 0) > 0;

    sendQuest2AcceptWithState(session, quest);
    if (shouldSendFullUpdateState) {
      sendQuest2UpdateWithState(session, quest);
    }
    if ((quest.stepIndex >>> 0) > 0) {
      for (let index = 0; index < (quest.stepIndex >>> 0); index += 1) {
        sendQuestUpdate(session, quest.taskId, index + 1);
      }
    }
    if ((quest.status >>> 0) > 0) {
      sendQuestUpdate(session, quest.taskId, quest.status >>> 0);
    }
    if (quest.stepMode === 'kill' && (quest.progressCount >>> 0) > 0) {
      sendQuestProgress(session, quest.progressObjectiveId >>> 0 || quest.taskId >>> 0, quest.progressCount >>> 0);
    }
    if ((quest.markerNpcId >>> 0) > 0 && usesQuest2TrackerMarkerPacket(quest)) {
      sendQuest2Marker(session, quest);
    }
    replayQuest2TrackerScripts(session, quest);
  }

  if (!session.hasAnnouncedQuestOverview && syncState.length > 0) {
    const activeQuest = syncState[0]!;
    session.sendGameDialogue(
      'Quest',
      sanitizeQuestDialogueText(`Active quest loaded.${activeQuest.stepDescription ? ` ${activeQuest.stepDescription}` : ''}`)
    );
    session.hasAnnouncedQuestOverview = true;
  }
}

function handleQuestAbandonRequest(session: GameSession, taskId: number, source = 'client-abandon'): boolean {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return false;
  }
  if (!isQuest2DefinitionId(taskId)) {
    session.log(`Ignoring non-quest2 abandon taskId=${taskId} source=${source}`);
    return false;
  }
  return dispatchQuestEventToSession(session, {
    type: 'quest_abandon',
    questId: taskId >>> 0,
  }).handled;
}

function handleQuestPacket(session: GameSession, payload: Buffer): void {
  if (payload.length < 5) {
    session.log('Short 0x03ff payload');
    return;
  }

  const { subcmd, taskId } = parseQuestPacket(payload);
  if (subcmd === 0x04) {
    session.log(
      `Quest packet sub=0x${subcmd.toString(16)} taskId=${taskId} len=${payload.length} hex=${payload.toString('hex')}`
    );
  } else {
    session.log(`Quest packet sub=0x${subcmd.toString(16)} taskId=${taskId}`);
  }

  if (subcmd === 0x05) {
    handleQuestAbandonRequest(session, taskId, 'client-abandon');
    return;
  }

  session.log(`Unhandled quest subcmd=0x${subcmd.toString(16)} taskId=${taskId}`);
}

function handleQuestMonsterDefeat(session: GameSession, monsterId: number, count = 1): QuestMonsterDefeatResult {
  const result = dispatchQuestEventToSession(session, {
    type: 'monster_defeat',
    monsterId: monsterId >>> 0,
    count: Math.max(1, count),
    mapId: session.currentMapId >>> 0,
  });

  return {
    handled: result.handled,
    grantedItems: result.grantedItems,
  };
}

function ensureQuestStateReady(session: GameSession): void {
  const persisted = session.getPersistedCharacter();
  if (!persisted) {
    return;
  }

  session.questStateV2 = normalizeQuestStateV2(
    persisted?.questStateV2 && typeof persisted.questStateV2 === 'object'
      ? persisted.questStateV2 as UnknownRecord
      : {}
  );
  session.pets = normalizePets(persisted.pets);
  session.selectedPetRuntimeId =
    typeof persisted.selectedPetRuntimeId === 'number'
      ? persisted.selectedPetRuntimeId >>> 0
      : null;
  session.petSummoned = persisted.petSummoned === true;
  const inventoryState = normalizeInventoryState(persisted);
  session.bagItems = inventoryState.inventory.bag;
  session.bagSize = inventoryState.inventory.bagSize;
  session.nextItemInstanceId = inventoryState.inventory.nextItemInstanceId;
  session.nextBagSlot = inventoryState.inventory.nextBagSlot;
}

function refreshQuestStateForItemTemplates(session: GameSession, templateIds: number[]): void {
  if (!Array.isArray(templateIds) || templateIds.length === 0) {
    return;
  }

  const interestingTemplates = new Set(
    templateIds.filter(Number.isInteger).map((templateId) => templateId >>> 0)
  );
  if (interestingTemplates.size === 0) {
    return;
  }

  for (const templateId of interestingTemplates) {
    const quantity = Math.max(0, getBagQuantityByTemplateId(session, templateId));
    const result = dispatchQuestEventToSession(session, {
      type: 'item_changed',
      templateId,
      delta: 0,
      quantity,
    });
    if (result.handled) {
      session.log(`Refreshed quest2 state for templateId=${templateId} quantity=${quantity}`);
    }
  }
}

export {
  ensureQuestStateReady,
  handleQuestAbandonRequest,
  handleQuestMonsterDefeat,
  handleQuestPacket,
  refreshQuestStateForItemTemplates,
  sendQuestAbandon,
  sendQuestComplete,
  sendQuestHistory,
  sendQuestProgress,
  sendQuestUpdate,
  syncQuestStateToClient,
};
