import { parseQuestPacket } from '../protocol/inbound-packets.js';
import { DEFAULT_FLAGS, GAME_QUEST_CMD, GAME_QUEST_TABLE_CMD } from '../config.js';
import {
  abandonQuest,
  applyMonsterDefeat,
  buildQuestSyncState,
  getCurrentObjective,
  getCurrentStep,
  getCurrentStepUi,
  getQuestDefinition,
  getQuestMarkerNpcId,
  normalizeQuestState,
} from '../quest-engine/index.js';
import { normalizeInventoryState } from '../inventory/index.js';
import { normalizePets } from '../pet-runtime.js';
import { buildQuestAcceptStatePacket, buildQuestPacket, buildQuestTableSyncPacket } from '../protocol/gameplay-packets.js';
import { numberOrDefault } from '../character/normalize.js';
import { applyObjectiveEvents } from '../objectives/objective-dispatcher.js';
import { createQuestEventHandler } from '../objectives/quest-event-handler.js';
import { getMapBootstrapSpawns } from '../map-spawns.js';
import type { QuestSyncMode, GameSession } from '../types.js';

import type { UnknownRecord } from '../utils.js';
type QuestSyncState = UnknownRecord & { taskId: number };

type QuestSyncOptions = {
  mode?: QuestSyncMode;
};

type SpawnRecord = {
  id: number;
  entityType: number;
};

type QuestMonsterDefeatResult = {
  handled: boolean;
  grantedItems: Array<{ templateId: number; quantity: number }>;
};

function supportsQuestTableTaskId(taskId: number): boolean {
  const normalizedTaskId = numberOrDefault(taskId, 0);
  return normalizedTaskId > 0 && (normalizedTaskId < 0x321 || normalizedTaskId === 811);
}

function buildQuestAcceptObjectiveWords(step: UnknownRecord | null): number[] {
  if (!step) {
    return new Array(10).fill(0);
  }

  const words = new Array(10).fill(0);
  const objective = step?.objective && typeof step.objective === 'object' ? step.objective : null;
  const requiredItems = Array.isArray(objective?.requiredItems) ? objective.requiredItems : [];
  const killTargetId = numberOrDefault(objective?.targetMonsterId, 0);
  const killCount = numberOrDefault(objective?.targetCount, 0);

  if (killTargetId > 0) {
    words[0] = killTargetId & 0xffff;
  }
  if (killCount > 0) {
    words[2] = killCount & 0xffff;
  }

  if (requiredItems.length > 0) {
    const firstItem = requiredItems[0] as UnknownRecord;
    words[4] = numberOrDefault(firstItem?.templateId, 0) & 0xffff;
    words[6] = numberOrDefault(firstItem?.quantity, 0) & 0xffff;
  }

  if (requiredItems.length > 1) {
    const secondItem = requiredItems[1] as UnknownRecord;
    words[5] = numberOrDefault(secondItem?.templateId, 0) & 0xffff;
    words[7] = numberOrDefault(secondItem?.quantity, 0) & 0xffff;
  }

  return words;
}

function getQuestSyncRecord(session: GameSession, taskId: number): { definition: UnknownRecord | null; record: UnknownRecord | null } {
  const definition = getQuestDefinition(taskId);
  const record = Array.isArray(session.activeQuests)
    ? session.activeQuests.find((entry: UnknownRecord) => numberOrDefault(entry?.id, 0) === taskId) || null
    : null;
  return { definition, record };
}

function resolveQuestPacketTargetNpcId(step: UnknownRecord | null): number {
  const objective = step?.objective && typeof step.objective === 'object' ? step.objective : null;
  const ui = step?.ui && typeof step.ui === 'object' ? step.ui : null;
  return numberOrDefault(
    ui?.taskRoleNpcId,
    numberOrDefault(
      objective?.handInNpcId,
      numberOrDefault(objective?.targetNpcId, numberOrDefault(ui?.overNpcId, 0))
    )
  );
}

function buildEscortRuntimeSpawns(session: GameSession, mapId: number, baseCount: number): SpawnRecord[] {
  if (!Array.isArray(session.activeQuests) || session.activeQuests.length === 0) {
    return [];
  }

  const escortRoleIds = new Set<number>();
  for (const record of session.activeQuests) {
    const definition = getQuestDefinition(numberOrDefault(record?.id, 0));
    const step = getCurrentStep(definition as any, record as any) as UnknownRecord | null;
    const ui = getCurrentStepUi(definition as any, record as any) as UnknownRecord | null;
    if (
      !step ||
      numberOrDefault(ui?.taskType, 0) !== 8 ||
      numberOrDefault(step?.mapId, 0) !== mapId
    ) {
      continue;
    }
    const roleId = numberOrDefault(ui?.taskRoleNpcId, numberOrDefault(ui?.escortNpcId, 0));
    if (roleId > 0) {
      escortRoleIds.add(roleId >>> 0);
    }
  }

  let offset = 0;
  return [...escortRoleIds].map((roleId) => {
    offset += 1;
    return {
      id: (((mapId & 0xffff) << 16) | ((baseCount + offset) & 0xffff)) >>> 0,
      entityType: roleId & 0xffff,
    };
  });
}

function resolveTrackedNpcRuntimeId(session: GameSession, mapId: number, trackedNpcId: number): number {
  if (trackedNpcId <= 0) {
    return 0;
  }

  const staticSpawns = getMapBootstrapSpawns(mapId);
  const allSpawns = [...staticSpawns, ...buildEscortRuntimeSpawns(session, mapId, staticSpawns.length)];
  const match = allSpawns.find((spawn) => (spawn?.entityType & 0xffff) === (trackedNpcId & 0xffff));
  return numberOrDefault(match?.id, 0) >>> 0;
}

function sendQuestAcceptWithState(
  session: GameSession,
  taskId: number,
  definition: UnknownRecord | null,
  record: UnknownRecord | null
): void {
  const step = getCurrentStep(definition as any, record as any) as UnknownRecord | null;
  const ui = getCurrentStepUi(definition as any, record as any) as UnknownRecord | null;
  const stepIndex = Math.max(0, numberOrDefault(record?.stepIndex, 0));
  const markerNpcId = getQuestMarkerNpcId(definition as any, record as any);
  const overNpcId = numberOrDefault(ui?.overNpcId, markerNpcId);
  const taskType = numberOrDefault(ui?.taskType, 0);
  const targetNpcId = resolveQuestPacketTargetNpcId(step) || overNpcId;
  const maxStep = Array.isArray((definition as UnknownRecord | null)?.steps)
    ? (definition as UnknownRecord).steps.length
    : 0;

  session.writePacket(
    buildQuestAcceptStatePacket({
      subtype: 0x03,
      taskId,
      currentStep: stepIndex + 1,
      taskType,
      maxStep: Math.max(1, maxStep),
      overNpcId,
      targetNpcId,
      objectiveWords: buildQuestAcceptObjectiveWords(step),
    }),
    DEFAULT_FLAGS,
    `Sending quest accept cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x03 taskId=${taskId} step=${stepIndex + 1} type=${taskType} maxStep=${Math.max(1, maxStep)} overNpc=${overNpcId} targetNpc=${targetNpcId}`
  );
}

function sendQuestAccept(session: GameSession, taskId: number): void {
  const { definition, record } = getQuestSyncRecord(session, taskId);
  if (definition && record) {
    sendQuestAcceptWithState(session, taskId, definition, record);
    return;
  }
  session.writePacket(
    buildQuestPacket(0x03, taskId),
    DEFAULT_FLAGS,
    `Sending quest accept cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x03 taskId=${taskId}`
  );
}

function sendQuestUpdate(session: GameSession, taskId: number, status: number): void {
  session.writePacket(
    buildQuestPacket(0x08, taskId, status, 'u16'),
    DEFAULT_FLAGS,
    `Sending quest update cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x08 taskId=${taskId} status=${status}`
  );
}

function sendQuestUpdateWithState(
  session: GameSession,
  taskId: number,
  definition: UnknownRecord | null,
  record: UnknownRecord | null
): void {
  const step = getCurrentStep(definition as any, record as any) as UnknownRecord | null;
  const ui = getCurrentStepUi(definition as any, record as any) as UnknownRecord | null;
  const stepIndex = Math.max(0, numberOrDefault(record?.stepIndex, 0));
  const markerNpcId = getQuestMarkerNpcId(definition as any, record as any);
  const overNpcId = numberOrDefault(ui?.overNpcId, markerNpcId);
  const taskType = numberOrDefault(ui?.taskType, 0);
  const targetNpcId = resolveQuestPacketTargetNpcId(step) || overNpcId;
  const maxStep = Array.isArray((definition as UnknownRecord | null)?.steps)
    ? (definition as UnknownRecord).steps.length
    : 0;

  session.writePacket(
    buildQuestAcceptStatePacket({
      subtype: 0x08,
      taskId,
      currentStep: stepIndex + 1,
      taskType,
      maxStep: Math.max(1, maxStep),
      overNpcId,
      targetNpcId,
      objectiveWords: buildQuestAcceptObjectiveWords(step),
    }),
    DEFAULT_FLAGS,
    `Sending quest update cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x08 taskId=${taskId} step=${stepIndex + 1} type=${taskType} maxStep=${Math.max(1, maxStep)} overNpc=${overNpcId} targetNpc=${targetNpcId}`
  );
}

function sendQuestMarker(session: GameSession, taskId: number, npcId: number): void {
  const { definition, record } = getQuestSyncRecord(session, taskId);
  const ui = getCurrentStepUi(definition as any, record as any) as UnknownRecord | null;
  const taskType = numberOrDefault(ui?.taskType, 0);
  const trackedNpcId = numberOrDefault(
    (taskType & 0x08) !== 0 ? ui?.taskRoleNpcId : 0,
    0
  );
  const trackedRuntimeId = numberOrDefault(
    (taskType & 0x08) !== 0 ? resolveTrackedNpcRuntimeId(session, session.currentMapId >>> 0, trackedNpcId) : 0,
    npcId
  );

  session.writePacket(
    buildQuestPacket(0x0c, trackedNpcId, trackedRuntimeId, 'u32'),
    DEFAULT_FLAGS,
    `Sending quest marker cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x0c questId=${taskId} trackedNpc=${trackedNpcId} trackedRuntime=0x${trackedRuntimeId.toString(16)} markerNpc=${npcId}`
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

function sendQuestTableStateSync(session: GameSession, syncState: QuestSyncState[]): void {
  const supportedQuests = syncState
    .filter((quest) => supportsQuestTableTaskId(numberOrDefault(quest.taskId, 0)))
    .slice(0, 0x10)
    .map((quest) => {
      const { definition, record } = getQuestSyncRecord(session, numberOrDefault(quest.taskId, 0));
      const ui = getCurrentStepUi(definition as any, record as any) as UnknownRecord | null;
      return {
        taskId: numberOrDefault(quest.taskId, 0),
        step: Math.max(1, numberOrDefault(quest.stepIndex, 0) + 1),
        extraA: numberOrDefault(quest.maxAward, numberOrDefault(ui?.maxAward, 0)),
        extraB: numberOrDefault(quest.taskStep, numberOrDefault(ui?.taskStep, 0)),
      };
    });
  const historyEntries = Array.isArray(session.completedQuests)
    ? session.completedQuests
        .filter((taskId) => supportsQuestTableTaskId(numberOrDefault(taskId, 0)))
        .map((taskId) => ({
          taskId: numberOrDefault(taskId, 0),
          state: 0,
        }))
    : [];

  const skippedCount = Math.max(0, syncState.length - supportedQuests.length);
  session.writePacket(
    buildQuestTableSyncPacket({
      playerRuntimeId: session.runtimeId >>> 0,
      subtype: 0x08,
      quests: supportedQuests,
      history: historyEntries,
    }),
    DEFAULT_FLAGS,
    `Sending quest table sync cmd=0x${GAME_QUEST_TABLE_CMD.toString(16)} sub=0x08 player=0x${(session.runtimeId >>> 0).toString(16)} quests=${supportedQuests.length} history=${historyEntries.length} skipped=${skippedCount}`
  );
}

function replayQuestTrackerScripts(
  session: GameSession,
  _taskId: number,
  definition: UnknownRecord | null,
  record: UnknownRecord | null
): void {
  const step = getCurrentStep(definition as any, record as any) as UnknownRecord | null;
  const ui = getCurrentStepUi(definition as any, record as any) as UnknownRecord | null;
  if (numberOrDefault(ui?.taskType, 0) !== 8) {
    return;
  }

  const trackerScriptIds = Array.isArray(ui?.trackerScriptIds)
    ? ui.trackerScriptIds.filter(Number.isInteger).map((scriptId: number) => scriptId >>> 0)
    : [];
  for (const scriptId of trackerScriptIds) {
    session.sendServerRunScriptImmediate?.(scriptId);
    session.sendServerRunScriptDeferred?.(scriptId);
  }
}

function syncQuestStateToClient(session: GameSession, options: QuestSyncOptions = {}): void {
  const mode: QuestSyncMode = options.mode || 'runtime';
  const replayTalkStepUpdates = mode === 'login';

  const syncState = buildQuestSyncState({
    activeQuests: session.activeQuests,
    completedQuests: session.completedQuests,
  }) as QuestSyncState[];

  sendQuestTableStateSync(session, syncState);
  for (const taskId of session.completedQuests) {
    sendQuestHistory(session, taskId, 0);
  }

  for (const quest of syncState) {
    const { definition, record } = getQuestSyncRecord(session, quest.taskId);
    if (mode === 'login') {
      sendQuestAcceptWithState(session, quest.taskId, definition, record);
      if (quest.stepMode === 'kill') {
        sendQuestUpdateWithState(session, quest.taskId, definition, record);
      }
    } else {
      sendQuestAccept(session, quest.taskId);
    }
    // Talk-step replay is mode-dependent: full login needs it so the client
    // reconstructs the current stage, while runtime refreshes stay minimal.
    if (quest.stepMode === 'kill' || (replayTalkStepUpdates && quest.stepMode === 'talk')) {
      for (let index = 0; index < numberOrDefault(quest.stepIndex, 0); index += 1) {
        sendQuestUpdate(session, quest.taskId, index + 1);
      }
    }
    if (quest.stepMode === 'kill' && numberOrDefault(quest.status, 0) > 0) {
      sendQuestUpdate(session, quest.taskId, numberOrDefault(quest.status, 0));
    }
    if (quest.stepMode === 'kill' && numberOrDefault(quest.progressCount, 0) > 0) {
      sendQuestProgress(
        session,
        numberOrDefault(quest.progressObjectiveId, quest.taskId),
        numberOrDefault(quest.progressCount, 0)
      );
    }
    const markerNpcId = getQuestMarkerNpcId(definition as any, record as any);
    if (markerNpcId > 0) {
      sendQuestMarker(session, quest.taskId, markerNpcId);
    }
    replayQuestTrackerScripts(session, quest.taskId, definition, record);
  }

  if (!session.hasAnnouncedQuestOverview && syncState.length > 0) {
    const activeQuest = syncState[0];
    session.sendGameDialogue('Quest', `Active quest loaded.${activeQuest.stepDescription ? ` ${activeQuest.stepDescription}` : ''}`);
    session.hasAnnouncedQuestOverview = true;
  }
}

function applyQuestEvents(
  session: GameSession,
  events: UnknownRecord[],
  source = 'runtime',
  options: UnknownRecord = {}
): void {
  applyObjectiveEvents(session, events, questEventHandler, source, options);
}

function handleQuestAbandonRequest(session: GameSession, taskId: number, source = 'client-abandon'): boolean {
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
  const questState = {
    activeQuests: session.activeQuests,
    completedQuests: session.completedQuests,
    level: session.level,
  };
  const events = applyMonsterDefeat(questState as any, monsterId, count);
  session.activeQuests = questState.activeQuests;
  session.completedQuests = questState.completedQuests;

  if (events.length > 0) {
    applyQuestEvents(session, events as UnknownRecord[], 'monster-defeat');
  }

  return {
    handled: events.length > 0,
    grantedItems: events
      .filter((event: UnknownRecord) => event?.type === 'item-granted' && event?.reason === 'defeat-collect')
      .map((event: UnknownRecord) => ({
        templateId: numberOrDefault(event?.templateId, 0),
        quantity: Math.max(1, numberOrDefault(event?.quantity, 1)),
      }))
      .filter((item) => item.templateId > 0),
  };
}

function ensureQuestStateReady(session: GameSession): void {
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

function refreshQuestStateForItemTemplates(session: GameSession, templateIds: number[]): void {
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
    }).map((quest: any) => [quest.taskId, quest] as [number, QuestSyncState])
  );

  for (const record of session.activeQuests) {
    const definition = getQuestDefinition(record?.id);
    if (!definition) {
      continue;
    }
    const objective = getCurrentObjective(definition as any, record as any) as UnknownRecord | null;
    const requiredItems = Array.isArray(objective?.requiredItems) ? objective.requiredItems : [];
    if (requiredItems.length === 0) {
      continue;
    }

    const matchesGrantedItem = requiredItems.some((item: UnknownRecord) =>
      interestingTemplates.has(numberOrDefault(item?.templateId, 0) >>> 0)
    );
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
