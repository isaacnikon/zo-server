import { STATIC_DATA_BACKEND } from '../config.js';
import { queryJsonArray } from '../db/postgres-cli.js';
import type {
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
} from './schema.js';

type QuestRow = {
  questId: number;
  name: string;
  repeatable: boolean;
  familyTaskId?: number | null;
};

type AcceptRuleRow = {
  questId: number;
  triggerType: StepDef['trigger']['type'];
};

type StepRow = {
  questId: number;
  stepId: string;
  stepOrder: number;
  kind: StepDef['kind'];
  description?: string | null;
  triggerType: StepDef['trigger']['type'];
  nextStepId?: string | null;
  progressCounter?: string | null;
  progressTarget?: number | null;
  progressEventValue?: QuestProgressDef['eventValue'] | null;
  markerNpcId?: number | null;
  overNpcId?: number | null;
  taskRoleNpcId?: number | null;
  taskType?: number | null;
  maxAward?: number | null;
  taskStep?: number | null;
  status?: number | null;
};

type RequirementRow = {
  questId: number;
  scopeType: 'accept' | 'step' | 'step_event' | 'reaction';
  stepId?: string | null;
  reactionId?: string | null;
  sortOrder: number;
  kind: RequirementDef['kind'];
  level?: number | null;
  targetQuestId?: number | null;
  mapId?: number | null;
  npcId?: number | null;
  monsterId?: number | null;
  templateId?: number | null;
  quantity?: number | null;
  flag?: string | null;
  booleanValue?: boolean | null;
  counter?: string | null;
  numericValue?: number | null;
  scriptId?: number | null;
  subtype?: number | null;
  contextId?: number | null;
};

type EffectRow = {
  questId: number;
  scopeType: 'accept' | 'step' | 'step_event' | 'reaction';
  stepId?: string | null;
  reactionId?: string | null;
  sortOrder: number;
  kind: QuestEffectDef['kind'];
  flag?: string | null;
  booleanValue?: boolean | null;
  counter?: string | null;
  amount?: number | null;
  rewardChoiceId?: number | null;
  templateId?: number | null;
  quantity?: number | null;
  itemName?: string | null;
  stat?: 'gold' | 'coins' | 'renown' | 'experience' | null;
  delta?: number | null;
  petTemplateId?: number | null;
  monsterId?: number | null;
  count?: number | null;
  title?: string | null;
  message?: string | null;
};

type StepTrackerScriptRow = {
  questId: number;
  stepId: string;
  sortOrder: number;
  scriptId: number;
};

type StepReactionRow = {
  questId: number;
  stepId: string;
  reactionId: string;
  reactionOrder: number;
  triggerType: StepDef['trigger']['type'];
};

type RewardRow = {
  questId: number;
  gold: number;
  experience: number;
  coins: number;
  renown: number;
};

type RewardItemRow = {
  questId: number;
  sortOrder: number;
  templateId: number;
  quantity: number;
  name?: string | null;
};

type RewardPetRow = {
  questId: number;
  sortOrder: number;
  petTemplateId: number;
};

type RewardChoiceRow = {
  questId: number;
  choiceId: number;
  label?: string | null;
  gold: number;
  experience: number;
  coins: number;
  renown: number;
};

type RewardChoiceItemRow = {
  questId: number;
  choiceId: number;
  sortOrder: number;
  templateId: number;
  quantity: number;
  name?: string | null;
};

type RewardChoicePetRow = {
  questId: number;
  choiceId: number;
  sortOrder: number;
  petTemplateId: number;
};

function loadQuestDefinitionsFromTables(): QuestDef[] {
  if (STATIC_DATA_BACKEND !== 'db') {
    return [];
  }

  try {
    const questRows = queryJsonArray<QuestRow>(
      `SELECT COALESCE(
         json_agg(
           json_build_object(
             'questId', quest_id,
             'name', name,
             'repeatable', repeatable,
             'familyTaskId', family_task_id
           )
           ORDER BY quest_id
         ),
         '[]'::json
       )
       FROM game_quest2_definitions`
    );
    if (questRows.length < 1) {
      return [];
    }

    const acceptRuleRows = queryJsonArray<AcceptRuleRow>(
      `SELECT COALESCE(
         json_agg(
           json_build_object(
             'questId', quest_id,
             'triggerType', trigger_type
           )
           ORDER BY quest_id
         ),
         '[]'::json
       )
       FROM game_quest2_accept_rules`
    );
    const stepRows = queryJsonArray<StepRow>(
      `SELECT COALESCE(
         json_agg(
           json_build_object(
             'questId', quest_id,
             'stepId', step_id,
             'stepOrder', step_order,
             'kind', kind,
             'description', description,
             'triggerType', trigger_type,
             'nextStepId', next_step_id,
             'progressCounter', progress_counter,
             'progressTarget', progress_target,
             'progressEventValue', progress_event_value,
             'markerNpcId', marker_npc_id,
             'overNpcId', over_npc_id,
             'taskRoleNpcId', task_role_npc_id,
             'taskType', task_type,
             'maxAward', max_award,
             'taskStep', task_step,
             'status', status
           )
           ORDER BY quest_id, step_order
         ),
         '[]'::json
       )
       FROM game_quest2_steps`
    );
    const requirementRows = queryJsonArray<RequirementRow>(
      `SELECT COALESCE(
         json_agg(
           json_build_object(
             'questId', quest_id,
             'scopeType', scope_type,
             'stepId', NULLIF(step_id, ''),
             'reactionId', NULLIF(reaction_id, ''),
             'sortOrder', sort_order,
             'kind', kind,
             'level', level_value,
             'targetQuestId', quest_id_value,
             'mapId', map_id_value,
             'npcId', npc_id_value,
             'monsterId', monster_id_value,
             'templateId', template_id_value,
             'quantity', quantity_value,
             'flag', flag_value,
             'booleanValue', boolean_value,
             'counter', counter_value,
             'numericValue', numeric_value,
             'scriptId', script_id_value,
             'subtype', subtype_value,
             'contextId', context_id_value
           )
           ORDER BY quest_id, scope_type, step_id, reaction_id, sort_order
         ),
         '[]'::json
       )
       FROM game_quest2_requirements`
    );
    const effectRows = queryJsonArray<EffectRow>(
      `SELECT COALESCE(
         json_agg(
           json_build_object(
             'questId', quest_id,
             'scopeType', scope_type,
             'stepId', NULLIF(step_id, ''),
             'reactionId', NULLIF(reaction_id, ''),
             'sortOrder', sort_order,
             'kind', kind,
             'flag', flag_value,
             'booleanValue', boolean_value,
             'counter', counter_value,
             'amount', amount_value,
             'rewardChoiceId', reward_choice_id_value,
             'templateId', item_template_id,
             'quantity', item_quantity,
             'itemName', item_name,
             'stat', stat_value,
             'delta', delta_value,
             'petTemplateId', pet_template_id,
             'monsterId', monster_id_value,
             'count', count_value,
             'title', title_value,
             'message', message_value
           )
           ORDER BY quest_id, scope_type, step_id, reaction_id, sort_order
         ),
         '[]'::json
       )
       FROM game_quest2_effects`
    );
    const stepReactionRows = queryJsonArray<StepReactionRow>(
      `SELECT COALESCE(
         json_agg(
           json_build_object(
             'questId', quest_id,
             'stepId', step_id,
             'reactionId', reaction_id,
             'reactionOrder', reaction_order,
             'triggerType', trigger_type
           )
           ORDER BY quest_id, step_id, reaction_order
         ),
         '[]'::json
       )
       FROM game_quest2_step_reactions`
    );
    const trackerScriptRows = queryJsonArray<StepTrackerScriptRow>(
      `SELECT COALESCE(
         json_agg(
           json_build_object(
             'questId', quest_id,
             'stepId', step_id,
             'sortOrder', sort_order,
             'scriptId', script_id
           )
           ORDER BY quest_id, step_id, sort_order
         ),
         '[]'::json
       )
       FROM game_quest2_step_tracker_scripts`
    );
    const rewardRows = queryJsonArray<RewardRow>(
      `SELECT COALESCE(
         json_agg(
           json_build_object(
             'questId', quest_id,
             'gold', gold,
             'experience', experience,
             'coins', coins,
             'renown', renown
           )
           ORDER BY quest_id
         ),
         '[]'::json
       )
       FROM game_quest2_rewards`
    );
    const rewardItemRows = queryJsonArray<RewardItemRow>(
      `SELECT COALESCE(
         json_agg(
           json_build_object(
             'questId', quest_id,
             'sortOrder', sort_order,
             'templateId', template_id,
             'quantity', quantity,
             'name', name
           )
           ORDER BY quest_id, sort_order
         ),
         '[]'::json
       )
       FROM game_quest2_reward_items`
    );
    const rewardPetRows = queryJsonArray<RewardPetRow>(
      `SELECT COALESCE(
         json_agg(
           json_build_object(
             'questId', quest_id,
             'sortOrder', sort_order,
             'petTemplateId', pet_template_id
           )
           ORDER BY quest_id, sort_order
         ),
         '[]'::json
       )
       FROM game_quest2_reward_pets`
    );
    const rewardChoiceRows = queryJsonArray<RewardChoiceRow>(
      `SELECT COALESCE(
         json_agg(
           json_build_object(
             'questId', quest_id,
             'choiceId', choice_id,
             'label', label,
             'gold', gold,
             'experience', experience,
             'coins', coins,
             'renown', renown
           )
           ORDER BY quest_id, choice_id
         ),
         '[]'::json
       )
       FROM game_quest2_reward_choices`
    );
    const rewardChoiceItemRows = queryJsonArray<RewardChoiceItemRow>(
      `SELECT COALESCE(
         json_agg(
           json_build_object(
             'questId', quest_id,
             'choiceId', choice_id,
             'sortOrder', sort_order,
             'templateId', template_id,
             'quantity', quantity,
             'name', name
           )
           ORDER BY quest_id, choice_id, sort_order
         ),
         '[]'::json
       )
       FROM game_quest2_reward_choice_items`
    );
    const rewardChoicePetRows = queryJsonArray<RewardChoicePetRow>(
      `SELECT COALESCE(
         json_agg(
           json_build_object(
             'questId', quest_id,
             'choiceId', choice_id,
             'sortOrder', sort_order,
             'petTemplateId', pet_template_id
           )
           ORDER BY quest_id, choice_id, sort_order
         ),
         '[]'::json
       )
       FROM game_quest2_reward_choice_pets`
    );

    return buildQuestDefinitions({
      questRows,
      acceptRuleRows,
      stepRows,
      requirementRows,
      effectRows,
      stepReactionRows,
      trackerScriptRows,
      rewardRows,
      rewardItemRows,
      rewardPetRows,
      rewardChoiceRows,
      rewardChoiceItemRows,
      rewardChoicePetRows,
    });
  } catch {
    return [];
  }
}

function buildQuestDefinitions(input: {
  questRows: QuestRow[];
  acceptRuleRows: AcceptRuleRow[];
  stepRows: StepRow[];
  requirementRows: RequirementRow[];
  effectRows: EffectRow[];
  stepReactionRows: StepReactionRow[];
  trackerScriptRows: StepTrackerScriptRow[];
  rewardRows: RewardRow[];
  rewardItemRows: RewardItemRow[];
  rewardPetRows: RewardPetRow[];
  rewardChoiceRows: RewardChoiceRow[];
  rewardChoiceItemRows: RewardChoiceItemRow[];
  rewardChoicePetRows: RewardChoicePetRow[];
}): QuestDef[] {
  const acceptByQuestId = new Map<number, AcceptRuleRow>(
    input.acceptRuleRows.map((row) => [row.questId >>> 0, row])
  );
  const rewardsByQuestId = new Map<number, RewardRow>(
    input.rewardRows.map((row) => [row.questId >>> 0, row])
  );

  const requirementsByScope = groupRowsByScope(input.requirementRows);
  const effectsByScope = groupRowsByScope(input.effectRows);
  const stepsByQuestId = groupRowsByQuestId(input.stepRows);
  const reactionsByStep = groupStepReactionsByStep(input.stepReactionRows);
  const trackerScriptsByStep = groupTrackerScriptsByStep(input.trackerScriptRows);
  const rewardItemsByQuestId = groupRowsByQuestId(input.rewardItemRows);
  const rewardPetsByQuestId = groupRowsByQuestId(input.rewardPetRows);
  const rewardChoicesByQuestId = groupRowsByQuestId(input.rewardChoiceRows);
  const rewardChoiceItemsByChoice = groupRewardChoiceRows(input.rewardChoiceItemRows);
  const rewardChoicePetsByChoice = groupRewardChoiceRows(input.rewardChoicePetRows);

  const definitions: QuestDef[] = [];
  for (const questRow of input.questRows) {
    const questId = questRow.questId >>> 0;
    const acceptRow = acceptByQuestId.get(questId);
    if (!acceptRow) {
      continue;
    }

    const rawSteps = (stepsByQuestId.get(questId) || [])
      .slice()
      .sort((left, right) => left.stepOrder - right.stepOrder);
    if (rawSteps.length < 1) {
      continue;
    }

    const steps: StepDef[] = rawSteps.map((stepRow, index) => {
      const client = buildClientStepHints(
        stepRow,
        trackerScriptsByStep.get(makeStepKey(questId, stepRow.stepId)) || []
      );
      return {
        id: stepRow.stepId,
        kind: stepRow.kind,
        description:
          typeof stepRow.description === 'string' && stepRow.description.length > 0
            ? stepRow.description
            : undefined,
        trigger: { type: stepRow.triggerType },
        requirements:
          requirementsByScope.get(makeScopeKey(questId, 'step', stepRow.stepId, ''))?.map(buildRequirement) || [],
        eventEffects:
          effectsByScope.get(makeScopeKey(questId, 'step_event', stepRow.stepId, ''))?.map(buildEffect) || undefined,
        effects:
          effectsByScope.get(makeScopeKey(questId, 'step', stepRow.stepId, ''))?.map(buildEffect) || [],
        reactions:
          reactionsByStep.get(makeStepKey(questId, stepRow.stepId))?.map((reactionRow) => buildReaction(
            reactionRow,
            requirementsByScope.get(makeScopeKey(questId, 'reaction', stepRow.stepId, reactionRow.reactionId)) || [],
            effectsByScope.get(makeScopeKey(questId, 'reaction', stepRow.stepId, reactionRow.reactionId)) || []
          )) || undefined,
        progress: buildProgress(stepRow),
        nextStepId:
          typeof stepRow.nextStepId === 'string' && stepRow.nextStepId.length > 0
            ? stepRow.nextStepId
            : (rawSteps[index + 1]?.stepId || null),
        client,
      };
    });

    const rewardChoices = (rewardChoicesByQuestId.get(questId) || [])
      .slice()
      .sort((left, right) => left.choiceId - right.choiceId)
      .map((choiceRow) => buildRewardChoice(
        choiceRow,
        rewardChoiceItemsByChoice.get(makeRewardChoiceKey(choiceRow.questId, choiceRow.choiceId)) || [],
        rewardChoicePetsByChoice.get(makeRewardChoiceKey(choiceRow.questId, choiceRow.choiceId)) || []
      ));

    const rewardRow = rewardsByQuestId.get(questId);
    const rewards: RewardDef = {
      gold: rewardRow?.gold || 0,
      experience: rewardRow?.experience || 0,
      coins: rewardRow?.coins || 0,
      renown: rewardRow?.renown || 0,
      items: (rewardItemsByQuestId.get(questId) || []).map(buildItemStack),
      pets: (rewardPetsByQuestId.get(questId) || []).map((row) => row.petTemplateId >>> 0),
      choiceGroups: rewardChoices,
    };

    const client: ClientQuestHints | undefined =
      Number.isInteger(questRow.familyTaskId) && (questRow.familyTaskId || 0) > 0
        ? { familyTaskId: questRow.familyTaskId! >>> 0 }
        : undefined;

    definitions.push({
      id: questId,
      name: typeof questRow.name === 'string' && questRow.name.length > 0 ? questRow.name : `Quest ${questId}`,
      repeatable: questRow.repeatable === true,
      accept: {
        trigger: { type: acceptRow.triggerType },
        requirements:
          requirementsByScope.get(makeScopeKey(questId, 'accept', '', ''))?.map(buildRequirement) || [],
        effects:
          effectsByScope.get(makeScopeKey(questId, 'accept', '', ''))?.map(buildEffect) || [],
      },
      steps,
      rewards,
      client,
    });
  }

  return definitions.sort((left, right) => left.id - right.id);
}

function groupRowsByQuestId<T extends { questId: number }>(rows: T[]): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const key = row.questId >>> 0;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }
  return grouped;
}

function groupRowsByScope<
  T extends {
    questId: number;
    scopeType: 'accept' | 'step' | 'step_event' | 'reaction';
    stepId?: string | null;
    reactionId?: string | null;
  },
>(
  rows: T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = makeScopeKey(row.questId, row.scopeType, row.stepId || '', row.reactionId || '');
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }
  return grouped;
}

function groupStepReactionsByStep(rows: StepReactionRow[]): Map<string, StepReactionRow[]> {
  const grouped = new Map<string, StepReactionRow[]>();
  for (const row of rows) {
    const key = makeStepKey(row.questId, row.stepId);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }
  return grouped;
}

function groupTrackerScriptsByStep(rows: StepTrackerScriptRow[]): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const key = makeStepKey(row.questId, row.stepId);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(row.scriptId >>> 0);
    } else {
      grouped.set(key, [row.scriptId >>> 0]);
    }
  }
  return grouped;
}

function groupRewardChoiceRows<T extends { questId: number; choiceId: number }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = makeRewardChoiceKey(row.questId, row.choiceId);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }
  return grouped;
}

function makeScopeKey(
  questId: number,
  scopeType: 'accept' | 'step' | 'step_event' | 'reaction',
  stepId: string,
  reactionId: string
): string {
  return `${questId >>> 0}:${scopeType}:${stepId}:${reactionId}`;
}

function makeStepKey(questId: number, stepId: string): string {
  return `${questId >>> 0}:${stepId}`;
}

function makeRewardChoiceKey(questId: number, choiceId: number): string {
  return `${questId >>> 0}:${choiceId >>> 0}`;
}

function buildProgress(row: StepRow): QuestProgressDef | undefined {
  if (typeof row.progressCounter !== 'string' || row.progressCounter.length < 1) {
    return undefined;
  }
  return {
    counter: row.progressCounter,
    target: Number.isInteger(row.progressTarget) && (row.progressTarget || 0) > 0 ? row.progressTarget! >>> 0 : 1,
    eventValue:
      row.progressEventValue === 'delta' || row.progressEventValue === 'one' || row.progressEventValue === 'quantity'
        ? row.progressEventValue
        : 'count',
  };
}

function buildClientStepHints(row: StepRow, trackerScriptIds: number[]): ClientStepHints | undefined {
  const client: ClientStepHints = {};
  if (Number.isInteger(row.markerNpcId) && (row.markerNpcId || 0) > 0) {
    client.markerNpcId = row.markerNpcId! >>> 0;
  }
  if (Number.isInteger(row.overNpcId) && (row.overNpcId || 0) > 0) {
    client.overNpcId = row.overNpcId! >>> 0;
  }
  if (Number.isInteger(row.taskRoleNpcId) && (row.taskRoleNpcId || 0) > 0) {
    client.taskRoleNpcId = row.taskRoleNpcId! >>> 0;
  }
  if (Number.isInteger(row.taskType) && (row.taskType || 0) >= 0) {
    client.taskType = row.taskType! >>> 0;
  }
  if (Number.isInteger(row.maxAward) && (row.maxAward || 0) >= 0) {
    client.maxAward = row.maxAward! >>> 0;
  }
  if (Number.isInteger(row.taskStep) && (row.taskStep || 0) > 0) {
    client.taskStep = row.taskStep! >>> 0;
  }
  if (Number.isInteger(row.status) && (row.status || 0) >= 0) {
    client.status = row.status! >>> 0;
  }
  if (trackerScriptIds.length > 0) {
    client.trackerScriptIds = trackerScriptIds;
  }
  return Object.keys(client).length > 0 ? client : undefined;
}

function buildRequirement(row: RequirementRow): RequirementDef {
  switch (row.kind) {
    case 'level_at_least':
      return { kind: 'level_at_least', level: Math.max(1, row.level || 1) };
    case 'quest_completed':
      return { kind: 'quest_completed', questId: row.targetQuestId! >>> 0 };
    case 'quest_active':
      return { kind: 'quest_active', questId: row.targetQuestId! >>> 0 };
    case 'map_is':
      return { kind: 'map_is', mapId: row.mapId! >>> 0 };
    case 'npc_is':
      return { kind: 'npc_is', npcId: row.npcId! >>> 0 };
    case 'turn_in_map_is':
      return { kind: 'turn_in_map_is', mapId: row.mapId! >>> 0 };
    case 'turn_in_npc_is':
      return { kind: 'turn_in_npc_is', npcId: row.npcId! >>> 0 };
    case 'monster_is':
      return { kind: 'monster_is', monsterId: row.monsterId! >>> 0 };
    case 'item_is':
      return { kind: 'item_is', templateId: row.templateId! >>> 0 };
    case 'item_count_at_least':
      return {
        kind: 'item_count_at_least',
        templateId: row.templateId! >>> 0,
        quantity: Math.max(1, row.quantity || 1),
      };
    case 'captured_monster_count_at_least':
      return {
        kind: 'captured_monster_count_at_least',
        monsterId: row.monsterId! >>> 0,
        quantity: Math.max(1, row.quantity || 1),
      };
    case 'flag_is':
      return {
        kind: 'flag_is',
        flag: row.flag || '',
        value: row.booleanValue !== false,
      };
    case 'counter_at_least':
      return {
        kind: 'counter_at_least',
        counter: row.counter || '',
        value: Math.max(0, row.numericValue || 0),
      };
    case 'script_is':
      return { kind: 'script_is', scriptId: row.scriptId! >>> 0 };
    case 'subtype_is':
      return { kind: 'subtype_is', subtype: row.subtype! >>> 0 };
    case 'context_is':
      return { kind: 'context_is', contextId: row.contextId! >>> 0 };
  }
}

function buildEffect(row: EffectRow): QuestEffectDef {
  switch (row.kind) {
    case 'set_flag':
      return { kind: 'set_flag', flag: row.flag || '', value: row.booleanValue !== false };
    case 'clear_flag':
      return { kind: 'clear_flag', flag: row.flag || '' };
    case 'increment_counter':
      return {
        kind: 'increment_counter',
        counter: row.counter || '',
        amount: Math.max(1, row.amount || 1),
      };
    case 'reset_counter':
      return { kind: 'reset_counter', counter: row.counter || '' };
    case 'select_reward_choice':
      return { kind: 'select_reward_choice', rewardChoiceId: row.rewardChoiceId! >>> 0 };
    case 'grant_item':
      return {
        kind: 'grant_item',
        item: buildItemStack({
          templateId: row.templateId! >>> 0,
          quantity: Math.max(1, row.quantity || 1),
          name: row.itemName,
        }),
        idempotent: row.booleanValue === true,
      };
    case 'remove_item':
      return {
        kind: 'remove_item',
        item: buildItemStack({
          templateId: row.templateId! >>> 0,
          quantity: Math.max(1, row.quantity || 1),
          name: row.itemName,
        }),
      };
    case 'remove_captured_monster_item':
      return {
        kind: 'remove_captured_monster_item',
        monsterId: row.monsterId! >>> 0,
        quantity: Math.max(1, row.quantity || 1),
        templateId: Number.isInteger(row.templateId) && (row.templateId || 0) > 0 ? (row.templateId! >>> 0) : undefined,
        name: typeof row.itemName === 'string' && row.itemName.length > 0 ? row.itemName : undefined,
      };
    case 'update_stat':
      return {
        kind: 'update_stat',
        stat: row.stat || 'gold',
        delta: Number.isFinite(row.delta) ? Number(row.delta) : 0,
      };
    case 'grant_pet':
      return { kind: 'grant_pet', petTemplateId: row.petTemplateId! >>> 0 };
    case 'start_combat':
      return {
        kind: 'start_combat',
        monsterId: row.monsterId! >>> 0,
        count: Math.max(1, row.count || 1),
      };
    case 'show_dialogue':
      return {
        kind: 'show_dialogue',
        title: typeof row.title === 'string' && row.title.length > 0 ? row.title : 'Quest',
        message: row.message || '',
      };
  }
}

function buildReaction(
  row: StepReactionRow,
  requirementRows: RequirementRow[],
  effectRows: EffectRow[]
): StepReactionDef {
  return {
    id: row.reactionId,
    trigger: { type: row.triggerType },
    requirements: requirementRows.map(buildRequirement),
    effects: effectRows.map(buildEffect),
  };
}

function buildItemStack(row: { templateId: number; quantity: number; name?: string | null }): ItemStackDef {
  return {
    templateId: row.templateId >>> 0,
    quantity: Math.max(1, row.quantity || 1),
    name: typeof row.name === 'string' && row.name.length > 0 ? row.name : undefined,
  };
}

function buildRewardChoice(
  row: RewardChoiceRow,
  itemRows: RewardChoiceItemRow[],
  petRows: RewardChoicePetRow[]
): RewardChoiceDef {
  return {
    id: row.choiceId >>> 0,
    label: typeof row.label === 'string' && row.label.length > 0 ? row.label : undefined,
    gold: row.gold || 0,
    experience: row.experience || 0,
    coins: row.coins || 0,
    renown: row.renown || 0,
    items: itemRows.map(buildItemStack),
    pets: petRows.map((petRow) => petRow.petTemplateId >>> 0),
  };
}

export {
  loadQuestDefinitionsFromTables,
};
