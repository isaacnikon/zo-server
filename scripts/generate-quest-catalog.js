#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const TASKLIST_FILE = path.resolve(__dirname, '..', 'data', 'client-verified', 'tasks', 'tasklist.json');
const HELP_FILE = path.resolve(__dirname, '..', 'data', 'client-verified', 'quests', 'client-help-quests.json');
const LIVE_QUEST_FILE = path.resolve(__dirname, '..', 'data', 'quests', 'main-story.json');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'data', 'quests', 'generated');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'catalog.json');

function main() {
  const tasklist = JSON.parse(fs.readFileSync(TASKLIST_FILE, 'utf8'));
  const help = JSON.parse(fs.readFileSync(HELP_FILE, 'utf8'));
  const live = JSON.parse(fs.readFileSync(LIVE_QUEST_FILE, 'utf8'));

  const taskRows = Array.isArray(tasklist?.tasks) ? tasklist.tasks : [];
  const helpRows = Array.isArray(help?.quests) ? help.quests : [];
  const taskById = new Map(
    taskRows
      .filter((task) => Number.isInteger(task?.task_id))
      .map((task) => [task.task_id, task])
  );
  const liveQuests = new Map(
    (Array.isArray(live?.quests) ? live.quests : [])
      .filter((quest) => Number.isInteger(quest?.id))
      .map((quest) => [quest.id, quest])
  );
  const helpByTaskId = groupByTaskId(helpRows);
  const taskIds = [...new Set([
    ...taskRows.map((task) => task.task_id).filter(Number.isInteger),
    ...helpRows.map((row) => row.taskId).filter(Number.isInteger),
  ])];

  const quests = taskIds
    .map((taskId) => buildCatalogEntry(
      taskById.get(taskId) || null,
      helpByTaskId.get(taskId) || [],
      liveQuests.get(taskId) || null,
      taskId
    ))
    .filter(Boolean)
    .sort((left, right) => left.taskId - right.taskId);

  const summary = summarizeCatalog(quests);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({
      source: {
        tasklist: TASKLIST_FILE,
        help: HELP_FILE,
        liveQuests: LIVE_QUEST_FILE,
      },
      generatedAt: new Date().toISOString(),
      summary,
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

function buildCatalogEntry(task, helpVariants, liveQuest, taskId) {
  if (!Number.isInteger(taskId)) {
    return null;
  }

  const prerequisiteTaskIds = uniqueNumbers([
    numberOrUndefined(task?.field_5),
    ...helpVariants.flatMap((variant) => Array.isArray(variant.referencedTaskIds) ? variant.referencedTaskIds : []),
  ].filter((referencedTaskId) => referencedTaskId > 0 && referencedTaskId !== taskId));
  const itemIds = uniqueNumbers(helpVariants.flatMap((variant) => variant.itemIds || []));
  const npcIds = uniqueNumbers([
    numberOrUndefined(task?.npc_id),
    ...helpVariants.flatMap((variant) => Array.isArray(variant.startNpcIds) ? variant.startNpcIds : []),
  ]);
  const targetNpcIds = uniqueNumbers(helpVariants.flatMap((variant) => variant.targetNpcIds || []));
  const mapIds = uniqueNumbers(helpVariants.flatMap((variant) => variant.mapIds || []));
  const inferredSteps = helpVariants.map((variant, index) => buildInferredStep(task, variant, index));
  const classification = classifyQuest(helpVariants, liveQuest);
  const resolvedTitle = resolveQuestTitle(task, helpVariants, taskId);

  return {
    taskId,
    title: resolvedTitle,
    sourceKind: task ? 'tasklist' : 'help_only',
    minLevel: numberOrZero(task?.min_level),
    startNpcId: Number.isInteger(task?.npc_id) ? task.npc_id : (npcIds[0] || 0),
    prerequisiteTaskIds,
    flags: {
      field4: numberOrZero(task?.field_4),
      field6: numberOrZero(task?.field_6),
      field7: numberOrZero(task?.field_7),
      field8: numberOrZero(task?.field_8),
      field9: numberOrZero(task?.field_9),
      field10: numberOrZero(task?.field_10),
      field11: numberOrZero(task?.field_11),
    },
    evidence: {
      helpVariantCount: helpVariants.length,
      npcIds,
      targetNpcIds,
      mapIds,
      itemIds,
      hasLiveRuntimeDefinition: Boolean(liveQuest),
    },
    runtimeStatus: classification.status,
    runtimeNotes: classification.notes,
    inferredSteps,
    liveQuestDefinition: liveQuest
      ? {
          id: liveQuest.id,
          name: liveQuest.name || resolvedTitle,
          stepCount: Array.isArray(liveQuest.steps) ? liveQuest.steps.length : 0,
        }
      : null,
    helpVariants: helpVariants.map((variant) => ({
      helpVariantTitle: variant.helpVariantTitle || '',
      stepIndex: numberOrZero(variant.stepIndex),
      startNpcIds: uniqueNumbers(variant.startNpcIds || []),
      targetNpcIds: uniqueNumbers(variant.targetNpcIds || []),
      mapIds: uniqueNumbers(variant.mapIds || []),
      itemIds: uniqueNumbers(variant.itemIds || []),
      goalCount: numberOrZero(variant.goalCount),
      referencedTaskIds: uniqueNumbers(variant.referencedTaskIds || []),
      blockPreview: typeof variant.blockPreview === 'string' ? variant.blockPreview : '',
    })),
  };
}

function buildInferredStep(task, variant, index) {
  const uniqueNpcIds = uniqueNumbers(variant.startNpcIds || []);
  const uniqueTargetNpcIds = uniqueNumbers(variant.targetNpcIds || []);
  const uniqueMapIds = uniqueNumbers(variant.mapIds || []);
  const uniqueItemIds = uniqueNumbers(variant.itemIds || []);
  const uniqueTaskRefs = uniqueNumbers(variant.referencedTaskIds || []);
  const startNpcId = uniqueNpcIds[0] || numberOrUndefined(task?.npc_id);
  const endNpcId = uniqueNpcIds.length > 1 ? uniqueNpcIds[uniqueNpcIds.length - 1] : startNpcId;
  const inferredType = inferStepType(variant);

  return {
    index: index + 1,
    helpStepIndex: numberOrZero(variant.stepIndex),
    inferredType,
    confidence: inferConfidence(variant),
    startNpcId: startNpcId || 0,
    endNpcId: endNpcId || 0,
    targetNpcIds: uniqueTargetNpcIds,
    monsterId: inferredType === 'kill' && uniqueTargetNpcIds.length > 0 ? uniqueTargetNpcIds[0] : 0,
    count: Math.max(1, numberOrZero(variant.goalCount) || 1),
    mapIds: uniqueMapIds,
    itemIds: uniqueItemIds,
    referencedTaskIds: uniqueTaskRefs,
    summary: buildVariantSummary(variant, uniqueItemIds, uniqueNpcIds, uniqueTargetNpcIds),
  };
}

function resolveQuestTitle(task, helpVariants, taskId) {
  const taskTitle = cleanQuestTitle(task?.title);
  if (isUsableQuestTitle(taskTitle)) {
    return taskTitle;
  }

  for (const variant of helpVariants) {
    const variantTitle = cleanQuestTitle(variant?.title);
    if (isUsableQuestTitle(variantTitle)) {
      return variantTitle;
    }
    const helpVariantTitle = cleanQuestTitle(variant?.helpVariantTitle);
    if (isUsableQuestTitle(helpVariantTitle)) {
      return helpVariantTitle;
    }
  }

  return `Quest ${taskId}`;
}

function inferStepType(variant) {
  const preview = String(variant?.blockPreview || '');
  const lowerPreview = preview.toLowerCase();
  if (lowerPreview.includes('kill #0<2>') || lowerPreview.includes('quest goal: kill')) {
    return 'kill';
  }
  if (lowerPreview.includes('obtain #0<2>') || lowerPreview.includes('get #0<2>') || lowerPreview.includes('bring #0<2>')) {
    return 'collect';
  }
  if ((Array.isArray(variant?.startNpcIds) ? variant.startNpcIds.length : 0) >= 2) {
    return 'talk';
  }
  return 'unknown';
}

function inferConfidence(variant) {
  const npcCount = Array.isArray(variant?.startNpcIds) ? uniqueNumbers(variant.startNpcIds).length : 0;
  const mapCount = Array.isArray(variant?.mapIds) ? uniqueNumbers(variant.mapIds).length : 0;
  if (npcCount >= 2 && mapCount >= 1) {
    return 'medium';
  }
  if (npcCount >= 1) {
    return 'low';
  }
  return 'unknown';
}

function buildVariantSummary(variant, itemIds, npcIds, targetNpcIds) {
  const title = typeof variant?.title === 'string' && variant.title.length > 0
    ? variant.title
    : 'Quest step';
  const stepLabel = numberOrZero(variant?.stepIndex) > 0 ? `step ${variant.stepIndex}` : 'step';
  const parts = [`${title} ${stepLabel}`];
  if (npcIds.length >= 2) {
    parts.push(`npc ${npcIds[0]} -> ${npcIds[npcIds.length - 1]}`);
  } else if (npcIds.length === 1) {
    parts.push(`npc ${npcIds[0]}`);
  }
  if (itemIds.length > 0) {
    parts.push(`items ${itemIds.join(', ')}`);
  }
  if (targetNpcIds.length > 0) {
    parts.push(`targets ${targetNpcIds.join(', ')}`);
  }
  if (numberOrZero(variant?.goalCount) > 1) {
    parts.push(`count ${variant.goalCount}`);
  }
  return parts.join(', ');
}

function classifyQuest(helpVariants, liveQuest) {
  if (liveQuest && Array.isArray(liveQuest.steps) && liveQuest.steps.length > 0) {
    return {
      status: 'runnable',
      notes: [
        'Has a server runtime definition.',
        'Use this for live testing until more quests are packet-verified.',
      ],
    };
  }

  if (helpVariants.length > 0) {
    return {
      status: 'needs_override',
      notes: [
        'Client help metadata exists.',
        'Quest still needs runtime trigger details such as subtype, scriptId, or item packet behavior.',
      ],
    };
  }

  return {
    status: 'metadata_only',
    notes: [
      'Quest exists in tasklist metadata.',
      'No extracted help block was found in the installed client script dataset yet.',
    ],
  };
}

function summarizeCatalog(quests) {
  const counts = {
    totalTasks: quests.length,
    tasklistBacked: 0,
    helpOnly: 0,
    runnable: 0,
    needs_override: 0,
    metadata_only: 0,
    withHelpVariants: 0,
    withItemReferences: 0,
  };

  for (const quest of quests) {
    if (quest.sourceKind === 'help_only') {
      counts.helpOnly += 1;
    } else {
      counts.tasklistBacked += 1;
    }
    if (Object.prototype.hasOwnProperty.call(counts, quest.runtimeStatus)) {
      counts[quest.runtimeStatus] += 1;
    }
    if (numberOrZero(quest?.evidence?.helpVariantCount) > 0) {
      counts.withHelpVariants += 1;
    }
    if (Array.isArray(quest?.evidence?.itemIds) && quest.evidence.itemIds.length > 0) {
      counts.withItemReferences += 1;
    }
  }

  return counts;
}

function cleanQuestTitle(title) {
  return String(title || '').replace(/^<[^>]+>/, '').trim();
}

function isUsableQuestTitle(title) {
  if (typeof title !== 'string' || title.length === 0) {
    return false;
  }

  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes('macro_') || lowerTitle.includes('claver') || title.includes('[[') || title.includes('..')) {
    return false;
  }

  return true;
}

function uniqueNumbers(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .filter((value) => Number.isInteger(value))
      .map((value) => value >>> 0)
  )];
}

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function numberOrUndefined(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

main();
