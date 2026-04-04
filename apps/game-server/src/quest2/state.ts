import type { UnknownRecord } from '../utils.js';
import type { QuestDef } from './schema.js';

export interface QuestInstance {
  questId: number;
  stepId: string;
  counters: Record<string, number>;
  flags: Record<string, boolean>;
  acceptedAt: number;
  selectedRewardChoiceId?: number;
}

export interface QuestState {
  active: QuestInstance[];
  completed: number[];
  failed: number[];
}

export function createEmptyQuestState(): QuestState {
  return {
    active: [],
    completed: [],
    failed: [],
  };
}

export function createQuestInstance(definition: QuestDef, now = Date.now()): QuestInstance {
  return {
    questId: definition.id,
    stepId: definition.steps[0]?.id || '',
    counters: {},
    flags: {},
    acceptedAt: now,
  };
}

export function cloneQuestInstance(instance: QuestInstance): QuestInstance {
  return {
    questId: instance.questId >>> 0,
    stepId: instance.stepId,
    counters: { ...instance.counters },
    flags: { ...instance.flags },
    acceptedAt: instance.acceptedAt,
    selectedRewardChoiceId:
      typeof instance.selectedRewardChoiceId === 'number'
        ? (instance.selectedRewardChoiceId >>> 0)
        : undefined,
  };
}

export function cloneQuestState(state: QuestState): QuestState {
  return {
    active: Array.isArray(state.active) ? state.active.map((instance) => cloneQuestInstance(instance)) : [],
    completed: Array.isArray(state.completed) ? state.completed.filter(Number.isInteger).map((questId) => questId >>> 0) : [],
    failed: Array.isArray(state.failed) ? state.failed.filter(Number.isInteger).map((questId) => questId >>> 0) : [],
  };
}

export function normalizeQuestInstance(source: UnknownRecord): QuestInstance | null {
  if (!Number.isInteger(source?.questId) || source.questId <= 0) {
    return null;
  }
  if (typeof source?.stepId !== 'string' || source.stepId.length < 1) {
    return null;
  }

  const counters = source?.counters && typeof source.counters === 'object'
    ? Object.fromEntries(
        Object.entries(source.counters as Record<string, unknown>)
          .filter(([, value]) => Number.isFinite(value))
          .map(([key, value]) => [key, Number(value)])
      )
    : {};
  const flags = source?.flags && typeof source.flags === 'object'
    ? Object.fromEntries(
        Object.entries(source.flags as Record<string, unknown>)
          .filter(([, value]) => typeof value === 'boolean')
          .map(([key, value]) => [key, value as boolean])
      )
    : {};

  return {
    questId: source.questId >>> 0,
    stepId: source.stepId,
    counters,
    flags,
    acceptedAt: Number.isFinite(source?.acceptedAt) ? Number(source.acceptedAt) : Date.now(),
    selectedRewardChoiceId:
      Number.isInteger(source?.selectedRewardChoiceId) && source.selectedRewardChoiceId > 0
        ? (source.selectedRewardChoiceId >>> 0)
        : undefined,
  };
}

export function normalizeQuestState(source: UnknownRecord): QuestState {
  return {
    active: Array.isArray(source?.active)
      ? source.active
          .map((instance: UnknownRecord) => normalizeQuestInstance(instance))
          .filter((instance: QuestInstance | null): instance is QuestInstance => Boolean(instance))
      : [],
    completed: Array.isArray(source?.completed)
      ? source.completed.filter(Number.isInteger).map((questId: number) => questId >>> 0)
      : [],
    failed: Array.isArray(source?.failed)
      ? source.failed.filter(Number.isInteger).map((questId: number) => questId >>> 0)
      : [],
  };
}

export function isQuestActive(state: QuestState, questId: number): boolean {
  return state.active.some((instance) => instance.questId === (questId >>> 0));
}

export function isQuestCompleted(state: QuestState, questId: number): boolean {
  return state.completed.includes(questId >>> 0);
}

export function getQuestInstance(state: QuestState, questId: number): QuestInstance | null {
  return state.active.find((instance) => instance.questId === (questId >>> 0)) || null;
}
