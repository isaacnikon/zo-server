#!/usr/bin/env node
// @ts-nocheck
'use strict';
export {};

const fs = require('fs');
const path = require('path');

const QUEST_FLOW_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-flow.json');
const TASK_RUNTIME_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'task-runtime.json');
const TASKLIST_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quests.json');
const ROLEINFO_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'roleinfo.json');
const ITEM_FILES = [
  path.resolve(__dirname, '..', 'data', 'client-derived', 'items.json'),
  path.resolve(__dirname, '..', 'data', 'client-derived', 'potions.json'),
  path.resolve(__dirname, '..', 'data', 'client-derived', 'stuff.json'),
  path.resolve(__dirname, '..', 'data', 'client-derived', 'equipment.json'),
  path.resolve(__dirname, '..', 'data', 'client-derived', 'weapons.json'),
];
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-schema.json');

function main() {
  const flow = JSON.parse(fs.readFileSync(QUEST_FLOW_FILE, 'utf8'));
  const runtime = JSON.parse(fs.readFileSync(TASK_RUNTIME_FILE, 'utf8'));
  const tasklist = JSON.parse(fs.readFileSync(TASKLIST_FILE, 'utf8'));
  const roleinfo = JSON.parse(fs.readFileSync(ROLEINFO_FILE, 'utf8'));
  const itemCatalog = loadItemCatalog();

  const flowByTaskId = new Map(
    (Array.isArray(flow?.quests) ? flow.quests : [])
      .filter((quest) => Number.isInteger(quest?.taskId))
      .map((quest) => [quest.taskId, quest])
  );
  const taskMetaById = new Map(
    (Array.isArray(tasklist?.entries) ? tasklist.entries : [])
      .filter((entry) => Number.isInteger(entry?.taskId))
      .map((entry) => [entry.taskId, entry])
  );
  const rewardsByTaskId = new Map();
  for (const block of Array.isArray(runtime?.rewardBlocks) ? runtime.rewardBlocks : []) {
    if (!Number.isInteger(block?.taskId)) {
      continue;
    }
    if (!rewardsByTaskId.has(block.taskId)) {
      rewardsByTaskId.set(block.taskId, []);
    }
    rewardsByTaskId.get(block.taskId).push(block);
  }

  const quests = [...flowByTaskId.keys()]
    .sort((left, right) => left - right)
    .map((taskId) => mergeQuest({
      taskId,
      flowQuest: flowByTaskId.get(taskId) || null,
      taskMeta: taskMetaById.get(taskId) || null,
      rewardBlocks: rewardsByTaskId.get(taskId) || [],
      roleEntries: Array.isArray(roleinfo?.entries) ? roleinfo.entries : [],
      itemCatalog,
    }))
    .filter(Boolean);

  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({
      source: {
        flow: QUEST_FLOW_FILE,
        runtime: TASK_RUNTIME_FILE,
        tasklist: TASKLIST_FILE,
        roleinfo: ROLEINFO_FILE,
        items: ITEM_FILES,
      },
      generatedAt: new Date().toISOString(),
      questCount: quests.length,
      quests,
    }, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write(`${OUTPUT_FILE}\n`);
}

function mergeQuest({ taskId, flowQuest, taskMeta, rewardBlocks, roleEntries, itemCatalog }) {
  if (!flowQuest) {
    return null;
  }

  const runtimeReward = selectBestRuntimeRewardBlock(rewardBlocks);
  const runtimeRewardChoices = normalizeRuntimeRewardChoices(runtimeReward, itemCatalog);
  const finalFlowStep = Array.isArray(flowQuest.steps) && flowQuest.steps.length > 0
    ? flowQuest.steps[flowQuest.steps.length - 1]
    : null;
  const mergedReward = mergeReward(finalFlowStep?.reward, runtimeRewardChoices);

  const steps = (Array.isArray(flowQuest.steps) ? flowQuest.steps : [])
    .map((step, index, allSteps) => mergeStep({
      taskId,
      step,
      index,
      allSteps,
      roleEntries,
      itemCatalog,
    }))
    .filter(Boolean);

  const acceptGrantItems = inferAcceptGrantItems(flowQuest, itemCatalog);

  return {
    taskId,
    title: flowQuest.title,
    startNpcId: numberOrNull(taskMeta?.startNpcId ?? flowQuest.startNpcId),
    minLevel: numberOrNull(taskMeta?.minLevel ?? flowQuest.minLevel),
    prerequisiteTaskId: numberOrNull(taskMeta?.prerequisiteTaskId ?? flowQuest.prerequisiteTaskId),
    acceptGrantItems,
    rewards: mergedReward,
    runtimeRewardChoices,
    steps,
    evidence: {
      flowBlockCount: flowQuest?.evidence?.blockCount || 0,
      runtimeRewardBlockCount: rewardBlocks.length,
      sourcePriority: {
        reward: 'runtime_reward_block > help_flow_text',
        stepText: 'help_flow_text',
        killTarget: 'help_flow_targetNpcId > role_name_inference',
        itemHandin: 'help_flow_item_ids',
      },
    },
  };
}

function mergeStep({ step, index, allSteps, roleEntries, itemCatalog }) {
  if (!step || typeof step !== 'object') {
    return null;
  }

  const type = inferMergedStepType(step);
  const npcId = inferStepNpcId(step, type);
  const count = inferStepCount(step);
  const monsterId = inferMonsterId(step, roleEntries);
  const consumeItems = inferConsumeItems(step, type, itemCatalog);

  const merged = {
    stepIndex: Number.isInteger(step.stepIndex) ? step.stepIndex : index + 1,
    type,
    npcId,
    mapId: Array.isArray(step.mapIds) && step.mapIds.length > 0 ? step.mapIds[0] : null,
    count,
    monsterId,
    description: typeof step.goalText === 'string' ? step.goalText : '',
    consumeItems,
    rawFlowType: step.flowType || '',
  };

  if (index === allSteps.length - 1) {
    merged.isCompletionStep = true;
  }

  return merged;
}

function inferMergedStepType(step) {
  switch (step?.flowType) {
    case 'kill':
      return 'kill';
    case 'capture':
      return 'capture';
    case 'kill_collect':
      return 'kill_collect';
    case 'talk':
    default:
      return 'talk';
  }
}

function inferStepNpcId(step, type) {
  const startNpcIds = Array.isArray(step?.startNpcIds) ? step.startNpcIds.filter(Number.isInteger) : [];
  if (startNpcIds.length === 0) {
    return null;
  }
  if (type === 'talk' || type === 'kill_collect') {
    return startNpcIds[startNpcIds.length - 1];
  }
  return startNpcIds[0];
}

function inferStepCount(step) {
  const text = String(step?.goalText || '');
  const match = text.match(/\bget\s+(\d+)\b/i) || text.match(/\bkill\s+(\d+)\b/i) || text.match(/\bobtain\s+(\d+)\b/i);
  if (match) {
    return Number(match[1]);
  }
  if (step?.flowType === 'kill' || step?.flowType === 'capture') {
    return 1;
  }
  return null;
}

function inferMonsterId(step, roleEntries) {
  const targetNpcIds = Array.isArray(step?.targetNpcIds) ? step.targetNpcIds.filter(Number.isInteger) : [];
  const monsterTarget = targetNpcIds.find((id) => id >= 5000);
  if (monsterTarget) {
    return monsterTarget;
  }

  const goalText = String(step?.goalText || '');
  const quotedNames = [...goalText.matchAll(/"([^"]+)"/g)].map((match) => match[1].trim()).filter(Boolean);
  for (const name of quotedNames) {
    const exactMonster = roleEntries.find((entry) => entry?.name === name && Number.isInteger(entry?.roleId) && entry.roleId >= 5000);
    if (exactMonster) {
      return exactMonster.roleId;
    }
  }
  return null;
}

function inferConsumeItems(step, type, itemCatalog) {
  const itemIds = Array.isArray(step?.itemIds) ? step.itemIds.filter(Number.isInteger) : [];
  if (itemIds.length === 0) {
    return [];
  }
  if (type !== 'talk' && type !== 'kill_collect' && type !== 'capture') {
    return [];
  }

  const candidates = type === 'talk'
    ? itemIds.slice(0, 1)
    : itemIds.filter((id) => !isEquipmentItem(id, itemCatalog));

  return candidates.map((templateId) => ({
    templateId,
    quantity: inferItemQuantity(step, templateId),
    name: itemCatalog.byId.get(templateId)?.name || '',
  }));
}

function inferItemQuantity(step, templateId) {
  const text = String(step?.goalText || '');
  const itemName = templateId ? '' : '';
  const directCount = text.match(/\bget\s+(\d+)\b/i) || text.match(/\bobtain\s+(\d+)\b/i);
  if (directCount) {
    return Number(directCount[1]);
  }
  return 1;
}

function inferAcceptGrantItems(flowQuest, itemCatalog) {
  const firstStep = Array.isArray(flowQuest?.steps) ? flowQuest.steps[0] : null;
  const itemIds = Array.isArray(firstStep?.itemIds) ? firstStep.itemIds.filter(Number.isInteger) : [];
  if (itemIds.length === 0) {
    return [];
  }
  const firstId = itemIds[0];
  if (isEquipmentItem(firstId, itemCatalog)) {
    return [];
  }
  return [{
    templateId: firstId,
    quantity: 1,
    name: itemCatalog.byId.get(firstId)?.name || '',
  }];
}

function mergeReward(flowReward, runtimeChoices) {
  const runtimePrimary = selectBestRuntimeChoice(runtimeChoices);
  const flowItemIds = Array.isArray(flowReward?.itemIds) ? flowReward.itemIds.filter(Number.isInteger) : [];
  const petTemplateIds = [
    ...new Set(runtimeChoices.flatMap((choice) => Array.isArray(choice?.petTemplateIds) ? choice.petTemplateIds : [])),
  ];

  const merged = {
    experience: numberOrZero(runtimePrimary?.experience ?? flowReward?.experience),
    gold: numberOrZero(runtimePrimary?.gold ?? flowReward?.gold),
    coins: numberOrZero(runtimePrimary?.coins ?? flowReward?.coins),
    renown: numberOrZero(runtimePrimary?.renown ?? flowReward?.renown),
    pets: petTemplateIds,
    items: runtimeChoices.length > 0
      ? runtimeChoices.map((choice) => ({
          awardId: choice.awardId,
          items: choice.items,
        }))
      : (flowItemIds.length > 0 ? [{
          awardId: 1,
          items: flowItemIds.map((templateId) => ({ templateId, quantity: 1 })),
        }] : []),
  };

  return merged;
}

function selectBestRuntimeChoice(choices) {
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  return choices.reduce((best, choice) => {
    if (!best) {
      return choice;
    }
    return runtimeChoiceScore(choice) > runtimeChoiceScore(best) ? choice : best;
  }, null);
}

function runtimeChoiceScore(choice) {
  return (
    (typeof choice?.experience === 'number' ? 30 : 0) +
    (typeof choice?.gold === 'number' ? 15 : 0) +
    (typeof choice?.coins === 'number' ? 20 : 0) +
    (typeof choice?.renown === 'number' ? 1 : 0) +
    ((Array.isArray(choice?.petTemplateIds) && choice.petTemplateIds.length > 0) ? 80 : 0) +
    ((Array.isArray(choice?.items) ? choice.items.length : 0) * 10)
  );
}

function selectBestRuntimeRewardBlock(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return null;
  }
  return blocks.reduce((best, block) => {
    if (!best) {
      return block;
    }
    const bestScore = rewardBlockScore(best);
    const score = rewardBlockScore(block);
    return score > bestScore ? block : best;
  }, null);
}

function rewardBlockScore(block) {
  const options = Array.isArray(block?.awardOptions) ? block.awardOptions : [];
  return options.reduce((score, option) => {
    const itemScore = Array.isArray(option?.itemAdds) ? option.itemAdds.length * 10 : 0;
    const petScore = option?.addPet ? 80 : 0;
    const numberScore =
      (typeof option?.addExp === 'number' ? 30 : 0) +
      (typeof option?.addMoney === 'number' ? 15 : 0) +
      (typeof option?.addCoins === 'number' ? 20 : 0) +
      (typeof option?.addRp === 'number' ? 1 : 0);
    const randomTablePenalty =
      typeof option?.rawBody === 'string' &&
      option.rawBody.includes('macro_Rand(') &&
      !option.addPet &&
      typeof option?.addExp !== 'number' &&
      typeof option?.addCoins !== 'number'
        ? 25
        : 0;
    return score + itemScore + petScore + numberScore - randomTablePenalty;
  }, 0);
}

function normalizeRuntimeRewardChoices(block, itemCatalog) {
  if (!block || !Array.isArray(block.awardOptions)) {
    return [];
  }

  return block.awardOptions.map((option) => {
    const items = (Array.isArray(option.itemAdds) ? option.itemAdds : []).map((item) => {
      const canonical = canonicalizeItemId(item.templateId, itemCatalog);
      return {
        templateId: canonical,
        quantity: Number.isInteger(item.quantity) ? item.quantity : 1,
        name: itemCatalog.byId.get(canonical)?.name || '',
      };
    });
    const petTemplateIds = [];
    if (typeof option.addPet === 'number') {
      petTemplateIds.push(option.addPet);
    } else if (typeof option.addPet === 'string' && option.addPet.length > 0) {
      petTemplateIds.push(option.addPet);
    }

    return {
      awardId: Number.isInteger(option.awardId) ? option.awardId : 1,
      experience: typeof option.addExp === 'number' ? option.addExp : null,
      gold: typeof option.addMoney === 'number' ? option.addMoney : null,
      coins: typeof option.addCoins === 'number' ? option.addCoins : null,
      renown: typeof option.addRp === 'number' ? option.addRp : null,
      petTemplateIds,
      items,
      rawBody: option.rawBody || '',
    };
  });
}

function canonicalizeItemId(templateId, itemCatalog) {
  const direct = itemCatalog.byId.get(templateId);
  if (!direct) {
    return templateId;
  }
  const sameName = itemCatalog.byName.get(direct.name) || [];
  if (sameName.length === 0) {
    return templateId;
  }
  const preferred = sameName
    .map((entry) => entry.templateId)
    .filter(Number.isInteger)
    .sort((left, right) => left - right)[0];
  return preferred || templateId;
}

function isEquipmentItem(templateId, itemCatalog) {
  const entry = itemCatalog.byId.get(templateId);
  if (!entry) {
    return false;
  }
  return entry.source === 'equipment' || entry.source === 'weapons';
}

function loadItemCatalog() {
  const byId = new Map();
  const byName = new Map();

  for (const filePath of ITEM_FILES) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const source = path.basename(filePath, '.json');
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    for (const entry of entries) {
      if (!Number.isInteger(entry?.templateId)) {
        continue;
      }
      const normalized = {
        templateId: entry.templateId,
        name: typeof entry.name === 'string' ? entry.name : '',
        source,
      };
      byId.set(entry.templateId, normalized);
      if (normalized.name.length > 0) {
        if (!byName.has(normalized.name)) {
          byName.set(normalized.name, []);
        }
        byName.get(normalized.name).push(normalized);
      }
    }
  }

  return { byId, byName };
}

function numberOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

main();
