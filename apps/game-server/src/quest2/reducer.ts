import type { QuestEvent, QuestReducerContext } from './events.js';
import type {
  ItemStackDef,
  QuestDef,
  QuestEffectDef,
  RequirementDef,
  ResolvedRewardDef,
  RewardDef,
  StepDef,
} from './schema.js';
import {
  cloneQuestState,
  createQuestInstance,
  type QuestInstance,
  type QuestState,
} from './state.js';

export type QuestTransition =
  | { type: 'quest_accepted'; questId: number; stepId: string }
  | { type: 'quest_progressed'; questId: number; stepId: string; counter: string; value: number; target: number }
  | { type: 'quest_advanced'; questId: number; fromStepId: string; toStepId: string }
  | { type: 'quest_completed'; questId: number; reward: ResolvedRewardDef }
  | { type: 'quest_abandoned'; questId: number };

export interface QuestReducerResult {
  state: QuestState;
  effects: QuestEffectDef[];
  transitions: QuestTransition[];
  changed: boolean;
}

const TURN_IN_READY_FLAG_PREFIX = '__turn_in_ready__:';

function reduceQuestEvent(
  definitions: readonly QuestDef[],
  state: QuestState,
  event: QuestEvent,
  context: QuestReducerContext = {}
): QuestReducerResult {
  const nextState = cloneQuestState(state);
  const effects: QuestEffectDef[] = [];
  const transitions: QuestTransition[] = [];
  let changed = false;

  if (event.type === 'quest_abandon') {
    const index = nextState.active.findIndex((instance) => instance.questId === (event.questId >>> 0));
    if (index >= 0) {
      nextState.active.splice(index, 1);
      transitions.push({ type: 'quest_abandoned', questId: event.questId >>> 0 });
      changed = true;
    }
    return { state: nextState, effects, transitions, changed };
  }

  const now = Number.isFinite(context.now) ? Number(context.now) : Date.now();
  const sortedDefinitions = [...definitions].sort((left, right) => left.id - right.id);

  for (const definition of sortedDefinitions) {
    if (!canAcceptQuest(nextState, definition, event, context)) {
      continue;
    }
    const instance = createQuestInstance(definition, now);
    applyInternalEffects(instance, definition.accept.effects);
    effects.push(...collectExternalEffects(definition.accept.effects));
    nextState.active.push(instance);
    transitions.push({
      type: 'quest_accepted',
      questId: definition.id,
      stepId: instance.stepId,
    });
    changed = true;
    break;
  }

  const orderedInstances = [...nextState.active].sort((left, right) => {
    if (left.acceptedAt !== right.acceptedAt) {
      return left.acceptedAt - right.acceptedAt;
    }
    return left.questId - right.questId;
  });

  for (const instance of orderedInstances) {
    const definition = definitions.find((candidate) => candidate.id === instance.questId);
    if (!definition) {
      continue;
    }
    const step = getStepById(definition, instance.stepId);
    if (!step) {
      continue;
    }
    const triggerRequirements = getStepTriggerRequirements(step);
    const turnInRequirements = getStepTurnInRequirements(step);
    const readyForTurnIn = isStepReadyForTurnIn(instance, step);

    if (readyForTurnIn && turnInRequirements.length > 0) {
      if (
        event.type === 'npc_interact' &&
        requirementsMatch(nextState, definition, instance, turnInRequirements, event, context)
      ) {
        if (
          typeof (event as { rewardChoiceId?: number }).rewardChoiceId === 'number' &&
          (event as { rewardChoiceId?: number }).rewardChoiceId! > 0
        ) {
          instance.selectedRewardChoiceId = ((event as { rewardChoiceId?: number }).rewardChoiceId as number) >>> 0;
          changed = true;
        }

        clearTurnInReady(instance, step);
        finalizeProgressStep(instance, step);
        applyInternalEffects(instance, step.effects);
        effects.push(...collectExternalEffects(step.effects));
        changed = true;

        if (step.nextStepId) {
          const previousStepId = instance.stepId;
          instance.stepId = step.nextStepId;
          transitions.push({
            type: 'quest_advanced',
            questId: definition.id,
            fromStepId: previousStepId,
            toStepId: step.nextStepId,
          });
          continue;
        }

        const resolvedReward = resolveReward(definition.rewards, instance.selectedRewardChoiceId);
        effects.push(...buildRewardEffects(resolvedReward));
        const activeIndex = nextState.active.findIndex((candidate) => candidate.questId === definition.id);
        if (activeIndex >= 0) {
          nextState.active.splice(activeIndex, 1);
        }
        if (definition.repeatable !== true && !nextState.completed.includes(definition.id)) {
          nextState.completed.push(definition.id);
        }
        transitions.push({
          type: 'quest_completed',
          questId: definition.id,
          reward: resolvedReward,
        });
      }
      continue;
    }

    for (const reaction of step.reactions || []) {
      if (reaction.trigger.type !== event.type) {
        continue;
      }
      if (!requirementsMatch(nextState, definition, instance, reaction.requirements, event, context)) {
        continue;
      }

      applyInternalEffects(instance, reaction.effects);
      effects.push(...collectExternalEffects(reaction.effects));
      if (hasInternalEffects(reaction.effects)) {
        changed = true;
      }
    }

    if (step.trigger.type !== event.type) {
      continue;
    }
    if (!requirementsMatch(nextState, definition, instance, triggerRequirements, event, context)) {
      continue;
    }

    if (typeof (event as { rewardChoiceId?: number }).rewardChoiceId === 'number' && (event as { rewardChoiceId?: number }).rewardChoiceId! > 0) {
      instance.selectedRewardChoiceId = ((event as { rewardChoiceId?: number }).rewardChoiceId as number) >>> 0;
      changed = true;
    }

    applyInternalEffects(instance, step.eventEffects || []);
    effects.push(...collectExternalEffects(step.eventEffects || []));
    if (hasInternalEffects(step.eventEffects || [])) {
      changed = true;
    }

    if (step.progress) {
      if (step.progress.eventValue === 'quantity' && event.type === 'item_changed') {
        const nextValue = Math.max(0, event.quantity || 0);
        if ((instance.counters[step.progress.counter] || 0) !== nextValue) {
          changed = true;
        }
        instance.counters[step.progress.counter] = nextValue;
      } else {
        const delta = resolveProgressDelta(step, event);
        if (delta > 0) {
          instance.counters[step.progress.counter] = (instance.counters[step.progress.counter] || 0) + delta;
          changed = true;
        }
      }

      const progressValue = instance.counters[step.progress.counter] || 0;
      if (progressValue < step.progress.target) {
        transitions.push({
          type: 'quest_progressed',
          questId: definition.id,
          stepId: step.id,
          counter: step.progress.counter,
          value: progressValue,
          target: step.progress.target,
        });
        continue;
      }

      if (turnInRequirements.length > 0) {
        instance.counters[step.progress.counter] = step.progress.target;
        setTurnInReady(instance, step);
        changed = true;
        transitions.push({
          type: 'quest_progressed',
          questId: definition.id,
          stepId: step.id,
          counter: step.progress.counter,
          value: step.progress.target,
          target: step.progress.target,
        });
        continue;
      }

      finalizeProgressStep(instance, step);
    }

    applyInternalEffects(instance, step.effects);
    effects.push(...collectExternalEffects(step.effects));
    changed = true;

    if (step.nextStepId) {
      const previousStepId = instance.stepId;
      instance.stepId = step.nextStepId;
      transitions.push({
        type: 'quest_advanced',
        questId: definition.id,
        fromStepId: previousStepId,
        toStepId: step.nextStepId,
      });
      continue;
    }

    const resolvedReward = resolveReward(definition.rewards, instance.selectedRewardChoiceId);
    effects.push(...buildRewardEffects(resolvedReward));
    const activeIndex = nextState.active.findIndex((candidate) => candidate.questId === definition.id);
    if (activeIndex >= 0) {
      nextState.active.splice(activeIndex, 1);
    }
    if (definition.repeatable !== true && !nextState.completed.includes(definition.id)) {
      nextState.completed.push(definition.id);
    }
    transitions.push({
      type: 'quest_completed',
      questId: definition.id,
      reward: resolvedReward,
    });
  }

  return {
    state: nextState,
    effects,
    transitions,
    changed,
  };
}

function canAcceptQuest(
  state: QuestState,
  definition: QuestDef,
  event: QuestEvent,
  context: QuestReducerContext
): boolean {
  if (definition.accept.trigger.type !== event.type) {
    return false;
  }
  const alreadyActive = state.active.some((instance) => instance.questId === definition.id);
  if (alreadyActive) {
    return false;
  }
  if (definition.repeatable !== true && state.completed.includes(definition.id)) {
    return false;
  }
  return requirementsMatch(state, definition, null, definition.accept.requirements, event, context);
}

function requirementsMatch(
  state: QuestState,
  _definition: QuestDef,
  instance: QuestInstance | null,
  requirements: RequirementDef[],
  event: QuestEvent,
  context: QuestReducerContext
): boolean {
  return requirements.every((requirement) => requirementMatches(state, instance, requirement, event, context));
}

function requirementMatches(
  state: QuestState,
  instance: QuestInstance | null,
  requirement: RequirementDef,
  event: QuestEvent,
  context: QuestReducerContext
): boolean {
  switch (requirement.kind) {
    case 'level_at_least':
      return Math.max(0, context.level || 0) >= requirement.level;
    case 'quest_completed':
      return state.completed.includes(requirement.questId >>> 0);
    case 'quest_active':
      return state.active.some((activeQuest) => activeQuest.questId === (requirement.questId >>> 0));
    case 'map_is':
      return resolveEventMapId(event, context) === (requirement.mapId >>> 0);
    case 'npc_is':
      return event.type === 'npc_interact' && (event.npcId >>> 0) === (requirement.npcId >>> 0);
    case 'turn_in_map_is':
      return resolveEventMapId(event, context) === (requirement.mapId >>> 0);
    case 'turn_in_npc_is':
      return event.type === 'npc_interact' && (event.npcId >>> 0) === (requirement.npcId >>> 0);
    case 'monster_is':
      return event.type === 'monster_defeat' && (event.monsterId >>> 0) === (requirement.monsterId >>> 0);
    case 'item_is':
      return event.type === 'item_changed' && (event.templateId >>> 0) === (requirement.templateId >>> 0);
    case 'item_count_at_least':
      return getInventoryCount(context, requirement.templateId) >= requirement.quantity;
    case 'captured_monster_count_at_least':
      return getCapturedMonsterCount(context, requirement.monsterId) >= requirement.quantity;
    case 'flag_is':
      return (instance?.flags?.[requirement.flag] || false) === requirement.value;
    case 'counter_at_least':
      return Math.max(0, instance?.counters?.[requirement.counter] || 0) >= requirement.value;
    case 'script_is':
      return event.type === 'npc_interact' && (event.scriptId || 0) === (requirement.scriptId >>> 0);
    case 'subtype_is':
      return event.type === 'npc_interact' && (event.subtype || 0) === (requirement.subtype >>> 0);
    case 'context_is':
      return event.type === 'npc_interact' && (event.contextId || 0) === (requirement.contextId >>> 0);
    default:
      return false;
  }
}

function resolveEventMapId(event: QuestEvent, context: QuestReducerContext): number {
  if (event.type === 'npc_interact' || event.type === 'monster_defeat' || event.type === 'combat_won') {
    const eventMapId = event.mapId;
    return typeof eventMapId === 'number' && Number.isInteger(eventMapId)
      ? (eventMapId >>> 0)
      : Math.max(0, context.mapId || 0);
  }
  return Math.max(0, context.mapId || 0);
}

function getInventoryCount(context: QuestReducerContext, templateId: number): number {
  const count = context.inventoryCounts?.[templateId];
  return Number.isFinite(count) ? Number(count) : 0;
}

function getCapturedMonsterCount(context: QuestReducerContext, monsterId: number): number {
  const count = context.capturedMonsterCounts?.[monsterId];
  return Number.isFinite(count) ? Number(count) : 0;
}

function getStepById(definition: QuestDef, stepId: string): StepDef | null {
  return definition.steps.find((step) => step.id === stepId) || null;
}

function getStepTriggerRequirements(step: StepDef): RequirementDef[] {
  return step.requirements.filter((requirement) => !isTurnInRequirement(step, requirement));
}

function getStepTurnInRequirements(step: StepDef): RequirementDef[] {
  return step.requirements.filter((requirement) => isTurnInRequirement(step, requirement));
}

function isTurnInRequirement(step: StepDef, requirement: RequirementDef): boolean {
  if (requirement.kind === 'turn_in_map_is' || requirement.kind === 'turn_in_npc_is') {
    return true;
  }

  const hasExplicitTurnInTarget = step.requirements.some(
    (entry) => entry.kind === 'turn_in_map_is' || entry.kind === 'turn_in_npc_is'
  );
  if (!hasExplicitTurnInTarget) {
    return false;
  }

  return requirement.kind === 'item_count_at_least' || requirement.kind === 'captured_monster_count_at_least';
}

function getTurnInReadyFlag(step: StepDef): string {
  return `${TURN_IN_READY_FLAG_PREFIX}${step.id}`;
}

function isStepReadyForTurnIn(instance: QuestInstance, step: StepDef): boolean {
  return instance.flags[getTurnInReadyFlag(step)] === true;
}

function setTurnInReady(instance: QuestInstance, step: StepDef): void {
  instance.flags[getTurnInReadyFlag(step)] = true;
}

function clearTurnInReady(instance: QuestInstance, step: StepDef): void {
  delete instance.flags[getTurnInReadyFlag(step)];
}

function finalizeProgressStep(instance: QuestInstance, step: StepDef): void {
  if (!step.progress) {
    return;
  }
  delete instance.counters[step.progress.counter];
}

function resolveProgressDelta(step: StepDef, event: QuestEvent): number {
  if (!step.progress) {
    return 0;
  }
  if (step.progress.eventValue === 'one') {
    return 1;
  }
  if (step.progress.eventValue === 'delta') {
    return event.type === 'item_changed' ? Math.max(0, event.delta || 0) : 0;
  }
  if (event.type === 'monster_defeat') {
    return Math.max(1, event.count || 1);
  }
  if (event.type === 'item_changed') {
    return Math.max(0, event.delta || 0);
  }
  return 1;
}

function applyInternalEffects(instance: QuestInstance, effects: QuestEffectDef[]): void {
  for (const effect of effects) {
    switch (effect.kind) {
      case 'set_flag':
        instance.flags[effect.flag] = effect.value !== false;
        break;
      case 'clear_flag':
        delete instance.flags[effect.flag];
        break;
      case 'increment_counter':
        instance.counters[effect.counter] = (instance.counters[effect.counter] || 0) + Math.max(1, effect.amount || 1);
        break;
      case 'reset_counter':
        delete instance.counters[effect.counter];
        break;
      case 'select_reward_choice':
        instance.selectedRewardChoiceId = effect.rewardChoiceId >>> 0;
        break;
      default:
        break;
    }
  }
}

function hasInternalEffects(effects: QuestEffectDef[]): boolean {
  return effects.some((effect) => {
    switch (effect.kind) {
      case 'set_flag':
      case 'clear_flag':
      case 'increment_counter':
      case 'reset_counter':
      case 'select_reward_choice':
        return true;
      default:
        return false;
    }
  });
}

function collectExternalEffects(effects: QuestEffectDef[]): QuestEffectDef[] {
  return effects.filter((effect) => {
    switch (effect.kind) {
      case 'grant_item':
      case 'remove_item':
      case 'remove_captured_monster_item':
      case 'update_stat':
      case 'grant_pet':
      case 'start_combat':
      case 'show_dialogue':
        return true;
      default:
        return false;
    }
  });
}

function resolveReward(reward: RewardDef, selectedChoiceId?: number): ResolvedRewardDef {
  const selectedChoice = reward.choiceGroups.find((choice) => choice.id === (selectedChoiceId || 0)) || reward.choiceGroups[0] || null;

  return {
    gold: selectedChoice ? selectedChoice.gold || reward.gold : reward.gold,
    experience: selectedChoice ? selectedChoice.experience || reward.experience : reward.experience,
    coins: selectedChoice ? selectedChoice.coins || reward.coins : reward.coins,
    renown: selectedChoice ? selectedChoice.renown || reward.renown : reward.renown,
    pets: selectedChoice ? selectedChoice.pets.slice() : reward.pets.slice(),
    items: selectedChoice && selectedChoice.items.length > 0 ? cloneItems(selectedChoice.items) : cloneItems(reward.items),
    selectedChoiceId: selectedChoice ? selectedChoice.id : undefined,
  };
}

function buildRewardEffects(reward: ResolvedRewardDef): QuestEffectDef[] {
  const effects: QuestEffectDef[] = [];

  if (reward.gold !== 0) {
    effects.push({ kind: 'update_stat', stat: 'gold', delta: reward.gold });
  }
  if (reward.experience !== 0) {
    effects.push({ kind: 'update_stat', stat: 'experience', delta: reward.experience });
  }
  if (reward.coins !== 0) {
    effects.push({ kind: 'update_stat', stat: 'coins', delta: reward.coins });
  }
  if (reward.renown !== 0) {
    effects.push({ kind: 'update_stat', stat: 'renown', delta: reward.renown });
  }
  for (const item of reward.items) {
    effects.push({ kind: 'grant_item', item });
  }
  for (const petTemplateId of reward.pets) {
    effects.push({ kind: 'grant_pet', petTemplateId });
  }

  return effects;
}

function cloneItems(items: ItemStackDef[]): ItemStackDef[] {
  return items.map((item) => ({
    templateId: item.templateId >>> 0,
    quantity: Math.max(1, item.quantity || 1),
    name: item.name,
  }));
}

export {
  reduceQuestEvent,
  resolveReward,
  buildRewardEffects,
};
