import { tryReadStaticJsonDocument } from './db/static-json-store.js';
import { resolveRepoPath } from './runtime-paths.js';

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
  bigTexts?: Array<{
    text?: string;
    kind?: string;
  }>;
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
  npcTypeId?: number;
  name?: string;
  resolvedSpawnEntityType?: number;
  validationStatus?: string;
  x: number;
  y: number;
};

type MapNpcFile = {
  mapId: number;
  mapName: string;
  npcs: MapNpcRecord[];
};

type ManualMapNpcOverrideRecord = {
  mapId: number;
  mapName?: string;
  npcs?: MapNpcRecord[];
};

type ManualMapNpcOverrideFile = {
  mapAdditions?: ManualMapNpcOverrideRecord[];
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

type FieldCombatAnchorRecord = {
  npcId: number;
  npcTypeId: number;
  name?: string;
  x: number;
  y: number;
};

type EncounterLevelRangeRecord = {
  min: number;
  max: number;
};

const MAP_SUMMARY_PATH = resolveRepoPath('data', 'client-derived', 'maps', 'map-summary.json');
const MANUAL_MAP_NPC_OVERRIDES_PATH = resolveRepoPath('data', 'map-npc-overrides.json');
const MAP_SUMMARY = loadMapSummary();
const MANUAL_MAP_NPC_OVERRIDES = loadManualMapNpcOverrides();
const MAP_DETAILS_CACHE = new Map<string, MapDetailsRecord | null>();
const MAP_NPCS_CACHE = new Map<string, MapNpcFile | null>();

function loadMapSummary(): Map<number, MapSummaryRecord> {
  const byMapId = new Map<number, MapSummaryRecord>();
  const parsed = tryReadStaticJsonDocument<MapSummaryFile>(MAP_SUMMARY_PATH);
  if (!parsed) {
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

function loadManualMapNpcOverrides(): Map<number, ManualMapNpcOverrideRecord> {
  const byMapId = new Map<number, ManualMapNpcOverrideRecord>();
  const parsed = tryReadStaticJsonDocument<ManualMapNpcOverrideFile>(MANUAL_MAP_NPC_OVERRIDES_PATH);
  if (!parsed) {
    return byMapId;
  }

  if (!Array.isArray(parsed?.mapAdditions)) {
    return byMapId;
  }

  for (const record of parsed.mapAdditions) {
    if (!record || !Number.isInteger(record.mapId)) {
      continue;
    }
    byMapId.set(record.mapId, record);
  }

  return byMapId;
}

export function getMapSummary(mapId: number): MapSummaryRecord | null {
  if (!Number.isInteger(mapId)) {
    return null;
  }
  return MAP_SUMMARY.get(mapId) || null;
}

export function listMapSummaries(): MapSummaryRecord[] {
  return Array.from(MAP_SUMMARY.values()).sort((left, right) => left.mapId - right.mapId);
}

function loadJsonFile<T>(path: string, cache: Map<string, T | null>): T | null {
  if (!path) {
    return null;
  }
  if (cache.has(path)) {
    return cache.get(path) || null;
  }

  const parsed = tryReadStaticJsonDocument<T>(resolveRepoPath(path));
  if (parsed == null) {
    cache.set(path, null);
    return null;
  }
  cache.set(path, parsed);
  return parsed;
}

export function getMapDetails(mapId: number): MapDetailsRecord | null {
  const summary = getMapSummary(mapId);
  if (!summary?.mapDetailsPath) {
    return null;
  }
  return loadJsonFile<MapDetailsRecord>(summary.mapDetailsPath, MAP_DETAILS_CACHE);
}

export function getMapNpcs(mapId: number): MapNpcFile | null {
  const summary = getMapSummary(mapId);
  const baseNpcs =
    summary?.npcsPath
      ? loadJsonFile<MapNpcFile>(summary.npcsPath, MAP_NPCS_CACHE)
      : null;
  const manualAdditions = MANUAL_MAP_NPC_OVERRIDES.get(mapId);
  const manualNpcs = Array.isArray(manualAdditions?.npcs) ? manualAdditions!.npcs : [];

  if (manualNpcs.length < 1) {
    return baseNpcs;
  }

  const mergedNpcs = [
    ...(Array.isArray(baseNpcs?.npcs) ? baseNpcs!.npcs : []),
    ...manualNpcs.filter(
      (npc) =>
        npc &&
        Number.isInteger(npc.npcId) &&
        Number.isInteger(npc.x) &&
        Number.isInteger(npc.y)
    ),
  ];
  if (mergedNpcs.length < 1) {
    return null;
  }

  return {
    mapId,
    mapName:
      baseNpcs?.mapName ||
      manualAdditions?.mapName ||
      summary?.mapName ||
      `Map ${mapId}`,
    npcs: mergedNpcs,
  };
}

function resolveSpawnEntityType(npc: MapNpcRecord): number {
  if (typeof npc.validationStatus === 'string' && npc.validationStatus === 'alias-id-mismatch') {
    return npc.npcId & 0xffff;
  }
  if (Number.isInteger(npc.resolvedSpawnEntityType)) {
    return (npc.resolvedSpawnEntityType || npc.npcId) & 0xffff;
  }
  return npc.npcId & 0xffff;
}

export function getMapBootstrapSpawns(mapId: number): SpawnRecord[] {
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
    .map((npc, index) => ({
      // Runtime ids must be unique per live instance; npcId/entityType can repeat on the same map.
      id: (((mapId & 0xffff) << 16) | ((index + 1) & 0xffff)) >>> 0,
      entityType: resolveSpawnEntityType(npc),
      x: npc.x & 0xffff,
      y: npc.y & 0xffff,
      dir: 0,
      state: 0,
    }));
}

export function getMapConnections(mapId: number): MapConnectionRecord[] {
  const summary = getMapSummary(mapId);
  if (!summary?.connections || !Array.isArray(summary.connections)) {
    return [];
  }
  return summary.connections;
}

export function getWorldMapAdjacency(mapId: number): Array<{
  toMapName: string;
  toMapId: number | null;
  validation?: string;
  connectionType?: string;
  authority?: string;
}> {
  const summary = getMapSummary(mapId);
  return summary?.worldMap?.adjacent || [];
}

export function getMapTeleportTargets(mapId: number): TeleportTargetRecord[] {
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

export function getMapFieldCombatAnchors(mapId: number): FieldCombatAnchorRecord[] {
  const npcs = getMapNpcs(mapId);
  if (!npcs?.npcs || !Array.isArray(npcs.npcs)) {
    return [];
  }

  return npcs.npcs
    .filter(
      (npc) =>
        npc &&
        npc.npcTypeId === 1 &&
        Number.isInteger(npc.npcId) &&
        Number.isInteger(npc.x) &&
        Number.isInteger(npc.y)
    )
    .map((npc) => ({
      npcId: npc.npcId,
      npcTypeId: npc.npcTypeId || 0,
      name: npc.name || '',
      x: npc.x,
      y: npc.y,
    }));
}

export function getMapEncounterLevelRange(mapId: number): EncounterLevelRangeRecord | null {
  const details = getMapDetails(mapId);
  const ranges = new Map<string, EncounterLevelRangeRecord>();

  for (const entry of details?.bigTexts || []) {
    if (entry?.kind !== 'overlay-label' || typeof entry?.text !== 'string') {
      continue;
    }
    const match = entry.text.match(/Level:(\d+)(?:-(\d+))?/i);
    if (!match) {
      continue;
    }
    const min = Number(match[1]);
    const max = Number(match[2] || match[1]);
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      continue;
    }
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    ranges.set(`${low}:${high}`, { min: low, max: high });
  }

  if (ranges.size === 0) {
    return null;
  }
  if (ranges.size === 1) {
    return Array.from(ranges.values())[0];
  }

  let merged: EncounterLevelRangeRecord | null = null;
  for (const range of ranges.values()) {
    if (!merged) {
      merged = { ...range };
      continue;
    }
    merged.min = Math.min(merged.min, range.min);
    merged.max = Math.max(merged.max, range.max);
  }
  return merged;
}
