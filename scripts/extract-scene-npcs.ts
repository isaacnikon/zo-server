#!/usr/bin/env node
// @ts-nocheck
'use strict';
export {};

const fs = require('fs');

const SCRIPT_PATH = '/home/nikon/Data/Zodiac Online/script.gcg';
const TITLE_RE = /macro_SetBigText\("¡ï([^"]+?)¡ï",3000,\s*63500\)/g;
const ADD_NPC_RE = /macro_AddMapNpc\((\d+),\s*(\d+),.*?,\s*(\d+),\s*(\d+)\)/g;
const HOME_RE = /macro_SetHomeInfo\((\d+),\s*(\d+),\s*(\d+)\)/;

function readScriptText() {
  return fs.readFileSync(SCRIPT_PATH, 'latin1');
}

function findSceneBlocks(text) {
  const matches = [...text.matchAll(TITLE_RE)];
  return matches.map((match, index) => {
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    return {
      title: match[1],
      start,
      end,
      body: text.slice(start, end),
    };
  });
}

function parseNpcLines(body) {
  const npcs = [];
  for (const match of body.matchAll(ADD_NPC_RE)) {
    npcs.push({
      id: Number(match[1]),
      typeFlags: Number(match[2]),
      x: Number(match[3]),
      y: Number(match[4]),
    });
  }
  return npcs;
}

function summarizeBlock(block) {
  const npcs = parseNpcLines(block.body);
  const home = block.body.match(HOME_RE);
  return {
    title: block.title,
    home: home ? {
      mapId: Number(home[1]),
      x: Number(home[2]),
      y: Number(home[3]),
    } : null,
    npcCount: npcs.length,
    npcs,
  };
}

function main() {
  const query = process.argv[2] || null;
  const text = readScriptText();
  const blocks = findSceneBlocks(text).map(summarizeBlock);
  const filtered = query
    ? blocks.filter((block) => block.title.toLowerCase().includes(query.toLowerCase()))
    : blocks;

  process.stdout.write(JSON.stringify(filtered, null, 2));
  process.stdout.write('\n');
}

main();
