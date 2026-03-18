// @ts-nocheck
'use strict';
export {};

const fs = require('fs');
const path = require('path');

const { MapCellStore } = require('../src/map-cell-store');

function usage() {
  console.error('Usage: node scripts/inspect-map-scenes.js <mapId> [sceneId]');
  console.error('   or: node scripts/inspect-map-scenes.js --all [sceneId]');
  process.exit(1);
}

function collectMapScenes(map, filterSceneId) {
  const byScene = new Map();
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const cell = map.cells[(y * map.width) + x];
      if (!cell || cell.sceneId === 0 || cell.sceneId === 256 || cell.sceneId === 512 || cell.sceneId === 128) {
        continue;
      }
      if (filterSceneId !== null && cell.sceneId !== filterSceneId) {
        continue;
      }
      if (!byScene.has(cell.sceneId)) {
        byScene.set(cell.sceneId, []);
      }
      byScene.get(cell.sceneId).push({
        x,
        y,
        flags: cell.flags,
        blocked: cell.blocked,
        auxValue: cell.auxValue,
      });
    }
  }

  return byScene;
}

function printMapScenes(map, byScene) {
  if (byScene.size === 0) {
    console.log(`Map ${map.mapId}: no nontrivial scene ids found.`);
    return;
  }

  console.log(`Map ${map.mapId} (${map.width}x${map.height})`);
  for (const [sceneId, cells] of [...byScene.entries()].sort((a, b) => a[0] - b[0])) {
    const xs = cells.map((cell) => cell.x);
    const ys = cells.map((cell) => cell.y);
    const flags = [...new Set(cells.map((cell) => cell.flags))].sort((a, b) => a - b);
    const auxValues = [...new Set(cells.map((cell) => cell.auxValue))].sort((a, b) => a - b);
    console.log(
      `sceneId=${sceneId} count=${cells.length} bounds=(${Math.min(...xs)},${Math.min(...ys)})-(${Math.max(...xs)},${Math.max(...ys)}) flags=${flags.join(',')} aux=${auxValues.join(',')}`
    );
    for (const cell of cells.slice(0, 20)) {
      console.log(
        `  x=${cell.x} y=${cell.y} flags=0x${cell.flags.toString(16)} blocked=${cell.blocked ? 1 : 0} aux=${cell.auxValue}`
      );
    }
    if (cells.length > 20) {
      console.log(`  ... ${cells.length - 20} more`);
    }
  }
}

function listMapIds(clientRoot) {
  const mapDir = path.join(clientRoot, 'map');
  return fs.readdirSync(mapDir)
    .map((name) => /^(\d+)\.b$/.exec(name))
    .filter(Boolean)
    .map((match) => Number.parseInt(match[1], 10))
    .sort((a, b) => a - b);
}

function main() {
  const arg = process.argv[2];
  const filterSceneId = process.argv[3] ? Number.parseInt(process.argv[3], 10) : null;
  if (!arg) {
    usage();
  }

  const store = new MapCellStore();

  if (arg === '--all') {
    for (const mapId of listMapIds(store.clientRoot)) {
      const map = store.getMap(mapId);
      if (!map) {
        continue;
      }
      const byScene = collectMapScenes(map, filterSceneId);
      if (byScene.size === 0) {
        continue;
      }
      printMapScenes(map, byScene);
    }
    return;
  }

  const mapId = Number.parseInt(arg, 10);
  if (!Number.isInteger(mapId)) {
    usage();
  }

  const map = store.getMap(mapId);
  if (!map) {
    console.error(`Map ${mapId} not found or could not be parsed.`);
    process.exit(2);
  }

  const byScene = collectMapScenes(map, filterSceneId);
  printMapScenes(map, byScene);
}

main();
