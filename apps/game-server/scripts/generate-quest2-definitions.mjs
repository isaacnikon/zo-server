#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');

const CATALOG_FILE = path.join(REPO_ROOT, 'data', 'quests', 'catalog.json');
const MAIN_STORY_FILE = path.join(REPO_ROOT, 'data', 'quests', 'main-story.json');
const HELP_FILE = path.join(REPO_ROOT, 'data', 'client-verified', 'quests', 'client-help-quests.json');
const ITEMS_FILE = path.join(REPO_ROOT, 'data', 'client-derived', 'items.json');
const OUTPUT_FILE = path.join(REPO_ROOT, 'data', 'quests-v2', 'definitions.json');

const PRESERVED_QUEST_IDS = new Set([1, 2, 7, 8]);

const STEP_OVERRIDES = {
  13: {
    1: {
      capturedMonsterId: 5030,
    },
  },
  27: {
    2: {
      objectiveKind: 'item-collect',
      targetMonsterId: 5164,
      requiredItems: [{ templateId: 21038, quantity: 1 }],
      omitTriggerMap: true,
      turnInMapId: 144,
    },
  },
  29: {
    1: {
      targetMonsterId: 5145,
    },
    2: {
      targetMonsterId: 5157,
    },
  },
  450: {
    2: {
      targetMonsterId: 5293,
      requiredItems: [{ templateId: 21230, quantity: 1 }],
    },
  },
  452: {
    2: {
      targetMonsterId: 5198,
      requiredItems: [{ templateId: 21232, quantity: 10 }],
    },
    3: {
      targetMonsterId: 5240,
      requiredItems: [{ templateId: 21233, quantity: 10 }],
    },
  },
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function buildItemNameByTemplateId() {
  const parsed = readJson(ITEMS_FILE);
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const byId = new Map();
  for (const entry of entries) {
    if (!isPositiveInteger(entry?.templateId)) {
      continue;
    }
    const name = nonEmptyString(entry?.name);
    if (name && !byId.has(entry.templateId >>> 0)) {
      byId.set(entry.templateId >>> 0, name);
    }
  }
  return byId;
}

function normalizeItem(rawItem, itemNameByTemplateId) {
  if (!isPositiveInteger(rawItem?.templateId)) {
    return null;
  }
  const templateId = rawItem.templateId >>> 0;
  const quantity = Math.max(1, Number.isInteger(rawItem?.quantity) ? rawItem.quantity : 1);
  const explicitName = nonEmptyString(rawItem?.name);
  const fallbackName = itemNameByTemplateId.get(templateId) || '';
  return {
    templateId,
    quantity,
    ...(explicitName || fallbackName ? { name: explicitName || fallbackName } : {}),
  };
}

function normalizeItemList(rawItems, itemNameByTemplateId) {
  if (!Array.isArray(rawItems)) {
    return [];
  }
  return rawItems
    .map((item) => normalizeItem(item, itemNameByTemplateId))
    .filter((item) => Boolean(item));
}

function dedupeItemList(items) {
  const unique = [];
  const seen = new Set();
  for (const item of items) {
    const key = `${item.templateId}:${item.quantity}:${item.name || ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function buildHelpEntriesByQuestId() {
  const parsed = readJson(HELP_FILE);
  const entries = Array.isArray(parsed?.quests) ? parsed.quests : [];
  const byQuestId = new Map();
  for (const entry of entries) {
    if (!isPositiveInteger(entry?.taskId)) {
      continue;
    }
    const questId = entry.taskId >>> 0;
    const list = byQuestId.get(questId) || [];
    list.push(entry);
    byQuestId.set(questId, list);
  }
  for (const list of byQuestId.values()) {
    list.sort((left, right) => {
      const leftIndex = Number.isInteger(left?.stepIndex) ? left.stepIndex : 0;
      const rightIndex = Number.isInteger(right?.stepIndex) ? right.stepIndex : 0;
      return leftIndex - rightIndex;
    });
  }
  return byQuestId;
}

function resolveNpcMapId(helpEntries, npcId, preferredStepIndex) {
  if (!isPositiveInteger(npcId) || !Array.isArray(helpEntries) || helpEntries.length < 1) {
    return null;
  }

  const tryResolve = (entry) => {
    const startNpcIds = Array.isArray(entry?.startNpcIds) ? entry.startNpcIds : [];
    const mapIds = Array.isArray(entry?.mapIds) ? entry.mapIds : [];
    for (let index = 0; index < startNpcIds.length; index += 1) {
      if ((startNpcIds[index] >>> 0) === (npcId >>> 0) && isPositiveInteger(mapIds[index])) {
        return mapIds[index] >>> 0;
      }
    }
    return null;
  };

  if (isPositiveInteger(preferredStepIndex)) {
    for (const entry of helpEntries) {
      if ((entry?.stepIndex >>> 0) !== (preferredStepIndex >>> 0)) {
        continue;
      }
      const mapId = tryResolve(entry);
      if (isPositiveInteger(mapId)) {
        return mapId >>> 0;
      }
    }
  }

  for (const entry of helpEntries) {
    const mapId = tryResolve(entry);
    if (isPositiveInteger(mapId)) {
      return mapId >>> 0;
    }
  }

  return null;
}

function getQuestOverride(questId, stepId) {
  const byQuest = STEP_OVERRIDES[questId];
  if (!byQuest) {
    return {};
  }
  return byQuest[stepId] || {};
}

function buildAcceptRule(quest, helpEntries, itemNameByTemplateId) {
  const requirements = [];

  if (isPositiveInteger(quest?.minLevel)) {
    requirements.push({ kind: 'level_at_least', level: quest.minLevel >>> 0 });
  }

  const prerequisiteTaskIds = Array.isArray(quest?.prerequisiteTaskIds) ? quest.prerequisiteTaskIds : [];
  for (const prerequisiteTaskId of prerequisiteTaskIds) {
    if (!isPositiveInteger(prerequisiteTaskId)) {
      continue;
    }
    requirements.push({ kind: 'quest_completed', questId: prerequisiteTaskId >>> 0 });
  }

  if (isPositiveInteger(quest?.acceptNpcId)) {
    requirements.push({ kind: 'npc_is', npcId: quest.acceptNpcId >>> 0 });
  }

  if (isPositiveInteger(quest?.acceptSubtype)) {
    requirements.push({ kind: 'subtype_is', subtype: quest.acceptSubtype >>> 0 });
  }

  const acceptMapId = resolveNpcMapId(helpEntries, quest?.acceptNpcId, 1);
  if (isPositiveInteger(acceptMapId)) {
    requirements.push({ kind: 'map_is', mapId: acceptMapId >>> 0 });
  }

  const effects = normalizeItemList(quest?.acceptGrantItems, itemNameByTemplateId).map((item) => ({
    kind: 'grant_item',
    idempotent: true,
    item,
  }));

  return {
    trigger: { type: 'npc_interact' },
    requirements,
    effects,
  };
}

function buildRewardChoiceGroups(rawChoiceGroups, itemNameByTemplateId) {
  if (!Array.isArray(rawChoiceGroups)) {
    return [];
  }

  const usedIds = new Set();
  let nextChoiceId = 1;
  const choices = [];

  for (const rawChoice of rawChoiceGroups) {
    let choiceId = isPositiveInteger(rawChoice?.awardId) ? (rawChoice.awardId >>> 0) : 0;
    while (!isPositiveInteger(choiceId) || usedIds.has(choiceId)) {
      choiceId = nextChoiceId;
      nextChoiceId += 1;
    }
    usedIds.add(choiceId);

    const choice = {
      id: choiceId,
      gold: Number.isInteger(rawChoice?.gold) ? rawChoice.gold : 0,
      experience: Number.isInteger(rawChoice?.experience) ? rawChoice.experience : 0,
      coins: Number.isInteger(rawChoice?.coins) ? rawChoice.coins : 0,
      renown: Number.isInteger(rawChoice?.renown) ? rawChoice.renown : 0,
      pets: Array.isArray(rawChoice?.pets) ? rawChoice.pets.filter(Number.isInteger).map((petId) => petId >>> 0) : [],
      items: normalizeItemList(rawChoice?.items, itemNameByTemplateId),
    };

    const hasPayload =
      choice.gold !== 0 ||
      choice.experience !== 0 ||
      choice.coins !== 0 ||
      choice.renown !== 0 ||
      choice.pets.length > 0 ||
      choice.items.length > 0;

    if (!hasPayload) {
      continue;
    }

    choices.push(choice);
  }

  return choices;
}

function buildRewards(quest, itemNameByTemplateId) {
  const rewards = quest?.rewards || {};
  if ((quest?.id >>> 0) === 51) {
    return {
      gold: Number.isInteger(rewards?.gold) ? rewards.gold : 0,
      experience: Number.isInteger(rewards?.experience) ? rewards.experience : 0,
      coins: Number.isInteger(rewards?.coins) ? rewards.coins : 0,
      renown: Number.isInteger(rewards?.renown) ? rewards.renown : 0,
      petByAptitudeBaseTemplateId: 2000,
      pets: [],
      items: [],
      choiceGroups: [],
    };
  }

  return {
    gold: Number.isInteger(rewards?.gold) ? rewards.gold : 0,
    experience: Number.isInteger(rewards?.experience) ? rewards.experience : 0,
    coins: Number.isInteger(rewards?.coins) ? rewards.coins : 0,
    renown: Number.isInteger(rewards?.renown) ? rewards.renown : 0,
    pets: Array.isArray(rewards?.pets) ? rewards.pets.filter(Number.isInteger).map((petId) => petId >>> 0) : [],
    items: normalizeItemList(rewards?.items, itemNameByTemplateId),
    choiceGroups: buildRewardChoiceGroups(rewards?.choiceGroups, itemNameByTemplateId),
  };
}

function indexItemsByTemplateId(items) {
  const byId = new Map();
  for (const item of items) {
    if (!isPositiveInteger(item?.templateId)) {
      continue;
    }
    byId.set(item.templateId >>> 0, item);
  }
  return byId;
}

function mergeQuantities(baseItems, overrideItems, itemNameByTemplateId) {
  const normalizedBase = normalizeItemList(baseItems, itemNameByTemplateId);
  if (!Array.isArray(overrideItems) || overrideItems.length < 1) {
    return normalizedBase;
  }

  const overrideById = indexItemsByTemplateId(normalizeItemList(overrideItems, itemNameByTemplateId));
  return normalizedBase.map((item) => {
    const override = overrideById.get(item.templateId);
    if (!override) {
      return item;
    }
    return {
      ...item,
      quantity: override.quantity,
      ...(override.name ? { name: override.name } : {}),
    };
  });
}

function buildCompletionGrantItems(step, mainStep, nextCatalogStep, nextMainStep, itemNameByTemplateId) {
  const actionGrantItems = normalizeItemList(
    Array.isArray(step?.actions) ? step.actions.filter((action) => action?.kind === 'grant-item').map((action) => action.item) : [],
    itemNameByTemplateId
  );
  const results = [...actionGrantItems];
  const seenTemplateIds = new Set(actionGrantItems.map((item) => item.templateId));

  const nextRequiredTemplateIds = new Set();
  for (const item of normalizeItemList(nextCatalogStep?.objective?.requiredItems, itemNameByTemplateId)) {
    nextRequiredTemplateIds.add(item.templateId);
  }
  for (const item of normalizeItemList(nextMainStep?.consumeItems, itemNameByTemplateId)) {
    nextRequiredTemplateIds.add(item.templateId);
  }

  const rawMainGrantItems = normalizeItemList(mainStep?.grantItems, itemNameByTemplateId);
  for (const item of rawMainGrantItems) {
    if (seenTemplateIds.has(item.templateId)) {
      continue;
    }
    if (!nextRequiredTemplateIds.has(item.templateId)) {
      continue;
    }
    results.push(item);
    seenTemplateIds.add(item.templateId);
  }

  return dedupeItemList(results);
}

function buildReactionRequirements(trigger) {
  const requirements = [];

  if (isPositiveInteger(trigger?.npcId)) {
    requirements.push({ kind: 'npc_is', npcId: trigger.npcId >>> 0 });
  }
  if (isPositiveInteger(trigger?.mapId)) {
    requirements.push({ kind: 'map_is', mapId: trigger.mapId >>> 0 });
  }
  if (isPositiveInteger(trigger?.subtype)) {
    requirements.push({ kind: 'subtype_is', subtype: trigger.subtype >>> 0 });
  }
  if (isPositiveInteger(trigger?.scriptId)) {
    requirements.push({ kind: 'script_is', scriptId: trigger.scriptId >>> 0 });
  }
  if (isPositiveInteger(trigger?.contextId)) {
    requirements.push({ kind: 'context_is', contextId: trigger.contextId >>> 0 });
  }

  return requirements;
}

function buildReactionEffects(trigger, itemNameByTemplateId) {
  const effects = [];

  const progressFlag = nonEmptyString(trigger?.setProgressFlag);
  if (progressFlag) {
    effects.push({ kind: 'set_flag', flag: progressFlag, value: true });
  }

  for (const item of normalizeItemList(trigger?.consumeItems, itemNameByTemplateId)) {
    effects.push({ kind: 'remove_item', item });
  }

  for (const item of normalizeItemList(trigger?.grantItems, itemNameByTemplateId)) {
    effects.push({ kind: 'grant_item', idempotent: true, item });
  }

  if (isPositiveInteger(trigger?.combat?.monsterId)) {
    effects.push({
      kind: 'start_combat',
      monsterId: trigger.combat.monsterId >>> 0,
      ...(isPositiveInteger(trigger?.combat?.count) ? { count: trigger.combat.count >>> 0 } : {}),
    });
  }

  return effects;
}

function buildReactionsForStep(quest, step, trackerStatus, itemNameByTemplateId) {
  const triggers = Array.isArray(quest?.interactionTriggers) ? quest.interactionTriggers : [];
  const matching = triggers.filter((trigger) => (trigger?.stepStatus >>> 0) === (trackerStatus >>> 0));
  return matching.map((trigger, index) => ({
    id: `reaction_${index + 1}`,
    trigger: { type: 'npc_interact' },
    requirements: buildReactionRequirements(trigger),
    effects: buildReactionEffects(trigger, itemNameByTemplateId),
  }));
}

function buildClientHints(step) {
  const tracker = step?.tracker || {};
  const ui = step?.ui || {};
  const hints = {
    ...(isPositiveInteger(tracker?.markerNpcId) ? { markerNpcId: tracker.markerNpcId >>> 0 } : {}),
    ...(isPositiveInteger(ui?.overNpcId) ? { overNpcId: ui.overNpcId >>> 0 } : {}),
    ...(isPositiveInteger(ui?.taskRoleNpcId) ? { taskRoleNpcId: ui.taskRoleNpcId >>> 0 } : {}),
    ...(Number.isInteger(ui?.taskType) && ui.taskType >= 0 ? { taskType: ui.taskType >>> 0 } : {}),
    ...(Number.isInteger(ui?.maxAward) && ui.maxAward >= 0 ? { maxAward: ui.maxAward >>> 0 } : {}),
    ...(isPositiveInteger(ui?.taskStep) ? { taskStep: ui.taskStep >>> 0 } : {}),
    ...(Number.isInteger(tracker?.status) && tracker.status >= 0 ? { status: tracker.status >>> 0 } : {}),
    ...(Array.isArray(ui?.trackerScriptIds) && ui.trackerScriptIds.filter(Number.isInteger).length > 0
      ? { trackerScriptIds: ui.trackerScriptIds.filter(Number.isInteger).map((scriptId) => scriptId >>> 0) }
      : {}),
  };

  return Object.keys(hints).length > 0 ? hints : undefined;
}

function resolveInteractionMapId(quest, step, stepIndex, helpEntries, override) {
  const objective = step?.objective || {};
  const targetNpcId = override?.turnInNpcId || objective?.handInNpcId || objective?.targetNpcId;
  const helpMapId = resolveNpcMapId(helpEntries, targetNpcId, stepIndex + 1);
  if (isPositiveInteger(helpMapId)) {
    return helpMapId >>> 0;
  }
  return isPositiveInteger(step?.mapId) ? (step.mapId >>> 0) : null;
}

function resolveTurnInMapId(quest, step, stepIndex, helpEntries, override) {
  if (isPositiveInteger(override?.turnInMapId)) {
    return override.turnInMapId >>> 0;
  }

  const objective = step?.objective || {};
  const handInNpcId = override?.turnInNpcId || objective?.handInNpcId || objective?.targetNpcId;
  const helpMapId = resolveNpcMapId(helpEntries, handInNpcId, stepIndex + 1);
  if (isPositiveInteger(helpMapId)) {
    return helpMapId >>> 0;
  }
  return isPositiveInteger(step?.mapId) ? (step.mapId >>> 0) : null;
}

function buildNpcInteractionStep(
  quest,
  step,
  stepIndex,
  mainStep,
  nextCatalogStep,
  nextMainStep,
  helpEntries,
  itemNameByTemplateId
) {
  const override = getQuestOverride(quest.id, step.id);
  const objective = step?.objective || {};
  const rawRequiredItems = Array.isArray(override?.requiredItems)
    ? override.requiredItems
    : (Array.isArray(objective?.requiredItems) ? objective.requiredItems : []);
  const requiredItems = mergeQuantities(
    rawRequiredItems,
    mainStep?.consumeItems,
    itemNameByTemplateId
  );
  const interactionMapId = resolveInteractionMapId(quest, step, stepIndex, helpEntries, override);
  const triggerRequirements = [];

  if (isPositiveInteger(objective?.targetNpcId)) {
    triggerRequirements.push({ kind: 'npc_is', npcId: objective.targetNpcId >>> 0 });
  }
  if (isPositiveInteger(interactionMapId)) {
    triggerRequirements.push({ kind: 'map_is', mapId: interactionMapId >>> 0 });
  }

  const requiredFlag = nonEmptyString(objective?.requiredProgressFlag);
  if (requiredFlag) {
    triggerRequirements.push({ kind: 'flag_is', flag: requiredFlag, value: true });
  }

  const captureRawItem = rawRequiredItems.find((item) => isPositiveInteger(item?.capturedMonsterId)) || null;
  const capturedMonsterId = isPositiveInteger(override?.capturedMonsterId)
    ? (override.capturedMonsterId >>> 0)
    : (isPositiveInteger(captureRawItem?.capturedMonsterId) ? (captureRawItem.capturedMonsterId >>> 0) : 0);

  const effects = [];
  const completionGrantItems = buildCompletionGrantItems(
    step,
    mainStep,
    nextCatalogStep,
    nextMainStep,
    itemNameByTemplateId
  );

  for (let index = 0; index < requiredItems.length; index += 1) {
    const item = requiredItems[index];
    const rawItem = rawRequiredItems[index] || null;
    if (isPositiveInteger(capturedMonsterId) && item.templateId === (rawItem?.templateId >>> 0)) {
      triggerRequirements.push({
        kind: 'captured_monster_count_at_least',
        monsterId: capturedMonsterId,
        quantity: item.quantity,
      });
      effects.push({
        kind: 'remove_captured_monster_item',
        monsterId: capturedMonsterId,
        quantity: item.quantity,
        templateId: item.templateId,
        ...(item.name ? { name: item.name } : {}),
      });
      continue;
    }
    triggerRequirements.push({
      kind: 'item_count_at_least',
      templateId: item.templateId,
      quantity: item.quantity,
    });
    effects.push({
      kind: 'remove_item',
      item,
    });
  }

  for (const item of completionGrantItems) {
    effects.push({ kind: 'grant_item', item });
  }

  const reactions = buildReactionsForStep(quest, step, step?.tracker?.status, itemNameByTemplateId);
  const description =
    nonEmptyString(step?.description) ||
    nonEmptyString(mainStep?.description) ||
    nonEmptyString(step?.completionDescription);

  return {
    id: `step_${step.id}`,
    kind:
      requiredItems.length > 0 || isPositiveInteger(capturedMonsterId)
        ? 'turn_in'
        : 'talk',
    ...(description ? { description } : {}),
    trigger: { type: 'npc_interact' },
    requirements: triggerRequirements,
    effects,
    ...(reactions.length > 0 ? { reactions } : {}),
    nextStepId: null,
    ...(buildClientHints(step) ? { client: buildClientHints(step) } : {}),
  };
}

function resolveCollectRequiredItem(step, mainStep, override, itemNameByTemplateId) {
  const baseRequiredItems = override?.requiredItems || step?.objective?.requiredItems;
  const mergedRequiredItems = mergeQuantities(baseRequiredItems, mainStep?.consumeItems, itemNameByTemplateId);
  return mergedRequiredItems[0] || null;
}

function buildMonsterProgress(counterPrefix, questId, stepId, target) {
  return {
    counter: `${counterPrefix}_${questId}_${stepId}`,
    target,
    eventValue: 'count',
  };
}

function buildCollectProgress(questId, stepId, target) {
  return {
    counter: `collect_${questId}_${stepId}`,
    target,
    eventValue: 'one',
  };
}

function buildCollectStep(
  quest,
  step,
  stepIndex,
  mainStep,
  nextCatalogStep,
  nextMainStep,
  helpEntries,
  itemNameByTemplateId
) {
  const override = getQuestOverride(quest.id, step.id);
  const objective = step?.objective || {};
  const requiredItem = resolveCollectRequiredItem(step, mainStep, override, itemNameByTemplateId);
  if (!requiredItem) {
    throw new Error(`Quest ${quest.id} step ${step.id} is missing a collect item.`);
  }

  const monsterId = isPositiveInteger(override?.targetMonsterId)
    ? (override.targetMonsterId >>> 0)
    : (isPositiveInteger(objective?.targetMonsterId) ? (objective.targetMonsterId >>> 0) : 0);
  if (!isPositiveInteger(monsterId)) {
    throw new Error(`Quest ${quest.id} step ${step.id} is missing a collect monster.`);
  }

  const requirements = [{ kind: 'monster_is', monsterId }];
  if (isPositiveInteger(step?.mapId) && override?.omitTriggerMap !== true) {
    requirements.push({ kind: 'map_is', mapId: step.mapId >>> 0 });
  }

  const turnInNpcId = isPositiveInteger(override?.turnInNpcId)
    ? (override.turnInNpcId >>> 0)
    : (isPositiveInteger(objective?.handInNpcId) ? (objective.handInNpcId >>> 0) : 0);
  if (isPositiveInteger(turnInNpcId)) {
    requirements.push({ kind: 'turn_in_npc_is', npcId: turnInNpcId });
  }

  const turnInMapId = resolveTurnInMapId(quest, step, stepIndex, helpEntries, override);
  if (isPositiveInteger(turnInMapId)) {
    requirements.push({ kind: 'turn_in_map_is', mapId: turnInMapId >>> 0 });
  }

  requirements.push({
    kind: 'item_count_at_least',
    templateId: requiredItem.templateId,
    quantity: requiredItem.quantity,
  });

  const description =
    nonEmptyString(step?.description) ||
    nonEmptyString(mainStep?.description) ||
    nonEmptyString(step?.completionDescription);
  const reactions = buildReactionsForStep(quest, step, step?.tracker?.status, itemNameByTemplateId);
  const objectiveGrantItem = normalizeItem(override?.grantItem || objective?.grantItem, itemNameByTemplateId);
  const eventItem = objectiveGrantItem ? { ...objectiveGrantItem } : { ...requiredItem, quantity: 1 };
  const completionGrantItems = buildCompletionGrantItems(
    step,
    mainStep,
    nextCatalogStep,
    nextMainStep,
    itemNameByTemplateId
  );

  const effects = [
    {
      kind: 'remove_item',
      item: requiredItem,
    },
    ...completionGrantItems.map((item) => ({ kind: 'grant_item', item })),
  ];

  return {
    id: `step_${step.id}`,
    kind: 'collect',
    ...(description ? { description } : {}),
    trigger: { type: 'monster_defeat' },
    requirements,
    eventEffects: [{ kind: 'grant_item', item: { ...eventItem, quantity: eventItem.quantity || 1 } }],
    effects,
    ...(reactions.length > 0 ? { reactions } : {}),
    progress: buildCollectProgress(quest.id, step.id, requiredItem.quantity),
    nextStepId: null,
    ...(buildClientHints(step) ? { client: buildClientHints(step) } : {}),
  };
}

function buildKillStep(quest, step, stepIndex, mainStep, helpEntries, itemNameByTemplateId) {
  const objective = step?.objective || {};
  if (!isPositiveInteger(objective?.targetMonsterId)) {
    throw new Error(`Quest ${quest.id} step ${step.id} is missing a kill monster.`);
  }

  const requirements = [{ kind: 'monster_is', monsterId: objective.targetMonsterId >>> 0 }];
  if (isPositiveInteger(step?.mapId)) {
    requirements.push({ kind: 'map_is', mapId: step.mapId >>> 0 });
  }
  if (isPositiveInteger(objective?.handInNpcId)) {
    requirements.push({ kind: 'turn_in_npc_is', npcId: objective.handInNpcId >>> 0 });
  }
  const turnInMapId = resolveTurnInMapId(quest, step, stepIndex, helpEntries, {});
  if (isPositiveInteger(turnInMapId)) {
    requirements.push({ kind: 'turn_in_map_is', mapId: turnInMapId >>> 0 });
  }

  const targetCount = Math.max(1, Number.isInteger(objective?.targetCount) ? objective.targetCount : 1);
  const description =
    nonEmptyString(step?.description) ||
    nonEmptyString(mainStep?.description) ||
    nonEmptyString(step?.completionDescription);
  const reactions = buildReactionsForStep(quest, step, step?.tracker?.status, itemNameByTemplateId);

  return {
    id: `step_${step.id}`,
    kind: 'kill',
    ...(description ? { description } : {}),
    trigger: { type: 'monster_defeat' },
    requirements,
    effects: [],
    ...(reactions.length > 0 ? { reactions } : {}),
    progress: buildMonsterProgress('kill', quest.id, step.id, targetCount),
    nextStepId: null,
    ...(buildClientHints(step) ? { client: buildClientHints(step) } : {}),
  };
}

function buildEscortStep(quest, step, stepIndex, mainStep, helpEntries, itemNameByTemplateId) {
  const objective = step?.objective || {};
  if (!isPositiveInteger(objective?.targetNpcId)) {
    throw new Error(`Quest ${quest.id} step ${step.id} is missing an escort destination NPC.`);
  }

  const interactionMapId = resolveInteractionMapId(quest, step, stepIndex, helpEntries, {});
  const requirements = [{ kind: 'npc_is', npcId: objective.targetNpcId >>> 0 }];
  if (isPositiveInteger(interactionMapId)) {
    requirements.push({ kind: 'map_is', mapId: interactionMapId >>> 0 });
  }

  const description =
    nonEmptyString(step?.description) ||
    nonEmptyString(mainStep?.description) ||
    nonEmptyString(step?.completionDescription);
  const reactions = buildReactionsForStep(quest, step, step?.tracker?.status, itemNameByTemplateId);

  return {
    id: `step_${step.id}`,
    kind: 'escort',
    ...(description ? { description } : {}),
    trigger: { type: 'npc_interact' },
    requirements,
    effects: [],
    ...(reactions.length > 0 ? { reactions } : {}),
    nextStepId: null,
    ...(buildClientHints(step) ? { client: buildClientHints(step) } : {}),
  };
}

function buildStep(quest, step, stepIndex, mainQuest, helpEntries, itemNameByTemplateId) {
  const mainStep = mainQuest?.steps?.[stepIndex] || null;
  const nextMainStep = mainQuest?.steps?.[stepIndex + 1] || null;
  const nextCatalogStep = quest?.steps?.[stepIndex + 1] || null;

  switch (getQuestOverride(quest.id, step.id)?.objectiveKind || step?.objective?.kind) {
    case 'npc-interaction':
      return buildNpcInteractionStep(
        quest,
        step,
        stepIndex,
        mainStep,
        nextCatalogStep,
        nextMainStep,
        helpEntries,
        itemNameByTemplateId
      );
    case 'item-collect':
      return buildCollectStep(
        quest,
        step,
        stepIndex,
        mainStep,
        nextCatalogStep,
        nextMainStep,
        helpEntries,
        itemNameByTemplateId
      );
    case 'monster-defeat':
      return buildKillStep(quest, step, stepIndex, mainStep, helpEntries, itemNameByTemplateId);
    case 'escort':
      return buildEscortStep(quest, step, stepIndex, mainStep, helpEntries, itemNameByTemplateId);
    default:
      throw new Error(`Quest ${quest.id} step ${step.id} uses unsupported objective kind: ${step?.objective?.kind}`);
  }
}

function buildQuestDefinition(quest, mainQuest, helpEntries, itemNameByTemplateId) {
  const steps = Array.isArray(quest?.steps) ? quest.steps : [];
  const builtSteps = steps.map((step, index) => buildStep(quest, step, index, mainQuest, helpEntries, itemNameByTemplateId));

  for (let index = 0; index < builtSteps.length; index += 1) {
    builtSteps[index] = {
      ...builtSteps[index],
      nextStepId: builtSteps[index + 1]?.id || null,
    };
  }

  if ((quest?.id >>> 0) === 51 && builtSteps[3]?.client) {
    builtSteps[3] = {
      ...builtSteps[3],
      client: {
        ...builtSteps[3].client,
        maxAward: 0,
      },
    };
  }

  return {
    id: quest.id >>> 0,
    name: nonEmptyString(quest?.name) || `Quest ${quest.id}`,
    repeatable: false,
    accept: buildAcceptRule(quest, helpEntries, itemNameByTemplateId),
    steps: builtSteps,
    rewards: buildRewards(quest, itemNameByTemplateId),
  };
}

function main() {
  const existingDefinitions = readJson(OUTPUT_FILE);
  const existingQuests = Array.isArray(existingDefinitions?.quests) ? existingDefinitions.quests : [];
  const preservedQuests = existingQuests.filter((quest) => PRESERVED_QUEST_IDS.has(quest?.id >>> 0));

  const catalog = readJson(CATALOG_FILE);
  const mainStory = readJson(MAIN_STORY_FILE);
  const catalogQuests = Array.isArray(catalog?.quests) ? catalog.quests : [];
  const mainQuestsById = new Map(
    (Array.isArray(mainStory?.quests) ? mainStory.quests : [])
      .filter((quest) => isPositiveInteger(quest?.id))
      .map((quest) => [quest.id >>> 0, quest])
  );
  const helpEntriesByQuestId = buildHelpEntriesByQuestId();
  const itemNameByTemplateId = buildItemNameByTemplateId();

  const generatedQuests = catalogQuests
    .filter((quest) => isPositiveInteger(quest?.id))
    .filter((quest) => !PRESERVED_QUEST_IDS.has(quest.id >>> 0))
    .map((quest) =>
      buildQuestDefinition(
        quest,
        mainQuestsById.get(quest.id >>> 0) || null,
        helpEntriesByQuestId.get(quest.id >>> 0) || [],
        itemNameByTemplateId
      )
    );

  const quests = [...preservedQuests, ...generatedQuests].sort((left, right) => left.id - right.id);
  writeJson(OUTPUT_FILE, { quests });

  process.stdout.write(
    `Wrote ${quests.length} quest2 definitions to ${path.relative(REPO_ROOT, OUTPUT_FILE)} `
      + `(preserved ${preservedQuests.length}, generated ${generatedQuests.length}).\n`
  );
}

main();
