#!/usr/bin/env node
'use strict';

const fs = require('fs');

const SCRIPT_PATH = '/home/nikon/Data/Zodiac Online/script.gcg';
const TITLE_RE = /macro_SetBigText\("¡ï([^"]+?)¡ï",3000,\s*63500\)/g;
const ROLE_CHECK_RE =
  /iResult=macro_RoleCheckRound\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)[\s\S]{0,220}?macro_ChangeScene\((\d+),\s*(\d+),\s*(\d+)\)/g;

function readScriptText() {
  return fs.readFileSync(SCRIPT_PATH, 'latin1');
}

function collectEvents(text) {
  const events = [];

  for (const match of text.matchAll(TITLE_RE)) {
    events.push({
      kind: 'title',
      index: match.index,
      title: match[1],
    });
  }

  for (const match of text.matchAll(ROLE_CHECK_RE)) {
    events.push({
      kind: 'travel',
      index: match.index,
      roleCheck: {
        mode: Number(match[1]),
        x: Number(match[2]),
        y: Number(match[3]),
        radius: Number(match[4]),
      },
      changeScene: {
        mapId: Number(match[5]),
        x: Number(match[6]),
        y: Number(match[7]),
      },
    });
  }

  events.sort((a, b) => a.index - b.index);
  return events;
}

function assignTravelToScenes(text) {
  const events = collectEvents(text);
  const grouped = new Map();
  let currentTitle = null;

  for (const event of events) {
    if (event.kind === 'title') {
      currentTitle = event.title;
      if (!grouped.has(currentTitle)) {
        grouped.set(currentTitle, []);
      }
      continue;
    }

    if (!currentTitle) {
      continue;
    }

    grouped.get(currentTitle).push({
      offset: event.index,
      roleCheck: event.roleCheck,
      changeScene: event.changeScene,
    });
  }

  return [...grouped.entries()].map(([title, travelTriggers]) => ({
    title,
    triggerCount: travelTriggers.length,
    travelTriggers,
  }));
}

function main() {
  const query = process.argv[2] || null;
  const text = readScriptText();
  const blocks = assignTravelToScenes(text);
  const filtered = query
    ? blocks.filter((block) => block.title.toLowerCase().includes(query.toLowerCase()))
    : blocks.filter((block) => block.triggerCount > 0);

  process.stdout.write(JSON.stringify(filtered, null, 2));
  process.stdout.write('\n');
}

main();
