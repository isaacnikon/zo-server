#!/usr/bin/env node
// @ts-nocheck
'use strict';
export {};

const fs = require('fs');
const path = require('path');

const QUEST_SCHEMA_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-schema.json');
const TASK_CHAINS_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'task-chains.json');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-workflow.json');

function main() {
  const schema = JSON.parse(fs.readFileSync(QUEST_SCHEMA_FILE, 'utf8'));
  const chains = JSON.parse(fs.readFileSync(TASK_CHAINS_FILE, 'utf8'));

  const chainByTaskId = new Map(
    (Array.isArray(chains?.chains) ? chains.chains : [])
      .filter((entry) => Number.isInteger(entry?.taskId))
      .map((entry) => [entry.taskId, entry])
  );

  const quests = (Array.isArray(schema?.quests) ? schema.quests : [])
    .filter((quest) => Number.isInteger(quest?.taskId))
    .map((quest) => buildQuestWorkflow(quest, chainByTaskId.get(quest.taskId) || null))
    .sort((left, right) => left.taskId - right.taskId);

  const summary = buildSummary(quests);
  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({
      source: {
        questSchema: QUEST_SCHEMA_FILE,
        taskChains: TASK_CHAINS_FILE,
      },
      generatedAt: new Date().toISOString(),
      summary,
      quests,
    }, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write(`${OUTPUT_FILE}\n`);
}

function buildQuestWorkflow(quest, chain) {
  const chainStepsByIndex = new Map(
    (Array.isArray(chain?.canonicalSteps) ? chain.canonicalSteps : [])
      .filter((step) => Number.isInteger(step?.stepIndex))
      .map((step) => [step.stepIndex, step])
  );
  const schemaSteps = Array.isArray(quest?.steps) ? quest.steps : [];
  const steps = schemaSteps.map((step) => {
    const chainStep = chainStepsByIndex.get(step.stepIndex) || null;
    return buildQuestStep(step, chainStep);
  });
  const acceptGrantItems = normalizeItems(quest.acceptGrantItems);
  const derivedAcceptGrantItems = inferAcceptGrantItemsFromWorkflow(acceptGrantItems, steps);

  const lowConfidenceSteps = steps
    .filter((step) => step.confidence === 'low' || step.conflicts.length > 0)
    .map((step) => step.stepIndex);

  return {
    taskId: quest.taskId,
    title: quest.title || `Quest ${quest.taskId}`,
    startNpcId: numberOrNull(quest.startNpcId),
    minLevel: numberOrNull(quest.minLevel),
    prerequisiteTaskId: numberOrNull(quest.prerequisiteTaskId),
    acceptGrantItems,
    derivedAcceptGrantItems,
    rewards: normalizeRewards(quest.rewards),
    runtimeRewardChoices: normalizeRuntimeRewardChoices(quest.runtimeRewardChoices),
    evidence: quest.evidence || {},
    workflow: {
      stepCount: steps.length,
      resolvedStepCount: steps.filter((step) => step.hasStateChain).length,
      lowConfidenceSteps,
      runtimeReady:
        steps.length > 0 &&
        lowConfidenceSteps.length === 0 &&
        steps.every((step) => step.confidence !== 'low'),
      steps,
    },
  };
}

function buildQuestStep(schemaStep, chainStep) {
  const state = chainStep?.state || null;
  const type = schemaStep?.type || chainStep?.type || 'unknown';
  const killObjective = Array.isArray(state?.killParams) && state.killParams.length > 0
    ? state.killParams[0]
    : null;
  const itemObjectives = Array.isArray(state?.itemParams) ? state.itemParams : [];
  const grantedByState = Array.isArray(state?.addedItems) ? state.addedItems : [];
  const conflicts = buildStepConflicts(schemaStep, state, killObjective);
  const confidenceScore = numberOrNull(chainStep?.score);
  const confidence = classifyStepConfidence(confidenceScore, conflicts);

  return {
    stepIndex: numberOrNull(schemaStep?.stepIndex),
    type,
    description: typeof schemaStep?.description === 'string' ? schemaStep.description : '',
    mapId: numberOrNull(schemaStep?.mapId),
    npcId: firstNumber(state?.overNpcId, schemaStep?.npcId),
    status: firstNumber(state?.taskStep, schemaStep?.stepIndex),
    taskType: numberOrNull(state?.taskType),
    count: deriveStepCount(type, schemaStep, killObjective, itemObjectives),
    monsterId: firstNumber(killObjective?.monsterId, schemaStep?.monsterId),
    consumeItems: normalizeItems(schemaStep?.consumeItems),
    itemObjectives: normalizeObjectives(itemObjectives),
    killObjectives: normalizeKillObjectives(state?.killParams),
    dropRate: numberOrNull(state?.dropRate),
    autoGrantedItems: normalizeItems(grantedByState),
    confidenceScore,
    confidence,
    conflicts,
    hasStateChain: Boolean(chainStep),
    evidence: chainStep
      ? {
          matchedClusterIndex: numberOrNull(chainStep.matchedClusterIndex),
          clusterFamilyId: typeof chainStep.clusterFamilyId === 'string' ? chainStep.clusterFamilyId : '',
          familyMembers: Array.isArray(chainStep.familyMembers) ? chainStep.familyMembers.slice() : [],
          matchReasons: Array.isArray(chainStep.reasons) ? chainStep.reasons.slice() : [],
        }
      : {
          matchedClusterIndex: null,
          clusterFamilyId: '',
          familyMembers: [],
          matchReasons: [],
        },
  };
}

function buildStepConflicts(schemaStep, state, killObjective) {
  const conflicts = [];

  if (Number.isInteger(schemaStep?.npcId) && Number.isInteger(state?.overNpcId) && schemaStep.npcId !== state.overNpcId) {
    conflicts.push({
      kind: 'npcId',
      schema: schemaStep.npcId,
      state: state.overNpcId,
    });
  }

  if (Number.isInteger(schemaStep?.monsterId) && Number.isInteger(killObjective?.monsterId) && schemaStep.monsterId !== killObjective.monsterId) {
    conflicts.push({
      kind: 'monsterId',
      schema: schemaStep.monsterId,
      state: killObjective.monsterId,
    });
  }

  if (Number.isInteger(schemaStep?.count) && Number.isInteger(killObjective?.count) && killObjective.count > 0 && schemaStep.count !== killObjective.count) {
    conflicts.push({
      kind: 'killCount',
      schema: schemaStep.count,
      state: killObjective.count,
    });
  }

  return conflicts;
}

function classifyStepConfidence(score, conflicts) {
  if (Array.isArray(conflicts) && conflicts.length > 0) {
    return 'low';
  }
  if (!Number.isInteger(score) || score <= 0) {
    return 'unknown';
  }
  if (score >= 17) {
    return 'high';
  }
  if (score >= 9) {
    return 'medium';
  }
  return 'low';
}

function deriveStepCount(stepType, schemaStep, killObjective, itemObjectives) {
  if (stepType === 'talk') {
    return null;
  }
  if (Number.isInteger(schemaStep?.count) && schemaStep.count > 0) {
    return schemaStep.count;
  }
  if (Number.isInteger(killObjective?.count) && killObjective.count > 0) {
    return killObjective.count;
  }
  if (Array.isArray(itemObjectives) && itemObjectives.length > 0 && Number.isInteger(itemObjectives[0]?.count) && itemObjectives[0].count > 0) {
    return itemObjectives[0].count;
  }
  return null;
}

function inferAcceptGrantItemsFromWorkflow(explicitAcceptGrantItems, steps) {
  if (Array.isArray(explicitAcceptGrantItems) && explicitAcceptGrantItems.length > 0) {
    return explicitAcceptGrantItems;
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    return [];
  }
  const firstStep = steps[0];
  const granted = normalizeItems(firstStep?.autoGrantedItems);
  if (granted.length === 0) {
    return [];
  }
  return granted;
}

function normalizeObjectives(items) {
  return Array.isArray(items)
    ? items
        .filter((item) => Number.isInteger(item?.templateId))
        .map((item) => ({
          templateId: item.templateId >>> 0,
          count: Math.max(0, numberOrDefault(item.count, 0)),
          index: Math.max(0, numberOrDefault(item.index, 0)),
        }))
    : [];
}

function normalizeKillObjectives(items) {
  return Array.isArray(items)
    ? items
        .filter((item) => Number.isInteger(item?.monsterId))
        .map((item) => ({
          monsterId: item.monsterId >>> 0,
          count: Math.max(0, numberOrDefault(item.count, 0)),
          index: Math.max(0, numberOrDefault(item.index, 0)),
        }))
    : [];
}

function normalizeRewards(reward) {
  if (!reward || typeof reward !== 'object') {
    return {
      experience: 0,
      gold: 0,
      coins: 0,
      renown: 0,
      pets: [],
      items: [],
    };
  }

  return {
    experience: numberOrDefault(reward.experience, 0),
    gold: numberOrDefault(reward.gold, 0),
    coins: numberOrDefault(reward.coins, 0),
    renown: numberOrDefault(reward.renown, 0),
    pets: Array.isArray(reward.pets) ? reward.pets.slice() : [],
    items: Array.isArray(reward.items)
      ? reward.items.map((choice) => ({
          awardId: numberOrNull(choice?.awardId),
          items: normalizeItems(choice?.items),
        }))
      : [],
  };
}

function normalizeRuntimeRewardChoices(choices) {
  return Array.isArray(choices)
    ? choices.map((choice) => ({
        awardId: numberOrNull(choice?.awardId),
        experience: numberOrNull(choice?.experience),
        gold: numberOrNull(choice?.gold),
        coins: numberOrNull(choice?.coins),
        renown: numberOrNull(choice?.renown),
        petTemplateIds: Array.isArray(choice?.petTemplateIds) ? choice.petTemplateIds.slice() : [],
        items: normalizeItems(choice?.items),
      }))
    : [];
}

function normalizeItems(items) {
  return Array.isArray(items)
    ? items
        .filter((item) => Number.isInteger(item?.templateId))
        .map((item) => ({
          templateId: item.templateId >>> 0,
          quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
          name: typeof item.name === 'string' ? item.name : '',
        }))
    : [];
}

function buildSummary(quests) {
  const total = quests.length;
  const runtimeReady = quests.filter((quest) => quest.workflow?.runtimeReady).length;
  const lowConfidence = quests.filter((quest) => Array.isArray(quest.workflow?.lowConfidenceSteps) && quest.workflow.lowConfidenceSteps.length > 0).length;
  const stepConfidences = {
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
  };

  for (const quest of quests) {
    for (const step of Array.isArray(quest?.workflow?.steps) ? quest.workflow.steps : []) {
      stepConfidences[step.confidence] = (stepConfidences[step.confidence] || 0) + 1;
    }
  }

  return {
    questCount: total,
    runtimeReadyQuestCount: runtimeReady,
    questsWithConflictsOrLowConfidence: lowConfidence,
    stepConfidenceCounts: stepConfidences,
  };
}

function firstNumber(...values) {
  for (const value of values) {
    if (Number.isInteger(value)) {
      return value >>> 0;
    }
  }
  return null;
}

function numberOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function numberOrDefault(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

main();
