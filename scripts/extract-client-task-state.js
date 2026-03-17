#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SCRIPT_GCG = '/home/nikon/Data/Zodiac Online/gcg/script.gcg';
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'task-state-clusters.json');

function main() {
  const scriptPath = process.argv[2] || DEFAULT_SCRIPT_GCG;
  const content = fs.readFileSync(scriptPath, 'latin1');
  const lines = content.split(/\r?\n/);
  const clusters = extractTaskStateClusters(lines);

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({
      source: {
        script: scriptPath,
      },
      generatedAt: new Date().toISOString(),
      clusterCount: clusters.length,
      clusters,
    }, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write(`${OUTPUT_FILE}\n`);
}

function extractTaskStateClusters(lines) {
  const clusters = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('macro_SetTaskMaxStep(')) {
      continue;
    }

    const start = index;
    let end = index;
    let sawStep = false;

    for (let inner = index; inner < Math.min(lines.length, index + 20); inner += 1) {
      const line = lines[inner];
      end = inner;
      if (line.includes('macro_SetTaskStep(')) {
        sawStep = true;
        break;
      }
      if (
        inner > index &&
        (
          line.includes('macro_SetTaskFinished(') ||
          line.includes('award = macro_GetSelectAward()') ||
          line.includes('task_addid={') ||
          line.includes('task_talkid={') ||
          line.includes('task_awardid={')
        )
      ) {
        break;
      }
    }

    if (!sawStep) {
      continue;
    }

    const snippetLines = lines.slice(start, end + 1);
    const rawSnippet = snippetLines.join('\n');
    const cluster = {
      clusterIndex: clusters.length + 1,
      lineStart: start + 1,
      lineEnd: end + 1,
      maxStep: extractSingleNumber(rawSnippet, /macro_SetTaskMaxStep\((\d+)\)/),
      taskType: extractSingleNumber(rawSnippet, /macro_SetTaskType\((\d+)\)/),
      overNpcId: extractSingleNumber(rawSnippet, /macro_SetOverNpc\((\d+)\)/),
      maxAward: extractSingleNumber(rawSnippet, /macro_SetMaxAward\((\d+)\)/),
      taskStep: extractSingleNumber(rawSnippet, /macro_SetTaskStep\((\d+)\)/),
      itemParams: [...rawSnippet.matchAll(/macro_SetTaskItemParam\((\d+),(\d+),(\d+)\)/g)].map((match) => ({
        templateId: Number(match[1]),
        count: Number(match[2]),
        index: Number(match[3]),
      })),
      killParams: [...rawSnippet.matchAll(/macro_SetTaskKillParam\((\d+),(\d+),(\d+)\)/g)].map((match) => ({
        monsterId: Number(match[1]),
        count: Number(match[2]),
        index: Number(match[3]),
      })),
      addedItems: [...rawSnippet.matchAll(/macro_AddItem(?:BangDing)?\((\d+),(\d+),0\)/g)].map((match) => ({
        templateId: Number(match[1]),
        quantity: Number(match[2]),
      })),
      dropRate: extractSingleNumber(rawSnippet, /macro_SetTaskDropRate\((\d+)\)/),
      rawSnippet,
    };
    clusters.push(cluster);
    index = end - 1;
  }

  return clusters;
}

function extractSingleNumber(text, pattern) {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

main();
