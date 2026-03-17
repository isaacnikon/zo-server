#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SCRIPT_GCG = '/home/nikon/Data/Zodiac Online/gcg/script.gcg';
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'task-runtime.json');

function main() {
  const scriptPath = process.argv[2] || DEFAULT_SCRIPT_GCG;
  const content = fs.readFileSync(scriptPath, 'latin1');

  const runtime = {
    source: {
      script: scriptPath,
    },
    generatedAt: new Date().toISOString(),
    fileExecReferences: extractFileExecReferences(content),
    rewardBlocks: extractRewardBlocks(content),
    taskTableBlocks: extractTaskTableBlocks(content),
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(runtime, null, 2)}\n`, 'utf8');
  process.stdout.write(`${OUTPUT_FILE}\n`);
}

function extractFileExecReferences(content) {
  return [...content.matchAll(/gc_fileExec\("([^"]+)"\)/g)]
    .map((match) => match[1])
    .filter(Boolean)
    .filter(uniqueOnly)
    .sort();
}

function extractRewardBlocks(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const finishedMatch = lines[index].match(/macro_SetTaskFinished\((\d+)\)/);
    if (!finishedMatch) {
      continue;
    }

    const taskId = Number(finishedMatch[1]);
    const start = findRewardBlockStart(lines, index);
    const snippetLines = lines.slice(start, index + 1);
    const snippet = snippetLines.join('\n');
    const awardOptions = extractAwardOptions(snippet);

    blocks.push({
      taskId,
      lineStart: start + 1,
      lineEnd: index + 1,
      awardReadCount: snippetLines.filter((line) => line.includes('macro_GetSelectAward()')).length,
      awardOptions,
      rawSnippet: snippet,
    });
  }

  return blocks;
}

function findRewardBlockStart(lines, endIndex) {
  let start = endIndex;
  for (let index = endIndex - 1; index >= Math.max(0, endIndex - 80); index -= 1) {
    const line = lines[index];
    if (line.includes('macro_GetSelectAward()')) {
      start = index;
    }
    if (
      index !== endIndex - 1 &&
      (line.includes('macro_SetTaskFinished(') ||
        line.includes('gc_fileExec(') ||
        line.includes('task_awardid={') ||
        line.includes('task_talkid={') ||
        line.includes('task_addid={'))
    ) {
      break;
    }
  }
  return start;
}

function extractAwardOptions(snippet) {
  const options = [];
  const optionRegex = /if\(award == (\d+)\) then([\s\S]*?)end/g;
  let match;

  while ((match = optionRegex.exec(snippet)) !== null) {
    const awardId = Number(match[1]);
    const body = match[2];
    options.push({
      awardId,
      addExp: extractSingleNumber(body, /macro_AddExp\(([^)]+)\)/),
      addMoney: extractSingleNumber(body, /macro_AddMoney\(([^)]+)\)/),
      addCoins: extractSingleNumber(body, /macro_AddTongBan\(([^)]+)\)/),
      addRp: extractSingleNumber(body, /macro_AddRp\(([^)]+)\)/),
      addPet: extractSingleNumber(body, /macro_AddPet\(([^)]+)\)/),
      itemAdds: [...body.matchAll(/macro_AddItem(?:BangDing)?\((\d+),(\d+),0\)/g)].map((itemMatch) => ({
        templateId: Number(itemMatch[1]),
        quantity: Number(itemMatch[2]),
      })),
      rawBody: body.trim(),
    });
  }

  return options;
}

function extractSingleNumber(text, pattern) {
  const match = text.match(pattern);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : match[1].trim();
}

function extractTaskTableBlocks(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('task_addid={')) {
      continue;
    }

    const addTable = extractTable(lines, index, 'task_addid={');
    const talkStart = findNextLine(lines, addTable.endLine + 1, 'task_talkid={');
    const awardStart = findNextLine(lines, addTable.endLine + 1, 'task_awardid={');
    if (talkStart === -1 || awardStart === -1) {
      continue;
    }

    const talkTable = extractTable(lines, talkStart, 'task_talkid={');
    const awardTable = extractTable(lines, awardStart, 'task_awardid={');
    const contextStart = Math.max(0, index - 20);
    const contextEnd = Math.min(lines.length, awardTable.endLine + 20);
    const context = lines.slice(contextStart, contextEnd).join('\n');

    blocks.push({
      lineStart: index + 1,
      lineEnd: awardTable.endLine + 1,
      taskAddEntries: parseTaskAddEntries(addTable.raw),
      taskTalkEntries: parseTaskTalkEntries(talkTable.raw),
      taskAwardEntries: parseTaskAwardEntries(awardTable.raw),
      fileExecReferences: [...context.matchAll(/gc_fileExec\("([^"]+)"\)/g)].map((match) => match[1]).filter(uniqueOnly),
      rawContext: context,
    });

    index = awardTable.endLine;
  }

  return blocks;
}

function extractTable(lines, startLine, marker) {
  const rawLines = [];
  let depth = 0;
  let seenOpen = false;
  let endLine = startLine;

  for (let index = startLine; index < lines.length; index += 1) {
    const line = lines[index];
    rawLines.push(line);
    for (const char of line) {
      if (char === '{') {
        depth += 1;
        seenOpen = true;
      } else if (char === '}') {
        depth -= 1;
      }
    }
    endLine = index;
    if (seenOpen && depth <= 0) {
      break;
    }
  }

  return {
    raw: rawLines.join('\n'),
    endLine,
    marker,
  };
}

function parseTaskAddEntries(raw) {
  return [...raw.matchAll(/\{(\d+),"([^"]*)"(?:,"([^"]*)")?\}/g)].map((match) => ({
    taskId: Number(match[1]),
    text1: match[2] || '',
    text2: match[3] || '',
  }));
}

function parseTaskTalkEntries(raw) {
  return [...raw.matchAll(/\{(\d+),(\d+),"([^"]*)","([^"]*)","([^"]*)"\}/g)].map((match) => ({
    taskId: Number(match[1]),
    phase: Number(match[2]),
    text: match[3] || '',
    acceptChoice: match[4] || '',
    rejectChoice: match[5] || '',
  }));
}

function parseTaskAwardEntries(raw) {
  return [...raw.matchAll(/\{(\d+),"([^"]*)",(\d+)\}/g)].map((match) => ({
    taskId: Number(match[1]),
    text: match[2] || '',
    phase: Number(match[3]),
  }));
}

function findNextLine(lines, startIndex, pattern) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index].includes(pattern)) {
      return index;
    }
    if (index > startIndex + 60) {
      return -1;
    }
  }
  return -1;
}

function uniqueOnly(value, index, array) {
  return array.indexOf(value) === index;
}

main();
