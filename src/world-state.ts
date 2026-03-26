import type { GameSession } from './types.js';

import { DEFAULT_FLAGS } from './config.js';
import { buildEntityHidePacket } from './combat/packets.js';
import { buildSceneSpawnBatchPacket } from './protocol/gameplay-packets.js';

export interface WorldPlayerPresence {
  runtimeId: number;
  sessionId: number;
  accountName: string | null;
  charName: string;
  roleEntityType: number;
  mapId: number;
  x: number;
  y: number;
  dir: number;
  state: number;
  session: GameSession;
}

export interface WorldState {
  nextRuntimeId: number;
  playersBySessionId: Map<number, WorldPlayerPresence>;
  playersByRuntimeId: Map<number, WorldPlayerPresence>;
  mapOccupancy: Map<number, Set<number>>;
  sessionIdByAccountName: Map<string, number>;
}

const PLAYER_VISIBILITY_RADIUS = Number.isFinite(Number(process.env.PLAYER_VISIBILITY_RADIUS))
  ? Math.max(8, Number(process.env.PLAYER_VISIBILITY_RADIUS) | 0)
  : 40;
const WORLD_RUNTIME_ID_BASE = 0x5000;
const WORLD_RUNTIME_ID_LIMIT = 0xffef;

export function createWorldState(): WorldState {
  return {
    nextRuntimeId: WORLD_RUNTIME_ID_BASE,
    playersBySessionId: new Map(),
    playersByRuntimeId: new Map(),
    mapOccupancy: new Map(),
    sessionIdByAccountName: new Map(),
  };
}

function getWorldState(sharedState: Record<string, any>): WorldState {
  if (!(sharedState?.worldState instanceof Object)) {
    sharedState.worldState = createWorldState();
  }
  return sharedState.worldState as WorldState;
}

function normalizeAccountName(accountName: string | null | undefined): string {
  return typeof accountName === 'string' ? accountName.trim() : '';
}

function hashAccountName(accountName: string): number {
  let hash = 5381;
  for (let index = 0; index < accountName.length; index += 1) {
    hash = ((hash << 5) + hash + accountName.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
}

function allocateRuntimeId(world: WorldState, accountName: string | null): number {
  const normalizedAccountName = normalizeAccountName(accountName);
  const usableRange = WORLD_RUNTIME_ID_LIMIT - WORLD_RUNTIME_ID_BASE + 1;
  const preferredStart = normalizedAccountName
    ? WORLD_RUNTIME_ID_BASE + (hashAccountName(normalizedAccountName) % usableRange)
    : world.nextRuntimeId >>> 0;
  const start = preferredStart >>> 0;
  let candidate = start;

  while (world.playersByRuntimeId.has(candidate >>> 0)) {
    const occupant = world.playersByRuntimeId.get(candidate >>> 0) || null;
    if (occupant && normalizeAccountName(occupant.accountName) === normalizedAccountName) {
      return candidate >>> 0;
    }
    candidate += 1;
    if (candidate > WORLD_RUNTIME_ID_LIMIT) {
      candidate = WORLD_RUNTIME_ID_BASE;
    }
    if ((candidate >>> 0) === (start >>> 0)) {
      throw new Error('World runtime id pool exhausted');
    }
  }

  world.nextRuntimeId = candidate + 1;
  if (world.nextRuntimeId > WORLD_RUNTIME_ID_LIMIT) {
    world.nextRuntimeId = WORLD_RUNTIME_ID_BASE;
  }
  return candidate >>> 0;
}

export function hasActiveWorldAccount(
  sharedState: Record<string, any>,
  accountName: string | null,
  excludeSessionId: number | null = null
): boolean {
  const normalizedAccountName = normalizeAccountName(accountName);
  if (!normalizedAccountName) {
    return false;
  }
  const world = getWorldState(sharedState);
  const sessionId = world.sessionIdByAccountName.get(normalizedAccountName);
  if (!Number.isInteger(sessionId)) {
    return false;
  }
  const normalizedSessionId = Number(sessionId) >>> 0;
  return excludeSessionId === null || normalizedSessionId !== (excludeSessionId >>> 0);
}

function getOrCreateMapOccupancy(world: WorldState, mapId: number): Set<number> {
  const normalizedMapId = mapId >>> 0;
  let occupancy = world.mapOccupancy.get(normalizedMapId);
  if (!occupancy) {
    occupancy = new Set<number>();
    world.mapOccupancy.set(normalizedMapId, occupancy);
  }
  return occupancy;
}

function removeFromMapOccupancy(world: WorldState, mapId: number, runtimeId: number): void {
  const occupancy = world.mapOccupancy.get(mapId >>> 0);
  if (!occupancy) {
    return;
  }
  occupancy.delete(runtimeId >>> 0);
  if (occupancy.size === 0) {
    world.mapOccupancy.delete(mapId >>> 0);
  }
}

function toSpawnRecord(presence: WorldPlayerPresence): {
  id: number;
  entityType: number;
  x: number;
  y: number;
  dir: number;
  state: number;
} {
  return {
    id: presence.runtimeId >>> 0,
    entityType: presence.roleEntityType >>> 0,
    x: presence.x >>> 0,
    y: presence.y >>> 0,
    dir: presence.dir >>> 0,
    state: presence.state >>> 0,
  };
}

function sendPresenceSpawn(targetSession: GameSession, presences: WorldPlayerPresence[], reason: string): void {
  if (!Array.isArray(presences) || presences.length === 0) {
    return;
  }
  targetSession.writePacket(
    buildSceneSpawnBatchPacket(presences.map(toSpawnRecord)),
    DEFAULT_FLAGS,
    `Sending player spawn sync reason=${reason} count=${presences.length}`
  );
}

function sendPresenceHide(targetSession: GameSession, runtimeId: number, reason: string): void {
  targetSession.writePacket(
    buildEntityHidePacket(runtimeId >>> 0),
    DEFAULT_FLAGS,
    `Sending player hide sync reason=${reason} runtimeId=${runtimeId >>> 0}`
  );
}

function shouldSessionsSeeEachOther(
  a: WorldPlayerPresence,
  b: WorldPlayerPresence,
  radius = PLAYER_VISIBILITY_RADIUS
): boolean {
  if ((a.mapId >>> 0) !== (b.mapId >>> 0)) {
    return false;
  }
  const dx = Math.abs((a.x >>> 0) - (b.x >>> 0));
  const dy = Math.abs((a.y >>> 0) - (b.y >>> 0));
  return dx <= radius && dy <= radius;
}

function updatePresenceFromSession(presence: WorldPlayerPresence, session: GameSession): void {
  presence.accountName = session.accountKey || session.accountName;
  presence.charName = session.charName;
  presence.roleEntityType = session.roleEntityType >>> 0;
  presence.mapId = session.currentMapId >>> 0;
  presence.x = session.currentX >>> 0;
  presence.y = session.currentY >>> 0;
  presence.session = session;
}

export function ensureWorldPresence(session: GameSession): WorldPlayerPresence {
  const world = getWorldState(session.sharedState);
  const normalizedAccountName = normalizeAccountName(session.accountKey || session.accountName);
  const existing = world.playersBySessionId.get(session.id);
  if (existing) {
    const previousMapId = existing.mapId >>> 0;
    updatePresenceFromSession(existing, session);
    if ((previousMapId >>> 0) !== (existing.mapId >>> 0)) {
      removeFromMapOccupancy(world, previousMapId, existing.runtimeId);
    }
    getOrCreateMapOccupancy(world, existing.mapId).add(existing.runtimeId);
    session.runtimeId = existing.runtimeId >>> 0;
    session.worldRegistered = true;
    return existing;
  }

  if (
    normalizedAccountName &&
    hasActiveWorldAccount(session.sharedState, normalizedAccountName, session.id)
  ) {
    throw new Error(`Account already active in world: ${normalizedAccountName}`);
  }

  const runtimeId = allocateRuntimeId(world, normalizedAccountName);
  const presence: WorldPlayerPresence = {
    runtimeId,
    sessionId: session.id,
    accountName: session.accountKey || session.accountName,
    charName: session.charName,
    roleEntityType: session.roleEntityType >>> 0,
    mapId: session.currentMapId >>> 0,
    x: session.currentX >>> 0,
    y: session.currentY >>> 0,
    dir: 0,
    state: 0,
    session,
  };

  world.playersBySessionId.set(session.id, presence);
  world.playersByRuntimeId.set(runtimeId, presence);
  getOrCreateMapOccupancy(world, presence.mapId).add(runtimeId);
  if (normalizedAccountName) {
    world.sessionIdByAccountName.set(normalizedAccountName, session.id >>> 0);
  }
  session.runtimeId = runtimeId >>> 0;
  session.worldRegistered = true;
  return presence;
}

export function syncWorldPresence(session: GameSession, reason: string): void {
  const world = getWorldState(session.sharedState);
  const source = ensureWorldPresence(session);
  updatePresenceFromSession(source, session);

  for (const visibleRuntimeId of [...session.visiblePlayerRuntimeIds]) {
    if ((visibleRuntimeId >>> 0) === (source.runtimeId >>> 0)) {
      session.visiblePlayerRuntimeIds.delete(visibleRuntimeId >>> 0);
      continue;
    }
    if (!world.playersByRuntimeId.has(visibleRuntimeId >>> 0)) {
      session.visiblePlayerRuntimeIds.delete(visibleRuntimeId >>> 0);
    }
  }

  const mapOccupancy = world.mapOccupancy.get(source.mapId >>> 0) || new Set<number>();
  const candidateIds = new Set<number>([
    ...mapOccupancy.values(),
    ...session.visiblePlayerRuntimeIds.values(),
  ]);
  candidateIds.delete(source.runtimeId >>> 0);

  for (const runtimeId of candidateIds) {
    const other = world.playersByRuntimeId.get(runtimeId >>> 0);
    if (!other || other.session.id === session.id) {
      session.visiblePlayerRuntimeIds.delete(runtimeId >>> 0);
      continue;
    }

    const sourceSeesOther = session.visiblePlayerRuntimeIds.has(runtimeId >>> 0);
    const otherSeesSource = other.session.visiblePlayerRuntimeIds.has(source.runtimeId >>> 0);
    const shouldSee = shouldSessionsSeeEachOther(source, other);

    if (shouldSee) {
      if (!sourceSeesOther) {
        sendPresenceSpawn(session, [other], `${reason}:viewer-add`);
        session.visiblePlayerRuntimeIds.add(runtimeId >>> 0);
      }

      if (!otherSeesSource) {
        sendPresenceSpawn(other.session, [source], `${reason}:peer-add`);
        other.session.visiblePlayerRuntimeIds.add(source.runtimeId >>> 0);
      } else {
        sendPresenceSpawn(other.session, [source], `${reason}:peer-update`);
      }
      continue;
    }

    if (sourceSeesOther) {
      sendPresenceHide(session, other.runtimeId, `${reason}:viewer-remove`);
      session.visiblePlayerRuntimeIds.delete(other.runtimeId >>> 0);
    }
    if (otherSeesSource) {
      sendPresenceHide(other.session, source.runtimeId, `${reason}:peer-remove`);
      other.session.visiblePlayerRuntimeIds.delete(source.runtimeId >>> 0);
    }
  }
}

export function removeWorldPresence(session: GameSession, reason: string): void {
  const world = getWorldState(session.sharedState);
  const presence = world.playersBySessionId.get(session.id);
  if (!presence) {
    session.worldRegistered = false;
    session.visiblePlayerRuntimeIds.clear();
    return;
  }

  for (const other of world.playersByRuntimeId.values()) {
    if ((other.runtimeId >>> 0) === (presence.runtimeId >>> 0)) {
      continue;
    }
    if (!other) {
      continue;
    }
    if (other.session.visiblePlayerRuntimeIds.has(presence.runtimeId >>> 0)) {
      sendPresenceHide(other.session, presence.runtimeId, `${reason}:disconnect`);
      other.session.visiblePlayerRuntimeIds.delete(presence.runtimeId >>> 0);
    }
  }

  removeFromMapOccupancy(world, presence.mapId, presence.runtimeId);
  world.playersBySessionId.delete(session.id);
  world.playersByRuntimeId.delete(presence.runtimeId);
  const normalizedAccountName = normalizeAccountName(presence.accountName);
  const mappedSessionId = normalizedAccountName
    ? world.sessionIdByAccountName.get(normalizedAccountName)
    : undefined;
  if (
    normalizedAccountName &&
    Number.isInteger(mappedSessionId) &&
    (Number(mappedSessionId) >>> 0) === (session.id >>> 0)
  ) {
    world.sessionIdByAccountName.delete(normalizedAccountName);
  }
  session.visiblePlayerRuntimeIds.clear();
  session.worldRegistered = false;
}
