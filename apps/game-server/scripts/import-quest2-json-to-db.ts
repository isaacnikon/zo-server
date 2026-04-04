#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { ensureDockerDatabaseReady, executeSqlViaDocker } from './db-utils.js';
import { sqlBoolean, sqlInteger, sqlNullableInteger, sqlText } from '../src/db/sql-literals.js';
import { QUEST2_DEFINITIONS_FILE, normalizeQuestDefinition } from '../src/quest2/definitions.js';
import type {
  QuestDef,
  QuestEffectDef,
  RequirementDef,
  RewardChoiceDef,
  StepDef,
  StepReactionDef,
} from '../src/quest2/schema.js';

const applyChanges = process.argv.includes('--apply');
const fileFlagIndex = process.argv.indexOf('--file');
const questFilePath =
  fileFlagIndex >= 0 && typeof process.argv[fileFlagIndex + 1] === 'string'
    ? path.resolve(process.cwd(), process.argv[fileFlagIndex + 1]!)
    : QUEST2_DEFINITIONS_FILE;

function loadQuestDefinitionsFromJson(filePath: string): QuestDef[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as { quests?: Array<Record<string, unknown>> };
  const quests = Array.isArray(parsed?.quests) ? parsed.quests : [];

  return quests
    .map((quest) => normalizeQuestDefinition(quest))
    .filter((quest): quest is QuestDef => Boolean(quest))
    .sort((left, right) => left.id - right.id);
}

function buildQuest2ImportSql(quests: QuestDef[]): string[] {
  const statements = ['BEGIN;'];

  statements.push(
    'DELETE FROM game_quest2_reward_choice_items;',
    'DELETE FROM game_quest2_reward_choice_pets;',
    'DELETE FROM game_quest2_reward_choices;',
    'DELETE FROM game_quest2_reward_items;',
    'DELETE FROM game_quest2_reward_pets;',
    'DELETE FROM game_quest2_rewards;',
    'DELETE FROM game_quest2_step_tracker_scripts;',
    'DELETE FROM game_quest2_step_reactions;',
    'DELETE FROM game_quest2_effects;',
    'DELETE FROM game_quest2_requirements;',
    'DELETE FROM game_quest2_steps;',
    'DELETE FROM game_quest2_accept_rules;',
    'DELETE FROM game_quest2_definitions;'
  );

  for (const quest of quests) {
    statements.push(buildQuestDefinitionInsertSql(quest));
    statements.push(buildAcceptRuleInsertSql(quest));

    quest.accept.requirements.forEach((requirement, index) => {
      statements.push(buildRequirementInsertSql(quest.id, 'accept', '', '', index + 1, requirement));
    });
    quest.accept.effects.forEach((effect, index) => {
      statements.push(buildEffectInsertSql(quest.id, 'accept', '', '', index + 1, effect));
    });

    quest.steps.forEach((step, stepIndex) => {
      statements.push(buildStepInsertSql(quest.id, step, stepIndex + 1));

      step.requirements.forEach((requirement, requirementIndex) => {
        statements.push(
          buildRequirementInsertSql(quest.id, 'step', step.id, '', requirementIndex + 1, requirement)
        );
      });

      (step.eventEffects || []).forEach((effect, effectIndex) => {
        statements.push(buildEffectInsertSql(quest.id, 'step_event', step.id, '', effectIndex + 1, effect));
      });

      step.effects.forEach((effect, effectIndex) => {
        statements.push(buildEffectInsertSql(quest.id, 'step', step.id, '', effectIndex + 1, effect));
      });

      (step.reactions || []).forEach((reaction, reactionIndex) => {
        statements.push(buildStepReactionInsertSql(quest.id, step.id, reaction, reactionIndex + 1));
        reaction.requirements.forEach((requirement, requirementIndex) => {
          statements.push(
            buildRequirementInsertSql(
              quest.id,
              'reaction',
              step.id,
              reaction.id,
              requirementIndex + 1,
              requirement
            )
          );
        });
        reaction.effects.forEach((effect, effectIndex) => {
          statements.push(
            buildEffectInsertSql(quest.id, 'reaction', step.id, reaction.id, effectIndex + 1, effect)
          );
        });
      });

      const trackerScriptIds = Array.isArray(step.client?.trackerScriptIds)
        ? step.client!.trackerScriptIds!.filter(Number.isInteger).map((scriptId) => scriptId >>> 0)
        : [];
      trackerScriptIds.forEach((scriptId, trackerIndex) => {
        statements.push(buildTrackerScriptInsertSql(quest.id, step.id, trackerIndex + 1, scriptId));
      });
    });

    statements.push(buildRewardInsertSql(quest));

    quest.rewards.items.forEach((item, index) => {
      statements.push(
        buildRewardItemInsertSql(quest.id, index + 1, item.templateId, item.quantity, item.name)
      );
    });
    quest.rewards.pets.forEach((petTemplateId, index) => {
      statements.push(buildRewardPetInsertSql(quest.id, index + 1, petTemplateId));
    });
    quest.rewards.choiceGroups.forEach((choice) => {
      statements.push(buildRewardChoiceInsertSql(quest.id, choice));

      choice.items.forEach((item, index) => {
        statements.push(
          buildRewardChoiceItemInsertSql(
            quest.id,
            choice.id,
            index + 1,
            item.templateId,
            item.quantity,
            item.name
          )
        );
      });

      choice.pets.forEach((petTemplateId, index) => {
        statements.push(buildRewardChoicePetInsertSql(quest.id, choice.id, index + 1, petTemplateId));
      });
    });
  }

  statements.push('COMMIT;');
  return statements;
}

function buildQuestDefinitionInsertSql(quest: QuestDef): string {
  return `INSERT INTO game_quest2_definitions (
    quest_id,
    name,
    repeatable,
    family_task_id,
    imported_at
  ) VALUES (
    ${sqlInteger(quest.id, 0)},
    ${sqlText(quest.name)},
    ${sqlBoolean(quest.repeatable)},
    ${sqlNullableInteger(quest.client?.familyTaskId)},
    NOW()
  );`;
}

function buildAcceptRuleInsertSql(quest: QuestDef): string {
  return `INSERT INTO game_quest2_accept_rules (
    quest_id,
    trigger_type
  ) VALUES (
    ${sqlInteger(quest.id, 0)},
    ${sqlText(quest.accept.trigger.type)}
  );`;
}

function buildStepInsertSql(questId: number, step: StepDef, stepOrder: number): string {
  return `INSERT INTO game_quest2_steps (
    quest_id,
    step_id,
    step_order,
    kind,
    description,
    trigger_type,
    next_step_id,
    progress_counter,
    progress_target,
    progress_event_value,
    marker_npc_id,
    over_npc_id,
    task_role_npc_id,
    task_type,
    max_award,
    task_step,
    status
  ) VALUES (
    ${sqlInteger(questId, 0)},
    ${sqlText(step.id)},
    ${sqlInteger(stepOrder, 0)},
    ${sqlText(step.kind)},
    ${sqlText(step.description)},
    ${sqlText(step.trigger.type)},
    ${sqlText(step.nextStepId)},
    ${sqlText(step.progress?.counter)},
    ${sqlNullableInteger(step.progress?.target)},
    ${sqlText(step.progress?.eventValue)},
    ${sqlNullableInteger(step.client?.markerNpcId)},
    ${sqlNullableInteger(step.client?.overNpcId)},
    ${sqlNullableInteger(step.client?.taskRoleNpcId)},
    ${sqlNullableInteger(step.client?.taskType)},
    ${sqlNullableInteger(step.client?.maxAward)},
    ${sqlNullableInteger(step.client?.taskStep)},
    ${sqlNullableInteger(step.client?.status)}
  );`;
}

function buildRequirementInsertSql(
  questId: number,
  scopeType: 'accept' | 'step' | 'step_event' | 'reaction',
  stepId: string,
  reactionId: string,
  sortOrder: number,
  requirement: RequirementDef
): string {
  let levelValue: number | null = null;
  let questIdValue: number | null = null;
  let mapIdValue: number | null = null;
  let npcIdValue: number | null = null;
  let monsterIdValue: number | null = null;
  let templateIdValue: number | null = null;
  let quantityValue: number | null = null;
  let flagValue: string | null = null;
  let booleanValue: boolean | null = null;
  let counterValue: string | null = null;
  let numericValue: number | null = null;
  let scriptIdValue: number | null = null;
  let subtypeValue: number | null = null;
  let contextIdValue: number | null = null;

  switch (requirement.kind) {
    case 'level_at_least':
      levelValue = requirement.level;
      break;
    case 'quest_completed':
    case 'quest_active':
      questIdValue = requirement.questId;
      break;
    case 'map_is':
    case 'turn_in_map_is':
      mapIdValue = requirement.mapId;
      break;
    case 'npc_is':
    case 'turn_in_npc_is':
      npcIdValue = requirement.npcId;
      break;
    case 'monster_is':
      monsterIdValue = requirement.monsterId;
      break;
    case 'item_is':
      templateIdValue = requirement.templateId;
      break;
    case 'item_count_at_least':
      templateIdValue = requirement.templateId;
      quantityValue = requirement.quantity;
      break;
    case 'captured_monster_count_at_least':
      monsterIdValue = requirement.monsterId;
      quantityValue = requirement.quantity;
      break;
    case 'flag_is':
      flagValue = requirement.flag;
      booleanValue = requirement.value;
      break;
    case 'counter_at_least':
      counterValue = requirement.counter;
      numericValue = requirement.value;
      break;
    case 'script_is':
      scriptIdValue = requirement.scriptId;
      break;
    case 'subtype_is':
      subtypeValue = requirement.subtype;
      break;
    case 'context_is':
      contextIdValue = requirement.contextId;
      break;
    default:
      break;
  }

  return `INSERT INTO game_quest2_requirements (
    quest_id,
    scope_type,
    step_id,
    reaction_id,
    sort_order,
    kind,
    level_value,
    quest_id_value,
    map_id_value,
    npc_id_value,
    monster_id_value,
    template_id_value,
    quantity_value,
    flag_value,
    boolean_value,
    counter_value,
    numeric_value,
    script_id_value,
    subtype_value,
    context_id_value
  ) VALUES (
    ${sqlInteger(questId, 0)},
    ${sqlText(scopeType)},
    ${sqlText(scopeType === 'accept' ? '' : stepId)},
    ${sqlText(scopeType === 'reaction' ? reactionId : '')},
    ${sqlInteger(sortOrder, 0)},
    ${sqlText(requirement.kind)},
    ${sqlNullableInteger(levelValue)},
    ${sqlNullableInteger(questIdValue)},
    ${sqlNullableInteger(mapIdValue)},
    ${sqlNullableInteger(npcIdValue)},
    ${sqlNullableInteger(monsterIdValue)},
    ${sqlNullableInteger(templateIdValue)},
    ${sqlNullableInteger(quantityValue)},
    ${sqlText(flagValue)},
    ${booleanValue == null ? 'NULL' : sqlBoolean(booleanValue)},
    ${sqlText(counterValue)},
    ${sqlNullableInteger(numericValue)},
    ${sqlNullableInteger(scriptIdValue)},
    ${sqlNullableInteger(subtypeValue)},
    ${sqlNullableInteger(contextIdValue)}
  );`;
}

function buildEffectInsertSql(
  questId: number,
  scopeType: 'accept' | 'step' | 'step_event' | 'reaction',
  stepId: string,
  reactionId: string,
  sortOrder: number,
  effect: QuestEffectDef
): string {
  let flagValue: string | null = null;
  let booleanValue: boolean | null = null;
  let counterValue: string | null = null;
  let amountValue: number | null = null;
  let rewardChoiceIdValue: number | null = null;
  let itemTemplateId: number | null = null;
  let itemQuantity: number | null = null;
  let itemName: string | null = null;
  let statValue: string | null = null;
  let deltaValue: number | null = null;
  let petTemplateId: number | null = null;
  let monsterIdValue: number | null = null;
  let countValue: number | null = null;
  let titleValue: string | null = null;
  let messageValue: string | null = null;

  switch (effect.kind) {
    case 'set_flag':
      flagValue = effect.flag;
      booleanValue = effect.value !== false;
      break;
    case 'clear_flag':
      flagValue = effect.flag;
      break;
    case 'increment_counter':
      counterValue = effect.counter;
      amountValue = effect.amount || 1;
      break;
    case 'reset_counter':
      counterValue = effect.counter;
      break;
    case 'select_reward_choice':
      rewardChoiceIdValue = effect.rewardChoiceId;
      break;
    case 'grant_item':
      booleanValue = effect.idempotent === true ? true : null;
      itemTemplateId = effect.item.templateId;
      itemQuantity = effect.item.quantity;
      itemName = effect.item.name || null;
      break;
    case 'remove_item':
      itemTemplateId = effect.item.templateId;
      itemQuantity = effect.item.quantity;
      itemName = effect.item.name || null;
      break;
    case 'remove_captured_monster_item':
      monsterIdValue = effect.monsterId;
      itemTemplateId = effect.templateId || null;
      itemQuantity = effect.quantity;
      itemName = effect.name || null;
      break;
    case 'update_stat':
      statValue = effect.stat;
      deltaValue = effect.delta;
      break;
    case 'grant_pet':
      petTemplateId = effect.petTemplateId;
      break;
    case 'start_combat':
      monsterIdValue = effect.monsterId;
      countValue = effect.count || 1;
      break;
    case 'show_dialogue':
      titleValue = effect.title;
      messageValue = effect.message;
      break;
    default:
      break;
  }

  return `INSERT INTO game_quest2_effects (
    quest_id,
    scope_type,
    step_id,
    reaction_id,
    sort_order,
    kind,
    flag_value,
    boolean_value,
    counter_value,
    amount_value,
    reward_choice_id_value,
    item_template_id,
    item_quantity,
    item_name,
    stat_value,
    delta_value,
    pet_template_id,
    monster_id_value,
    count_value,
    title_value,
    message_value
  ) VALUES (
    ${sqlInteger(questId, 0)},
    ${sqlText(scopeType)},
    ${sqlText(scopeType === 'accept' ? '' : stepId)},
    ${sqlText(scopeType === 'reaction' ? reactionId : '')},
    ${sqlInteger(sortOrder, 0)},
    ${sqlText(effect.kind)},
    ${sqlText(flagValue)},
    ${booleanValue == null ? 'NULL' : sqlBoolean(booleanValue)},
    ${sqlText(counterValue)},
    ${sqlNullableInteger(amountValue)},
    ${sqlNullableInteger(rewardChoiceIdValue)},
    ${sqlNullableInteger(itemTemplateId)},
    ${sqlNullableInteger(itemQuantity)},
    ${sqlText(itemName)},
    ${sqlText(statValue)},
    ${sqlNullableInteger(deltaValue)},
    ${sqlNullableInteger(petTemplateId)},
    ${sqlNullableInteger(monsterIdValue)},
    ${sqlNullableInteger(countValue)},
    ${sqlText(titleValue)},
    ${sqlText(messageValue)}
  );`;
}

function buildStepReactionInsertSql(
  questId: number,
  stepId: string,
  reaction: StepReactionDef,
  reactionOrder: number
): string {
  return `INSERT INTO game_quest2_step_reactions (
    quest_id,
    step_id,
    reaction_id,
    reaction_order,
    trigger_type
  ) VALUES (
    ${sqlInteger(questId, 0)},
    ${sqlText(stepId)},
    ${sqlText(reaction.id)},
    ${sqlInteger(reactionOrder, 0)},
    ${sqlText(reaction.trigger.type)}
  );`;
}

function buildTrackerScriptInsertSql(
  questId: number,
  stepId: string,
  sortOrder: number,
  scriptId: number
): string {
  return `INSERT INTO game_quest2_step_tracker_scripts (
    quest_id,
    step_id,
    sort_order,
    script_id
  ) VALUES (
    ${sqlInteger(questId, 0)},
    ${sqlText(stepId)},
    ${sqlInteger(sortOrder, 0)},
    ${sqlInteger(scriptId, 0)}
  );`;
}

function buildRewardInsertSql(quest: QuestDef): string {
  return `INSERT INTO game_quest2_rewards (
    quest_id,
    gold,
    experience,
    coins,
    renown
  ) VALUES (
    ${sqlInteger(quest.id, 0)},
    ${sqlInteger(quest.rewards.gold, 0)},
    ${sqlInteger(quest.rewards.experience, 0)},
    ${sqlInteger(quest.rewards.coins, 0)},
    ${sqlInteger(quest.rewards.renown, 0)}
  );`;
}

function buildRewardItemInsertSql(
  questId: number,
  sortOrder: number,
  templateId: number,
  quantity: number,
  name?: string
): string {
  return `INSERT INTO game_quest2_reward_items (
    quest_id,
    sort_order,
    template_id,
    quantity,
    name
  ) VALUES (
    ${sqlInteger(questId, 0)},
    ${sqlInteger(sortOrder, 0)},
    ${sqlInteger(templateId, 0)},
    ${sqlInteger(quantity, 1)},
    ${sqlText(name)}
  );`;
}

function buildRewardPetInsertSql(questId: number, sortOrder: number, petTemplateId: number): string {
  return `INSERT INTO game_quest2_reward_pets (
    quest_id,
    sort_order,
    pet_template_id
  ) VALUES (
    ${sqlInteger(questId, 0)},
    ${sqlInteger(sortOrder, 0)},
    ${sqlInteger(petTemplateId, 0)}
  );`;
}

function buildRewardChoiceInsertSql(questId: number, choice: RewardChoiceDef): string {
  return `INSERT INTO game_quest2_reward_choices (
    quest_id,
    choice_id,
    label,
    gold,
    experience,
    coins,
    renown
  ) VALUES (
    ${sqlInteger(questId, 0)},
    ${sqlInteger(choice.id, 0)},
    ${sqlText(choice.label)},
    ${sqlInteger(choice.gold, 0)},
    ${sqlInteger(choice.experience, 0)},
    ${sqlInteger(choice.coins, 0)},
    ${sqlInteger(choice.renown, 0)}
  );`;
}

function buildRewardChoiceItemInsertSql(
  questId: number,
  choiceId: number,
  sortOrder: number,
  templateId: number,
  quantity: number,
  name?: string
): string {
  return `INSERT INTO game_quest2_reward_choice_items (
    quest_id,
    choice_id,
    sort_order,
    template_id,
    quantity,
    name
  ) VALUES (
    ${sqlInteger(questId, 0)},
    ${sqlInteger(choiceId, 0)},
    ${sqlInteger(sortOrder, 0)},
    ${sqlInteger(templateId, 0)},
    ${sqlInteger(quantity, 1)},
    ${sqlText(name)}
  );`;
}

function buildRewardChoicePetInsertSql(
  questId: number,
  choiceId: number,
  sortOrder: number,
  petTemplateId: number
): string {
  return `INSERT INTO game_quest2_reward_choice_pets (
    quest_id,
    choice_id,
    sort_order,
    pet_template_id
  ) VALUES (
    ${sqlInteger(questId, 0)},
    ${sqlInteger(choiceId, 0)},
    ${sqlInteger(sortOrder, 0)},
    ${sqlInteger(petTemplateId, 0)}
  );`;
}

async function main(): Promise<void> {
  const quests = loadQuestDefinitionsFromJson(questFilePath);
  if (quests.length < 1) {
    throw new Error(`No quest2 definitions loaded from ${questFilePath}. Refusing to import empty data.`);
  }
  const sqlStatements = buildQuest2ImportSql(quests);

  if (!applyChanges) {
    process.stdout.write(
      `Dry run: ${quests.length} quest2 definitions ready for import from ${questFilePath}.\n`
    );
    return;
  }

  await ensureDockerDatabaseReady();
  await executeSqlViaDocker(sqlStatements.join('\n'));
  process.stdout.write(`Imported ${quests.length} quest2 definitions from ${questFilePath}.\n`);
}

await main();
