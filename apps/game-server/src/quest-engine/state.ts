import type { QuestEvent } from '../types.js';
import { numberOrDefault, type UnknownRecord } from '../utils.js';

import type {
  GrantedItem,
  QuestActionRecord,
  QuestDefinitionRecord,
  QuestRecord,
  QuestState,
} from './data.js';

import {
  QUEST_DEFINITIONS,
  getQuestDefinition,
  getCurrentStep,
  getCurrentObjective,
  getCurrentStepUi,
  getQuestTrackerStatus,
  getQuestStatus,
  getQuestStepDescription,
  getQuestProgressObjectiveId,
  getQuestProgressCount,
  getQuestMarkerNpcId,
} from './data.js';

function normalizeQuestState(source: UnknownRecord): QuestState {
  const activeQuests = Array.isArray(source?.activeQuests)
    ? source.activeQuests
        .map((record: UnknownRecord) => normalizeQuestRecord(record))
        .filter((record: QuestRecord | null): record is QuestRecord => Boolean(record))
    : [];
  const completedQuests = Array.isArray(source?.completedQuests)
    ? source.completedQuests.filter(Number.isInteger).map((taskId: number) => taskId >>> 0)
    : [];

  return {
    activeQuests,
    completedQuests,
    level: numberOrDefault(source?.level, 1),
  };
}

function normalizeQuestRecord(record: UnknownRecord): QuestRecord | null {
  const questId = Number.isInteger(record?.id)
    ? (record.id >>> 0)
    : Number.isInteger(record?.taskId)
    ? (record.taskId >>> 0)
    : 0;
  if (questId <= 0) {
    return null;
  }
  return {
    id: questId,
    stepIndex: Math.max(0, numberOrDefault(record.stepIndex, 0)),
    status: Math.max(0, numberOrDefault(record.status, 0)),
    progress: cloneProgress(record.progress),
    acceptedAt: numberOrDefault(record.acceptedAt, Date.now()),
  };
}

function cloneProgress(progress: unknown): UnknownRecord {
  return progress && typeof progress === 'object' ? { ...(progress as UnknownRecord) } : {};
}

function removeActiveQuest(state: QuestState, taskId: number): QuestRecord | null {
  const index = state.activeQuests.findIndex((record) => record.id === (taskId >>> 0));
  if (index < 0) {
    return null;
  }
  const [record] = state.activeQuests.splice(index, 1);
  return record || null;
}

function isQuestAccepted(state: QuestState, taskId: number): boolean {
  return state.activeQuests.some((record) => record.id === (taskId >>> 0));
}

function canAcceptQuest(state: QuestState, definition: QuestDefinitionRecord | null): boolean {
  if (!definition) {
    return false;
  }
  const isRepeatable = definition.repeatable === true;
  if ((!isRepeatable && state.completedQuests.includes(definition.id)) || isQuestAccepted(state, definition.id)) {
    return false;
  }
  const missingPrerequisites = definition.prerequisiteTaskIds.some(
    (prerequisiteTaskId) => !state.completedQuests.includes(prerequisiteTaskId)
  );
  if (missingPrerequisites || numberOrDefault(state.level, 1) < definition.minLevel) {
    return false;
  }
  const blockedByExclusiveQuest = definition.exclusiveTaskIds.some(
    (taskId) => state.completedQuests.includes(taskId) || isQuestAccepted(state, taskId)
  );
  if (blockedByExclusiveQuest) {
    return false;
  }
  return true;
}

function appendGrantedItemEvents(
  events: QuestEvent[],
  definition: QuestDefinitionRecord,
  items: GrantedItem[] | undefined,
  reason: string
): void {
  for (const item of Array.isArray(items) ? items : []) {
    if (!Number.isInteger(item?.templateId) || item.templateId <= 0) {
      continue;
    }
    events.push({
      type: 'item-granted',
      taskId: definition.id,
      definition,
      templateId: item.templateId >>> 0,
      quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
      itemName: item.name || '',
      reason,
    });
  }
}

function getRequiredItems(step: ReturnType<typeof getCurrentStep>): GrantedItem[] {
  return Array.isArray(step?.objective?.requiredItems)
    ? step!.objective!.requiredItems
    : [];
}

function getTurnInRequiredItems(step: ReturnType<typeof getCurrentStep>): GrantedItem[] {
  const objectiveItems = getRequiredItems(step);
  if (objectiveItems.length > 0) {
    return objectiveItems;
  }
  return (Array.isArray(step?.actions) ? step.actions : [])
    .filter((action) => action?.kind === 'consume-item' && action.item)
    .map((action) => action.item!) as GrantedItem[];
}

function getOwnedQuestItemQuantity(
  item: GrantedItem,
  getItemQuantity?: (templateId: number) => number,
  matchItemRequirement?: (item: GrantedItem) => number
): number {
  return typeof matchItemRequirement === 'function'
    ? Math.max(0, numberOrDefault(matchItemRequirement(item), 0))
    : typeof getItemQuantity === 'function'
    ? Math.max(0, numberOrDefault(getItemQuantity(item.templateId >>> 0), 0))
    : 0;
}

function hasRequiredQuestItems(
  items: GrantedItem[],
  getItemQuantity?: (templateId: number) => number,
  matchItemRequirement?: (item: GrantedItem) => number
): boolean {
  return items.every((item) => getOwnedQuestItemQuantity(item, getItemQuantity, matchItemRequirement) >= Math.max(1, numberOrDefault(item.quantity, 1)));
}

function objectiveRequiresNpcTurnIn(objective: ReturnType<typeof getCurrentObjective>): boolean {
  if (!objective) {
    return false;
  }
  if (objective.kind === 'monster-defeat' || objective.kind === 'item-collect') {
    return objective.autoAdvance !== true && numberOrDefault(objective.handInNpcId, 0) > 0;
  }
  return false;
}

function appendStepActionEvents(
  events: QuestEvent[],
  definition: QuestDefinitionRecord,
  actions: QuestActionRecord[] | undefined,
  reasonPrefix: string
): void {
  for (const action of Array.isArray(actions) ? actions : []) {
    if (action?.kind === 'consume-item' && action.item) {
      events.push({
        type: 'item-consumed',
        taskId: definition.id,
        definition,
        templateId: action.item.templateId >>> 0,
        quantity: Math.max(1, numberOrDefault(action.item.quantity, 1)),
        itemName: action.item.name || '',
        reason: `${reasonPrefix}-consume-item`,
      });
      continue;
    }
    if (action?.kind === 'grant-item' && action.item) {
      events.push({
        type: 'item-granted',
        taskId: definition.id,
        definition,
        templateId: action.item.templateId >>> 0,
        quantity: Math.max(1, numberOrDefault(action.item.quantity, 1)),
        itemName: action.item.name || '',
        reason: `${reasonPrefix}-grant-item`,
      });
    }
  }
}

function acceptQuest(state: QuestState, taskId: number, events: QuestEvent[], reason: string): boolean {
  const definition = getQuestDefinition(taskId);
  if (!canAcceptQuest(state, definition)) {
    return false;
  }
  const acceptedDefinition = definition as QuestDefinitionRecord;

  const record: QuestRecord = {
    id: acceptedDefinition.id,
    stepIndex: 0,
    status: 0,
    progress: {},
    acceptedAt: Date.now(),
  };
  state.activeQuests.push(record);

  events.push({
    type: 'accepted',
    taskId: acceptedDefinition.id,
    definition: acceptedDefinition,
    status: 0,
    stepDescription: getQuestStepDescription(acceptedDefinition, record),
    progressObjectiveId: getQuestProgressObjectiveId(acceptedDefinition, record),
    progressCount: getQuestProgressCount(acceptedDefinition, record),
    markerNpcId: getQuestMarkerNpcId(acceptedDefinition, record),
    reason,
  });
  appendGrantedItemEvents(
    events,
    acceptedDefinition,
    acceptedDefinition.acceptGrantItems,
    `${reason}-accept`
  );
  return true;
}

function completeQuest(state: QuestState, record: QuestRecord, definition: QuestDefinitionRecord, events: QuestEvent[], reason: string): void {
  removeActiveQuest(state, definition.id);
  if (definition.repeatable !== true && !state.completedQuests.includes(definition.id)) {
    state.completedQuests.push(definition.id);
  }
  events.push({
    type: 'completed',
    taskId: definition.id,
    definition,
    reward: definition.rewards,
    resetItemTemplateIds: collectQuestResetItemTemplateIds(definition),
    reason,
  });

  if (Number.isInteger(definition.nextQuestId)) {
    acceptQuest(state, definition.nextQuestId!, events, 'chain');
  }
}

function advanceQuest(state: QuestState, record: QuestRecord, definition: QuestDefinitionRecord, events: QuestEvent[], reason: string): void {
  record.stepIndex += 1;
  record.progress = {};
  record.status = 0;

  if (record.stepIndex >= definition.steps.length) {
    completeQuest(state, record, definition, events, reason);
    return;
  }

  events.push({
    type: 'advanced',
    taskId: definition.id,
    definition,
    status: getQuestStatus(definition, record),
    stepDescription: getQuestStepDescription(definition, record),
    progressObjectiveId: getQuestProgressObjectiveId(definition, record),
    progressCount: getQuestProgressCount(definition, record),
    markerNpcId: getQuestMarkerNpcId(definition, record),
    reason,
  });
}

function reconcileAutoAccept(_state: QuestState): QuestEvent[] {
  return [];
}

function interactWithNpc(
  state: QuestState,
  npcId: number,
  getItemQuantity?: (templateId: number) => number,
  matchItemRequirement?: (item: GrantedItem) => number
): QuestEvent[] {
  if (!Number.isInteger(npcId) || npcId <= 0) {
    return [];
  }

  const events: QuestEvent[] = [];
  const activeRecords = [...state.activeQuests].sort((left, right) => {
    const acceptedDelta = numberOrDefault(left.acceptedAt, 0) - numberOrDefault(right.acceptedAt, 0);
    if (acceptedDelta !== 0) {
      return acceptedDelta;
    }
    return left.id - right.id;
  });

  for (const record of activeRecords) {
    const definition = getQuestDefinition(record.id);
    const step = getCurrentStep(definition, record);
    const ui = getCurrentStepUi(definition, record);
    const objective = getCurrentObjective(definition, record);
    const objectiveProgress = objective
      ? numberOrDefault(record.progress?.[objective.progressKey], 0)
      : 0;
    const objectiveTargetCount = objective
      ? Math.max(1, numberOrDefault(objective.targetCount, 1))
      : 0;
    if (
      definition &&
      step &&
      objectiveRequiresNpcTurnIn(objective) &&
      numberOrDefault(objective?.handInNpcId, numberOrDefault(ui?.overNpcId, 0)) === (npcId >>> 0)
    ) {
      const turnInRequiredItems = getTurnInRequiredItems(step);
      const hasTurnInItems = hasRequiredQuestItems(turnInRequiredItems, getItemQuantity, matchItemRequirement);
      const canTurnInByProgress = objectiveProgress >= objectiveTargetCount;
      const canTurnIn =
        objective?.kind === 'item-collect'
          ? hasTurnInItems
          : canTurnInByProgress;
      if (!canTurnIn) {
        continue;
      }
      if (objective?.kind === 'item-collect' && hasTurnInItems && !canTurnInByProgress) {
        record.progress = {
          ...cloneProgress(record.progress),
          [objective.progressKey]: objectiveTargetCount,
        };
      }
      for (const item of turnInRequiredItems) {
        const quantity = Math.max(1, numberOrDefault(item.quantity, 1));
        const ownedQuantity = getOwnedQuestItemQuantity(item, getItemQuantity, matchItemRequirement);
        if (ownedQuantity < quantity) {
          events.push({
            type: 'item-missing',
            taskId: definition.id,
            definition,
            templateId: item.templateId >>> 0,
            quantity,
            itemName: item.name || '',
            reason: 'turn-in-missing-item',
          });
          return events;
        }
      }
      appendStepActionEvents(events, definition, step.actions, `${objective!.kind}-turn-in`);
      advanceQuest(state, record, definition, events, 'kill-turn-in');
      return events;
    }
    if (
      !definition ||
      !step ||
      (objective?.kind !== 'npc-interaction' && objective?.kind !== 'escort') ||
      numberOrDefault(objective.targetNpcId, numberOrDefault(ui?.overNpcId, 0)) !== (npcId >>> 0)
    ) {
      continue;
    }
    if (
      typeof objective.requiredProgressFlag === 'string' &&
      objective.requiredProgressFlag.length > 0 &&
      record.progress?.[objective.requiredProgressFlag] !== true
    ) {
      continue;
    }

    for (const item of getRequiredItems(step)) {
      const quantity = Math.max(1, numberOrDefault(item.quantity, 1));
      const ownedQuantity =
        typeof matchItemRequirement === 'function'
          ? Math.max(0, numberOrDefault(matchItemRequirement(item), 0))
          : typeof getItemQuantity === 'function'
          ? Math.max(0, numberOrDefault(getItemQuantity(item.templateId >>> 0), 0))
          : 0;
      if (ownedQuantity < quantity) {
        events.push({
          type: 'item-missing',
          taskId: definition.id,
          definition,
          templateId: item.templateId >>> 0,
          quantity,
          itemName: item.name || '',
          reason: 'talk-missing-item',
        });
        return events;
      }
    }

    appendStepActionEvents(events, definition, step.actions, 'talk-step');
    advanceQuest(state, record, definition, events, 'talk');
    return events;
  }

  const availableQuest = QUEST_DEFINITIONS
    .filter((definition) => numberOrDefault(definition?.acceptNpcId, 0) === (npcId >>> 0))
    .sort((left, right) => left.id - right.id)
    .find((definition) => canAcceptQuest(state, definition));
  if (!availableQuest) {
    return [];
  }

  acceptQuest(state, availableQuest.id, events, 'talk-accept');
  return events;
}

function getQuestAcceptBlocker(state: QuestState, npcId: number): string | null {
  if (!Number.isInteger(npcId) || npcId <= 0) {
    return null;
  }
  const playerLevel = numberOrDefault(state.level, 1);
  for (const definition of QUEST_DEFINITIONS) {
    if (numberOrDefault(definition?.acceptNpcId, 0) !== (npcId >>> 0)) {
      continue;
    }
    const accepted = isQuestAccepted(state, definition.id);
    const completed = state.completedQuests.includes(definition.id);
    if (accepted || (definition.repeatable !== true && completed)) {
      continue;
    }
    const missingPrerequisites = definition.prerequisiteTaskIds.some(
      (prereqId) => !state.completedQuests.includes(prereqId)
    );
    if (missingPrerequisites) {
      continue;
    }
    if (playerLevel < definition.minLevel) {
      return `You must be level ${definition.minLevel} to accept "${definition.name}".`;
    }
  }
  return null;
}

function applyMonsterDefeat(state: QuestState, monsterId: number, count = 1): QuestEvent[] {
  const events: QuestEvent[] = [];

  for (const record of [...state.activeQuests]) {
    const definition = getQuestDefinition(record.id);
    const step = getCurrentStep(definition, record);
    const objective = getCurrentObjective(definition, record);
    if (
      !step ||
      !objective ||
      (objective.kind !== 'monster-defeat' && objective.kind !== 'item-collect') ||
      numberOrDefault(objective.targetMonsterId, 0) !== monsterId
    ) {
      continue;
    }

    const targetCount = Math.max(1, numberOrDefault(objective.targetCount, 1));
    const nextCount = Math.min(
      targetCount,
      numberOrDefault(record.progress?.[objective.progressKey], 0) + Math.max(1, count)
    );
    record.progress = {
      ...cloneProgress(record.progress),
      [objective.progressKey]: nextCount,
    };
    record.status =
      nextCount >= targetCount && objectiveRequiresNpcTurnIn(objective)
        ? getQuestTrackerStatus(definition, record)
        : 0;

    if (objective.kind === 'item-collect' && objective.grantItem) {
      events.push({
        type: 'item-granted',
        taskId: definition!.id,
        definition: definition!,
        templateId: objective.grantItem.templateId >>> 0,
        quantity: Math.max(1, numberOrDefault(objective.grantItem.quantity, 1) * Math.max(1, count)),
        itemName: objective.grantItem.name || '',
        reason: 'defeat-collect',
      });
    }

    if (nextCount >= targetCount && objectiveRequiresNpcTurnIn(objective)) {
      events.push({
        type: 'progress',
        taskId: definition!.id,
        definition: definition!,
        status: getQuestTrackerStatus(definition, record),
        stepDescription:
          typeof step.completionDescription === 'string' && step.completionDescription.length > 0
            ? step.completionDescription
            : getQuestStepDescription(definition, record),
        progressObjectiveId: getQuestProgressObjectiveId(definition, record),
        progressCount: getQuestProgressCount(definition, record),
        markerNpcId: getQuestMarkerNpcId(definition, record),
        reason: 'kill-ready-to-turn-in',
      });
      continue;
    }

    if (nextCount >= targetCount) {
      appendStepActionEvents(events, definition!, step.actions, `${objective.kind}-complete`);
      advanceQuest(state, record, definition!, events, 'kill-complete');
      continue;
    }

    events.push({
      type: 'progress',
      taskId: definition!.id,
      definition: definition!,
      status: getQuestStatus(definition, record),
      stepDescription: getQuestStepDescription(definition, record),
      progressObjectiveId: getQuestProgressObjectiveId(definition, record),
      progressCount: getQuestProgressCount(definition, record),
      reason: 'kill',
    });
  }

  return events;
}

function abandonQuest(state: QuestState, taskId: number): QuestEvent[] {
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
  return [
    {
      type: 'abandoned',
      taskId,
      definition,
      resetItemTemplateIds: collectQuestResetItemTemplateIds(definition),
    },
  ];
}

function collectQuestResetItemTemplateIds(definition: QuestDefinitionRecord | null): number[] {
  const templateIds = new Set<number>();

  for (const item of Array.isArray(definition?.acceptGrantItems) ? definition!.acceptGrantItems! : []) {
    if (Number.isInteger(item?.templateId) && item.templateId > 0) {
      templateIds.add(item.templateId >>> 0);
    }
  }

  for (const step of Array.isArray(definition?.steps) ? definition!.steps : []) {
    const objectiveGrantItem = step?.objective?.grantItem;
    if (objectiveGrantItem && Number.isInteger(objectiveGrantItem.templateId) && objectiveGrantItem.templateId > 0) {
      templateIds.add(objectiveGrantItem.templateId >>> 0);
    }
    for (const action of Array.isArray(step?.actions) ? step.actions : []) {
      const actionItem = action?.item;
      if (action?.kind === 'grant-item' && actionItem && Number.isInteger(actionItem.templateId) && actionItem.templateId > 0) {
        templateIds.add(actionItem.templateId >>> 0);
      }
    }
  }

  for (const trigger of Array.isArray(definition?.interactionTriggers) ? definition!.interactionTriggers : []) {
    for (const item of Array.isArray(trigger?.grantItems) ? trigger.grantItems : []) {
      if (Number.isInteger(item?.templateId) && item.templateId > 0) {
        templateIds.add(item.templateId >>> 0);
      }
    }
  }

  return [...templateIds];
}

function buildQuestSyncState(state: QuestState): UnknownRecord[] {
  return state.activeQuests
    .map((record) => {
      const definition = getQuestDefinition(record.id);
      if (!definition) {
        return null;
      }
      const step = definition.steps?.[record.stepIndex];
      const objective = step?.objective || null;
      const ui = step?.ui || null;
      const stepMode =
        objective?.kind === 'monster-defeat' || objective?.kind === 'item-collect'
          ? 'kill'
          : 'talk';
      return {
        taskId: definition.id,
        stepIndex: numberOrDefault(record.stepIndex, 0),
        status: getQuestStatus(definition, record),
        stepDescription: getQuestStepDescription(definition, record),
        progressObjectiveId: getQuestProgressObjectiveId(definition, record),
        progressCount: getQuestProgressCount(definition, record),
        taskType: numberOrDefault(ui?.taskType, 0),
        overNpcId: numberOrDefault(ui?.overNpcId, 0),
        taskRoleNpcId: numberOrDefault(ui?.taskRoleNpcId, 0),
        maxAward: numberOrDefault(ui?.maxAward, 0),
        taskStep: numberOrDefault(ui?.taskStep, numberOrDefault(record.stepIndex, 0) + 1),
        stepMode,
      };
    })
    .filter(Boolean) as UnknownRecord[];
}

export {
  normalizeQuestState,
  normalizeQuestRecord,
  cloneProgress,
  removeActiveQuest,
  isQuestAccepted,
  canAcceptQuest,
  acceptQuest,
  completeQuest,
  advanceQuest,
  appendGrantedItemEvents,
  interactWithNpc,
  getQuestAcceptBlocker,
  applyMonsterDefeat,
  abandonQuest,
  collectQuestResetItemTemplateIds,
  buildQuestSyncState,
  reconcileAutoAccept,
};
