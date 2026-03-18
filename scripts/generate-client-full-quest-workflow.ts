#!/usr/bin/env node
// @ts-nocheck
'use strict';
export {};

const fs = require('fs');
const path = require('path');

const WORKFLOW_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-workflow.json');
const DISPATCH_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-dispatch.json');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-full-workflow.json');

function main() {
  const workflow = JSON.parse(fs.readFileSync(WORKFLOW_FILE, 'utf8'));
  const dispatch = JSON.parse(fs.readFileSync(DISPATCH_FILE, 'utf8'));

  const dispatchByTaskId = new Map(
    (Array.isArray(dispatch?.quests) ? dispatch.quests : [])
      .filter((quest) => Number.isInteger(quest?.taskId))
      .map((quest) => [quest.taskId, quest])
  );

  const quests = (Array.isArray(workflow?.quests) ? workflow.quests : [])
    .filter((quest) => Number.isInteger(quest?.taskId))
    .map((quest) => ({
      ...quest,
      dispatch: summarizeDispatch(dispatchByTaskId.get(quest.taskId) || null),
    }));

  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({
      source: {
        workflow: WORKFLOW_FILE,
        dispatch: DISPATCH_FILE,
      },
      generatedAt: new Date().toISOString(),
      summary: buildSummary(quests),
      quests,
    }, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write(`${OUTPUT_FILE}\n`);
}

function summarizeDispatch(dispatchQuest) {
  if (!dispatchQuest) {
    return {
      available: false,
      acceptDialog: { kind: 'none', entries: [], addPrompts: [] },
      phaseDialogs: [],
      dispatchBlockCount: 0,
    };
  }

  return {
    available: true,
    acceptDialog: dispatchQuest.acceptDialog || { kind: 'none', entries: [], addPrompts: [] },
    phaseDialogs: Array.isArray(dispatchQuest.phaseDialogs) ? dispatchQuest.phaseDialogs : [],
    dispatchBlockCount: Array.isArray(dispatchQuest.dispatchBlocks) ? dispatchQuest.dispatchBlocks.length : 0,
  };
}

function buildSummary(quests) {
  return {
    questCount: quests.length,
    runtimeReadyQuestCount: quests.filter((quest) => quest.workflow?.runtimeReady).length,
    withDispatchCount: quests.filter((quest) => quest.dispatch?.available).length,
    withAcceptDialogCount: quests.filter((quest) => quest.dispatch?.acceptDialog?.kind && quest.dispatch.acceptDialog.kind !== 'none').length,
  };
}

main();
