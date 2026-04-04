import { STATIC_DATA_BACKEND } from '../config.js';
import { tryReadStaticJsonDocument } from '../db/static-json-store.js';
import { resolveRepoPath } from '../runtime-paths.js';
import { numberOrDefault, type UnknownRecord } from '../utils.js';
import { loadQuestDefinitionsFromTables } from './table-loader.js';
import type {
  AcceptRuleDef,
  ClientQuestHints,
  ClientStepHints,
  ItemStackDef,
  QuestDef,
  QuestEffectDef,
  QuestProgressDef,
  RequirementDef,
  RewardChoiceDef,
  RewardDef,
  StepReactionDef,
  StepDef,
  TriggerDef,
} from './schema.js';

const QUEST2_DEFINITIONS_FILE = resolveRepoPath('data', 'quests-v2', 'definitions.json');
let questDefinitionsSnapshot: readonly QuestDef[] | null = null;
let questDefinitionsById = new Map<number, QuestDef>();
let questDefinitionsLoadPromise: Promise<readonly QuestDef[]> | null = null;

function loadQuestDefinitionsFromJson(): QuestDef[] {
  if (STATIC_DATA_BACKEND === 'db') {
    return [];
  }

  const parsed = tryReadStaticJsonDocument<UnknownRecord>(QUEST2_DEFINITIONS_FILE);
  const quests = Array.isArray(parsed?.quests) ? parsed.quests : [];
  return quests
    .map((quest: UnknownRecord) => normalizeQuestDefinition(quest))
    .filter((quest: QuestDef | null): quest is QuestDef => Boolean(quest))
    .sort((left, right) => left.id - right.id);
}

function setQuestDefinitions(definitions: QuestDef[]): readonly QuestDef[] {
  const sortedDefinitions = [...definitions].sort((left, right) => left.id - right.id);
  questDefinitionsSnapshot = Object.freeze(sortedDefinitions);
  questDefinitionsById = new Map(sortedDefinitions.map((definition) => [definition.id, definition]));
  return questDefinitionsSnapshot;
}

async function refreshQuestDefinitions(): Promise<readonly QuestDef[]> {
  const definitions =
    STATIC_DATA_BACKEND === 'db'
      ? await loadQuestDefinitionsFromTables()
      : loadQuestDefinitionsFromJson();
  return setQuestDefinitions(definitions);
}

async function initializeQuestDefinitions(forceReload = false): Promise<readonly QuestDef[]> {
  if (forceReload) {
    questDefinitionsLoadPromise = null;
    questDefinitionsSnapshot = null;
    questDefinitionsById = new Map<number, QuestDef>();
  }
  if (questDefinitionsSnapshot) {
    return questDefinitionsSnapshot;
  }
  if (!questDefinitionsLoadPromise) {
    questDefinitionsLoadPromise = refreshQuestDefinitions().finally(() => {
      questDefinitionsLoadPromise = null;
    });
  }
  return questDefinitionsLoadPromise;
}

function loadQuestDefinitions(): readonly QuestDef[] {
  if (!questDefinitionsSnapshot) {
    if (STATIC_DATA_BACKEND === 'db') {
      throw new Error('quest2 definitions were accessed before initialization');
    }
    return setQuestDefinitions(loadQuestDefinitionsFromJson());
  }
  return questDefinitionsSnapshot;
}

function normalizeQuestDefinition(source: UnknownRecord): QuestDef | null {
  if (!Number.isInteger(source?.id) || source.id <= 0) {
    return null;
  }

  const normalizedSteps = normalizeSteps(Array.isArray(source?.steps) ? source.steps : []);
  if (normalizedSteps.length < 1) {
    return null;
  }

  const accept = normalizeAcceptRule(source?.accept);
  if (!accept) {
    return null;
  }

  return {
    id: source.id >>> 0,
    name: typeof source?.name === 'string' && source.name.length > 0 ? source.name : `Quest ${source.id}`,
    repeatable: source?.repeatable === true,
    accept,
    steps: normalizedSteps,
    rewards: normalizeReward(source?.rewards),
    client: normalizeClientQuestHints(source?.client),
  };
}

function normalizeSteps(rawSteps: UnknownRecord[]): StepDef[] {
  const normalizedDrafts = rawSteps.map((source, index) => normalizeStepDraft(source, index));
  const validDrafts = normalizedDrafts.filter((draft): draft is RequiredStepDraft => Boolean(draft));
  const stepIds = new Set(validDrafts.map((step) => step.id));
  const steps: StepDef[] = [];

  for (let index = 0; index < validDrafts.length; index += 1) {
    const draft = validDrafts[index]!;
    const explicitNextStepId =
      typeof draft.nextStepId === 'string' && draft.nextStepId.length > 0
        ? draft.nextStepId
        : null;
    const derivedNextStepId =
      explicitNextStepId !== null
        ? explicitNextStepId
        : validDrafts[index + 1]?.id || null;
    if (derivedNextStepId && !stepIds.has(derivedNextStepId)) {
      continue;
    }

    steps.push({
      id: draft.id,
      kind: draft.kind,
      description: draft.description,
      trigger: draft.trigger,
      requirements: draft.requirements,
      eventEffects: draft.eventEffects,
      effects: draft.effects,
      reactions: draft.reactions,
      progress: draft.progress,
      nextStepId: derivedNextStepId,
      client: draft.client,
    });
  }

  return steps;
}

type RequiredStepDraft = {
  id: string;
  kind: StepDef['kind'];
  description?: string;
  trigger: TriggerDef;
  requirements: RequirementDef[];
  eventEffects?: QuestEffectDef[];
  effects: QuestEffectDef[];
  reactions?: StepReactionDef[];
  progress?: QuestProgressDef;
  nextStepId: string | null;
  client?: ClientStepHints;
};

function normalizeStepDraft(source: UnknownRecord, index: number): RequiredStepDraft | null {
  const trigger = normalizeTrigger(source?.trigger);
  if (!trigger) {
    return null;
  }
  const kind = normalizeStepKind(source?.kind);
  if (!kind) {
    return null;
  }

  return {
    id: typeof source?.id === 'string' && source.id.length > 0 ? source.id : `step_${index + 1}`,
    kind,
    description: typeof source?.description === 'string' && source.description.length > 0 ? source.description : undefined,
    trigger,
    requirements: normalizeRequirements(source?.requirements),
    eventEffects: normalizeEffects(source?.eventEffects),
    effects: normalizeEffects(source?.effects),
    reactions: normalizeReactions(source?.reactions),
    progress: normalizeProgress(source?.progress),
    nextStepId: typeof source?.nextStepId === 'string' && source.nextStepId.length > 0 ? source.nextStepId : null,
    client: normalizeClientStepHints(source?.client),
  };
}

function normalizeStepKind(value: unknown): StepDef['kind'] | null {
  switch (value) {
    case 'talk':
    case 'kill':
    case 'collect':
    case 'turn_in':
    case 'trigger_combat':
    case 'escort':
      return value;
    default:
      return null;
  }
}

function normalizeAcceptRule(source: UnknownRecord): AcceptRuleDef | null {
  const trigger = normalizeTrigger(source?.trigger);
  if (!trigger) {
    return null;
  }
  return {
    trigger,
    requirements: normalizeRequirements(source?.requirements),
    effects: normalizeEffects(source?.effects),
  };
}

function normalizeTrigger(source: UnknownRecord): TriggerDef | null {
  switch (source?.type) {
    case 'npc_interact':
    case 'monster_defeat':
    case 'item_changed':
    case 'combat_won':
      return { type: source.type };
    default:
      return null;
  }
}

function normalizeRequirements(value: unknown): RequirementDef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((source: UnknownRecord) => normalizeRequirement(source))
    .filter((requirement: RequirementDef | null): requirement is RequirementDef => Boolean(requirement));
}

function normalizeRequirement(source: UnknownRecord): RequirementDef | null {
  switch (source?.kind) {
    case 'level_at_least':
      return Number.isInteger(source?.level) && source.level > 0
        ? { kind: 'level_at_least', level: source.level >>> 0 }
        : null;
    case 'quest_completed':
      return Number.isInteger(source?.questId) && source.questId > 0
        ? { kind: 'quest_completed', questId: source.questId >>> 0 }
        : null;
    case 'quest_active':
      return Number.isInteger(source?.questId) && source.questId > 0
        ? { kind: 'quest_active', questId: source.questId >>> 0 }
        : null;
    case 'map_is':
      return Number.isInteger(source?.mapId) && source.mapId > 0
        ? { kind: 'map_is', mapId: source.mapId >>> 0 }
        : null;
    case 'npc_is':
      return Number.isInteger(source?.npcId) && source.npcId > 0
        ? { kind: 'npc_is', npcId: source.npcId >>> 0 }
        : null;
    case 'turn_in_map_is':
      return Number.isInteger(source?.mapId) && source.mapId > 0
        ? { kind: 'turn_in_map_is', mapId: source.mapId >>> 0 }
        : null;
    case 'turn_in_npc_is':
      return Number.isInteger(source?.npcId) && source.npcId > 0
        ? { kind: 'turn_in_npc_is', npcId: source.npcId >>> 0 }
        : null;
    case 'monster_is':
      return Number.isInteger(source?.monsterId) && source.monsterId > 0
        ? { kind: 'monster_is', monsterId: source.monsterId >>> 0 }
        : null;
    case 'item_is':
      return Number.isInteger(source?.templateId) && source.templateId > 0
        ? { kind: 'item_is', templateId: source.templateId >>> 0 }
        : null;
    case 'item_count_at_least':
      return Number.isInteger(source?.templateId) && source.templateId > 0
        ? {
            kind: 'item_count_at_least',
            templateId: source.templateId >>> 0,
            quantity: Math.max(1, numberOrDefault(source?.quantity, 1)),
          }
        : null;
    case 'captured_monster_count_at_least':
      return Number.isInteger(source?.monsterId) && source.monsterId > 0
        ? {
            kind: 'captured_monster_count_at_least',
            monsterId: source.monsterId >>> 0,
            quantity: Math.max(1, numberOrDefault(source?.quantity, 1)),
          }
        : null;
    case 'flag_is':
      return typeof source?.flag === 'string' && source.flag.length > 0
        ? {
            kind: 'flag_is',
            flag: source.flag,
            value: source?.value !== false,
          }
        : null;
    case 'counter_at_least':
      return typeof source?.counter === 'string' && source.counter.length > 0
        ? {
            kind: 'counter_at_least',
            counter: source.counter,
            value: Math.max(0, numberOrDefault(source?.value, 0)),
          }
        : null;
    case 'script_is':
      return Number.isInteger(source?.scriptId) && source.scriptId > 0
        ? { kind: 'script_is', scriptId: source.scriptId >>> 0 }
        : null;
    case 'subtype_is':
      return Number.isInteger(source?.subtype) && source.subtype >= 0
        ? { kind: 'subtype_is', subtype: source.subtype >>> 0 }
        : null;
    case 'context_is':
      return Number.isInteger(source?.contextId) && source.contextId > 0
        ? { kind: 'context_is', contextId: source.contextId >>> 0 }
        : null;
    default:
      return null;
  }
}

function normalizeEffects(value: unknown): QuestEffectDef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((source: UnknownRecord) => normalizeEffect(source))
    .filter((effect: QuestEffectDef | null): effect is QuestEffectDef => Boolean(effect));
}

function normalizeEffect(source: UnknownRecord): QuestEffectDef | null {
  switch (source?.kind) {
    case 'set_flag':
      return typeof source?.flag === 'string' && source.flag.length > 0
        ? { kind: 'set_flag', flag: source.flag, value: source?.value !== false }
        : null;
    case 'clear_flag':
      return typeof source?.flag === 'string' && source.flag.length > 0
        ? { kind: 'clear_flag', flag: source.flag }
        : null;
    case 'increment_counter':
      return typeof source?.counter === 'string' && source.counter.length > 0
        ? {
            kind: 'increment_counter',
            counter: source.counter,
            amount: Math.max(1, numberOrDefault(source?.amount, 1)),
          }
        : null;
    case 'reset_counter':
      return typeof source?.counter === 'string' && source.counter.length > 0
        ? { kind: 'reset_counter', counter: source.counter }
        : null;
    case 'select_reward_choice':
      return Number.isInteger(source?.rewardChoiceId) && source.rewardChoiceId > 0
        ? { kind: 'select_reward_choice', rewardChoiceId: source.rewardChoiceId >>> 0 }
        : null;
    case 'grant_item': {
      const item = normalizeItemStack(source?.item || source);
      return item ? { kind: 'grant_item', item, idempotent: source?.idempotent === true } : null;
    }
    case 'remove_item': {
      const item = normalizeItemStack(source?.item || source);
      return item ? { kind: 'remove_item', item } : null;
    }
    case 'remove_captured_monster_item':
      return Number.isInteger(source?.monsterId) && source.monsterId > 0
        ? {
            kind: 'remove_captured_monster_item',
            monsterId: source.monsterId >>> 0,
            quantity: Math.max(1, numberOrDefault(source?.quantity, 1)),
            templateId:
              Number.isInteger(source?.templateId) && source.templateId > 0
                ? (source.templateId >>> 0)
                : undefined,
            name: typeof source?.name === 'string' && source.name.length > 0 ? source.name : undefined,
          }
        : null;
    case 'update_stat':
      return (
        (source?.stat === 'gold' ||
          source?.stat === 'coins' ||
          source?.stat === 'renown' ||
          source?.stat === 'experience') &&
        Number.isFinite(source?.delta)
      )
        ? { kind: 'update_stat', stat: source.stat, delta: Number(source.delta) }
        : null;
    case 'grant_pet':
      return Number.isInteger(source?.petTemplateId) && source.petTemplateId > 0
        ? { kind: 'grant_pet', petTemplateId: source.petTemplateId >>> 0 }
        : null;
    case 'start_combat':
      return Number.isInteger(source?.monsterId) && source.monsterId > 0
        ? {
            kind: 'start_combat',
            monsterId: source.monsterId >>> 0,
            count: Math.max(1, numberOrDefault(source?.count, 1)),
          }
        : null;
    case 'show_dialogue':
      return typeof source?.message === 'string'
        ? {
            kind: 'show_dialogue',
            title: typeof source?.title === 'string' ? source.title : 'Quest',
            message: source.message,
          }
        : null;
    default:
      return null;
  }
}

function normalizeReactions(value: unknown): StepReactionDef[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const reactions = value
    .map((source: UnknownRecord, index: number) => normalizeReaction(source, index))
    .filter((reaction: StepReactionDef | null): reaction is StepReactionDef => Boolean(reaction));

  return reactions.length > 0 ? reactions : undefined;
}

function normalizeReaction(source: UnknownRecord, index: number): StepReactionDef | null {
  const trigger = normalizeTrigger(source?.trigger);
  if (!trigger) {
    return null;
  }

  return {
    id: typeof source?.id === 'string' && source.id.length > 0 ? source.id : `reaction_${index + 1}`,
    trigger,
    requirements: normalizeRequirements(source?.requirements),
    effects: normalizeEffects(source?.effects),
  };
}

function normalizeProgress(source: UnknownRecord): QuestProgressDef | undefined {
  if (typeof source?.counter !== 'string' || source.counter.length < 1) {
    return undefined;
  }
  return {
    counter: source.counter,
    target: Math.max(1, numberOrDefault(source?.target, 1)),
    eventValue:
      source?.eventValue === 'delta' ||
      source?.eventValue === 'one' ||
      source?.eventValue === 'quantity'
        ? source.eventValue
        : 'count',
  };
}

function normalizeReward(source: UnknownRecord): RewardDef {
  return {
    gold: numberOrDefault(source?.gold, 0),
    experience: numberOrDefault(source?.experience, 0),
    coins: numberOrDefault(source?.coins, 0),
    renown: numberOrDefault(source?.renown, 0),
    pets: Array.isArray(source?.pets) ? source.pets.filter(Number.isInteger).map((petId: number) => petId >>> 0) : [],
    items: Array.isArray(source?.items)
      ? source.items
          .map((item: UnknownRecord) => normalizeItemStack(item))
          .filter((item: ItemStackDef | null): item is ItemStackDef => Boolean(item))
      : [],
    choiceGroups: Array.isArray(source?.choiceGroups)
      ? source.choiceGroups
          .map((choice: UnknownRecord) => normalizeRewardChoice(choice))
          .filter((choice: RewardChoiceDef | null): choice is RewardChoiceDef => Boolean(choice))
      : [],
  };
}

function normalizeRewardChoice(source: UnknownRecord): RewardChoiceDef | null {
  if (!Number.isInteger(source?.id) || source.id <= 0) {
    return null;
  }
  return {
    id: source.id >>> 0,
    label: typeof source?.label === 'string' && source.label.length > 0 ? source.label : undefined,
    gold: numberOrDefault(source?.gold, 0),
    experience: numberOrDefault(source?.experience, 0),
    coins: numberOrDefault(source?.coins, 0),
    renown: numberOrDefault(source?.renown, 0),
    pets: Array.isArray(source?.pets) ? source.pets.filter(Number.isInteger).map((petId: number) => petId >>> 0) : [],
    items: Array.isArray(source?.items)
      ? source.items
          .map((item: UnknownRecord) => normalizeItemStack(item))
          .filter((item: ItemStackDef | null): item is ItemStackDef => Boolean(item))
      : [],
  };
}

function normalizeItemStack(source: UnknownRecord): ItemStackDef | null {
  if (!Number.isInteger(source?.templateId) || source.templateId <= 0) {
    return null;
  }
  return {
    templateId: source.templateId >>> 0,
    quantity: Math.max(1, numberOrDefault(source?.quantity, 1)),
    name: typeof source?.name === 'string' && source.name.length > 0 ? source.name : undefined,
  };
}

function normalizeClientQuestHints(source: UnknownRecord): ClientQuestHints | undefined {
  if (!Number.isInteger(source?.familyTaskId) || source.familyTaskId <= 0) {
    return undefined;
  }
  return {
    familyTaskId: source.familyTaskId >>> 0,
  };
}

function normalizeClientStepHints(source: UnknownRecord): ClientStepHints | undefined {
  if (!source || typeof source !== 'object') {
    return undefined;
  }
  const markerNpcId = Number.isInteger(source?.markerNpcId) && source.markerNpcId > 0
    ? (source.markerNpcId >>> 0)
    : undefined;
  const overNpcId = Number.isInteger(source?.overNpcId) && source.overNpcId > 0
    ? (source.overNpcId >>> 0)
    : undefined;
  const taskRoleNpcId = Number.isInteger(source?.taskRoleNpcId) && source.taskRoleNpcId > 0
    ? (source.taskRoleNpcId >>> 0)
    : undefined;
  const taskType = Number.isInteger(source?.taskType) && source.taskType >= 0
    ? (source.taskType >>> 0)
    : undefined;
  const maxAward = Number.isInteger(source?.maxAward) && source.maxAward >= 0
    ? (source.maxAward >>> 0)
    : undefined;
  const taskStep = Number.isInteger(source?.taskStep) && source.taskStep > 0
    ? (source.taskStep >>> 0)
    : undefined;
  const status = Number.isInteger(source?.status) && source.status >= 0
    ? (source.status >>> 0)
    : undefined;
  const trackerScriptIds = Array.isArray(source?.trackerScriptIds)
    ? source.trackerScriptIds.filter(Number.isInteger).map((scriptId: number) => scriptId >>> 0)
    : [];
  if (
    !markerNpcId &&
    !overNpcId &&
    !taskRoleNpcId &&
    taskType === undefined &&
    maxAward === undefined &&
    taskStep === undefined &&
    status === undefined &&
    trackerScriptIds.length < 1
  ) {
    return undefined;
  }
  return {
    markerNpcId,
    overNpcId,
    taskRoleNpcId,
    taskType,
    maxAward,
    taskStep,
    status,
    ...(trackerScriptIds.length > 0 ? { trackerScriptIds } : {}),
  };
}

function getQuestDefinition(questId: number): QuestDef | null {
  if (!Number.isInteger(questId) || questId <= 0) {
    return null;
  }
  loadQuestDefinitions();
  return questDefinitionsById.get(questId >>> 0) || null;
}

function listQuestDefinitions(): readonly QuestDef[] {
  return loadQuestDefinitions();
}

function isQuest2DefinitionId(questId: number): boolean {
  return getQuestDefinition(questId) !== null;
}

export {
  QUEST2_DEFINITIONS_FILE,
  initializeQuestDefinitions,
  refreshQuestDefinitions,
  loadQuestDefinitions,
  normalizeQuestDefinition,
  getQuestDefinition,
  listQuestDefinitions,
  isQuest2DefinitionId,
};
