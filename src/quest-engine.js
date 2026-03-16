'use strict';

const fs = require('fs');
const path = require('path');

const QUEST_DATA_FILE = path.resolve(__dirname, '..', 'data', 'quests', 'main-story.json');
const QUEST_DEFINITIONS = Object.freeze(loadQuestDefinitions());

const QUESTS_BY_ID = new Map(QUEST_DEFINITIONS.map((quest) => [quest.id, quest]));

function loadQuestDefinitions() {
  const raw = fs.readFileSync(QUEST_DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  const quests = Array.isArray(parsed?.quests) ? parsed.quests : [];
  return quests
    .map((quest) => normalizeQuestDefinition(quest))
    .filter(Boolean);
}

function normalizeQuestDefinition(quest) {
  if (!Number.isInteger(quest?.id) || !Array.isArray(quest?.steps) || quest.steps.length === 0) {
    return null;
  }

  return {
    id: quest.id >>> 0,
    name: typeof quest.name === 'string' ? quest.name : `Quest ${quest.id}`,
    type: typeof quest.type === 'string' ? quest.type : 'story',
    acceptMessage: typeof quest.acceptMessage === 'string' ? quest.acceptMessage : '',
    completionMessage: typeof quest.completionMessage === 'string' ? quest.completionMessage : '',
    autoAccept: quest.autoAccept === true,
    acceptNpcId: Number.isInteger(quest.acceptNpcId) ? quest.acceptNpcId >>> 0 : undefined,
    acceptSubtype: Number.isInteger(quest.acceptSubtype) ? quest.acceptSubtype & 0xff : undefined,
    prerequisiteTaskIds: ensureNumberSet(quest.prerequisiteTaskIds),
    nextQuestId: Number.isInteger(quest.nextQuestId) ? quest.nextQuestId >>> 0 : undefined,
    rewards: {
      gold: numberOrDefault(quest?.rewards?.gold, 0),
      experience: numberOrDefault(quest?.rewards?.experience, 0),
    },
    steps: quest.steps
      .map((step) => normalizeQuestStep(step))
      .filter(Boolean),
  };
}

function normalizeQuestStep(step) {
  if (typeof step?.type !== 'string') {
    return null;
  }

  return {
    type: step.type,
    npcId: Number.isInteger(step.npcId) ? step.npcId >>> 0 : undefined,
    subtype: Number.isInteger(step.subtype) ? step.subtype & 0xff : undefined,
    scriptId: Number.isInteger(step.scriptId) ? step.scriptId & 0xffff : undefined,
    mapId: Number.isInteger(step.mapId) ? step.mapId >>> 0 : undefined,
    monsterId: Number.isInteger(step.monsterId) ? step.monsterId >>> 0 : undefined,
    count: Number.isInteger(step.count) ? step.count >>> 0 : undefined,
    status: Number.isInteger(step.status) ? step.status >>> 0 : undefined,
    description: typeof step.description === 'string' ? step.description : '',
    grantItems: Array.isArray(step.grantItems)
      ? step.grantItems
          .map((item) => normalizeGrantedItem(item))
          .filter(Boolean)
      : undefined,
  };
}

function normalizeGrantedItem(item) {
  if (!Number.isInteger(item?.templateId)) {
    return null;
  }

  return {
    templateId: item.templateId >>> 0,
    quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
    name: typeof item.name === 'string' ? item.name : '',
  };
}

function cloneProgress(progress) {
  if (!progress || typeof progress !== 'object') {
    return {};
  }
  return JSON.parse(JSON.stringify(progress));
}

function ensureNumberSet(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.filter((value) => Number.isInteger(value)).map((value) => value >>> 0))];
}

function getQuestDefinition(taskId) {
  return QUESTS_BY_ID.get(taskId) || null;
}

function createQuestRecord(definition) {
  return {
    id: definition.id,
    stepIndex: 0,
    status: 0,
    progress: {},
    acceptedAt: Date.now(),
  };
}

function normalizeQuestRecord(record) {
  const definition = getQuestDefinition(record?.id);
  if (!definition) {
    return null;
  }

  const stepsLength = definition.steps.length;
  const stepIndex = Math.max(0, Math.min(numberOrDefault(record?.stepIndex, 0), Math.max(0, stepsLength - 1)));
  return {
    id: definition.id,
    stepIndex,
    status: numberOrDefault(record?.status, 0),
    progress: cloneProgress(record?.progress),
    acceptedAt: numberOrDefault(record?.acceptedAt, Date.now()),
  };
}

function normalizeQuestState(character) {
  const completedQuests = ensureNumberSet(character?.completedQuests);
  const activeQuestMap = new Map();

  for (const rawRecord of Array.isArray(character?.activeQuests) ? character.activeQuests : []) {
    const record = normalizeQuestRecord(rawRecord);
    if (!record || completedQuests.includes(record.id)) {
      continue;
    }
    activeQuestMap.set(record.id, record);
  }

  return {
    activeQuests: [...activeQuestMap.values()],
    completedQuests,
  };
}

function getCurrentStep(definition, questRecord) {
  if (!definition || !questRecord) {
    return null;
  }
  return definition.steps[questRecord.stepIndex] || null;
}

function getQuestStatus(definition, questRecord) {
  const step = getCurrentStep(definition, questRecord);
  if (!step) {
    return questRecord?.status || 0;
  }

  if (step.type === 'kill') {
    const killCount = Math.max(0, numberOrDefault(questRecord?.progress?.count, 0));
    return killCount;
  }

  return numberOrDefault(step.status, questRecord?.stepIndex || 0);
}

function getQuestMarkerNpcId(definition, questRecord) {
  const step = getCurrentStep(definition, questRecord);
  if (!step) {
    return 0;
  }
  return numberOrDefault(step.npcId, 0);
}

function getQuestStepDescription(definition, questRecord) {
  const step = getCurrentStep(definition, questRecord);
  if (!step) {
    return '';
  }
  return typeof step.description === 'string' ? step.description : '';
}

function acceptQuest(state, taskId, events, reason = 'accepted') {
  const definition = getQuestDefinition(taskId);
  if (!definition) {
    return false;
  }

  if (state.completedQuests.includes(taskId) || state.activeQuests.some((quest) => quest.id === taskId)) {
    return false;
  }
  if (definition.prerequisiteTaskIds.some((prerequisiteTaskId) => !state.completedQuests.includes(prerequisiteTaskId))) {
    return false;
  }

  const record = createQuestRecord(definition);
  state.activeQuests.push(record);
  events.push({
    type: 'accepted',
    taskId,
    definition,
    status: getQuestStatus(definition, record),
    markerNpcId: getQuestMarkerNpcId(definition, record),
    stepDescription: getQuestStepDescription(definition, record),
    reason,
  });
  return true;
}

function removeActiveQuest(state, taskId) {
  const index = state.activeQuests.findIndex((quest) => quest.id === taskId);
  if (index < 0) {
    return null;
  }
  const [record] = state.activeQuests.splice(index, 1);
  return record;
}

function advanceQuest(state, record, definition, events, reason = 'advanced') {
  record.stepIndex += 1;
  record.progress = {};

  if (record.stepIndex >= definition.steps.length) {
    removeActiveQuest(state, definition.id);
    if (!state.completedQuests.includes(definition.id)) {
      state.completedQuests.push(definition.id);
    }
    const reward = {
      gold: numberOrDefault(definition.rewards?.gold, 0),
      experience: numberOrDefault(definition.rewards?.experience, 0),
    };
    events.push({
      type: 'completed',
      taskId: definition.id,
      definition,
      reward,
      reason,
    });
    if (Number.isInteger(definition.nextQuestId)) {
      acceptQuest(state, definition.nextQuestId, events, 'chain');
    }
    return;
  }

  record.status = getQuestStatus(definition, record);
  events.push({
    type: 'advanced',
    taskId: definition.id,
    definition,
    status: record.status,
    markerNpcId: getQuestMarkerNpcId(definition, record),
    stepDescription: getQuestStepDescription(definition, record),
    reason,
  });
}

function reconcileAutoAccept(state) {
  const events = [];
  for (const definition of QUEST_DEFINITIONS) {
    if (definition.autoAccept) {
      acceptQuest(state, definition.id, events, 'auto');
    }
  }
  return events;
}

function applySceneTransition(state, mapId) {
  const events = [];

  for (const record of [...state.activeQuests]) {
    const definition = getQuestDefinition(record.id);
    const step = getCurrentStep(definition, record);
    if (!step || step.type !== 'transition') {
      continue;
    }
    if (numberOrDefault(step.mapId, 0) !== mapId) {
      continue;
    }
    advanceQuest(state, record, definition, events, 'transition');
  }

  return events;
}

function applyMonsterDefeat(state, monsterId, count = 1) {
  const events = [];

  for (const record of [...state.activeQuests]) {
    const definition = getQuestDefinition(record.id);
    const step = getCurrentStep(definition, record);
    if (!step || step.type !== 'kill' || numberOrDefault(step.monsterId, 0) !== monsterId) {
      continue;
    }

    const currentCount = Math.max(0, numberOrDefault(record.progress?.count, 0));
    const nextCount = Math.min(numberOrDefault(step.count, 1), currentCount + Math.max(1, count));
    record.progress = {
      ...cloneProgress(record.progress),
      count: nextCount,
    };
    record.status = nextCount;
    events.push({
      type: 'progress',
      taskId: definition.id,
      definition,
      status: nextCount,
      markerNpcId: getQuestMarkerNpcId(definition, record),
      stepDescription: getQuestStepDescription(definition, record),
      reason: 'kill',
    });

    if (nextCount >= numberOrDefault(step.count, 1)) {
      advanceQuest(state, record, definition, events, 'kill-complete');
    }
  }

  return events;
}

function applyServerRunEvent(state, event) {
  const events = [];
  const acceptedQuestIds = new Set();

  for (const definition of QUEST_DEFINITIONS) {
    if (typeof definition.acceptNpcId === 'number' && definition.acceptNpcId !== event.npcId) {
      continue;
    }
    if (typeof definition.acceptSubtype === 'number' && definition.acceptSubtype !== event.subtype) {
      continue;
    }
    if (acceptQuest(state, definition.id, events, 'npc-click')) {
      acceptedQuestIds.add(definition.id);
    }
  }

  for (const record of [...state.activeQuests]) {
    if (acceptedQuestIds.has(record.id)) {
      continue;
    }
    const definition = getQuestDefinition(record.id);
    const step = getCurrentStep(definition, record);
    if (!step || step.type !== 'talk') {
      continue;
    }

    if (typeof step.mapId === 'number' && step.mapId !== event.mapId) {
      continue;
    }
    if (typeof step.subtype === 'number' && step.subtype !== event.subtype) {
      continue;
    }
    if (
      typeof step.npcId === 'number' &&
      typeof event.npcId === 'number' &&
      step.npcId !== event.npcId
    ) {
      continue;
    }
    if (typeof step.scriptId === 'number' && step.scriptId !== event.scriptId) {
      continue;
    }

    if (Array.isArray(step.grantItems)) {
      for (const item of step.grantItems) {
        events.push({
          type: 'item-granted',
          taskId: definition.id,
          definition,
          templateId: numberOrDefault(item?.templateId, 0),
          quantity: Math.max(1, numberOrDefault(item?.quantity, 1)),
          itemName: typeof item?.name === 'string' ? item.name : '',
        });
      }
    }

    advanceQuest(state, record, definition, events, 'talk');
  }

  return events;
}

function abandonQuest(state, taskId) {
  const definition = getQuestDefinition(taskId);
  if (!definition) {
    return [];
  }
  const record = removeActiveQuest(state, taskId);
  if (!record) {
    return [];
  }
  return [{
    type: 'abandoned',
    taskId,
    definition,
  }];
}

function buildQuestSyncState(state) {
  return state.activeQuests
    .map((record) => {
      const definition = getQuestDefinition(record.id);
      if (!definition) {
        return null;
      }
      return {
        taskId: definition.id,
        status: getQuestStatus(definition, record),
        markerNpcId: getQuestMarkerNpcId(definition, record),
        stepDescription: getQuestStepDescription(definition, record),
      };
    })
    .filter(Boolean);
}

function numberOrDefault(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

module.exports = {
  QUEST_DEFINITIONS,
  buildQuestSyncState,
  normalizeQuestState,
  reconcileAutoAccept,
  applyMonsterDefeat,
  applySceneTransition,
  applyServerRunEvent,
  abandonQuest,
  getQuestDefinition,
};
