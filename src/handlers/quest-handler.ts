const { parseQuestPacket } = require('../protocol/inbound-packets');
const { DEFAULT_FLAGS, GAME_QUEST_CMD } = require('../config');
const {
  abandonQuest,
  buildQuestSyncState,
  getQuestDefinition,
  getQuestMarkerNpcId,
  normalizeQuestState,
} = require('../quest-engine');
const { normalizeInventoryState } = require('../inventory');
const { normalizePets } = require('../pet-runtime');
const { buildQuestPacket } = require('../protocol/gameplay-packets');
const { numberOrDefault } = require('../character/normalize');
const { applyObjectiveEvents } = require('../objectives/objective-dispatcher');
const { createQuestEventHandler } = require('../objectives/quest-event-handler');
import type { QuestSyncMode } from '../types';

type SessionLike = Record<string, any>;
type UnknownRecord = Record<string, any>;
type QuestSyncState = UnknownRecord & { taskId: number };

type QuestSyncOptions = {
  mode?: QuestSyncMode;
};

function sendQuestAccept(session: SessionLike, taskId: number): void {
  session.writePacket(
    buildQuestPacket(0x03, taskId),
    DEFAULT_FLAGS,
    `Sending quest accept cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x03 taskId=${taskId}`
  );
}

function sendQuestUpdate(session: SessionLike, taskId: number, status: number): void {
  session.writePacket(
    buildQuestPacket(0x08, taskId, status, 'u16'),
    DEFAULT_FLAGS,
    `Sending quest update cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x08 taskId=${taskId} status=${status}`
  );
}

function sendQuestMarker(session: SessionLike, taskId: number, npcId: number): void {
  session.writePacket(
    buildQuestPacket(0x0c, taskId, npcId, 'u32'),
    DEFAULT_FLAGS,
    `Sending quest marker cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x0c taskId=${taskId} npcId=${npcId}`
  );
}

function sendQuestProgress(session: SessionLike, objectiveId: number, status: number): void {
  session.writePacket(
    buildQuestPacket(0x0b, objectiveId, status, 'u16'),
    DEFAULT_FLAGS,
    `Sending quest progress cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x0b objectiveId=${objectiveId} status=${status}`
  );
}

function sendQuestComplete(session: SessionLike, taskId: number): void {
  session.writePacket(
    buildQuestPacket(0x04, taskId),
    DEFAULT_FLAGS,
    `Sending quest complete cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x04 taskId=${taskId}`
  );
}

function sendQuestAbandon(session: SessionLike, taskId: number): void {
  session.writePacket(
    buildQuestPacket(0x05, taskId),
    DEFAULT_FLAGS,
    `Sending quest abandon cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x05 taskId=${taskId}`
  );
}

function sendQuestHistory(session: SessionLike, taskId: number, historyLevel = 0): void {
  session.writePacket(
    buildQuestPacket(0x0e, taskId, historyLevel & 0xff, 'u8'),
    DEFAULT_FLAGS,
    `Sending quest history cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x0e taskId=${taskId} history=${historyLevel}`
  );
}

function syncQuestStateToClient(session: SessionLike, options: QuestSyncOptions = {}): void {
  const mode: QuestSyncMode = options.mode || 'runtime';
  const replayTalkStepUpdates = mode === 'login';
  for (const taskId of session.completedQuests) {
    sendQuestHistory(session, taskId, 0);
  }

  const syncState = buildQuestSyncState({
    activeQuests: session.activeQuests,
    completedQuests: session.completedQuests,
  });

  for (const quest of syncState) {
    sendQuestAccept(session, quest.taskId);
    // Talk-step replay is mode-dependent: full login needs it so the client
    // reconstructs the current stage, while runtime refreshes stay minimal.
    if (quest.stepType === 'kill' || (replayTalkStepUpdates && quest.stepType === 'talk')) {
      for (let index = 0; index < numberOrDefault(quest.stepIndex, 0); index += 1) {
        sendQuestUpdate(session, quest.taskId, index + 1);
      }
    }
    if (quest.stepType === 'kill' && numberOrDefault(quest.status, 0) > 0) {
      sendQuestUpdate(session, quest.taskId, numberOrDefault(quest.status, 0));
    }
    if (quest.stepType === 'kill' && numberOrDefault(quest.progressCount, 0) > 0) {
      sendQuestProgress(
        session,
        numberOrDefault(quest.progressObjectiveId, quest.taskId),
        numberOrDefault(quest.progressCount, 0)
      );
    }
    const definition = getQuestDefinition(quest.taskId);
    const record = Array.isArray(session.activeQuests)
      ? session.activeQuests.find((entry: UnknownRecord) => numberOrDefault(entry?.id, 0) === quest.taskId) || null
      : null;
    const markerNpcId = getQuestMarkerNpcId(definition, record);
    if (markerNpcId > 0) {
      sendQuestMarker(session, quest.taskId, markerNpcId);
    }
  }

  if (!session.hasAnnouncedQuestOverview && syncState.length > 0) {
    const activeQuest = syncState[0];
    session.sendGameDialogue('Quest', `Active quest loaded.${activeQuest.stepDescription ? ` ${activeQuest.stepDescription}` : ''}`);
    session.hasAnnouncedQuestOverview = true;
  }
}

function applyQuestEvents(
  session: SessionLike,
  events: UnknownRecord[],
  source = 'runtime',
  options: UnknownRecord = {}
): void {
  applyObjectiveEvents(session, events, questEventHandler, source, options);
}

function handleQuestAbandonRequest(session: SessionLike, taskId: number, source = 'client-abandon'): boolean {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return false;
  }

  const questState = {
    activeQuests: session.activeQuests,
    completedQuests: session.completedQuests,
  };
  const events = abandonQuest(questState, taskId);
  session.activeQuests = questState.activeQuests;
  session.completedQuests = questState.completedQuests;
  if (events.length > 0) {
    applyQuestEvents(session, events, source);
    return true;
  }
  return false;
}

function handleQuestPacket(session: SessionLike, payload: Buffer): void {
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

function handleQuestMonsterDefeat(session: SessionLike, monsterId: number, count = 1): void {
  session.dispatchObjectiveMonsterDefeat(monsterId, count, 'monster-defeat');
}

function ensureQuestStateReady(session: SessionLike): void {
  const persisted = session.getPersistedCharacter();
  if (persisted) {
    const questState = normalizeQuestState(persisted);
    session.activeQuests = questState.activeQuests;
    session.completedQuests = questState.completedQuests;
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

  session.reconcileObjectives('bootstrap', {
    suppressPackets: true,
    suppressDialogues: true,
    suppressStatSync: true,
  });
}

const questEventHandler = createQuestEventHandler({
  sendQuestAccept,
  sendQuestUpdate,
  sendQuestMarker,
  sendQuestProgress,
  sendQuestComplete,
  sendQuestAbandon,
  sendQuestHistory,
  syncQuestStateToClient,
});

function refreshQuestStateForItemTemplates(session: SessionLike, templateIds: number[]): void {
  if (!Array.isArray(templateIds) || templateIds.length === 0) {
    return;
  }

  const interestingTemplates = new Set(templateIds.filter(Number.isInteger).map((templateId) => templateId >>> 0));
  if (interestingTemplates.size === 0) {
    return;
  }

  const syncStateByTaskId = new Map<number, QuestSyncState>(
    buildQuestSyncState({
      activeQuests: session.activeQuests,
      completedQuests: session.completedQuests,
    }).map((quest: QuestSyncState) => [quest.taskId, quest] as const)
  );

  for (const record of session.activeQuests) {
    const definition = getQuestDefinition(record?.id);
    const step = definition?.steps?.[record?.stepIndex];
    if (!step || !Array.isArray(step.consumeItems) || step.consumeItems.length === 0) {
      continue;
    }

    const matchesGrantedItem = step.consumeItems.some((item: UnknownRecord) => interestingTemplates.has(item.templateId >>> 0));
    if (!matchesGrantedItem) {
      continue;
    }

    const syncState = syncStateByTaskId.get(definition.id);
    if (!syncState) {
      continue;
    }
    session.log(`Refreshed quest sync for task=${definition.id} after item grant templates=${[...interestingTemplates].join(',')}`);
  }
}

export {
  handleQuestPacket,
  applyQuestEvents,
  questEventHandler,
  handleQuestMonsterDefeat,
  syncQuestStateToClient,
  ensureQuestStateReady,
  refreshQuestStateForItemTemplates,
  handleQuestAbandonRequest,
  sendQuestAccept,
  sendQuestUpdate,
  sendQuestProgress,
  sendQuestComplete,
  sendQuestAbandon,
  sendQuestHistory,
};
