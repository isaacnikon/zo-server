#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SCRIPT_GCG = '/home/nikon/Data/Zodiac Online/gcg/script.gcg';
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'task-context.json');

function main() {
  const scriptPath = process.argv[2] || DEFAULT_SCRIPT_GCG;
  const content = fs.readFileSync(scriptPath, 'latin1');

  const contextByTaskId = new Map();
  addCheckFinishedRefs(contextByTaskId, content);

  const tasks = [...contextByTaskId.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([taskId, refs]) => ({
      taskId,
      checkFinishedRefs: refs.checkFinishedRefs.sort(compareContextRef),
    }));

  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({
      source: {
        script: scriptPath,
      },
      generatedAt: new Date().toISOString(),
      taskCount: tasks.length,
      tasks,
    }, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write(`${OUTPUT_FILE}\n`);
}

function addCheckFinishedRefs(contextByTaskId, content) {
  const regex = /macro_CheckFinished\((\d+),(\d+),(\d+)\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const taskId = Number(match[1]);
    const npcId = Number(match[2]);
    const phase = Number(match[3]);
    if (!Number.isInteger(taskId) || !Number.isInteger(npcId) || !Number.isInteger(phase)) {
      continue;
    }
    const line = content.slice(0, match.index).split('\n').length;
    const context = getTaskContext(contextByTaskId, taskId);
    context.checkFinishedRefs.push({
      npcId,
      phase,
      line,
    });
  }
}

function getTaskContext(contextByTaskId, taskId) {
  if (!contextByTaskId.has(taskId)) {
    contextByTaskId.set(taskId, {
      checkFinishedRefs: [],
    });
  }
  return contextByTaskId.get(taskId);
}

function compareContextRef(left, right) {
  if (left.phase !== right.phase) {
    return left.phase - right.phase;
  }
  if (left.npcId !== right.npcId) {
    return left.npcId - right.npcId;
  }
  return left.line - right.line;
}

main();
