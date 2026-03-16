#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const HELP_FILE = path.resolve(__dirname, '..', 'data', 'client-verified', 'quests', 'client-help-quests.json');
const ITEM_FILE = path.resolve(__dirname, '..', 'data', 'client-verified', 'items', 'selected-items.json');
const TASKLIST_FILE = path.resolve(__dirname, '..', 'data', 'client-verified', 'tasks', 'tasklist.json');
const OVERRIDES_FILE = path.resolve(__dirname, '..', 'data', 'quests', 'main-story.overrides.json');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'quests', 'main-story.json');

function main() {
  const help = JSON.parse(fs.readFileSync(HELP_FILE, 'utf8'));
  const items = JSON.parse(fs.readFileSync(ITEM_FILE, 'utf8'));
  const tasklist = JSON.parse(fs.readFileSync(TASKLIST_FILE, 'utf8'));
  const overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));

  const itemNameById = new Map(
    (Array.isArray(items?.items) ? items.items : []).map((item) => [item.template_id, item.name || ''])
  );
  const helpByTaskId = groupByTaskId(Array.isArray(help?.quests) ? help.quests : []);
  const taskById = new Map(
    (Array.isArray(tasklist?.tasks) ? tasklist.tasks : [])
      .filter((task) => Number.isInteger(task?.task_id))
      .map((task) => [task.task_id, task])
  );

  const quests = (Array.isArray(overrides?.quests) ? overrides.quests : [])
    .map((overrideQuest) => buildQuestFromHelp(overrideQuest, helpByTaskId, itemNameById, taskById))
    .filter(Boolean);

  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({
      source: {
        help: HELP_FILE,
        items: ITEM_FILE,
        tasklist: TASKLIST_FILE,
        overrides: OVERRIDES_FILE,
      },
      generatedAt: new Date().toISOString(),
      quests,
    }, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write(`${OUTPUT_FILE}\n`);
}

function groupByTaskId(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!Number.isInteger(row?.taskId)) {
      continue;
    }
    if (!grouped.has(row.taskId)) {
      grouped.set(row.taskId, []);
    }
    grouped.get(row.taskId).push(row);
  }
  for (const entries of grouped.values()) {
    entries.sort((left, right) => left.stepIndex - right.stepIndex);
  }
  return grouped;
}

function buildQuestFromHelp(overrideQuest, helpByTaskId, itemNameById, taskById) {
  const helpSteps = helpByTaskId.get(overrideQuest.id);
  const task = taskById.get(overrideQuest.id);
  const overrideSteps = Array.isArray(overrideQuest.steps) ? overrideQuest.steps : [];

  if ((!Array.isArray(helpSteps) || helpSteps.length === 0) && overrideSteps.length === 0) {
    return null;
  }

  const stepCount = Math.max(Array.isArray(helpSteps) ? helpSteps.length : 0, overrideSteps.length);
  const steps = Array.from({ length: stepCount }, (_, index) =>
    mergeStep(Array.isArray(helpSteps) ? helpSteps[index] : null, overrideSteps[index] || {}, itemNameById, index)
  );

  return {
    id: overrideQuest.id,
    name: overrideQuest.name || (helpSteps?.[0]?.title) || `Quest ${overrideQuest.id}`,
    type: overrideQuest.type || 'story',
    acceptMessage: overrideQuest.acceptMessage || `${helpSteps[0].title} is active.`,
    completionMessage: overrideQuest.completionMessage || `${helpSteps[0].title} is complete.`,
    acceptNpcId: firstNumber(overrideQuest.acceptNpcId, task?.npc_id),
    acceptSubtype: Number.isInteger(overrideQuest.acceptSubtype) ? overrideQuest.acceptSubtype : undefined,
    prerequisiteTaskIds: normalizePrerequisiteTaskIds(overrideQuest.prerequisiteTaskIds, task?.field_5),
    acceptGrantItems: Array.isArray(overrideQuest.acceptGrantItems) && overrideQuest.acceptGrantItems.length > 0
      ? overrideQuest.acceptGrantItems.map((item) => ({
          templateId: item.templateId,
          quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
          name:
            typeof item.name === 'string' && item.name.length > 0
              ? item.name
              : (itemNameById.get(item.templateId) || ''),
        }))
      : undefined,
    rewards: {
      gold: numberOrDefault(overrideQuest?.rewards?.gold, 0),
      experience: numberOrDefault(overrideQuest?.rewards?.experience, 0),
      coins: numberOrDefault(overrideQuest?.rewards?.coins, 0),
      renown: numberOrDefault(overrideQuest?.rewards?.renown, 0),
      items: Array.isArray(overrideQuest?.rewards?.items)
        ? overrideQuest.rewards.items.map((item) => ({
            templateId: item.templateId,
            quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
            name:
              typeof item.name === 'string' && item.name.length > 0
                ? item.name
                : (itemNameById.get(item.templateId) || ''),
          }))
        : [],
    },
    steps,
  };
}

function normalizePrerequisiteTaskIds(overrideIds, taskFieldValue) {
  const values = Array.isArray(overrideIds) ? overrideIds : [taskFieldValue];
  return [...new Set(
    values
      .filter((value) => Number.isInteger(value) && value > 0)
      .map((value) => value >>> 0)
  )];
}

function mergeStep(helpStep, overrideStep, itemNameById, index) {
  const step = {
    type: overrideStep.type || 'talk',
    npcId: firstNumber(overrideStep.npcId, helpStep?.startNpcIds?.[1], helpStep?.startNpcIds?.[0]),
    status: Number.isInteger(overrideStep.status)
      ? overrideStep.status
      : (Number.isInteger(helpStep?.stepIndex) ? helpStep.stepIndex : index + 1),
    description:
      typeof overrideStep.description === 'string'
        ? overrideStep.description
        : `${helpStep?.title || 'Quest'} (${helpStep?.stepIndex || index + 1})`,
  };

  if (Number.isInteger(overrideStep.subtype)) {
    step.subtype = overrideStep.subtype;
  }
  if (Number.isInteger(overrideStep.scriptId)) {
    step.scriptId = overrideStep.scriptId;
  }
  if (Number.isInteger(overrideStep.mapId)) {
    step.mapId = overrideStep.mapId;
  }
  if (Number.isInteger(overrideStep.monsterId)) {
    step.monsterId = overrideStep.monsterId;
  }
  if (Number.isInteger(overrideStep.count)) {
    step.count = overrideStep.count;
  }
  if (Array.isArray(overrideStep.grantItems) && overrideStep.grantItems.length > 0) {
    step.grantItems = overrideStep.grantItems.map((item) => ({
      templateId: item.templateId,
      quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
      name:
        typeof item.name === 'string' && item.name.length > 0
          ? item.name
          : (itemNameById.get(item.templateId) || ''),
    }));
  }
  if (Array.isArray(overrideStep.consumeItems) && overrideStep.consumeItems.length > 0) {
    step.consumeItems = overrideStep.consumeItems.map((item) => ({
      templateId: item.templateId,
      quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
      name:
        typeof item.name === 'string' && item.name.length > 0
          ? item.name
          : (itemNameById.get(item.templateId) || ''),
    }));
  }

  return step;
}

function firstNumber(...values) {
  for (const value of values) {
    if (Number.isInteger(value)) {
      return value;
    }
  }
  return undefined;
}

function numberOrDefault(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

main();
