'use strict';

const fs = require('fs');
const path = require('path');

const QUEST_DATA_FILE = path.resolve(__dirname, '..', 'data', 'quests', 'main-story.json');
const CLIENT_QUEST_METADATA_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quests.json');
const CLIENT_QUEST_METADATA = loadClientQuestMetadata();
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

  const clientMeta = CLIENT_QUEST_METADATA.get(quest.id >>> 0) || null;
  const prerequisiteTaskIds = mergePrerequisiteTaskIds(
    quest.prerequisiteTaskIds,
    clientMeta?.prerequisiteTaskId
  );

  return {
    id: quest.id >>> 0,
    name:
      sanitizeClientQuestTitle(clientMeta?.title) ||
      (typeof quest.name === 'string' ? quest.name : `Quest ${quest.id}`),
    type: typeof quest.type === 'string' ? quest.type : 'story',
    acceptMessage: typeof quest.acceptMessage === 'string' ? quest.acceptMessage : '',
    completionMessage: typeof quest.completionMessage === 'string' ? quest.completionMessage : '',
    autoAccept: quest.autoAccept === true,
    acceptNpcId:
      Number.isInteger(clientMeta?.startNpcId) && clientMeta.startNpcId > 0
        ? clientMeta.startNpcId >>> 0
        : Number.isInteger(quest.acceptNpcId)
          ? quest.acceptNpcId >>> 0
          : undefined,
    acceptSubtype: Number.isInteger(quest.acceptSubtype) ? quest.acceptSubtype & 0xff : undefined,
    prerequisiteTaskIds,
    minLevel:
      Number.isInteger(clientMeta?.minLevel) && clientMeta.minLevel > 0
        ? clientMeta.minLevel >>> 0
        : 1,
    acceptGrantItems: Array.isArray(quest.acceptGrantItems)
      ? quest.acceptGrantItems
          .map((item) => normalizeGrantedItem(item))
          .filter(Boolean)
      : undefined,
    auxiliaryActions: Array.isArray(quest.auxiliaryActions)
      ? quest.auxiliaryActions
          .map((action) => normalizeAuxiliaryAction(action))
          .filter(Boolean)
      : [],
    nextQuestId: Number.isInteger(quest.nextQuestId) ? quest.nextQuestId >>> 0 : undefined,
    rewards: {
      gold: numberOrDefault(quest?.rewards?.gold, 0),
      experience: numberOrDefault(quest?.rewards?.experience, 0),
      coins: numberOrDefault(quest?.rewards?.coins, 0),
      renown: numberOrDefault(quest?.rewards?.renown, 0),
      choiceGroups: Array.isArray(quest?.rewards?.choiceGroups)
        ? quest.rewards.choiceGroups
            .map((group) => normalizeRewardChoiceGroup(group))
            .filter(Boolean)
        : [],
      items: Array.isArray(quest?.rewards?.items)
        ? quest.rewards.items
            .map((item) => normalizeGrantedItem(item))
            .filter(Boolean)
        : [],
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
    consumeItems: Array.isArray(step.consumeItems)
      ? step.consumeItems
          .map((item) => normalizeGrantedItem(item))
          .filter(Boolean)
      : undefined,
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

function normalizeRewardChoiceGroup(group) {
  if (!group || typeof group !== 'object') {
    return null;
  }

  return {
    awardId: Number.isInteger(group.awardId) ? group.awardId >>> 0 : 0,
    gold: numberOrDefault(group.gold, 0),
    experience: numberOrDefault(group.experience, 0),
    coins: numberOrDefault(group.coins, 0),
    renown: numberOrDefault(group.renown, 0),
    pets: Array.isArray(group.pets) ? group.pets.slice() : [],
    items: Array.isArray(group.items)
      ? group.items
          .map((item) => normalizeGrantedItem(item))
          .filter(Boolean)
      : [],
  };
}

function normalizeAuxiliaryAction(action) {
  if (!action || typeof action.type !== 'string') {
    return null;
  }

  return {
    type: action.type,
    stepStatus: Number.isInteger(action.stepStatus) ? action.stepStatus >>> 0 : undefined,
    subtype: Number.isInteger(action.subtype) ? action.subtype & 0xff : undefined,
    npcId: Number.isInteger(action.npcId) ? action.npcId >>> 0 : undefined,
    contextId: Number.isInteger(action.contextId) ? action.contextId >>> 0 : undefined,
    extra: Number.isInteger(action.extra) ? action.extra & 0xff : undefined,
    scriptId: Number.isInteger(action.scriptId) ? action.scriptId & 0xffff : undefined,
    mapId: Number.isInteger(action.mapId) ? action.mapId >>> 0 : undefined,
    monsterId: Number.isInteger(action.monsterId) ? action.monsterId >>> 0 : undefined,
    count: Number.isInteger(action.count) ? action.count >>> 0 : undefined,
    onlyIfMissingTemplateId: Number.isInteger(action.onlyIfMissingTemplateId) ? action.onlyIfMissingTemplateId >>> 0 : undefined,
    grantItems: Array.isArray(action.grantItems)
      ? action.grantItems
          .map((item) => normalizeGrantedItem(item))
          .filter(Boolean)
      : [],
  };
}

function loadClientQuestMetadata() {
  try {
    const raw = fs.readFileSync(CLIENT_QUEST_METADATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return new Map(
      entries
        .filter((entry) => Number.isInteger(entry?.taskId))
        .map((entry) => [entry.taskId >>> 0, entry])
    );
  } catch (err) {
    return new Map();
  }
}

function sanitizeClientQuestTitle(title) {
  if (typeof title !== 'string' || title.length === 0) {
    return '';
  }
  return title.replace(/<[^>]+>/g, '').trim();
}

function mergePrerequisiteTaskIds(rawIds, clientPrerequisiteTaskId) {
  const merged = ensureNumberSet(rawIds);
  if (Number.isInteger(clientPrerequisiteTaskId) && clientPrerequisiteTaskId > 0) {
    merged.push(clientPrerequisiteTaskId >>> 0);
  }
  return ensureNumberSet(merged);
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
    level: numberOrDefault(character?.level, 1),
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

  return numberOrDefault(step.status, numberOrDefault(questRecord?.stepIndex, 0));
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
  if (numberOrDefault(state?.level, 1) < numberOrDefault(definition.minLevel, 1)) {
    return false;
  }

  const record = createQuestRecord(definition);
  state.activeQuests.push(record);
  if (Array.isArray(definition.acceptGrantItems)) {
    for (const item of definition.acceptGrantItems) {
      events.push({
        type: 'item-granted',
        taskId,
        definition,
        templateId: numberOrDefault(item?.templateId, 0),
        quantity: Math.max(1, numberOrDefault(item?.quantity, 1)),
        itemName: typeof item?.name === 'string' ? item.name : '',
        reason,
      });
    }
  }
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
      coins: numberOrDefault(definition.rewards?.coins, 0),
      renown: numberOrDefault(definition.rewards?.renown, 0),
      items: Array.isArray(definition.rewards?.items) ? definition.rewards.items : [],
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
    if (typeof step.npcId === 'number') {
      if (typeof event.npcId !== 'number' || step.npcId !== event.npcId) {
        continue;
      }
    }
    if (typeof step.scriptId === 'number' && step.scriptId !== event.scriptId) {
      continue;
    }

    if (Array.isArray(step.consumeItems)) {
      let missingRequiredItem = false;
      for (const item of step.consumeItems) {
        const requiredQuantity = Math.max(1, numberOrDefault(item?.quantity, 1));
        const availableQuantity = getInventoryQuantity(event.inventory, numberOrDefault(item?.templateId, 0));
        if (availableQuantity < requiredQuantity) {
          missingRequiredItem = true;
          events.push({
            type: 'item-missing',
            taskId: definition.id,
            definition,
            templateId: numberOrDefault(item?.templateId, 0),
            quantity: requiredQuantity,
            itemName: typeof item?.name === 'string' ? item.name : '',
          });
          break;
        }
      }
      if (missingRequiredItem) {
        continue;
      }
      for (const item of step.consumeItems) {
        events.push({
          type: 'item-consumed',
          taskId: definition.id,
          definition,
          templateId: numberOrDefault(item?.templateId, 0),
          quantity: Math.max(1, numberOrDefault(item?.quantity, 1)),
          itemName: typeof item?.name === 'string' ? item.name : '',
        });
      }
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

function resolveQuestServerRunAuxiliaryActions(state, event) {
  const events = [];

  for (const record of state.activeQuests) {
    const definition = getQuestDefinition(record.id);
    const step = getCurrentStep(definition, record);
    if (!definition || !step) {
      continue;
    }

    for (const action of Array.isArray(definition.auxiliaryActions) ? definition.auxiliaryActions : []) {
      if (!matchesAuxiliaryAction(action, step, event)) {
        continue;
      }

      if (action.type === 'grant_on_server_run') {
        const requiredMissingTemplateId = numberOrDefault(action.onlyIfMissingTemplateId, 0);
        if (requiredMissingTemplateId > 0 && getInventoryQuantity(event.inventory, requiredMissingTemplateId) > 0) {
          continue;
        }
        for (const item of Array.isArray(action.grantItems) ? action.grantItems : []) {
          events.push({
            type: 'item-granted',
            taskId: definition.id,
            definition,
            templateId: numberOrDefault(item?.templateId, 0),
            quantity: Math.max(1, numberOrDefault(item?.quantity, 1)),
            itemName: typeof item?.name === 'string' ? item.name : '',
            reason: 'auxiliary-server-run',
          });
        }
        continue;
      }

      if (action.type === 'combat_on_server_run') {
        events.push({
          type: 'quest-combat-trigger',
          taskId: definition.id,
          definition,
          monsterId: numberOrDefault(action.monsterId, 0),
          count: Math.max(1, numberOrDefault(action.count, 1)),
          npcId: numberOrDefault(action.npcId, 0),
          mapId: numberOrDefault(action.mapId, numberOrDefault(step.mapId, 0)),
        });
      }
    }
  }

  return events;
}

function matchesAuxiliaryAction(action, step, event) {
  if (!action || !step) {
    return false;
  }
  if (Number.isInteger(action.stepStatus) && action.stepStatus !== numberOrDefault(step.status, 0)) {
    return false;
  }
  if (Number.isInteger(action.subtype) && action.subtype !== numberOrDefault(event.subtype, 0)) {
    return false;
  }
  if (Number.isInteger(action.mapId) && action.mapId !== numberOrDefault(event.mapId, 0)) {
    return false;
  }
  if (Number.isInteger(action.npcId) && action.npcId !== numberOrDefault(event.npcId, 0)) {
    return false;
  }
  if (Number.isInteger(action.contextId) && action.contextId !== numberOrDefault(event.contextId, 0)) {
    return false;
  }
  if (Number.isInteger(action.extra) && action.extra !== numberOrDefault(event.extra, 0)) {
    return false;
  }
  if (Number.isInteger(action.scriptId) && action.scriptId !== numberOrDefault(event.scriptId, 0)) {
    return false;
  }
  return true;
}

function buildServerRunQuestTrace(state, event) {
  const trace = [];

  for (const definition of QUEST_DEFINITIONS) {
    if (typeof definition.acceptNpcId === 'number' || typeof definition.acceptSubtype === 'number') {
      const mismatchReasons = [];
      if (typeof definition.acceptNpcId === 'number' && definition.acceptNpcId !== event.npcId) {
        mismatchReasons.push(`npc ${definition.acceptNpcId}!=${numberOrDefault(event.npcId, 0)}`);
      }
      if (typeof definition.acceptSubtype === 'number' && definition.acceptSubtype !== event.subtype) {
        mismatchReasons.push(`subtype 0x${definition.acceptSubtype.toString(16)}!=0x${numberOrDefault(event.subtype, 0).toString(16)}`);
      }

      if (mismatchReasons.length === 0) {
        const alreadyCompleted = state.completedQuests.includes(definition.id);
        const alreadyActive = state.activeQuests.some((quest) => quest.id === definition.id);
        const missingPrerequisites = definition.prerequisiteTaskIds.filter(
          (prerequisiteTaskId) => !state.completedQuests.includes(prerequisiteTaskId)
        );
        if (alreadyCompleted) {
          trace.push(`[accept] task=${definition.id} "${definition.name}" skipped: already completed`);
        } else if (alreadyActive) {
          trace.push(`[accept] task=${definition.id} "${definition.name}" skipped: already active`);
        } else if (missingPrerequisites.length > 0) {
          trace.push(`[accept] task=${definition.id} "${definition.name}" skipped: missing prerequisites ${missingPrerequisites.join(',')}`);
        } else if (numberOrDefault(state?.level, 1) < numberOrDefault(definition.minLevel, 1)) {
          trace.push(`[accept] task=${definition.id} "${definition.name}" skipped: level ${numberOrDefault(state?.level, 1)} < ${numberOrDefault(definition.minLevel, 1)}`);
        } else {
          trace.push(`[accept] task=${definition.id} "${definition.name}" matched`);
        }
      }
    }
  }

  for (const record of state.activeQuests) {
    const definition = getQuestDefinition(record.id);
    const step = getCurrentStep(definition, record);
    if (!definition) {
      trace.push(`[step] task=${numberOrDefault(record?.id, 0)} missing definition`);
      continue;
    }
    if (!step) {
      trace.push(`[step] task=${definition.id} "${definition.name}" has no current step`);
      continue;
    }
    if (step.type !== 'talk') {
      trace.push(`[step] task=${definition.id} "${definition.name}" ignored: current step type=${step.type}`);
      continue;
    }

    const mismatchReasons = [];
    if (typeof step.mapId === 'number' && step.mapId !== event.mapId) {
      mismatchReasons.push(`map ${step.mapId}!=${numberOrDefault(event.mapId, 0)}`);
    }
    if (typeof step.subtype === 'number' && step.subtype !== event.subtype) {
      mismatchReasons.push(`subtype 0x${step.subtype.toString(16)}!=0x${numberOrDefault(event.subtype, 0).toString(16)}`);
    }
    if (typeof step.npcId === 'number') {
      if (typeof event.npcId !== 'number') {
        mismatchReasons.push(`npc ${step.npcId}!=missing`);
      } else if (step.npcId !== event.npcId) {
        mismatchReasons.push(`npc ${step.npcId}!=${event.npcId}`);
      }
    }
    if (typeof step.scriptId === 'number' && step.scriptId !== event.scriptId) {
      mismatchReasons.push(`script ${step.scriptId}!=${numberOrDefault(event.scriptId, 0)}`);
    }

    if (Array.isArray(step.consumeItems)) {
      for (const item of step.consumeItems) {
        const requiredQuantity = Math.max(1, numberOrDefault(item?.quantity, 1));
        const availableQuantity = getInventoryQuantity(event.inventory, numberOrDefault(item?.templateId, 0));
        if (availableQuantity <= 0) {
          mismatchReasons.push(`missing item ${numberOrDefault(item?.templateId, 0)} x${requiredQuantity}`);
          break;
        }
        if (availableQuantity < requiredQuantity) {
          mismatchReasons.push(`item ${numberOrDefault(item?.templateId, 0)} short ${availableQuantity}/${requiredQuantity}`);
          break;
        }
      }
    }

    if (mismatchReasons.length > 0) {
      trace.push(
        `[step] task=${definition.id} "${definition.name}" step=${record.stepIndex} blocked: ${mismatchReasons.join(', ')}`
      );
      continue;
    }

    trace.push(
      `[step] task=${definition.id} "${definition.name}" step=${record.stepIndex} matched${step.description ? `: ${step.description}` : ''}`
    );
  }

  if (trace.length === 0) {
    trace.push('[quest-trace] no acceptors or active talk steps evaluated');
  }

  return trace;
}

function abandonQuest(state, taskId) {
  const definition = getQuestDefinition(taskId);
  if (!definition) {
    return [];
  }
  const hadCompleted = state.completedQuests.includes(taskId);
  state.completedQuests = state.completedQuests.filter((completedTaskId) => completedTaskId !== taskId);
  const record = removeActiveQuest(state, taskId);
  if (!record && !hadCompleted) {
    return [];
  }
  return [{
    type: 'abandoned',
    taskId,
    definition,
    resetItemTemplateIds: collectQuestResetItemTemplateIds(definition),
  }];
}

function collectQuestResetItemTemplateIds(definition) {
  const templateIds = new Set();

  for (const item of Array.isArray(definition?.acceptGrantItems) ? definition.acceptGrantItems : []) {
    if (Number.isInteger(item?.templateId) && item.templateId > 0) {
      templateIds.add(item.templateId >>> 0);
    }
  }

  for (const step of Array.isArray(definition?.steps) ? definition.steps : []) {
    for (const item of Array.isArray(step?.grantItems) ? step.grantItems : []) {
      if (Number.isInteger(item?.templateId) && item.templateId > 0) {
        templateIds.add(item.templateId >>> 0);
      }
    }
  }

  for (const action of Array.isArray(definition?.auxiliaryActions) ? definition.auxiliaryActions : []) {
    for (const item of Array.isArray(action?.grantItems) ? action.grantItems : []) {
      if (Number.isInteger(item?.templateId) && item.templateId > 0) {
        templateIds.add(item.templateId >>> 0);
      }
    }
  }

  return [...templateIds];
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
        stepType: typeof definition.steps?.[record.stepIndex]?.type === 'string'
          ? definition.steps[record.stepIndex].type
          : '',
      };
    })
    .filter(Boolean);
}

function numberOrDefault(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getInventoryQuantity(inventory, templateId) {
  return Array.isArray(inventory)
    ? inventory.reduce(
        (total, entry) =>
          total + (entry?.templateId === (templateId >>> 0) ? numberOrDefault(entry?.quantity, 0) : 0),
        0
      )
    : 0;
}

module.exports = {
  QUEST_DEFINITIONS,
  buildQuestSyncState,
  normalizeQuestState,
  reconcileAutoAccept,
  applyMonsterDefeat,
  applySceneTransition,
  applyServerRunEvent,
  resolveQuestServerRunAuxiliaryActions,
  buildServerRunQuestTrace,
  abandonQuest,
  getQuestDefinition,
};
