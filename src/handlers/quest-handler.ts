const { parseQuestPacket } = require('../protocol/inbound-packets');
const { DEFAULT_FLAGS, GAME_QUEST_CMD } = require('../config');
const {
  abandonQuest,
  buildQuestSyncState,
  getQuestDefinition,
  normalizeQuestState,
} = require('../quest-engine');
const { normalizeInventoryState } = require('../inventory');
const { normalizePets } = require('../pet-runtime');
const { buildQuestPacket } = require('../protocol/gameplay-packets');
const { numberOrDefault } = require('../character/normalize');
const { applyObjectiveEvents } = require('../objectives/objective-dispatcher');
const { createQuestEventHandler } = require('../objectives/quest-event-handler');

type SessionLike = Record<string, any>;
type UnknownRecord = Record<string, any>;
type QuestSyncState = UnknownRecord & {
  taskId: number;
  markerNpcId?: number;
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
    buildQuestPacket(0x08, taskId),
    DEFAULT_FLAGS,
    `Sending quest update cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x08 taskId=${taskId} status=${status}`
  );
}

function sendQuestProgress(session: SessionLike, objectiveId: number, status: number): void {
  session.writePacket(
    buildQuestPacket(0x0b, objectiveId),
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

function sendQuestFindNpc(session: SessionLike, taskId: number, npcId: number): void {
  session.writePacket(
    buildQuestPacket(0x0c, taskId, npcId >>> 0),
    DEFAULT_FLAGS,
    `Sending quest marker cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x0c taskId=${taskId} npcId=${npcId}`
  );
}

function syncQuestStateToClient(session: SessionLike): void {
  for (const taskId of session.completedQuests) {
    sendQuestHistory(session, taskId, 0);
  }

  const syncState = buildQuestSyncState({
    activeQuests: session.activeQuests,
    completedQuests: session.completedQuests,
  });

  for (const quest of syncState) {
    sendQuestAccept(session, quest.taskId);
    for (let index = 0; index < numberOrDefault(quest.stepIndex, 0); index += 1) {
      sendQuestUpdate(session, quest.taskId, index + 1);
    }
    if (quest.stepType === 'kill' && numberOrDefault(quest.status, 0) > 0) {
      sendQuestProgress(session, numberOrDefault(quest.progressObjectiveId, quest.taskId), quest.status);
    }
    if (quest.markerNpcId > 0) {
      sendQuestFindNpc(session, quest.taskId, quest.markerNpcId);
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

function handleQuestPacket(session: SessionLike, payload: Buffer): void {
  if (payload.length < 5) {
    session.log('Short 0x03ff payload');
    return;
  }

  const { subcmd, taskId } = parseQuestPacket(payload);
  session.log(`Quest packet sub=0x${subcmd.toString(16)} taskId=${taskId}`);

  if (subcmd === 0x05) {
    const questState = {
      activeQuests: session.activeQuests,
      completedQuests: session.completedQuests,
    };
    const events = abandonQuest(questState, taskId);
    session.activeQuests = questState.activeQuests;
    session.completedQuests = questState.completedQuests;
    if (events.length > 0) {
      applyQuestEvents(session, events, 'client-abandon');
    }
    return;
  }

  if (subcmd === 0x0c) {
    const syncState = buildQuestSyncState({
      activeQuests: session.activeQuests,
      completedQuests: session.completedQuests,
    }).find((quest: UnknownRecord) => quest.taskId === taskId);
    if (syncState?.markerNpcId) {
      sendQuestFindNpc(session, taskId, syncState.markerNpcId);
    }
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

  session.dispatchObjectiveSceneTransition(session.currentMapId, 'bootstrap-scene', {
    suppressPackets: true,
    suppressDialogues: true,
    suppressStatSync: true,
  });
}

const questEventHandler = createQuestEventHandler({
  sendQuestAccept,
  sendQuestUpdate,
  sendQuestProgress,
  sendQuestComplete,
  sendQuestAbandon,
  sendQuestHistory,
  sendQuestFindNpc,
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

    const markerNpcId = syncState.markerNpcId ?? 0;
    if (markerNpcId > 0) {
      sendQuestFindNpc(session, definition.id, markerNpcId);
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
  sendQuestAccept,
  sendQuestUpdate,
  sendQuestProgress,
  sendQuestComplete,
  sendQuestAbandon,
  sendQuestHistory,
  sendQuestFindNpc,
};
