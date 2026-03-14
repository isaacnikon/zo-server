'use strict';

const { MapCellStore } = require('../src/map-cell-store');

function usage() {
  console.error('Usage: node scripts/inspect-map-scenes.js <mapId> [sceneId]');
  process.exit(1);
}

function main() {
  const mapId = Number.parseInt(process.argv[2], 10);
  const filterSceneId = process.argv[3] ? Number.parseInt(process.argv[3], 10) : null;
  if (!Number.isInteger(mapId)) {
    usage();
  }

  const store = new MapCellStore();
  const map = store.getMap(mapId);
  if (!map) {
    console.error(`Map ${mapId} not found or could not be parsed.`);
    process.exit(2);
  }

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

  if (byScene.size === 0) {
    console.log(`Map ${mapId}: no nontrivial scene ids found.`);
    return;
  }

  console.log(`Map ${mapId} (${map.width}x${map.height})`);
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

main();
