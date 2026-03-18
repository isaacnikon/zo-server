'use strict';
export {};

const fs = require('fs');
const path = require('path');
const { resolveRepoPath } = require('./runtime-paths');

const { MAP_CLIENT_ROOT } = require('./config');

const DEFAULT_CLIENT_ROOT = resolveRepoPath('data', 'client');
type MapCell = {
  flags: number;
  blocked: boolean;
  sceneId: number;
  auxValue: number;
};
type ParsedMap = {
  mapId: number;
  width: number;
  height: number;
  cells: MapCell[];
};

class MapCellStore {
  clientRoot: string;
  cache: Map<number, ParsedMap | null>;

  constructor(options: { clientRoot?: string } = {}) {
    this.clientRoot = path.resolve(options.clientRoot || MAP_CLIENT_ROOT || DEFAULT_CLIENT_ROOT);
    this.cache = new Map();
  }

  getMap(mapId: number): ParsedMap | null {
    if (!Number.isInteger(mapId) || mapId <= 0) {
      return null;
    }

    if (this.cache.has(mapId)) {
      return this.cache.get(mapId) ?? null;
    }

    const parsed = this.loadMap(mapId);
    this.cache.set(mapId, parsed);
    return parsed;
  }

  getCell(mapId: number, x: number, y: number): MapCell | null {
    const map = this.getMap(mapId);
    if (!map) {
      return null;
    }
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
      return null;
    }

    return map.cells[(y * map.width) + x] || null;
  }

  loadMap(mapId: number): ParsedMap | null {
    const filePath = path.join(this.clientRoot, 'map', `${mapId}.b`);
    let data;
    try {
      data = fs.readFileSync(filePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }

    if (data.length < 6) {
      return null;
    }

    const width = data.readUInt16LE(2);
    const height = data.readUInt16LE(4);
    const cellCount = width * height;
    const expectedLength = 6 + (cellCount * 6);
    if (width <= 0 || height <= 0 || data.length < expectedLength) {
      return null;
    }

    const cells = new Array<MapCell>(cellCount);
    let offset = 6;
    for (let i = 0; i < cellCount; i += 1) {
      const flags = data.readUInt16LE(offset);
      const sceneId = data.readUInt16LE(offset + 2);
      const auxValue = data.readUInt16LE(offset + 4);
      cells[i] = {
        flags,
        blocked: (flags & 0x0001) !== 0,
        sceneId,
        auxValue,
      };
      offset += 6;
    }

    return {
      mapId,
      width,
      height,
      cells,
    };
  }
}

module.exports = {
  MapCellStore,
};
