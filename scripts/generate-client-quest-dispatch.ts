#!/usr/bin/env node
// @ts-nocheck
'use strict';
export {};

const fs = require('fs');
const path = require('path');

const TASK_RUNTIME_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'task-runtime.json');
const QUEST_WORKFLOW_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-workflow.json');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-dispatch.json');

function main() {
  const runtime = JSON.parse(fs.readFileSync(TASK_RUNTIME_FILE, 'utf8'));
  const workflow = JSON.parse(fs.readFileSync(QUEST_WORKFLOW_FILE, 'utf8'));

  const taskIds = new Set();
  for (const quest of Array.isArray(workflow?.quests) ? workflow.quests : []) {
    if (Number.isInteger(quest?.taskId)) {
      taskIds.add(quest.taskId);
    }
  }
  for (const block of Array.isArray(runtime?.taskTableBlocks) ? runtime.taskTableBlocks : []) {
    for (const entry of block.taskAddEntries || []) {
      if (Number.isInteger(entry?.taskId)) taskIds.add(entry.taskId);
    }
    for (const entry of block.taskTalkEntries || []) {
      if (Number.isInteger(entry?.taskId)) taskIds.add(entry.taskId);
    }
    for (const entry of block.taskAwardEntries || []) {
      if (Number.isInteger(entry?.taskId)) taskIds.add(entry.taskId);
    }
  }

  const workflowByTaskId = new Map(
    (Array.isArray(workflow?.quests) ? workflow.quests : [])
      .filter((quest) => Number.isInteger(quest?.taskId))
      .map((quest) => [quest.taskId, quest])
  );

  const quests = [...taskIds]
    .sort((left, right) => left - right)
    .map((taskId) => buildDispatch(taskId, runtime, workflowByTaskId.get(taskId) || null));

  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({
      source: {
        taskRuntime: TASK_RUNTIME_FILE,
        questWorkflow: QUEST_WORKFLOW_FILE,
      },
      generatedAt: new Date().toISOString(),
      summary: buildSummary(quests),
      quests,
    }, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write(`${OUTPUT_FILE}\n`);
}

function buildDispatch(taskId, runtime, workflowQuest) {
  const blocks = [];
  for (const block of Array.isArray(runtime?.taskTableBlocks) ? runtime.taskTableBlocks : []) {
    const taskAddEntries = (block.taskAddEntries || []).filter((entry) => entry.taskId === taskId);
    const taskTalkEntries = (block.taskTalkEntries || []).filter((entry) => entry.taskId === taskId);
    const taskAwardEntries = (block.taskAwardEntries || []).filter((entry) => entry.taskId === taskId);
    if (taskAddEntries.length === 0 && taskTalkEntries.length === 0 && taskAwardEntries.length === 0) {
      continue;
    }
    blocks.push({
      lineStart: block.lineStart,
      lineEnd: block.lineEnd,
      fileExecReferences: Array.isArray(block.fileExecReferences) ? block.fileExecReferences.slice() : [],
      taskAddEntries,
      taskTalkEntries,
      taskAwardEntries,
    });
  }

  const addEntries = blocks.flatMap((block) => block.taskAddEntries);
  const talkByPhase = groupByPhase(blocks.flatMap((block) => block.taskTalkEntries));
  const awardByPhase = groupByPhase(blocks.flatMap((block) => block.taskAwardEntries));
  const stepCount = Array.isArray(workflowQuest?.workflow?.steps) ? workflowQuest.workflow.steps.length : 0;

  return {
    taskId,
    title: workflowQuest?.title || `Quest ${taskId}`,
    stepCount,
    acceptDialog: inferAcceptDialog(talkByPhase, awardByPhase, addEntries),
    phaseDialogs: buildPhaseDialogs(stepCount, talkByPhase, awardByPhase),
    addPrompts: dedupeAddEntries(addEntries),
    dispatchBlocks: blocks,
  };
}

function inferAcceptDialog(talkByPhase, awardByPhase, addEntries) {
  const talkPhaseOne = talkByPhase.get(1) || [];
  const awardPhaseOne = awardByPhase.get(1) || [];

  if (talkPhaseOne.length > 0) {
    return {
      kind: 'talk_phase_1',
      entries: talkPhaseOne,
      addPrompts: dedupeAddEntries(addEntries),
    };
  }
  if (awardPhaseOne.length > 0) {
    return {
      kind: 'award_phase_1_fallback',
      entries: awardPhaseOne,
      addPrompts: dedupeAddEntries(addEntries),
    };
  }
  if (addEntries.length > 0) {
    return {
      kind: 'add_prompt_only',
      entries: [],
      addPrompts: dedupeAddEntries(addEntries),
    };
  }
  return {
    kind: 'none',
    entries: [],
    addPrompts: [],
  };
}

function buildPhaseDialogs(stepCount, talkByPhase, awardByPhase) {
  const phases = new Set([...talkByPhase.keys(), ...awardByPhase.keys()]);
  return [...phases]
    .sort((left, right) => left - right)
    .map((phase) => ({
      phase,
      likelyStepIndex: phase >= 1 && phase <= stepCount ? phase : null,
      talkEntries: talkByPhase.get(phase) || [],
      awardEntries: awardByPhase.get(phase) || [],
    }));
}

function groupByPhase(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const phase = Number.isInteger(entry?.phase) ? entry.phase : 0;
    if (!grouped.has(phase)) {
      grouped.set(phase, []);
    }
    grouped.get(phase).push(sanitizeEntry(entry));
  }
  for (const [phase, phaseEntries] of grouped.entries()) {
    grouped.set(phase, dedupeEntries(phaseEntries));
  }
  return grouped;
}

function sanitizeEntry(entry) {
  const sanitized = { ...entry };
  if (typeof sanitized.text1 === 'string') {
    sanitized.text1 = sanitized.text1.trim();
  }
  if (typeof sanitized.text2 === 'string') {
    sanitized.text2 = sanitized.text2.trim();
  }
  if (typeof sanitized.text === 'string') {
    sanitized.text = sanitized.text.trim();
  }
  if (typeof sanitized.acceptChoice === 'string') {
    sanitized.acceptChoice = sanitized.acceptChoice.trim();
  }
  if (typeof sanitized.rejectChoice === 'string') {
    sanitized.rejectChoice = sanitized.rejectChoice.trim();
  }
  return sanitized;
}

function dedupeAddEntries(entries) {
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    const normalized = sanitizeEntry(entry);
    const key = `${normalized.text1 || ''}\u0000${normalized.text2 || ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

function dedupeEntries(entries) {
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    const normalized = sanitizeEntry(entry);
    const key = JSON.stringify(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

function buildSummary(quests) {
  return {
    questCount: quests.length,
    withAcceptDialogCount: quests.filter((quest) => quest.acceptDialog?.kind !== 'none').length,
    withTalkPhaseCount: quests.filter((quest) => quest.phaseDialogs.some((phase) => phase.talkEntries.length > 0)).length,
    withAwardPhaseCount: quests.filter((quest) => quest.phaseDialogs.some((phase) => phase.awardEntries.length > 0)).length,
  };
}

main();
