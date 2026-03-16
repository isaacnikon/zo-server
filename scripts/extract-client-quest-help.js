#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SCRIPT_GCG = '/home/nikon/Data/Zodiac Online/gcg/script.gcg';
const DEFAULT_TASKLIST_JSON = path.resolve(__dirname, '..', 'data', 'client-verified', 'tasks', 'tasklist.json');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'data', 'client-verified', 'quests');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'client-help-quests.json');

function main() {
  const scriptPath = process.argv[2] || DEFAULT_SCRIPT_GCG;
  const stringsOutput = extractAsciiStrings(fs.readFileSync(scriptPath), 4);

  const taskTitleById = loadTaskTitles(DEFAULT_TASKLIST_JSON);
  const quests = extractQuestHelp(stringsOutput, taskTitleById);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({
      source: scriptPath,
      extractedAt: new Date().toISOString(),
      questCount: quests.length,
      quests,
    }, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write(`${OUTPUT_FILE}\n`);
}

function extractAsciiStrings(buffer, minLength) {
  const lines = [];
  let current = '';

  for (const byte of buffer) {
    if (byte >= 0x20 && byte <= 0x7e) {
      current += String.fromCharCode(byte);
      continue;
    }

    if (current.length >= minLength) {
      lines.push(current);
    }
    current = '';
  }

  if (current.length >= minLength) {
    lines.push(current);
  }

  return lines.join('\n');
}

function loadTaskTitles(tasklistPath) {
  const raw = fs.readFileSync(tasklistPath, 'utf8');
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed?.tasks)
    ? parsed.tasks
    : (Array.isArray(parsed?.rows) ? parsed.rows : []);
  const map = new Map();
  for (const row of rows) {
    const taskId = Number.isInteger(row?.task_id) ? row.task_id : row?.taskId;
    if (!Number.isInteger(taskId)) {
      continue;
    }
    map.set(taskId, cleanQuestTitle(typeof row.title === 'string' ? row.title : ''));
  }
  return map;
}

function extractQuestHelp(stringsOutput, taskTitleById) {
  const lines = stringsOutput.split(/\r?\n/);
  const quests = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('--')) {
      continue;
    }

    const titleMatch = line.match(/^--(.+?)\((\d+)\)/);
    if (!titleMatch) {
      continue;
    }

    const nearby = lines.slice(index, index + 14).join('\n');
    const taskIdMatch = nearby.match(/macro_GetTaskName\((\d+)\)/);
    if (!taskIdMatch) {
      continue;
    }

    const startNpcMatches = [...nearby.matchAll(/macro_GetNpcPosition\((\d+),(\d+)\)/g)];
    const itemIdMatches = [...nearby.matchAll(/macro_GetItemName\((\d+)\)/g)].map((match) => Number(match[1]));
    const taskRefs = [...nearby.matchAll(/macro_GetTaskName\((\d+)\)/g)].map((match) => Number(match[1]));
    const typeNpcIds = [...nearby.matchAll(/macro_GetTypeNpcName\((\d+)\)/g)].map((match) => Number(match[1]));
    const startNpcIds = startNpcMatches.map((match) => Number(match[1]));
    const questId = Number(taskIdMatch[1]);
    const stepIndex = Number(titleMatch[2]);

    quests.push({
      taskId: questId,
      title: cleanQuestTitle(taskTitleById.get(questId) || titleMatch[1]),
      helpVariantTitle: cleanQuestTitle(titleMatch[1]),
      stepIndex,
      startNpcIds,
      mapIds: startNpcMatches.map((match) => Number(match[2])),
      targetNpcIds: [...new Set(typeNpcIds.filter((npcId) => !startNpcIds.includes(npcId)))],
      itemIds: [...new Set(itemIdMatches)],
      goalCount: extractGoalCount(nearby),
      referencedTaskIds: [...new Set(taskRefs.filter((value) => value !== questId))],
      blockPreview: nearby,
    });
  }

  return dedupeQuestHelpBlocks(quests);
}

function dedupeQuestHelpBlocks(quests) {
  const seen = new Set();
  const result = [];

  for (const quest of quests) {
    const key = `${quest.taskId}:${quest.stepIndex}:${quest.startNpcIds.join(',')}:${quest.targetNpcIds.join(',')}:${quest.itemIds.join(',')}:${quest.goalCount}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(quest);
  }

  return result.sort((left, right) => {
    if (left.taskId !== right.taskId) {
      return left.taskId - right.taskId;
    }
    return left.stepIndex - right.stepIndex;
  });
}

function cleanQuestTitle(title) {
  return String(title || '').replace(/^<[^>]+>/, '').trim();
}

function extractGoalCount(block) {
  const text = String(block || '');
  const patterns = [
    /Quest Goal:\s*Kill#0<2>(\d+)/i,
    /Quest Goal:\s*Capture #0<2>(\d+)/i,
    /Quest Goal:\s*Kill\s+#0<2>(\d+)/i,
    /Quest Goal:\s*Kill\s*(\d+)/i,
    /Quest Goal:.*?obtain #0<2>.*?(\d+)#0<0>/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }

  return 1;
}

main();
