#!/usr/bin/env node
// @ts-nocheck
'use strict';
export {};

const fs = require('fs');
const path = require('path');

const FULL_WORKFLOW_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-full-workflow.json');
const QUEST_FLOW_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-flow.json');
const TASK_CONTEXT_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'task-context.json');
const ROLEINFO_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'roleinfo.json');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-runtime-candidates.json');

function main() {
  const fullWorkflow = JSON.parse(fs.readFileSync(FULL_WORKFLOW_FILE, 'utf8'));
  const questFlow = JSON.parse(fs.readFileSync(QUEST_FLOW_FILE, 'utf8'));
  const taskContext = JSON.parse(fs.readFileSync(TASK_CONTEXT_FILE, 'utf8'));
  const roleinfo = JSON.parse(fs.readFileSync(ROLEINFO_FILE, 'utf8'));
  const flowByTaskId = new Map(
    (Array.isArray(questFlow?.quests) ? questFlow.quests : Array.isArray(questFlow) ? questFlow : [])
      .filter((quest) => Number.isInteger(quest?.taskId))
      .map((quest) => [quest.taskId, quest])
  );
  const contextByTaskId = new Map(
    (Array.isArray(taskContext?.tasks) ? taskContext.tasks : [])
      .filter((task) => Number.isInteger(task?.taskId))
      .map((task) => [task.taskId, task])
  );
  const rolesById = new Map(
    (Array.isArray(roleinfo?.entries) ? roleinfo.entries : [])
      .filter((role) => Number.isInteger(role?.roleId))
      .map((role) => [role.roleId, role])
  );
  const quests = (Array.isArray(fullWorkflow?.quests) ? fullWorkflow.quests : [])
    .filter((quest) => Number.isInteger(quest?.taskId))
    .map((quest) => buildRuntimeCandidate(
      quest,
      flowByTaskId.get(quest.taskId) || null,
      contextByTaskId.get(quest.taskId) || null,
      rolesById
    ));

  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({
      source: {
        fullWorkflow: FULL_WORKFLOW_FILE,
        questFlow: QUEST_FLOW_FILE,
        taskContext: TASK_CONTEXT_FILE,
        roleinfo: ROLEINFO_FILE,
      },
      generatedAt: new Date().toISOString(),
      summary: buildSummary(quests),
      quests,
    }, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write(`${OUTPUT_FILE}\n`);
}

function buildRuntimeCandidate(quest, flowQuest, taskContext, rolesById) {
  const workflow = quest?.workflow || {};
  const flowStepsByIndex = buildFlowStepsByIndex(flowQuest);
  const rawSteps = Array.isArray(workflow?.steps)
    ? workflow.steps.map((step) => buildRuntimeStep(
      quest,
      step,
      flowStepsByIndex.get(firstNumber(step?.stepIndex)) || [],
      taskContext,
      rolesById
    ))
    : [];
  const steps = collapseDuplicateSteps(rawSteps);
  const unresolvedSteps = steps
    .filter((step) => isUnresolvedStep(step))
    .map((step) => step.stepIndex);

  return {
    taskId: quest.taskId,
    title: quest.title || `Quest ${quest.taskId}`,
    startNpcId: firstNumber(quest.startNpcId),
    minLevel: firstNumber(quest.minLevel),
    prerequisiteTaskId: firstNumber(quest.prerequisiteTaskId),
    acceptGrantItems: normalizeItems(bestAcceptGrantItems(quest)),
    rewards: normalizeRewards(quest.rewards),
    runtimeRewardChoices: Array.isArray(quest.runtimeRewardChoices) ? quest.runtimeRewardChoices : [],
    runtimeCandidate: {
      ready: steps.length > 0 && unresolvedSteps.length === 0,
      unresolvedSteps,
      stepCount: steps.length,
      steps,
    },
  };
}

function buildRuntimeStep(quest, step, flowStepVariants, taskContext, rolesById) {
  const taskId = firstNumber(quest?.taskId);
  const schemaNpcId = schemaSideNpcId(step);
  const stateNpcId = firstNumber(step?.npcId);
  const schemaContextRefs = matchingContextRefsForNpc(taskId, step, taskContext, schemaNpcId);
  const stateContextRefs = matchingContextRefsForNpc(taskId, step, taskContext, stateNpcId);
  const descriptionPreferredNpcId = selectNpcIdByDescription(step, schemaNpcId, stateNpcId, rolesById);
  const descriptionResolved = Number.isInteger(descriptionPreferredNpcId);
  const flowPreferredNpcId = selectNpcIdByFlow(quest, step, flowStepVariants, schemaNpcId, stateNpcId);
  const flowResolved = Number.isInteger(flowPreferredNpcId);
  const bestNpcId = Number.isInteger(descriptionPreferredNpcId)
    ? descriptionPreferredNpcId
    : Number.isInteger(flowPreferredNpcId)
      ? flowPreferredNpcId
      : selectNpcId(step, schemaNpcId, stateNpcId, schemaContextRefs, stateContextRefs);
  const descriptionPreferredMonsterId = selectMonsterIdByDescription(step, rolesById);
  const monsterDescriptionResolved = Number.isInteger(descriptionPreferredMonsterId);
  const bestMonsterId = Number.isInteger(descriptionPreferredMonsterId)
    ? descriptionPreferredMonsterId
    : bestKillMonsterId(step);
  const bestCount = bestStepCount(step);
  const consumeItems = bestConsumeItems(step);
  const grantItems = normalizeItems(step?.autoGrantedItems);

  const contextRefs = bestNpcId === schemaNpcId ? schemaContextRefs : stateContextRefs;
  const aliasResolved = hasSameNameMonsterOnlyConflict(step, rolesById);
  const confidence = resolveConfidence(
    step,
    contextRefs,
    aliasResolved,
    descriptionResolved,
    monsterDescriptionResolved,
    flowResolved
  );
  return {
    stepIndex: firstNumber(step?.stepIndex),
    type: step?.type || 'unknown',
    description: typeof step?.description === 'string' ? step.description : '',
    npcId: bestNpcId,
    mapId: firstNumber(step?.mapId),
    status: firstNumber(step?.status),
    taskType: firstNumber(step?.taskType),
    monsterId: bestMonsterId,
    count: bestCount,
    consumeItems,
    grantItems,
    dropRate: firstNumber(step?.dropRate),
    confidence,
    sourcePreference: {
      npcId: sourceForNpc(step, bestNpcId, schemaNpcId, stateNpcId),
      monsterId: sourceForMonster(step, bestMonsterId, descriptionPreferredMonsterId),
      count: sourceForCount(step),
      consumeItems: sourceForConsumeItems(step),
    },
    contextRefs,
    aliasResolved,
    descriptionResolved,
    monsterDescriptionResolved,
    flowResolved,
    originalConflicts: Array.isArray(step?.conflicts) ? step.conflicts : [],
    originalEvidence: step?.evidence || {},
  };
}

function bestAcceptGrantItems(quest) {
  const explicit = normalizeItems(quest?.acceptGrantItems);
  if (explicit.length > 0) {
    return explicit;
  }
  return normalizeItems(quest?.derivedAcceptGrantItems);
}

function bestKillMonsterId(step) {
  const killObjectives = Array.isArray(step?.killObjectives) ? step.killObjectives : [];
  if (killObjectives.length > 0 && Number.isInteger(killObjectives[0]?.monsterId)) {
    return killObjectives[0].monsterId >>> 0;
  }
  return firstNumber(step?.monsterId);
}

function bestStepCount(step) {
  if (step?.type === 'talk') {
    return null;
  }
  if (step?.type === 'kill' || step?.type === 'capture') {
    const killObjectives = Array.isArray(step?.killObjectives) ? step.killObjectives : [];
    if (killObjectives.length > 0 && Number.isInteger(killObjectives[0]?.count) && killObjectives[0].count > 0) {
      return killObjectives[0].count >>> 0;
    }
  }
  if (step?.type === 'kill_collect' || step?.type === 'capture') {
    const itemObjectives = Array.isArray(step?.itemObjectives) ? step.itemObjectives : [];
    if (itemObjectives.length > 0 && Number.isInteger(itemObjectives[0]?.count) && itemObjectives[0].count > 0) {
      return itemObjectives[0].count >>> 0;
    }
  }
  return Number.isInteger(step?.count) ? step.count >>> 0 : null;
}

function bestConsumeItems(step) {
  const objectives = normalizeItemObjectives(step?.itemObjectives);
  if (objectives.length > 0 && (step?.type === 'talk' || step?.type === 'kill_collect' || step?.type === 'capture')) {
    return objectives;
  }
  return normalizeItems(step?.consumeItems);
}

function normalizeItemObjectives(items) {
  return Array.isArray(items)
    ? items
        .filter((item) => Number.isInteger(item?.templateId))
        .map((item) => ({
          templateId: item.templateId >>> 0,
          quantity: Math.max(1, numberOrDefault(item.count, 1)),
          name: '',
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

function normalizeRewards(reward) {
  if (!reward || typeof reward !== 'object') {
    return { experience: 0, gold: 0, coins: 0, renown: 0, pets: [], items: [] };
  }
  return {
    experience: numberOrDefault(reward.experience, 0),
    gold: numberOrDefault(reward.gold, 0),
    coins: numberOrDefault(reward.coins, 0),
    renown: numberOrDefault(reward.renown, 0),
    pets: Array.isArray(reward.pets) ? reward.pets.slice() : [],
    items: Array.isArray(reward.items) ? reward.items : [],
  };
}

function sourceForNpc(step, bestNpcId, schemaNpcId, stateNpcId) {
  if (bestNpcId && schemaNpcId && bestNpcId === schemaNpcId) {
    return 'schema';
  }
  if (bestNpcId && stateNpcId && bestNpcId === stateNpcId) {
    return 'state_chain';
  }
  return Array.isArray(step?.originalConflicts) && step.originalConflicts.some((conflict) => conflict.kind === 'npcId')
    ? 'schema_or_state_chain_conflict'
    : 'schema_or_state_chain';
}

function sourceForMonster(step, bestMonsterId, descriptionPreferredMonsterId) {
  if (Number.isInteger(descriptionPreferredMonsterId) && bestMonsterId === descriptionPreferredMonsterId) {
    return 'schema_or_state_chain_description';
  }
  return Array.isArray(step?.killObjectives) && step.killObjectives.length > 0
    ? 'state_chain'
    : 'schema';
}

function sourceForCount(step) {
  if (step?.type === 'kill' || step?.type === 'capture') {
    return Array.isArray(step?.killObjectives) && step.killObjectives.length > 0 ? 'state_chain' : 'schema';
  }
  if (step?.type === 'kill_collect') {
    return Array.isArray(step?.itemObjectives) && step.itemObjectives.length > 0 ? 'state_chain' : 'schema';
  }
  return 'schema';
}

function sourceForConsumeItems(step) {
  return Array.isArray(step?.itemObjectives) && step.itemObjectives.length > 0 ? 'state_chain' : 'schema';
}

function matchingContextRefsForNpc(taskId, step, taskContext, npcId) {
  if (!taskContext || !Array.isArray(taskContext.checkFinishedRefs)) {
    return [];
  }
  const stepIndex = firstNumber(step?.stepIndex);
  if (!Number.isInteger(npcId)) {
    return [];
  }
  return taskContext.checkFinishedRefs.filter((ref) => {
    if (!Number.isInteger(ref?.npcId) || !Number.isInteger(ref?.phase)) {
      return false;
    }
    if (Number.isInteger(stepIndex) && ref.phase !== stepIndex && ref.phase !== 0) {
      return false;
    }
    if (Number.isInteger(npcId) && ref.npcId !== npcId) {
      return false;
    }
    return true;
  });
}

function buildFlowStepsByIndex(flowQuest) {
  const byIndex = new Map();
  for (const step of Array.isArray(flowQuest?.steps) ? flowQuest.steps : []) {
    const stepIndex = firstNumber(step?.stepIndex);
    if (!Number.isInteger(stepIndex)) {
      continue;
    }
    if (!byIndex.has(stepIndex)) {
      byIndex.set(stepIndex, []);
    }
    byIndex.get(stepIndex).push(step);
  }
  return byIndex;
}

function selectNpcIdByFlow(quest, step, flowStepVariants, schemaNpcId, stateNpcId) {
  const flowStartNpcIds = uniqueNumbers(flatMap(flowStepVariants, (flowStep) => flowStep?.startNpcIds));
  const flowTargetNpcIds = uniqueNumbers(flatMap(flowStepVariants, (flowStep) => flowStep?.targetNpcIds));
  const flowNpcIds = uniqueNumbers([...flowStartNpcIds, ...flowTargetNpcIds]);
  const questStartNpcId = firstNumber(quest?.startNpcId);

  if (Number.isInteger(stateNpcId) && flowTargetNpcIds.length === 1 && flowTargetNpcIds[0] === stateNpcId) {
    return stateNpcId;
  }

  if (step?.type === 'capture' && flowTargetNpcIds.length === 0 && flowStartNpcIds.length === 1) {
    return flowStartNpcIds[0];
  }

  if (
    Number.isInteger(schemaNpcId) &&
    flowNpcIds.includes(schemaNpcId) &&
    Number.isInteger(stateNpcId) &&
    !flowNpcIds.includes(stateNpcId)
  ) {
    return schemaNpcId;
  }

  if (
    Number.isInteger(questStartNpcId) &&
    Number.isInteger(stateNpcId) &&
    stateNpcId === questStartNpcId &&
    (!Number.isInteger(schemaNpcId) || schemaNpcId !== questStartNpcId)
  ) {
    return stateNpcId;
  }

  if (
    step?.type === 'talk' &&
    Number.isInteger(stateNpcId) &&
    flowTargetNpcIds.length === 1 &&
    stateNpcId === flowTargetNpcIds[0]
  ) {
    return stateNpcId;
  }

  return null;
}

function resolveConfidence(step, contextRefs, aliasResolved, descriptionResolved, monsterDescriptionResolved, flowResolved) {
  const original = step?.confidence || 'unknown';
  if (!Array.isArray(step?.conflicts) || step.conflicts.length === 0) {
    if (original === 'low') {
      const reasons = Array.isArray(step?.evidence?.matchReasons) ? step.evidence.matchReasons : [];
      const duplicateVariantCount = Number.isInteger(step?.duplicateVariantCount) ? step.duplicateVariantCount : 0;
      if (descriptionResolved || flowResolved || (duplicateVariantCount > 1 && reasons.includes('npc'))) {
        return 'medium';
      }
    }
    return original;
  }

  const npcOnlyConflicts = step.conflicts.every((conflict) => conflict.kind === 'npcId');
  if (npcOnlyConflicts && ((Array.isArray(contextRefs) && contextRefs.length > 0) || descriptionResolved || flowResolved)) {
    return original === 'low' ? 'medium' : original;
  }

  if (aliasResolved) {
    return original === 'low' ? 'medium' : original;
  }

  const monsterOnlyConflicts = step.conflicts.every((conflict) => conflict.kind === 'monsterId');
  if (monsterOnlyConflicts && (monsterDescriptionResolved || step?.type === 'talk')) {
    return original === 'low' ? 'medium' : original;
  }

  const countOnlyConflicts = step.conflicts.every((conflict) => conflict.kind === 'killCount');
  if (countOnlyConflicts && (step?.type === 'kill' || step?.type === 'capture' || step?.type === 'kill_collect')) {
    return original === 'low' ? 'medium' : original;
  }

  return original;
}

function buildSummary(quests) {
  return {
    questCount: quests.length,
    readyCount: quests.filter((quest) => quest.runtimeCandidate?.ready).length,
    unresolvedCount: quests.filter((quest) => Array.isArray(quest.runtimeCandidate?.unresolvedSteps) && quest.runtimeCandidate.unresolvedSteps.length > 0).length,
  };
}

function collapseDuplicateSteps(steps) {
  const byIndex = new Map();
  for (const step of Array.isArray(steps) ? steps : []) {
    const stepIndex = firstNumber(step?.stepIndex);
    const key = Number.isInteger(stepIndex) ? stepIndex : -1;
    if (!byIndex.has(key)) {
      byIndex.set(key, []);
    }
    byIndex.get(key).push(step);
  }

  return [...byIndex.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, variants]) => chooseBestStepVariant(variants))
    .filter(Boolean);
}

function chooseBestStepVariant(variants) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return null;
  }
  if (variants.length === 1) {
    return variants[0];
  }

  const ranked = variants
    .map((step) => ({ step, score: scoreStepVariant(step) }))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0].step;
  const sameNpcAcrossVariants = variants.every((step) => step.npcId === best.npcId);
  const duplicateConsensusPromotesConfidence =
    best.confidence === 'low' &&
    sameNpcAcrossVariants &&
    variants.every((step) => !Array.isArray(step.originalConflicts) || step.originalConflicts.length === 0);
  return {
    ...best,
    confidence: duplicateConsensusPromotesConfidence ? 'medium' : best.confidence,
    duplicateVariantCount: variants.length,
    duplicateAlternatives: variants
      .filter((step) => step !== best)
      .map((step) => ({
        stepIndex: step.stepIndex,
        type: step.type,
        npcId: step.npcId,
        monsterId: step.monsterId,
        count: step.count,
        confidence: step.confidence,
        originalConflicts: step.originalConflicts,
      })),
  };
}

function scoreStepVariant(step) {
  const confidenceScore = ({
    high: 40,
    medium: 25,
    low: 10,
    unknown: 0,
  })[step?.confidence || 'unknown'] || 0;
  const contextScore = Array.isArray(step?.contextRefs) ? step.contextRefs.length * 4 : 0;
  const conflictPenalty = Array.isArray(step?.originalConflicts) ? step.originalConflicts.length * 12 : 0;
  const aliasBonus = step?.aliasResolved === true ? 8 : 0;
  const evidenceBonus = Array.isArray(step?.originalEvidence?.matchReasons) ? step.originalEvidence.matchReasons.length : 0;
  const monsterBonus = Number.isInteger(step?.monsterId) ? 2 : 0;
  const consumeBonus = Array.isArray(step?.consumeItems) && step.consumeItems.length > 0 ? 2 : 0;
  const grantBonus = Array.isArray(step?.grantItems) && step.grantItems.length > 0 ? 1 : 0;
  return confidenceScore + contextScore + aliasBonus + evidenceBonus + monsterBonus + consumeBonus + grantBonus - conflictPenalty;
}

function isUnresolvedStep(step) {
  if (step?.confidence === 'unknown') {
    return true;
  }
  if (step?.confidence !== 'low') {
    return false;
  }
  const conflicts = Array.isArray(step?.originalConflicts) ? step.originalConflicts : [];
  const npcOnlyConflicts = conflicts.length > 0 && conflicts.every((conflict) => conflict.kind === 'npcId');
  const hasContextRefs = Array.isArray(step?.contextRefs) && step.contextRefs.length > 0;
  if (npcOnlyConflicts && (hasContextRefs || step?.descriptionResolved === true || step?.flowResolved === true)) {
    return false;
  }
  if (step?.aliasResolved === true && step.confidence === 'medium') {
    return false;
  }
  const monsterOnlyConflicts = conflicts.length > 0 && conflicts.every((conflict) => conflict.kind === 'monsterId');
  if (monsterOnlyConflicts && (step?.monsterDescriptionResolved === true || step?.type === 'talk') && step.confidence === 'medium') {
    return false;
  }
  const countOnlyConflicts = conflicts.length > 0 && conflicts.every((conflict) => conflict.kind === 'killCount');
  if (countOnlyConflicts && step.confidence === 'medium') {
    return false;
  }
  return true;
}

function hasSameNameMonsterOnlyConflict(step, rolesById) {
  const conflicts = Array.isArray(step?.conflicts) ? step.conflicts : [];
  if (conflicts.length === 0) {
    return false;
  }
  return conflicts.every((conflict) => {
    if (!conflict || conflict.kind !== 'monsterId') {
      return false;
    }
    const schemaRole = rolesById.get(conflict.schema);
    const stateRole = rolesById.get(conflict.state);
    if (!schemaRole || !stateRole) {
      return false;
    }
    const schemaName = typeof schemaRole.name === 'string' ? schemaRole.name.trim() : '';
    const stateName = typeof stateRole.name === 'string' ? stateRole.name.trim() : '';
    return schemaName.length > 0 && schemaName === stateName;
  });
}

function selectNpcId(step, schemaNpcId, stateNpcId, schemaContextRefs, stateContextRefs) {
  const conflicts = Array.isArray(step?.conflicts) ? step.conflicts : [];
  const npcOnlyConflicts = conflicts.length > 0 && conflicts.every((conflict) => conflict.kind === 'npcId');
  if (npcOnlyConflicts) {
    if (Array.isArray(stateContextRefs) && stateContextRefs.length > 0) {
      return stateNpcId;
    }
    if (Array.isArray(schemaContextRefs) && schemaContextRefs.length > 0) {
      return schemaNpcId;
    }
  }
  return stateNpcId ?? schemaNpcId ?? null;
}

function flatMap(items, mapFn) {
  const output = [];
  for (const item of Array.isArray(items) ? items : []) {
    const values = mapFn(item);
    if (Array.isArray(values)) {
      output.push(...values);
    }
  }
  return output;
}

function uniqueNumbers(values) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (!Number.isInteger(value)) {
      continue;
    }
    const normalized = value >>> 0;
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function schemaSideNpcId(step) {
  const conflicts = Array.isArray(step?.conflicts) ? step.conflicts : [];
  const npcConflict = conflicts.find((conflict) => conflict.kind === 'npcId' && Number.isInteger(conflict.schema));
  return npcConflict ? (npcConflict.schema >>> 0) : null;
}

function selectNpcIdByDescription(step, schemaNpcId, stateNpcId, rolesById) {
  const description = normalizeForMatch(String(step?.description || ''));
  if (!description) {
    return null;
  }
  const schemaName = npcNameForMatch(schemaNpcId, rolesById);
  const stateName = npcNameForMatch(stateNpcId, rolesById);
  const schemaHit = schemaName && description.includes(schemaName);
  const stateHit = stateName && description.includes(stateName);
  if (schemaHit && !stateHit) {
    return schemaNpcId;
  }
  if (stateHit && !schemaHit) {
    return stateNpcId;
  }
  return null;
}

function npcNameForMatch(npcId, rolesById) {
  if (!Number.isInteger(npcId)) {
    return '';
  }
  const role = rolesById.get(npcId);
  const name = normalizeForMatch(typeof role?.name === 'string' ? role.name : '');
  return name.length >= 3 ? name : '';
}

function selectMonsterIdByDescription(step, rolesById) {
  const description = normalizeForMatch(String(step?.description || ''));
  if (!description) {
    return null;
  }
  const conflicts = Array.isArray(step?.conflicts) ? step.conflicts : [];
  const monsterConflict = conflicts.find((conflict) => conflict.kind === 'monsterId');
  if (!monsterConflict) {
    return null;
  }
  const schemaName = monsterNameForMatch(monsterConflict.schema, rolesById);
  const stateName = monsterNameForMatch(monsterConflict.state, rolesById);
  const schemaHit = schemaName && description.includes(schemaName);
  const stateHit = stateName && description.includes(stateName);
  if (schemaHit && !stateHit) {
    return monsterConflict.schema >>> 0;
  }
  if (stateHit && !schemaHit) {
    return monsterConflict.state >>> 0;
  }
  return null;
}

function monsterNameForMatch(roleId, rolesById) {
  if (!Number.isInteger(roleId)) {
    return '';
  }
  const role = rolesById.get(roleId);
  const name = normalizeForMatch(typeof role?.name === 'string' ? role.name : '');
  return name.length >= 3 ? name : '';
}

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function firstNumber(value) {
  return Number.isInteger(value) ? value >>> 0 : null;
}

function numberOrDefault(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

main();
