import type { FieldEventSpawn, GameSession, ServerRunRequestData } from '../types.js';

import { DEFAULT_FLAGS } from '../config.js';
import { getMapEncounterLevelRange, getMapSummary } from '../map-data.js';
import { buildEntityRemovePacket, buildSceneSpawnBatchPacket } from '../protocol/gameplay-packets.js';
import { buildEncounterPoolEntry } from '../roleinfo/index.js';

type FieldEventSpawnPoint = {
  x: number;
  y: number;
};

type FieldEventConfig = {
  id: string;
  name: string;
  npcId: number;
  entityType?: number;
  monsterId: number;
  spawnMaps: number[];
  spawnPointsByMap: Record<number, FieldEventSpawnPoint[]>;
  formation?: Array<{ monsterId: number; row: number; col: number }>;
  interactionSubcmds?: number[];
};

type FieldEventSharedState = {
  activeMapId: number;
  activePointIndex: number;
  defeatedAt: number | null;
  respawnAt: number | null;
};

type FieldEventInteractionResult = {
  handled: boolean;
  kind?: 'combat';
  ruleId?: string;
  detail?: string;
};

type ResolvedFieldEventTarget = {
  npcId: number;
  name: string;
  x: number;
  y: number;
  resolvedSpawnEntityType: number;
  runtimeId: number;
  validationStatus: 'field-event';
};

const DEFAULT_INTERACTION_SUBCMDS = [0x02, 0x03, 0x08, 0x15];
const FIELD_EVENT_SHARED_STATE_KEY = 'fieldEvents';
const FIELD_EVENT_TIMER_MAP_KEY = 'fieldEventRespawnTimers';
const FIELD_EVENT_RESPAWN_MIN_MS = Number.isFinite(Number(process.env.FIELD_EVENT_RESPAWN_MIN_MS))
  ? Math.max(1000, Number(process.env.FIELD_EVENT_RESPAWN_MIN_MS))
  : 60_000;
const FIELD_EVENT_RESPAWN_MAX_MS = Number.isFinite(Number(process.env.FIELD_EVENT_RESPAWN_MAX_MS))
  ? Math.max(FIELD_EVENT_RESPAWN_MIN_MS, Number(process.env.FIELD_EVENT_RESPAWN_MAX_MS))
  : 180_000;
const FALL_ALLEY_EVENT_POINTS: FieldEventSpawnPoint[] = [
  { x: 109, y: 131 },
  { x: 8, y: 211 },
  { x: 6, y: 157 },
];

const FIELD_EVENT_CONFIGS: FieldEventConfig[] = [
  {
    id: 'little-piggy',
    name: 'Little Piggy',
    npcId: 3474,
    monsterId: 5170,
    spawnMaps: [105],
    spawnPointsByMap: {
      105: FALL_ALLEY_EVENT_POINTS,
    },
    formation: [
      { monsterId: 5170, row: 1, col: 2 },
      { monsterId: 5170, row: 0, col: 1 },
      { monsterId: 5170, row: 0, col: 3 },
    ],
  },
  {
    id: 'piggy-leader',
    name: 'Piggy Leader',
    npcId: 3473,
    monsterId: 5171,
    spawnMaps: [105],
    spawnPointsByMap: {
      105: FALL_ALLEY_EVENT_POINTS,
    },
    formation: [
      { monsterId: 5171, row: 1, col: 2 },
      { monsterId: 5170, row: 0, col: 1 },
      { monsterId: 5170, row: 0, col: 3 },
    ],
  },
];

function buildFieldEventRuntimeId(mapId: number, sceneIndex: number): number {
  return (((mapId & 0xffff) << 16) | (0x4000 + (sceneIndex & 0x3fff))) >>> 0;
}

function randomIntInclusive(min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + Math.floor(Math.random() * ((high - low) + 1));
}

function chooseRandomEntry<T>(values: T[]): T | null {
  if (!Array.isArray(values) || values.length < 1) {
    return null;
  }
  return values[randomIntInclusive(0, values.length - 1)] || null;
}

function getFieldEventRespawnTimers(sharedState: Record<string, any>): Map<string, NodeJS.Timeout> {
  if (!(sharedState?.[FIELD_EVENT_TIMER_MAP_KEY] instanceof Map)) {
    sharedState[FIELD_EVENT_TIMER_MAP_KEY] = new Map<string, NodeJS.Timeout>();
  }
  return sharedState[FIELD_EVENT_TIMER_MAP_KEY] as Map<string, NodeJS.Timeout>;
}

function resolveFieldEventRuntimeIdFromRequest(request: ServerRunRequestData): number {
  if (request.subcmd === 0x15) {
    const low = Number.isInteger(request.rawArgs?.[0]) ? (request.rawArgs[0] >>> 0) : 0;
    const high = Number.isInteger(request.rawArgs?.[1]) ? (request.rawArgs[1] >>> 0) : 0;
    if (low > 0 || high > 0) {
      return (((high & 0xffff) << 16) | (low & 0xffff)) >>> 0;
    }
  }

  return 0;
}

function buildConfiguredFormation(config: FieldEventConfig, levelMin: number, levelMax: number) {
  const formation = Array.isArray(config.formation) ? config.formation : [];
  return formation
    .filter(
      (entry) =>
        entry &&
        Number.isInteger(entry.monsterId) &&
        Number.isInteger(entry.row) &&
        Number.isInteger(entry.col)
    )
    .map((entry) => ({
      ...buildEncounterPoolEntry(entry.monsterId >>> 0, {
        levelMin,
        levelMax,
        weight: 1,
      }),
      row: entry.row & 0xff,
      col: entry.col & 0xff,
    }));
}

function getFieldEventRegistry(sharedState: Record<string, any>): Record<string, FieldEventSharedState> {
  if (!sharedState || typeof sharedState !== 'object') {
    return {};
  }

  const current = sharedState[FIELD_EVENT_SHARED_STATE_KEY];
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return current as Record<string, FieldEventSharedState>;
  }

  const created: Record<string, FieldEventSharedState> = {};
  sharedState[FIELD_EVENT_SHARED_STATE_KEY] = created;
  return created;
}

function getSpawnPoints(config: FieldEventConfig, mapId: number): FieldEventSpawnPoint[] {
  const points = config.spawnPointsByMap[mapId >>> 0];
  return Array.isArray(points) ? points.filter((point) => Number.isInteger(point?.x) && Number.isInteger(point?.y)) : [];
}

function chooseRandomFieldEventLocation(config: FieldEventConfig): { mapId: number; pointIndex: number } | null {
  const candidates = config.spawnMaps
    .map((mapId) => ({
      mapId: mapId >>> 0,
      points: getSpawnPoints(config, mapId),
    }))
    .filter((entry) => entry.points.length > 0);
  const mapChoice = chooseRandomEntry(candidates);
  if (!mapChoice) {
    return null;
  }
  return {
    mapId: mapChoice.mapId >>> 0,
    pointIndex: randomIntInclusive(0, mapChoice.points.length - 1),
  };
}

function ensureFieldEventState(sharedState: Record<string, any>, config: FieldEventConfig): FieldEventSharedState {
  const registry = getFieldEventRegistry(sharedState);
  const existing = registry[config.id];
  const randomLocation = chooseRandomFieldEventLocation(config);
  const fallbackMapId = randomLocation?.mapId || 0;
  const fallbackState: FieldEventSharedState = {
    activeMapId: fallbackMapId >>> 0,
    activePointIndex: randomLocation?.pointIndex || 0,
    defeatedAt: null,
    respawnAt: null,
  };

  if (!existing || typeof existing !== 'object') {
    registry[config.id] = fallbackState;
    return fallbackState;
  }

  const activeMapId = Number.isInteger(existing.activeMapId) ? (existing.activeMapId >>> 0) : fallbackMapId >>> 0;
  const spawnPoints = getSpawnPoints(config, activeMapId);
  if (spawnPoints.length < 1) {
    registry[config.id] = fallbackState;
    return fallbackState;
  }

  const activePointIndex = Number.isInteger(existing.activePointIndex)
    ? Math.max(0, Math.min(spawnPoints.length - 1, existing.activePointIndex >>> 0))
    : 0;
  const normalized: FieldEventSharedState = {
    activeMapId,
    activePointIndex,
    defeatedAt: Number.isInteger(existing.defeatedAt) ? (existing.defeatedAt as number) : null,
    respawnAt: Number.isInteger(existing.respawnAt) ? (existing.respawnAt as number) : null,
  };
  registry[config.id] = normalized;
  return normalized;
}

function findConfigByEventId(eventId: string): FieldEventConfig | null {
  return FIELD_EVENT_CONFIGS.find((config) => config.id === eventId) || null;
}

function getSessionsById(sharedState: Record<string, any>): Map<number, GameSession> {
  if (!(sharedState?.sessionsById instanceof Map)) {
    sharedState.sessionsById = new Map<number, GameSession>();
  }
  return sharedState.sessionsById as Map<number, GameSession>;
}

function logFieldEvent(sharedState: Record<string, any>, message: string): void {
  const firstSession = getSessionsById(sharedState).values().next().value as GameSession | undefined;
  if (firstSession?.log) {
    firstSession.log(message);
  }
}

function buildActiveFieldEventSpawn(config: FieldEventConfig, state: FieldEventSharedState): FieldEventSpawn | null {
  if ((state.activeMapId || 0) <= 0 || (state.defeatedAt || 0) > 0) {
    return null;
  }
  const spawnPoints = getSpawnPoints(config, state.activeMapId);
  if (spawnPoints.length < 1) {
    return null;
  }
  const pointIndex = Math.max(0, Math.min(spawnPoints.length - 1, state.activePointIndex >>> 0));
  const point = spawnPoints[pointIndex];
  const slotIndex = Math.max(1, FIELD_EVENT_CONFIGS.findIndex((entry) => entry.id === config.id) + 1);
  return {
    eventId: config.id,
    runtimeId: buildFieldEventRuntimeId(state.activeMapId, slotIndex),
    sceneIndex: (0x4000 + slotIndex) >>> 0,
    npcId: config.npcId >>> 0,
    entityType: (config.entityType || config.npcId) >>> 0,
    monsterId: config.monsterId >>> 0,
    name: config.name,
    mapId: state.activeMapId >>> 0,
    x: point.x >>> 0,
    y: point.y >>> 0,
  };
}

function activateFieldEvent(sharedState: Record<string, any>, config: FieldEventConfig): FieldEventSharedState {
  const state = ensureFieldEventState(sharedState, config);
  const randomLocation = chooseRandomFieldEventLocation(config);
  state.activeMapId = randomLocation?.mapId || 0;
  state.activePointIndex = randomLocation?.pointIndex || 0;
  state.defeatedAt = null;
  state.respawnAt = null;
  return state;
}

function broadcastFieldEventSpawn(sharedState: Record<string, any>, config: FieldEventConfig): number {
  const state = ensureFieldEventState(sharedState, config);
  const spawn = buildActiveFieldEventSpawn(config, state);
  if (!spawn) {
    return 0;
  }

  let viewers = 0;
  for (const target of getSessionsById(sharedState).values()) {
    if (!target || target.state !== 'LOGGED_IN' || target.isGame !== true) {
      continue;
    }
    if ((target.currentMapId >>> 0) !== (spawn.mapId >>> 0)) {
      continue;
    }
    target.fieldEventSpawns?.set(spawn.runtimeId >>> 0, { ...spawn });
    target.writePacket(
      buildSceneSpawnBatchPacket([{
        id: spawn.runtimeId,
        entityType: spawn.entityType,
        x: spawn.x,
        y: spawn.y,
        dir: 0,
        state: 0,
      }]),
      DEFAULT_FLAGS,
      `Spawning field event event=${config.id} runtimeId=0x${(spawn.runtimeId >>> 0).toString(16)} map=${spawn.mapId} pos=${spawn.x},${spawn.y}`
    );
    viewers += 1;
  }
  return viewers;
}

function scheduleFieldEventRespawn(sharedState: Record<string, any>, config: FieldEventConfig): number {
  const timers = getFieldEventRespawnTimers(sharedState);
  const existing = timers.get(config.id);
  if (existing) {
    clearTimeout(existing);
    timers.delete(config.id);
  }

  const delayMs = randomIntInclusive(FIELD_EVENT_RESPAWN_MIN_MS, FIELD_EVENT_RESPAWN_MAX_MS);
  const state = ensureFieldEventState(sharedState, config);
  const respawnAt = Date.now() + delayMs;
  state.respawnAt = respawnAt;
  const timer = setTimeout(() => {
    timers.delete(config.id);
    const current = ensureFieldEventState(sharedState, config);
    if ((current.respawnAt || 0) !== respawnAt || (current.defeatedAt || 0) <= 0) {
      return;
    }
    activateFieldEvent(sharedState, config);
    const viewers = broadcastFieldEventSpawn(sharedState, config);
    const activeState = ensureFieldEventState(sharedState, config);
    logFieldEvent(
      sharedState,
      `Field event respawned event=${config.id} map=${activeState.activeMapId} pointIndex=${activeState.activePointIndex} viewers=${viewers}`
    );
  }, delayMs);
  timers.set(config.id, timer);
  return delayMs;
}

function findSpawnByNpcKey(session: GameSession, npcKey: number): FieldEventSpawn | null {
  if (npcKey <= 0) {
    return null;
  }
  const spawns = Array.from(session.fieldEventSpawns?.values() || []);
  return spawns.find((spawn) =>
    (spawn.npcId >>> 0) === (npcKey >>> 0) ||
    (spawn.entityType >>> 0) === (npcKey >>> 0) ||
    (spawn.runtimeId >>> 0) === (npcKey >>> 0)
  ) || null;
}

function toResolvedFieldEventTarget(spawn: FieldEventSpawn): ResolvedFieldEventTarget {
  return {
    npcId: spawn.npcId >>> 0,
    name: spawn.name,
    x: spawn.x >>> 0,
    y: spawn.y >>> 0,
    resolvedSpawnEntityType: spawn.entityType >>> 0,
    runtimeId: spawn.runtimeId >>> 0,
    validationStatus: 'field-event',
  };
}

export function buildMapFieldEventSpawns(
  sharedState: Record<string, any>,
  mapId: number,
  baseCount = 0
): FieldEventSpawn[] {
  void baseCount;
  const result: FieldEventSpawn[] = [];
  for (const config of FIELD_EVENT_CONFIGS) {
    const state = ensureFieldEventState(sharedState, config);
    const spawn = buildActiveFieldEventSpawn(config, state);
    if (!spawn || (spawn.mapId >>> 0) !== (mapId >>> 0)) {
      continue;
    }
    result.push(spawn);
  }
  return result;
}

export function resolveFieldEventInteractionTarget(
  session: GameSession,
  request: ServerRunRequestData
): ResolvedFieldEventTarget | null {
  const spawns = Array.from(session.fieldEventSpawns?.values() || []);
  if (spawns.length < 1) {
    return null;
  }

  if (request.subcmd === 0x08) {
    const sceneIndex = Number.isInteger(request.rawArgs?.[0]) ? (request.rawArgs[0] >>> 0) : 0;
    const bySceneIndex = spawns.find((spawn) => (spawn.sceneIndex >>> 0) === sceneIndex);
    return bySceneIndex ? toResolvedFieldEventTarget(bySceneIndex) : null;
  }

  const runtimeId = resolveFieldEventRuntimeIdFromRequest(request);
  if (runtimeId > 0) {
    const byRuntimeId = spawns.find((spawn) => (spawn.runtimeId >>> 0) === runtimeId);
    return byRuntimeId ? toResolvedFieldEventTarget(byRuntimeId) : null;
  }

  const npcKey =
    Number.isInteger(request.npcId)
      ? (request.npcId! >>> 0)
      : Number.isInteger(request.rawArgs?.[0])
        ? (request.rawArgs[0] >>> 0)
        : 0;
  const byNpcKey = findSpawnByNpcKey(session, npcKey);
  return byNpcKey ? toResolvedFieldEventTarget(byNpcKey) : null;
}

export function tryHandleFieldEventInteraction(
  session: GameSession,
  npcId: number,
  request: ServerRunRequestData
): FieldEventInteractionResult {
  const spawn = findSpawnByNpcKey(session, npcId);
  if (!spawn) {
    return { handled: false };
  }

  const config = findConfigByEventId(spawn.eventId);
  if (!config) {
    return { handled: false };
  }

  const allowedSubcmds = Array.isArray(config.interactionSubcmds) && config.interactionSubcmds.length > 0
    ? config.interactionSubcmds
    : DEFAULT_INTERACTION_SUBCMDS;
  if (!allowedSubcmds.some((subcmd) => (subcmd >>> 0) === (request.subcmd >>> 0))) {
    return { handled: false };
  }
  if (typeof session.sendCombatEncounterProbe !== 'function' || session.combatState?.active) {
    return { handled: false };
  }

  const encounterLevelRange = getMapEncounterLevelRange(session.currentMapId);
  const mapName = getMapSummary(session.currentMapId)?.mapName || `Map ${session.currentMapId}`;
  const levelMin = encounterLevelRange?.min || 1;
  const levelMax = encounterLevelRange?.max || levelMin;
  const fixedEnemies = buildConfiguredFormation(config, levelMin, levelMax);
  session.sendCombatEncounterProbe({
    probeId: `field-event:${spawn.eventId}:${spawn.runtimeId}:${Date.now()}`,
    fieldEventId: spawn.eventId,
    fieldEventRuntimeId: spawn.runtimeId >>> 0,
    originMapId: session.currentMapId >>> 0,
    originX: session.currentX >>> 0,
    originY: session.currentY >>> 0,
    encounterProfile: {
      minEnemies: Math.max(1, fixedEnemies.length || 1),
      maxEnemies: Math.max(1, fixedEnemies.length || 1),
      locationName: mapName,
      fixedEnemies: fixedEnemies.length > 0 ? fixedEnemies : undefined,
      pool: [
        buildEncounterPoolEntry(spawn.monsterId, {
          levelMin,
          levelMax,
          weight: 1,
        }),
      ],
    },
  });

  return {
    handled: true,
    kind: 'combat',
    ruleId: config.id,
    detail: `monsterId=${spawn.monsterId >>> 0} runtimeId=0x${(spawn.runtimeId >>> 0).toString(16)}`,
  };
}

export function handleActiveFieldEventVictory(
  session: GameSession,
  encounterAction: Record<string, unknown> | null
): boolean {
  const eventId = typeof encounterAction?.fieldEventId === 'string' ? encounterAction.fieldEventId : '';
  if (!eventId) {
    return false;
  }

  const config = findConfigByEventId(eventId);
  if (!config) {
    return false;
  }

  const state = ensureFieldEventState(session.sharedState, config);
  state.defeatedAt = Date.now();
  state.respawnAt = null;

  const rawRuntimeId = encounterAction?.fieldEventRuntimeId;
  const runtimeId = Number.isInteger(rawRuntimeId)
    ? ((rawRuntimeId as number) >>> 0)
    : 0;
  let removedSessions = 0;
  for (const target of getSessionsById(session.sharedState).values()) {
    if (!target || target.state !== 'LOGGED_IN' || target.isGame !== true) {
      continue;
    }
    if ((target.currentMapId >>> 0) !== (session.currentMapId >>> 0)) {
      continue;
    }

    const matchingSpawns = Array.from(target.fieldEventSpawns?.values() || []).filter(
      (spawn) => spawn.eventId === eventId
    );
    for (const spawn of matchingSpawns) {
      target.fieldEventSpawns?.delete(spawn.runtimeId >>> 0);
      target.writePacket(
        buildEntityRemovePacket(spawn.runtimeId >>> 0),
        DEFAULT_FLAGS,
        `Removing field event spawn event=${eventId} runtimeId=0x${(spawn.runtimeId >>> 0).toString(16)} map=${target.currentMapId}`
      );
    }
    if (matchingSpawns.length > 0) {
      removedSessions += 1;
    }
  }

  if (runtimeId > 0 && removedSessions < 1) {
    session.fieldEventSpawns?.delete(runtimeId);
    session.writePacket(
      buildEntityRemovePacket(runtimeId),
      DEFAULT_FLAGS,
      `Removing field event spawn event=${eventId} runtimeId=0x${runtimeId.toString(16)} map=${session.currentMapId}`
    );
  }

  const delayMs = scheduleFieldEventRespawn(session.sharedState, config);
  session.log(
    `Field event defeated event=${eventId} map=${state.activeMapId} pointIndex=${state.activePointIndex} viewers=${removedSessions} respawnDelayMs=${delayMs}`
  );
  return true;
}
