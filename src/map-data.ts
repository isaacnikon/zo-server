import fs from 'fs';

const { resolveRepoPath } = require('./runtime-paths');

type MapConnectionRecord = {
  fromMapName: string;
  fromMapId: number | null;
  toMapName: string;
  toMapId: number | null;
  connectionType?: string;
  validation?: string;
  authority?: string;
};

type PortalEffectCandidateRecord = {
  x: number;
  y: number;
  assetName?: string;
  kind?: string;
  nearestTransition?: {
    target?: {
      mapId?: number | null;
      mapName?: string | null;
      x?: number | null;
      y?: number | null;
    };
  } | null;
};

type MapDetailsRecord = {
  mapId: number;
  mapName: string;
  homeInfo?: {
    mapId: number;
    x: number;
    y: number;
  } | null;
  sceneTransitions?: Array<{
    target?: {
      mapId?: number | null;
      mapName?: string | null;
      x?: number | null;
      y?: number | null;
    };
  }>;
  mapConfig?: {
    portalEffectCandidates?: PortalEffectCandidateRecord[];
  } | null;
};

type MapNpcRecord = {
  npcId: number;
  name?: string;
  resolvedSpawnEntityType?: number;
  x: number;
  y: number;
};

type MapNpcFile = {
  mapId: number;
  mapName: string;
  npcs: MapNpcRecord[];
};

type MapSummaryWorldRecord = {
  nodeId: number;
  nodeName: string;
  nodeKind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  adjacent: Array<{
    toMapName: string;
    toMapId: number | null;
    validation?: string;
    connectionType?: string;
    authority?: string;
  }>;
} | null;

type MapSummaryRecord = {
  mapId: number;
  mapName: string;
  mapDetailsPath?: string | null;
  npcsPath?: string | null;
  worldMap?: MapSummaryWorldRecord;
  connections?: MapConnectionRecord[];
};

type MapSummaryFile = {
  maps: MapSummaryRecord[];
};

type SpawnRecord = {
  id: number;
  entityType: number;
  x: number;
  y: number;
  dir: number;
  state: number;
};

type TeleportTargetRecord = {
  mapId: number | null;
  mapName: string | null;
  x: number | null;
  y: number | null;
  source: 'scene-transition' | 'portal-effect-candidate' | 'worldmap-connection';
};

const MAP_SUMMARY_PATH = resolveRepoPath('data', 'client-derived', 'maps', 'map-summary.json');
const MAP_SUMMARY = loadMapSummary();
const MAP_DETAILS_CACHE = new Map<string, MapDetailsRecord | null>();
const MAP_NPCS_CACHE = new Map<string, MapNpcFile | null>();

function loadMapSummary(): Map<number, MapSummaryRecord> {
  const byMapId = new Map<number, MapSummaryRecord>();
  if (!fs.existsSync(MAP_SUMMARY_PATH)) {
    return byMapId;
  }

  let parsed: MapSummaryFile;
  try {
    parsed = JSON.parse(fs.readFileSync(MAP_SUMMARY_PATH, 'utf8'));
  } catch (_error) {
    return byMapId;
  }

  if (!Array.isArray(parsed?.maps)) {
    return byMapId;
  }

  for (const record of parsed.maps) {
    if (!record || !Number.isInteger(record.mapId)) {
      continue;
    }
    byMapId.set(record.mapId, record);
  }
  return byMapId;
}

function getMapSummary(mapId: number): MapSummaryRecord | null {
  if (!Number.isInteger(mapId)) {
    return null;
  }
  return MAP_SUMMARY.get(mapId) || null;
}

function listMapSummaries(): MapSummaryRecord[] {
  return Array.from(MAP_SUMMARY.values()).sort((left, right) => left.mapId - right.mapId);
}

function loadJsonFile<T>(path: string, cache: Map<string, T | null>): T | null {
  if (!path) {
    return null;
  }
  if (cache.has(path)) {
    return cache.get(path) || null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(resolveRepoPath(path), 'utf8')) as T;
    cache.set(path, parsed);
    return parsed;
  } catch (_error) {
    cache.set(path, null);
    return null;
  }
}

function getMapDetails(mapId: number): MapDetailsRecord | null {
  const summary = getMapSummary(mapId);
  if (!summary?.mapDetailsPath) {
    return null;
  }
  return loadJsonFile<MapDetailsRecord>(summary.mapDetailsPath, MAP_DETAILS_CACHE);
}

function getMapNpcs(mapId: number): MapNpcFile | null {
  const summary = getMapSummary(mapId);
  if (!summary?.npcsPath) {
    return null;
  }
  return loadJsonFile<MapNpcFile>(summary.npcsPath, MAP_NPCS_CACHE);
}

function resolveSpawnEntityType(npc: MapNpcRecord): number {
  if (Number.isInteger(npc.resolvedSpawnEntityType)) {
    return (npc.resolvedSpawnEntityType || npc.npcId) & 0xffff;
  }
  return npc.npcId & 0xffff;
}

function getMapBootstrapSpawns(mapId: number): SpawnRecord[] {
  const npcs = getMapNpcs(mapId);
  if (!npcs?.npcs || !Array.isArray(npcs.npcs)) {
    return [];
  }

  return npcs.npcs
    .filter(
      (npc) =>
        npc &&
        Number.isInteger(npc.npcId) &&
        Number.isInteger(npc.x) &&
        Number.isInteger(npc.y)
    )
    .map((npc) => ({
      id: (((mapId & 0xffff) << 16) | (npc.npcId & 0xffff)) >>> 0,
      entityType: resolveSpawnEntityType(npc),
      x: npc.x & 0xffff,
      y: npc.y & 0xffff,
      dir: 0,
      state: 0,
    }));
}

function getMapConnections(mapId: number): MapConnectionRecord[] {
  const summary = getMapSummary(mapId);
  if (!summary?.connections || !Array.isArray(summary.connections)) {
    return [];
  }
  return summary.connections;
}

function getWorldMapAdjacency(mapId: number): Array<{
  toMapName: string;
  toMapId: number | null;
  validation?: string;
  connectionType?: string;
  authority?: string;
}> {
  const summary = getMapSummary(mapId);
  return summary?.worldMap?.adjacent || [];
}

function getMapTeleportTargets(mapId: number): TeleportTargetRecord[] {
  const details = getMapDetails(mapId);
  const summary = getMapSummary(mapId);
  const targets = new Map<string, TeleportTargetRecord>();

  for (const transition of details?.sceneTransitions || []) {
    const target = transition?.target;
    if (!target) {
      continue;
    }
    const key = `scene:${target.mapId ?? 'null'}:${target.x ?? 'null'}:${target.y ?? 'null'}`;
    targets.set(key, {
      mapId: Number.isInteger(target.mapId) ? target.mapId || null : null,
      mapName: target.mapName || null,
      x: Number.isInteger(target.x) ? target.x || null : null,
      y: Number.isInteger(target.y) ? target.y || null : null,
      source: 'scene-transition',
    });
  }

  for (const candidate of details?.mapConfig?.portalEffectCandidates || []) {
    const target = candidate?.nearestTransition?.target;
    if (!target) {
      continue;
    }
    const key = `portal:${target.mapId ?? 'null'}:${target.x ?? 'null'}:${target.y ?? 'null'}`;
    targets.set(key, {
      mapId: Number.isInteger(target.mapId) ? target.mapId || null : null,
      mapName: target.mapName || null,
      x: Number.isInteger(target.x) ? target.x || null : null,
      y: Number.isInteger(target.y) ? target.y || null : null,
      source: 'portal-effect-candidate',
    });
  }

  for (const adjacent of summary?.worldMap?.adjacent || []) {
    const key = `world:${adjacent.toMapId ?? 'null'}:${adjacent.toMapName}`;
    targets.set(key, {
      mapId: Number.isInteger(adjacent.toMapId) ? adjacent.toMapId || null : null,
      mapName: adjacent.toMapName || null,
      x: null,
      y: null,
      source: 'worldmap-connection',
    });
  }

  return Array.from(targets.values());
}

module.exports = {
  listMapSummaries,
  getMapSummary,
  getMapDetails,
  getMapNpcs,
  getMapBootstrapSpawns,
  getMapConnections,
  getWorldMapAdjacency,
  getMapTeleportTargets,
};
