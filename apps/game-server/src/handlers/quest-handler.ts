import { parseQuestPacket } from '../protocol/inbound-packets.js';
import { DEFAULT_FLAGS, GAME_QUEST_CMD, GAME_QUEST_TABLE_CMD } from '../config.js';
import {
  abandonQuest,
  applyMonsterDefeat,
  buildQuestSyncState,
  getCurrentObjective,
  getCurrentStep,
  getCurrentStepUi,
  isClientTasklistFamilyTask,
  getQuestDefinition,
  getQuestMarkerNpcId,
  normalizeQuestState,
} from '../quest-engine/index.js';
import { getBagQuantityByTemplateId } from '../inventory/index.js';
import { normalizeInventoryState } from '../inventory/index.js';
import { normalizePets } from '../pet-runtime.js';
import { buildQuestAcceptStatePacket, buildQuestPacket, buildQuestTableSyncPacket } from '../protocol/gameplay-packets.js';
import { numberOrDefault } from '../character/normalize.js';
import { applyObjectiveEvents } from '../objectives/objective-dispatcher.js';
import { createQuestEventHandler } from '../objectives/quest-event-handler.js';
import { getMapBootstrapSpawns } from '../map-spawns.js';
import { isQuest2DefinitionId } from '../quest2/definitions.js';
import { filterLegacyCompletedQuestIds, filterLegacyQuestRecords } from '../quest2/legacy-state.js';
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
import type { QuestSyncMode, GameSession } from '../types.js';

import { sanitizeQuestDialogueText } from '../utils.js';

import type { UnknownRecord } from '../utils.js';
type QuestSyncState = UnknownRecord & { taskId: number; source?: 'legacy' | 'quest2' };

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

const CLIENT_QUEST_ALIAS_TASKS = new Map<number, number>([
  [811, 383],
]);
const MIRRORED_CLIENT_QUESTS_BY_SESSION = new WeakMap<GameSession, Set<number>>();
const RENOWN_TASK_ID = 811;
const RENOWN_CLIENT_ALIAS_TASK_ID = 383;
const RENOWN_OUTCAST_MAP_ID = 128;

function supportsQuestTableTaskId(taskId: number): boolean {
  const normalizedTaskId = numberOrDefault(taskId, 0);
  return normalizedTaskId > 0 && (normalizedTaskId < 0x321 || normalizedTaskId === 811) && (!isClientTasklistFamilyTask(normalizedTaskId) || normalizedTaskId === 811);
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
    words[1] = killCount & 0xffff;
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

function resolveQuestPacketTaskRoleNpcId(step: UnknownRecord | null): number {
  const ui = step?.ui && typeof step.ui === 'object' ? step.ui : null;
  return numberOrDefault(ui?.taskRoleNpcId, 0);
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

function usesQuestTrackerMarkerPacket(ui: UnknownRecord | null): boolean {
  return (numberOrDefault(ui?.taskType, 0) & 0x08) !== 0;
}

function questUsesTrackerMarkerPacket(session: GameSession, taskId: number): boolean {
  const { definition, record } = getQuestSyncRecord(session, taskId);
  const ui = getCurrentStepUi(definition as any, record as any) as UnknownRecord | null;
  return usesQuestTrackerMarkerPacket(ui);
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
  const taskRoleNpcId = resolveQuestPacketTaskRoleNpcId(step);
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
      taskRoleNpcId,
      objectiveWords: buildQuestAcceptObjectiveWords(step),
    }),
    DEFAULT_FLAGS,
    `Sending quest accept cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x03 taskId=${taskId} step=${stepIndex + 1} type=${taskType} maxStep=${Math.max(1, maxStep)} overNpc=${overNpcId} taskRole=${taskRoleNpcId}`
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
  const taskRoleNpcId = resolveQuestPacketTaskRoleNpcId(step);
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
      taskRoleNpcId,
      objectiveWords: buildQuestAcceptObjectiveWords(step),
    }),
    DEFAULT_FLAGS,
    `Sending quest update cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x08 taskId=${taskId} step=${stepIndex + 1} type=${taskType} maxStep=${Math.max(1, maxStep)} overNpc=${overNpcId} taskRole=${taskRoleNpcId}`
  );
}

function sendQuestMarker(session: GameSession, taskId: number, npcId: number): void {
  const { definition, record } = getQuestSyncRecord(session, taskId);
  const ui = getCurrentStepUi(definition as any, record as any) as UnknownRecord | null;
  const taskType = numberOrDefault(ui?.taskType, 0);
  const trackedNpcId =
    numberOrDefault((taskType & 0x08) !== 0 ? ui?.taskRoleNpcId : 0, 0) ||
    numberOrDefault(npcId, 0);
  const trackedRuntimeId =
    trackedNpcId > 0
      ? resolveTrackedNpcRuntimeId(session, session.currentMapId >>> 0, trackedNpcId)
      : 0;

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

function buildLegacyQuestSyncState(session: GameSession): QuestSyncState[] {
  return buildQuestSyncState({
    activeQuests: filterLegacyQuestRecords(session.activeQuests),
    completedQuests: filterLegacyCompletedQuestIds(session.completedQuests),
  }).map((quest: UnknownRecord) => ({
    ...quest,
    source: 'legacy',
  })) as QuestSyncState[];
}

function buildCombinedCompletedQuestIds(session: GameSession): number[] {
  const completed = new Set<number>();
  for (const taskId of filterLegacyCompletedQuestIds(session.completedQuests)) {
    completed.add(taskId >>> 0);
  }
  for (const taskId of Array.isArray(session.questStateV2?.completed) ? session.questStateV2.completed : []) {
    if (Number.isInteger(taskId) && taskId > 0) {
      completed.add(taskId >>> 0);
    }
  }
  return [...completed].sort((left, right) => left - right);
}

function sendQuestTableStateSync(
  session: GameSession,
  syncState: QuestSyncState[],
  completedTaskIds: number[]
): void {
  const supportedQuests = syncState
    .filter((quest) => supportsQuestTableTaskId(numberOrDefault(quest.taskId, 0)))
    .slice(0, 0x10)
    .map((quest) => {
      return {
        taskId: numberOrDefault(quest.taskId, 0),
        step: Math.max(1, numberOrDefault(quest.stepIndex, 0) + 1),
        extraA: numberOrDefault(quest.maxAward, 0),
        extraB: numberOrDefault(quest.taskStep, 0),
      };
    });
  const historyEntries = completedTaskIds
    .filter((taskId) => supportsQuestTableTaskId(numberOrDefault(taskId, 0)))
    .map((taskId) => ({
      taskId: numberOrDefault(taskId, 0),
      state: 0,
    }));

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
  const quest2SyncState = buildQuest2SyncState(session.questStateV2);
  const syncState = [...quest2SyncState].sort((left, right) => {
    if (numberOrDefault(left.acceptedAt, 0) !== numberOrDefault(right.acceptedAt, 0)) {
      return numberOrDefault(left.acceptedAt, 0) - numberOrDefault(right.acceptedAt, 0);
    }
    return numberOrDefault(left.taskId, 0) - numberOrDefault(right.taskId, 0);
  });
  const completedTaskIds = Array.isArray(session.questStateV2?.completed)
    ? session.questStateV2.completed
        .filter(Number.isInteger)
        .map((taskId: number) => taskId >>> 0)
        .sort((left: number, right: number) => left - right)
    : [];

  session.log(
    `Quest sync mode=${mode} quest2Active=${quest2SyncState.length} quest2Completed=${completedTaskIds.length}`
  );

  const mirroredClientQuestIds = new Set<number>();
  sendQuestTableStateSync(session, syncState, completedTaskIds);
  for (const taskId of completedTaskIds) {
    sendQuestHistory(session, taskId, 0);
  }

  for (const quest of quest2SyncState) {
    const shouldSendFullUpdateState =
      quest.stepMode === 'kill' ||
      numberOrDefault(quest.stepIndex, 0) > 0 ||
      numberOrDefault(quest.status, 0) > 0;

    sendQuest2AcceptWithState(session, quest);
    if (mode === 'login') {
      if (shouldSendFullUpdateState) {
        sendQuest2UpdateWithState(session, quest);
      }
    } else {
      if (shouldSendFullUpdateState) {
        sendQuest2UpdateWithState(session, quest);
      }
    }

    if (numberOrDefault(quest.stepIndex, 0) > 0) {
      for (let index = 0; index < numberOrDefault(quest.stepIndex, 0); index += 1) {
        sendQuestUpdate(session, quest.taskId, index + 1);
      }
    }
    if (numberOrDefault(quest.status, 0) > 0) {
      sendQuestUpdate(session, quest.taskId, numberOrDefault(quest.status, 0));
    }
    if (quest.stepMode === 'kill' && numberOrDefault(quest.progressCount, 0) > 0) {
      sendQuestProgress(
        session,
        numberOrDefault(quest.progressObjectiveId, quest.taskId),
        numberOrDefault(quest.progressCount, 0)
      );
    }
    if (numberOrDefault(quest.markerNpcId, 0) > 0 && usesQuest2TrackerMarkerPacket(quest)) {
      sendQuest2Marker(session, quest);
    }
    replayQuest2TrackerScripts(session, quest);
  }

  clearStaleMirroredClientQuests(session, mirroredClientQuestIds);
  MIRRORED_CLIENT_QUESTS_BY_SESSION.set(session, mirroredClientQuestIds);

  if (!session.hasAnnouncedQuestOverview && syncState.length > 0) {
    const activeQuest = syncState[0];
    session.sendGameDialogue(
      'Quest',
      sanitizeQuestDialogueText(`Active quest loaded.${activeQuest.stepDescription ? ` ${activeQuest.stepDescription}` : ''}`)
    );
    session.hasAnnouncedQuestOverview = true;
  }
}

function collectMissingAcceptGrantItemEvents(session: GameSession, syncState: QuestSyncState[]): UnknownRecord[] {
  const events: UnknownRecord[] = [];

  for (const quest of syncState) {
    const { definition } = getQuestSyncRecord(session, quest.taskId);
    const grantItems = Array.isArray(definition?.acceptGrantItems) ? definition!.acceptGrantItems : [];
    for (const item of grantItems) {
      const templateId = numberOrDefault(item?.templateId, 0);
      const quantity = Math.max(1, numberOrDefault(item?.quantity, 1));
      if (templateId <= 0) {
        continue;
      }
      const currentQuantity = getBagQuantityByTemplateId(session, templateId);
      if (currentQuantity >= quantity) {
        continue;
      }
      events.push({
        type: 'item-granted',
        taskId: quest.taskId,
        definition,
        templateId,
        quantity: quantity - currentQuantity,
        itemName: typeof item?.name === 'string' ? item.name : '',
        reason: 'sync-ensure-accept-item',
      });
    }
  }

  return events;
}

function resolveClientQuestAliasTaskId(quest: QuestSyncState, session: GameSession): number {
  const taskId = numberOrDefault(quest?.taskId, 0);
  const aliasTaskId = numberOrDefault(CLIENT_QUEST_ALIAS_TASKS.get(taskId), 0);
  if (aliasTaskId <= 0) {
    return 0;
  }
  const hasRealAliasTask = Array.isArray(session.activeQuests)
    ? session.activeQuests.some((record) => numberOrDefault(record?.id, 0) === aliasTaskId)
    : false;
  if (hasRealAliasTask) {
    return 0;
  }
  if (
    taskId === RENOWN_TASK_ID &&
    aliasTaskId === RENOWN_CLIENT_ALIAS_TASK_ID &&
    (
      (session.currentMapId >>> 0) !== RENOWN_OUTCAST_MAP_ID ||
      numberOrDefault(quest?.stepIndex, 0) !== 0 ||
      numberOrDefault(quest?.status, 0) !== 0
    )
  ) {
    return 0;
  }
  return aliasTaskId;
}

function clearStaleMirroredClientQuests(session: GameSession, mirroredClientQuestIds: Set<number>): void {
  const previousMirroredClientQuestIds = MIRRORED_CLIENT_QUESTS_BY_SESSION.get(session);
  if (!previousMirroredClientQuestIds || previousMirroredClientQuestIds.size < 1) {
    return;
  }

  for (const clientTaskId of previousMirroredClientQuestIds) {
    if (mirroredClientQuestIds.has(clientTaskId)) {
      continue;
    }
    sendQuestMarker(session, clientTaskId, 0);
    sendQuestUpdate(session, clientTaskId, 0);
    sendQuestAbandon(session, clientTaskId);
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
  if (!isQuest2DefinitionId(taskId)) {
    session.log(`Ignoring legacy quest abandon taskId=${taskId} source=${source}`);
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
  const quest2Result = dispatchQuestEventToSession(session, {
    type: 'monster_defeat',
    monsterId: monsterId >>> 0,
    count: Math.max(1, count),
    mapId: session.currentMapId >>> 0,
  });

  return {
    handled: quest2Result.handled,
    grantedItems: quest2Result.grantedItems,
  };
}

function ensureQuestStateReady(session: GameSession): void {
  const persisted = session.getPersistedCharacter();
  if (persisted) {
    const questState = normalizeQuestState(persisted);
    session.activeQuests = filterLegacyQuestRecords(questState.activeQuests);
    session.completedQuests = filterLegacyCompletedQuestIds(questState.completedQuests);
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
}

const questEventHandler = createQuestEventHandler({
  sendQuestAccept,
  sendQuestUpdate,
  sendQuestMarker,
  sendQuestProgress,
  sendQuestComplete,
  sendQuestAbandon,
  sendQuestHistory,
  usesQuestTrackerMarkerPacket: questUsesTrackerMarkerPacket,
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
