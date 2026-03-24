import type { QuestEvent } from '../types.js';
import { numberOrDefault, type UnknownRecord } from '../utils.js';

import type {
  GrantedItem,
  QuestDefinitionRecord,
  QuestRecord,
  QuestState,
} from './data.js';

import {
  QUEST_DEFINITIONS,
  getQuestDefinition,
  getCurrentStep,
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
  if (state.completedQuests.includes(definition.id) || isQuestAccepted(state, definition.id)) {
    return false;
  }
  const missingPrerequisites = definition.prerequisiteTaskIds.some(
    (prerequisiteTaskId) => !state.completedQuests.includes(prerequisiteTaskId)
  );
  if (missingPrerequisites || numberOrDefault(state.level, 1) < definition.minLevel) {
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
  if (!state.completedQuests.includes(definition.id)) {
    state.completedQuests.push(definition.id);
  }
  events.push({
    type: 'completed',
    taskId: definition.id,
    definition,
    reward: definition.rewards,
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

  record.status = getQuestStatus(definition, record);
  events.push({
    type: 'advanced',
    taskId: definition.id,
    definition,
    status: record.status,
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
    if (
      definition &&
      step &&
      step.type === 'kill' &&
      step.completeOnTalkAfterKill === true &&
      numberOrDefault(step.completionNpcId, numberOrDefault(step.npcId, 0)) === (npcId >>> 0) &&
      numberOrDefault(record.progress?.count, 0) >= Math.max(1, numberOrDefault(step.count, 1))
    ) {
      advanceQuest(state, record, definition, events, 'kill-turn-in');
      return events;
    }
    if (!definition || !step || step.type !== 'talk' || numberOrDefault(step.npcId, 0) !== (npcId >>> 0)) {
      continue;
    }

    for (const item of Array.isArray(step.consumeItems) ? step.consumeItems : []) {
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

    for (const item of Array.isArray(step.consumeItems) ? step.consumeItems : []) {
      events.push({
        type: 'item-consumed',
        taskId: definition.id,
        definition,
        templateId: item.templateId >>> 0,
        quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
        itemName: item.name || '',
        reason: 'talk-consume-item',
      });
    }

    appendGrantedItemEvents(events, definition, step.grantItems, 'talk-step-grant');
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

function applyMonsterDefeat(state: QuestState, monsterId: number, count = 1): QuestEvent[] {
  const events: QuestEvent[] = [];

  for (const record of [...state.activeQuests]) {
    const definition = getQuestDefinition(record.id);
    const step = getCurrentStep(definition, record);
    if (!step || step.type !== 'kill' || numberOrDefault(step.monsterId, 0) !== monsterId) {
      continue;
    }

    const targetCount = Math.max(1, numberOrDefault(step.count, 1));
    const nextCount = Math.min(targetCount, numberOrDefault(record.progress?.count, 0) + Math.max(1, count));
    record.progress = {
      ...cloneProgress(record.progress),
      count: nextCount,
    };
    record.status = getQuestStatus(definition, record);

    if (nextCount >= targetCount && step.completeOnTalkAfterKill === true) {
      events.push({
        type: 'progress',
        taskId: definition!.id,
        definition: definition!,
        status: getQuestStatus(definition, record),
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
    for (const item of Array.isArray(step?.grantItems) ? step.grantItems : []) {
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
      return {
        taskId: definition.id,
        stepIndex: numberOrDefault(record.stepIndex, 0),
        status: getQuestStatus(definition, record),
        stepDescription: getQuestStepDescription(definition, record),
        progressObjectiveId: getQuestProgressObjectiveId(definition, record),
        progressCount: getQuestProgressCount(definition, record),
        stepType:
          typeof definition.steps?.[record.stepIndex]?.type === 'string'
            ? definition.steps[record.stepIndex].type
            : '',
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
  applyMonsterDefeat,
  abandonQuest,
  collectQuestResetItemTemplateIds,
  buildQuestSyncState,
  reconcileAutoAccept,
};
