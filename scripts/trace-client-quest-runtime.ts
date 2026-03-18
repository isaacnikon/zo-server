#!/usr/bin/env node
// @ts-nocheck
'use strict';
export {};

const fs = require('fs');
const path = require('path');

const QUEST_SCHEMA_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-schema.json');

function main() {
  const questId = Number(process.argv[2]);
  const outputJson = process.argv.includes('--json');
  if (!Number.isInteger(questId) || questId <= 0) {
    process.stderr.write('usage: node scripts/trace-client-quest-runtime.js <taskId> [--json]\n');
    process.exit(1);
  }

  const schema = JSON.parse(fs.readFileSync(QUEST_SCHEMA_FILE, 'utf8'));
  const quest = (Array.isArray(schema?.quests) ? schema.quests : []).find((entry) => entry?.taskId === questId);
  if (!quest) {
    process.stderr.write(`quest ${questId} not found in ${QUEST_SCHEMA_FILE}\n`);
    process.exit(1);
  }

  const trace = buildQuestTrace(quest);

  if (outputJson) {
    process.stdout.write(`${JSON.stringify(trace, null, 2)}\n`);
    return;
  }

  renderTrace(trace);
}

function buildQuestTrace(quest) {
  const events = [];

  events.push({
    phase: 'accept',
    npcId: numberOrNull(quest.startNpcId),
    minLevel: numberOrNull(quest.minLevel),
    prerequisiteTaskId: numberOrNull(quest.prerequisiteTaskId),
    grantItems: normalizeItems(quest.acceptGrantItems),
  });

  const steps = Array.isArray(quest.steps) ? quest.steps : [];
  for (const step of steps) {
    events.push({
      phase: 'step',
      stepIndex: step.stepIndex,
      type: step.type,
      npcId: numberOrNull(step.npcId),
      mapId: numberOrNull(step.mapId),
      monsterId: numberOrNull(step.monsterId),
      count: numberOrNull(step.count),
      description: stringOrEmpty(step.description),
      consumeItems: normalizeItems(step.consumeItems),
    });
  }

  events.push({
    phase: 'complete',
    npcId: inferCompletionNpcId(steps),
    rewards: normalizeRewardSummary(quest.rewards),
    runtimeRewardChoices: Array.isArray(quest.runtimeRewardChoices)
      ? quest.runtimeRewardChoices.map((choice) => ({
          awardId: numberOrNull(choice.awardId),
          experience: numberOrNull(choice.experience),
          gold: numberOrNull(choice.gold),
          coins: numberOrNull(choice.coins),
          renown: numberOrNull(choice.renown),
          petTemplateIds: Array.isArray(choice.petTemplateIds) ? choice.petTemplateIds.slice() : [],
          items: normalizeItems(choice.items),
        }))
      : [],
  });

  return {
    taskId: quest.taskId,
    title: stringOrEmpty(quest.title),
    eventCount: events.length,
    events,
    evidence: quest.evidence || {},
  };
}

function renderTrace(trace) {
  process.stdout.write(`Quest ${trace.taskId}: ${trace.title}\n`);
  for (const event of trace.events) {
    if (event.phase === 'accept') {
      process.stdout.write(`accept: npc=${displayNumber(event.npcId)} minLevel=${displayNumber(event.minLevel)} prereq=${displayNumber(event.prerequisiteTaskId)}\n`);
      if (event.grantItems.length > 0) {
        process.stdout.write(`  grant: ${formatItems(event.grantItems)}\n`);
      }
      continue;
    }

    if (event.phase === 'step') {
      const parts = [
        `step ${displayNumber(event.stepIndex)}`,
        `type=${event.type || 'unknown'}`,
      ];
      if (event.npcId !== null) {
        parts.push(`npc=${event.npcId}`);
      }
      if (event.mapId !== null) {
        parts.push(`map=${event.mapId}`);
      }
      if (event.monsterId !== null) {
        parts.push(`monster=${event.monsterId}`);
      }
      if (event.count !== null) {
        parts.push(`count=${event.count}`);
      }
      process.stdout.write(`${parts.join(' ')}\n`);
      if (event.description) {
        process.stdout.write(`  ${event.description}\n`);
      }
      if (event.consumeItems.length > 0) {
        process.stdout.write(`  consume: ${formatItems(event.consumeItems)}\n`);
      }
      continue;
    }

    if (event.phase === 'complete') {
      process.stdout.write(`complete: npc=${displayNumber(event.npcId)}\n`);
      process.stdout.write(`  reward summary: exp=${event.rewards.experience} gold=${event.rewards.gold} coins=${event.rewards.coins} renown=${event.rewards.renown}\n`);
      if (event.rewards.pets.length > 0) {
        process.stdout.write(`  reward pets: ${event.rewards.pets.join(', ')}\n`);
      }
      if (event.rewards.items.length > 0) {
        process.stdout.write(`  reward items: ${formatItems(event.rewards.items)}\n`);
      }
      if (event.runtimeRewardChoices.length > 0) {
        process.stdout.write('  runtime choices:\n');
        for (const choice of event.runtimeRewardChoices) {
          const parts = [`award=${displayNumber(choice.awardId)}`];
          if (choice.experience !== null) parts.push(`exp=${choice.experience}`);
          if (choice.gold !== null) parts.push(`gold=${choice.gold}`);
          if (choice.coins !== null) parts.push(`coins=${choice.coins}`);
          if (choice.renown !== null) parts.push(`renown=${choice.renown}`);
          if (choice.petTemplateIds.length > 0) parts.push(`pets=${choice.petTemplateIds.join(',')}`);
          if (choice.items.length > 0) parts.push(`items=${formatItems(choice.items)}`);
          process.stdout.write(`    ${parts.join(' ')}\n`);
        }
      }
    }
  }
}

function inferCompletionNpcId(steps) {
  const last = Array.isArray(steps) && steps.length > 0 ? steps[steps.length - 1] : null;
  return numberOrNull(last?.npcId);
}

function normalizeRewardSummary(reward) {
  const items = [];
  if (Array.isArray(reward?.items)) {
    for (const choice of reward.items) {
      if (Array.isArray(choice?.items)) {
        items.push(...normalizeItems(choice.items));
      }
    }
  }
  return {
    experience: numberOrZero(reward?.experience),
    gold: numberOrZero(reward?.gold),
    coins: numberOrZero(reward?.coins),
    renown: numberOrZero(reward?.renown),
    pets: Array.isArray(reward?.pets) ? reward.pets.slice() : [],
    items,
  };
}

function normalizeItems(items) {
  return Array.isArray(items)
    ? items
        .filter((item) => Number.isInteger(item?.templateId))
        .map((item) => ({
          templateId: item.templateId >>> 0,
          quantity: Math.max(1, numberOrZero(item.quantity) || 1),
          name: stringOrEmpty(item.name),
        }))
    : [];
}

function formatItems(items) {
  return items
    .map((item) => `${item.templateId}x${item.quantity}${item.name ? `(${item.name})` : ''}`)
    .join(', ');
}

function displayNumber(value) {
  return value === null ? '-' : String(value);
}

function numberOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

main();
