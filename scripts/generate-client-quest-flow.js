#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SCRIPT_GCG = '/home/nikon/Data/Zodiac Online/gcg/script.gcg';
const TASKLIST_JSON = path.resolve(__dirname, '..', 'data', 'client-derived', 'quests.json');
const GENERAL_ITEMS_JSON = path.resolve(__dirname, '..', 'data', 'client-derived', 'items.json');
const POTIONS_JSON = path.resolve(__dirname, '..', 'data', 'client-derived', 'potions.json');
const STUFF_JSON = path.resolve(__dirname, '..', 'data', 'client-derived', 'stuff.json');
const EQUIPMENT_JSON = path.resolve(__dirname, '..', 'data', 'client-derived', 'equipment.json');
const WEAPONS_JSON = path.resolve(__dirname, '..', 'data', 'client-derived', 'weapons.json');
const ROLEINFO_JSON = path.resolve(__dirname, '..', 'data', 'client-derived', 'roleinfo.json');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-flow.json');

function main() {
  const scriptPath = process.argv[2] || DEFAULT_SCRIPT_GCG;
  const taskMetaById = loadTaskMetaById(TASKLIST_JSON);
  const itemNameById = loadItemNameById();
  const roleNameById = loadRoleNameById(ROLEINFO_JSON);

  const content = fs.readFileSync(scriptPath, 'latin1');
  const blocks = extractHelpBlocks(content);
  const quests = mergeBlocksByTaskId(blocks, taskMetaById, itemNameById, roleNameById);

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({
      source: {
        script: scriptPath,
        tasklist: TASKLIST_JSON,
        items: [
          GENERAL_ITEMS_JSON,
          POTIONS_JSON,
          STUFF_JSON,
          EQUIPMENT_JSON,
          WEAPONS_JSON,
        ],
        roleinfo: ROLEINFO_JSON,
      },
      generatedAt: new Date().toISOString(),
      questCount: quests.length,
      blockCount: blocks.length,
      quests,
    }, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write(`${OUTPUT_FILE}\n`);
}

function extractHelpBlocks(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const headerLine = lines[index];
    if (!headerLine.startsWith('--')) {
      continue;
    }

    const collected = [headerLine];
    let helpLine = null;
    let closed = false;

    for (let inner = index + 1; inner < Math.min(lines.length, index + 18); inner += 1) {
      const line = lines[inner];
      if (line.startsWith('--') && collected.length > 1) {
        break;
      }
      collected.push(line);
      if (line.includes('macro_GuiSetText("helpcontext",')) {
        helpLine = line;
      }
      if (line.includes('macro_GuiSetWinVisable("HELPWIN", 1)')) {
        closed = true;
        index = inner;
        break;
      }
    }

    if (!helpLine || !closed) {
      continue;
    }

    const block = parseHelpBlock(collected.join('\n'));
    if (block) {
      blocks.push(block);
    }
  }

  return blocks;
}

function parseHelpBlock(rawBlock) {
  const headerMatch = rawBlock.match(/^--([^\n]+)/);
  const taskIdMatch = rawBlock.match(/macro_GetTaskName\((\d+)\)/);
  const helpLineMatch = rawBlock.match(/macro_GuiSetText\("helpcontext",\s*"([\s\S]*?)"\)/);
  if (!headerMatch || !taskIdMatch || !helpLineMatch) {
    return null;
  }

  const header = headerMatch[1].trim();
  const taskId = Number(taskIdMatch[1]);
  const npcPositionMatches = [...rawBlock.matchAll(/macro_GetNpcPosition\((\d+),(\d+)\)/g)];
  const itemIdMatches = [...rawBlock.matchAll(/macro_GetItemName\((\d+)\)/g)].map((match) => Number(match[1]));
  const npcIdMatches = [...rawBlock.matchAll(/macro_GetTypeNpcName\((\d+)\)/g)].map((match) => Number(match[1]));
  const referencedTaskIds = [...rawBlock.matchAll(/macro_GetTaskName\((\d+)\)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value !== taskId);

  const positionNpcIds = npcPositionMatches.map((match) => Number(match[1]));
  const mapIds = npcPositionMatches.map((match) => Number(match[2]));
  const targetNpcIds = [...new Set(npcIdMatches.filter((npcId) => !positionNpcIds.includes(npcId)))];

  const helpString = helpLineMatch[1];
  const stepIndex = extractStepIndex(header, helpString);
  const title = cleanHeaderTitle(header);
  const goalTextRaw = extractSection(helpString, 'Quest Goal:', ['Quest Reward:']);
  const rewardTextRaw = extractSection(helpString, 'Quest Reward:', ['Quest Description:', 'Quest Brief:', '#2<8><']);
  const descriptionTextRaw =
    extractSection(helpString, 'Quest Description:', ['#2<8><']) ||
    extractSection(helpString, 'Quest Brief:', ['#2<8><']);

  return {
    taskId,
    title,
    header,
    stepIndex,
    startNpcIds: positionNpcIds,
    mapIds,
    targetNpcIds,
    itemIds: [...new Set(itemIdMatches)],
    referencedTaskIds: [...new Set(referencedTaskIds)],
    goalTextRaw,
    rewardTextRaw,
    descriptionTextRaw,
    helpString,
    rawBlock,
  };
}

function mergeBlocksByTaskId(blocks, taskMetaById, itemNameById, roleNameById) {
  const byTaskId = new Map();

  for (const block of blocks) {
    if (!byTaskId.has(block.taskId)) {
      byTaskId.set(block.taskId, []);
    }
    byTaskId.get(block.taskId).push(block);
  }

  const quests = [];
  for (const [taskId, entries] of byTaskId.entries()) {
    entries.sort((left, right) => left.stepIndex - right.stepIndex);
    const taskMeta = taskMetaById.get(taskId) || null;

    quests.push({
      taskId,
      title: taskMeta?.title || entries[0].title || `Quest ${taskId}`,
      startNpcId: taskMeta?.startNpcId || firstNumber(...entries[0].startNpcIds),
      minLevel: taskMeta?.minLevel || 1,
      prerequisiteTaskId: taskMeta?.prerequisiteTaskId || 0,
      steps: entries.map((entry) => buildQuestFlowStep(entry, itemNameById, roleNameById)),
      evidence: {
        blockCount: entries.length,
        headers: entries.map((entry) => entry.header),
      },
    });
  }

  quests.sort((left, right) => left.taskId - right.taskId);
  return quests;
}

function buildQuestFlowStep(entry, itemNameById, roleNameById) {
  const goalText = materializeMacroText(entry.goalTextRaw, itemNameById, roleNameById);
  const rewardText = materializeMacroText(entry.rewardTextRaw, itemNameById, roleNameById);
  const descriptionText = materializeMacroText(entry.descriptionTextRaw, itemNameById, roleNameById);
  const rewardNumbers = parseRewardNumbers(rewardText);
  const rewardItemIds = extractRewardItemIds(entry.rewardTextRaw, entry.itemIds);

  return {
    stepIndex: entry.stepIndex,
    flowType: classifyGoal(goalText),
    startNpcIds: entry.startNpcIds,
    mapIds: entry.mapIds,
    targetNpcIds: entry.targetNpcIds,
    itemIds: entry.itemIds,
    referencedTaskIds: entry.referencedTaskIds,
    goalText,
    rewardText,
    descriptionText,
    reward: {
      experience: rewardNumbers.experience,
      gold: rewardNumbers.gold,
      coins: rewardNumbers.coins,
      renown: rewardNumbers.renown,
      itemIds: rewardItemIds,
      itemNames: rewardItemIds.map((itemId) => itemNameById.get(itemId) || `Item ${itemId}`),
    },
    evidence: {
      header: entry.header,
      rawGoalText: entry.goalTextRaw,
      rawRewardText: entry.rewardTextRaw,
    },
  };
}

function loadTaskMetaById(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  return new Map(
    entries
      .filter((entry) => Number.isInteger(entry?.taskId))
      .map((entry) => [entry.taskId, {
        title: cleanQuestTitle(entry.title),
        startNpcId: Number.isInteger(entry.startNpcId) ? entry.startNpcId : 0,
        minLevel: Number.isInteger(entry.minLevel) ? entry.minLevel : 1,
        prerequisiteTaskId: Number.isInteger(entry.prerequisiteTaskId) ? entry.prerequisiteTaskId : 0,
      }])
  );
}

function loadItemNameById() {
  const map = new Map();
  for (const filePath of [
    GENERAL_ITEMS_JSON,
    POTIONS_JSON,
    STUFF_JSON,
    EQUIPMENT_JSON,
    WEAPONS_JSON,
  ]) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    for (const entry of entries) {
      if (!Number.isInteger(entry?.templateId) || typeof entry?.name !== 'string' || entry.name.length === 0) {
        continue;
      }
      map.set(entry.templateId, entry.name);
    }
  }
  return map;
}

function loadRoleNameById(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  return new Map(
    entries
      .filter((entry) => Number.isInteger(entry?.roleId))
      .map((entry) => [entry.roleId, entry.name || `Npc ${entry.roleId}`])
  );
}

function extractStepIndex(header, helpString) {
  const titleMatch = header.match(/\(([^)]+)\)/);
  const helpMatch = helpString.match(/macro_GetTaskName\(\d+\)\((\d+)\)/);
  if (helpMatch) {
    return Number(helpMatch[1]);
  }
  if (!titleMatch) {
    return 1;
  }
  const raw = titleMatch[1].trim();
  const roman = romanToInt(raw);
  if (roman > 0) {
    return roman;
  }
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

function cleanHeaderTitle(header) {
  return cleanQuestTitle(header.replace(/\([^)]*\)/, '').split(',')[0]);
}

function cleanQuestTitle(title) {
  return String(title || '').replace(/^<[^>]+>/, '').trim();
}

function extractSection(text, startMarker, endMarkers) {
  const start = text.indexOf(startMarker);
  if (start < 0) {
    return '';
  }
  const contentStart = start + startMarker.length;
  const markers = Array.isArray(endMarkers) ? endMarkers : [];
  let bestEnd = -1;
  for (const marker of markers) {
    const end = text.indexOf(marker, contentStart);
    if (end >= 0 && (bestEnd < 0 || end < bestEnd)) {
      bestEnd = end;
    }
  }
  return bestEnd >= 0 ? text.slice(contentStart, bestEnd) : text.slice(contentStart);
}

function materializeMacroText(text, itemNameById, roleNameById) {
  return cleanRenderedText(
    String(text || '')
      .replace(/\\"?\.\.macro_GetItemName\((\d+)\)\.\.\\"?/g, (_, id) => itemNameById.get(Number(id)) || `Item ${id}`)
      .replace(/\\"?\.\.macro_GetTypeNpcName\((\d+)\)\.\.\\"?/g, (_, id) => roleNameById.get(Number(id)) || `Npc ${id}`)
      .replace(/\\"?\.\.macro_GetTaskName\((\d+)\)\.\.\\"?/g, (_, id) => `Task ${id}`)
      .replace(/\\"?\.\.macro_GetMapName\((\d+)\)\.\.\\"?/g, (_, id) => `Map ${id}`)
      .replace(/\.\.macro_GetItemName\((\d+)\)\.\./g, (_, id) => itemNameById.get(Number(id)) || `Item ${id}`)
      .replace(/\.\.macro_GetTypeNpcName\((\d+)\)\.\./g, (_, id) => roleNameById.get(Number(id)) || `Npc ${id}`)
      .replace(/\.\.macro_GetTaskName\((\d+)\)\.\./g, (_, id) => `Task ${id}`)
      .replace(/\.\.macro_GetMapName\((\d+)\)\.\./g, (_, id) => `Map ${id}`)
      .replace(/\.\.x\d*\.\.|\.\.y\d*\.\./g, ' ')
      .replace(/\\n/g, '\n')
  );
}

function cleanRenderedText(text) {
  return String(text || '')
    .replace(/#\d+<\d+>/g, ' ')
    .replace(/��/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRewardNumbers(rewardText) {
  return {
    experience: extractRewardNumber(rewardText, /Experience:\s*(\d+)/i),
    gold: extractRewardNumber(rewardText, /Gold:\s*(\d+)/i),
    coins: extractRewardNumber(rewardText, /Coin:\s*(\d+)/i),
    renown: extractRewardNumber(rewardText, /Renown:\s*(\d+)/i),
  };
}

function extractRewardNumber(text, pattern) {
  const match = String(text || '').match(pattern);
  return match ? Number(match[1]) : 0;
}

function extractRewardItemIds(rawRewardText, itemIds) {
  const rewardIds = [...String(rawRewardText || '').matchAll(/macro_GetItemName\((\d+)\)/g)]
    .map((match) => Number(match[1]));
  if (rewardIds.length > 0) {
    return [...new Set(rewardIds)];
  }
  return [];
}

function classifyGoal(goalText) {
  const text = String(goalText || '').toLowerCase();
  if (text.includes('capture')) {
    return 'capture';
  }
  if (text.includes('kill') && (text.includes('obtain') || text.includes('get '))) {
    return 'kill_collect';
  }
  if (text.includes('kill')) {
    return 'kill';
  }
  if (text.includes('bring') || text.includes('take it to') || text.includes('speak with')) {
    return 'talk';
  }
  return 'unknown';
}

function romanToInt(raw) {
  const text = String(raw || '').trim().toUpperCase();
  const map = new Map([
    ['I', 1],
    ['V', 5],
    ['X', 10],
  ]);
  let total = 0;
  let previous = 0;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const value = map.get(text[index]);
    if (!value) {
      return 0;
    }
    if (value < previous) {
      total -= value;
    } else {
      total += value;
      previous = value;
    }
  }
  return total;
}

function firstNumber(...values) {
  for (const value of values) {
    if (Number.isInteger(value)) {
      return value;
    }
  }
  return 0;
}

main();
