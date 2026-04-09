import type { GameSession } from './types.js';

import { DEFAULT_FLAGS } from './config.js';
import { removeRuntimeOnlinePlayer, upsertRuntimeOnlinePlayer } from './db/runtime-online-store.js';
import {
  buildEntityRemovePacket,
  buildEntityPositionSyncPacket,
  buildEntityWalkSyncPacket,
  buildSceneSpawnBatchPacket,
} from './protocol/gameplay-packets.js';
import { isLiveWorldSession, isWorldSession } from './session-role.js';

export interface WorldPlayerPresence {
  runtimeId: number;
  sessionId: number;
  accountName: string | null;
  charName: string;
  entityType: number;
  roleEntityType: number;
  roleData: number;
  level: number;
  selectedAptitude: number;
  mapId: number;
  x: number;
  y: number;
  dir: number;
  state: number;
  session: GameSession;
}

interface WorldPetPresence {
  runtimeId: number;
  ownerRuntimeId: number;
  entityType: number;
  x: number;
  y: number;
  dir: number;
  state: number;
}

interface WorldPresenceWalkState {
  flags: number;
  linkedRuntimeId: number;
  teamStatus: number;
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
const PLAYER_MOVE_SMOOTH_DISTANCE_LIMIT = 12;
const WORLD_RUNTIME_ID_BASE = 0x5000;
const WORLD_RUNTIME_ID_LIMIT = 0xffef;
const WORLD_SESSION_STALE_TIMEOUT_MS = Number.isFinite(Number(process.env.ONLINE_HEARTBEAT_TIMEOUT_MS))
  ? Math.max(5000, Number(process.env.ONLINE_HEARTBEAT_TIMEOUT_MS) | 0)
  : 65000;

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
  pruneStaleWorldSessionForAccount(sharedState, normalizedAccountName, excludeSessionId);
  const world = getWorldState(sharedState);
  const sessionId = world.sessionIdByAccountName.get(normalizedAccountName);
  if (!Number.isInteger(sessionId)) {
    return false;
  }
  const normalizedSessionId = Number(sessionId) >>> 0;
  return excludeSessionId === null || normalizedSessionId !== (excludeSessionId >>> 0);
}

export function replaceExistingWorldSessionsForRemote(
  sharedState: Record<string, any>,
  remoteAddress: string | null,
  excludeSessionId: number
): number {
  const normalizedRemoteAddress = typeof remoteAddress === 'string' ? remoteAddress.trim() : '';
  if (!normalizedRemoteAddress) {
    return 0;
  }

  const sessionsById =
    sharedState?.sessionsById instanceof Map ? sharedState.sessionsById as Map<number, GameSession> : null;
  if (!sessionsById) {
    return 0;
  }

  let replacedCount = 0;
  for (const candidate of sessionsById.values()) {
    if (!candidate || (candidate.id >>> 0) === (excludeSessionId >>> 0)) {
      continue;
    }
    if ((candidate.remoteAddress || '').trim() !== normalizedRemoteAddress) {
      continue;
    }
    if (!isLiveWorldSession(candidate)) {
      continue;
    }
    candidate.log(`Replacing live world session due to new login from remote=${normalizedRemoteAddress}`);
    removeWorldPresence(candidate, 'replaced-live-session');
    if (!candidate.socket.destroyed) {
      candidate.socket.destroy();
    }
    replacedCount += 1;
  }
  return replacedCount;
}

function resolveSessionLastSeenAt(session: GameSession): number {
  const lastHeartbeatAt = Number.isFinite(Number(session.lastHeartbeatAt))
    ? Math.max(0, Number(session.lastHeartbeatAt))
    : 0;
  const onlineCursorAt = Number.isFinite(Number(session.onlineCreditCursorAt))
    ? Math.max(0, Number(session.onlineCreditCursorAt))
    : 0;
  const onlineLastPersistAt = Number.isFinite(Number(session.onlineLastPersistAt))
    ? Math.max(0, Number(session.onlineLastPersistAt))
    : 0;
  return Math.max(lastHeartbeatAt, onlineCursorAt, onlineLastPersistAt);
}

function isStaleWorldSession(session: GameSession): boolean {
  if (!session) {
    return true;
  }
  if (session.socket?.destroyed) {
    return true;
  }
  if (!isWorldSession(session) || session.state !== 'LOGGED_IN') {
    return true;
  }
  const lastSeenAt = resolveSessionLastSeenAt(session);
  if (lastSeenAt <= 0) {
    return false;
  }
  return Date.now() - lastSeenAt > WORLD_SESSION_STALE_TIMEOUT_MS;
}

function pruneStaleWorldSessionForAccount(
  sharedState: Record<string, any>,
  accountName: string,
  excludeSessionId: number | null = null
): boolean {
  const normalizedAccountName = normalizeAccountName(accountName);
  if (!normalizedAccountName) {
    return false;
  }

  const world = getWorldState(sharedState);
  const mappedSessionId = world.sessionIdByAccountName.get(normalizedAccountName);
  if (!Number.isInteger(mappedSessionId)) {
    return false;
  }

  const normalizedSessionId = Number(mappedSessionId) >>> 0;
  if (excludeSessionId !== null && normalizedSessionId === (excludeSessionId >>> 0)) {
    return false;
  }

  const presence = world.playersBySessionId.get(normalizedSessionId);
  const candidate = presence?.session;
  if (candidate && !isStaleWorldSession(candidate)) {
    return false;
  }

  if (candidate) {
    candidate.log(`Pruning stale world session for account="${normalizedAccountName}"`);
    removeWorldPresence(candidate, 'stale-world-session');
  } else {
    world.sessionIdByAccountName.delete(normalizedAccountName);
  }
  return true;
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

function resolvePlayerAppearanceWord(roleEntityType: number, selectedAptitude: number): number {
  const normalizedRoleEntityType = Number(roleEntityType);
  if (Number.isFinite(normalizedRoleEntityType) && normalizedRoleEntityType > 0) {
    return normalizedRoleEntityType & 0xffff;
  }

  const normalizedAptitude = Number(selectedAptitude);
  if (!Number.isFinite(normalizedAptitude)) {
    return 1;
  }
  return Math.max(1, normalizedAptitude | 0) & 0xffff;
}

function getSelectedPetRecord(session: GameSession): Record<string, any> | null {
  if (!session.petSummoned || !Array.isArray(session.pets) || session.pets.length === 0) {
    return null;
  }

  if (typeof session.selectedPetRuntimeId === 'number') {
    const selectedPetRuntimeId = session.selectedPetRuntimeId >>> 0;
    const selected = session.pets.find(
      (entry: Record<string, any>) => (entry?.runtimeId >>> 0) === selectedPetRuntimeId
    );
    if (selected) {
      return selected;
    }
  }

  return session.pets[0] || null;
}

function resolveWorldPetPosition(ownerX: number, ownerY: number): { x: number; y: number } {
  const x = ownerX >= 0xffff ? Math.max(0, ownerX - 1) : ownerX + 1;
  return {
    x: x & 0xffff,
    y: ownerY & 0xffff,
  };
}

function resolveWorldPetPresence(owner: WorldPlayerPresence): WorldPetPresence | null {
  const pet = getSelectedPetRecord(owner.session);
  if (!pet) {
    return null;
  }

  const entityType = Number(pet.templateId) >>> 0;
  if (!entityType) {
    return null;
  }

  const position = resolveWorldPetPosition(owner.x >>> 0, owner.y >>> 0);
  return {
    runtimeId: (Number(pet.runtimeId) >>> 0),
    ownerRuntimeId: owner.runtimeId >>> 0,
    entityType,
    x: position.x >>> 0,
    y: position.y >>> 0,
    dir: 0,
    state: 0,
  };
}

function resolvePresenceBaseFlags(presence: WorldPlayerPresence): number {
  return ((((presence.state >>> 0) & 0xffff) << 16) | ((presence.dir >>> 0) & 0xffff)) >>> 0;
}

function resolvePresenceLeaderRuntimeId(presence: WorldPlayerPresence): number {
  const teamId = Number.isInteger(presence.session.teamId) ? (Number(presence.session.teamId) >>> 0) : 0;
  if (!teamId) {
    return 0;
  }

  const teamRuntime = presence.session.sharedState?.teamRuntime as {
    teams?: Map<number, { leaderSessionId?: number }>;
  } | null | undefined;
  const teams = teamRuntime?.teams;
  if (!(teams instanceof Map)) {
    return 0;
  }

  const team = teams.get(teamId) || null;
  const leaderSessionId = Number.isInteger(team?.leaderSessionId) ? (Number(team?.leaderSessionId) >>> 0) : 0;
  if (!leaderSessionId) {
    return 0;
  }

  const sessionsById =
    presence.session.sharedState?.sessionsById instanceof Map
      ? presence.session.sharedState.sessionsById as Map<number, GameSession>
      : null;
  const leaderSession = sessionsById?.get(leaderSessionId) || null;
  if (!leaderSession) {
    return 0;
  }

  return leaderSession.runtimeId >>> 0;
}

function resolvePresenceWalkState(presence: WorldPlayerPresence): WorldPresenceWalkState {
  const flags = resolvePresenceBaseFlags(presence);
  const leaderRuntimeId = resolvePresenceLeaderRuntimeId(presence);
  if (!leaderRuntimeId) {
    return {
      flags,
      linkedRuntimeId: 0,
      teamStatus: 0,
    };
  }

  return {
    flags: (flags | 0x10) >>> 0,
    linkedRuntimeId: leaderRuntimeId >>> 0,
    teamStatus: 1,
  };
}

function requiresWalkStatePayload(walkState: WorldPresenceWalkState): boolean {
  return ((walkState.flags >>> 0) & 0x40010) !== 0;
}

function toSpawnRecord(presence: WorldPlayerPresence): {
    id: number;
    entityType: number;
  x: number;
  y: number;
  dir: number;
  state: number;
  playerData: {
    roleData: number;
    level: number;
    name: string;
    appearanceWords: [number, number, number];
    appearanceFlags: [number, number, number];
    extraFlags: number;
    trailingState: number;
  };
} {
  const walkState = resolvePresenceWalkState(presence);
  return {
    id: presence.runtimeId >>> 0,
    entityType: presence.entityType >>> 0,
    x: presence.x >>> 0,
    y: presence.y >>> 0,
    dir: walkState.flags & 0xffff,
    state: (walkState.flags >>> 16) & 0xffff,
    playerData: {
      roleData: presence.roleData >>> 0,
      level: presence.level >>> 0,
      name: presence.charName || '',
      appearanceWords: [
        resolvePlayerAppearanceWord(presence.roleEntityType, presence.selectedAptitude),
        0,
        0,
      ],
      appearanceFlags: [0, 0, 0],
      extraFlags: 0,
      trailingState: 0,
    },
  };
}

function sendPresenceWalkStateRefresh(targetSession: GameSession, presence: WorldPlayerPresence, reason: string): void {
  const walkState = resolvePresenceWalkState(presence);
  if (!requiresWalkStatePayload(walkState)) {
    return;
  }

  targetSession.observedPlayerPositions.set(presence.runtimeId >>> 0, {
    x: presence.x >>> 0,
    y: presence.y >>> 0,
  });
  targetSession.writePacket(
    buildEntityWalkSyncPacket(
      presence.runtimeId >>> 0,
      presence.x >>> 0,
      presence.y >>> 0,
      walkState.flags >>> 0,
      {
        linkedRuntimeId: walkState.linkedRuntimeId >>> 0,
        teamStatus: walkState.teamStatus >>> 0,
      }
    ),
    DEFAULT_FLAGS,
    `Sending player walk state sync reason=${reason} runtimeId=${presence.runtimeId >>> 0} pos=${presence.x >>> 0},${presence.y >>> 0} flags=0x${(walkState.flags >>> 0).toString(16)} link=${walkState.linkedRuntimeId >>> 0} status=${walkState.teamStatus >>> 0}`
  );
}

function sendPresenceSpawn(targetSession: GameSession, presences: WorldPlayerPresence[], reason: string): void {
  if (!Array.isArray(presences) || presences.length === 0) {
    return;
  }
  for (const presence of presences) {
    targetSession.observedPlayerPositions.set(presence.runtimeId >>> 0, {
      x: presence.x >>> 0,
      y: presence.y >>> 0,
    });
  }
  targetSession.writePacket(
    buildSceneSpawnBatchPacket(presences.map(toSpawnRecord)),
    DEFAULT_FLAGS,
    `Sending player spawn sync reason=${reason} count=${presences.length}`
  );
  for (const presence of presences) {
    sendPresenceWalkStateRefresh(targetSession, presence, `${reason}:state`);
  }
}

function sendPetSpawn(targetSession: GameSession, pet: WorldPetPresence, reason: string): void {
  targetSession.observedPetStates.set(pet.runtimeId >>> 0, {
    ownerRuntimeId: pet.ownerRuntimeId >>> 0,
    x: pet.x >>> 0,
    y: pet.y >>> 0,
    entityType: pet.entityType >>> 0,
  });
  targetSession.writePacket(
    buildSceneSpawnBatchPacket([
      {
        id: pet.runtimeId >>> 0,
        entityType: pet.entityType >>> 0,
        x: pet.x >>> 0,
        y: pet.y >>> 0,
        dir: pet.dir >>> 0,
        state: pet.state >>> 0,
      },
    ]),
    DEFAULT_FLAGS,
    `Sending pet spawn sync reason=${reason} ownerRuntimeId=${pet.ownerRuntimeId >>> 0} runtimeId=${pet.runtimeId >>> 0} entityType=0x${(pet.entityType >>> 0).toString(16)} pos=${pet.x >>> 0},${pet.y >>> 0}`
  );
}

function sendPresenceHide(targetSession: GameSession, runtimeId: number, reason: string): void {
  targetSession.observedPlayerPositions.delete(runtimeId >>> 0);
  targetSession.writePacket(
    buildEntityRemovePacket(runtimeId >>> 0),
    DEFAULT_FLAGS,
    `Sending player remove sync reason=${reason} runtimeId=${runtimeId >>> 0}`
  );
}

function sendPetHide(targetSession: GameSession, runtimeId: number, reason: string): void {
  targetSession.observedPetStates.delete(runtimeId >>> 0);
  targetSession.writePacket(
    buildEntityRemovePacket(runtimeId >>> 0),
    DEFAULT_FLAGS,
    `Sending pet remove sync reason=${reason} runtimeId=${runtimeId >>> 0}`
  );
}

function sendPresenceMoveDirect(
  targetSession: GameSession,
  runtimeId: number,
  x: number,
  y: number,
  reason: string
): void {
  targetSession.observedPlayerPositions.set(runtimeId >>> 0, {
    x: x >>> 0,
    y: y >>> 0,
  });
  targetSession.writePacket(
    buildEntityPositionSyncPacket(runtimeId >>> 0, x >>> 0, y >>> 0),
    DEFAULT_FLAGS,
    `Sending player move sync reason=${reason} runtimeId=${runtimeId >>> 0} pos=${x >>> 0},${y >>> 0}`
  );
}

function sendPresenceMoveSmooth(
  targetSession: GameSession,
  runtimeId: number,
  x: number,
  y: number,
  reason: string
): void {
  const world = getWorldState(targetSession.sharedState);
  const presence = world.playersByRuntimeId.get(runtimeId >>> 0) || null;
  const walkState = presence
    ? resolvePresenceWalkState(presence)
    : {
      flags: 0,
      linkedRuntimeId: 0,
      teamStatus: 0,
    };
  targetSession.observedPlayerPositions.set(runtimeId >>> 0, {
    x: x >>> 0,
    y: y >>> 0,
  });
  targetSession.writePacket(
    buildEntityWalkSyncPacket(runtimeId >>> 0, x >>> 0, y >>> 0, walkState.flags >>> 0, {
      linkedRuntimeId: walkState.linkedRuntimeId >>> 0,
      teamStatus: walkState.teamStatus >>> 0,
    }),
    DEFAULT_FLAGS,
    `Sending player walk sync reason=${reason} runtimeId=${runtimeId >>> 0} pos=${x >>> 0},${y >>> 0} flags=0x${(walkState.flags >>> 0).toString(16)}`
  );
}

function sendPresenceMove(targetSession: GameSession, presence: WorldPlayerPresence, reason: string): void {
  const runtimeId = presence.runtimeId >>> 0;
  const targetX = presence.x >>> 0;
  const targetY = presence.y >>> 0;
  const previous = targetSession.observedPlayerPositions.get(runtimeId) || null;

  if (!previous) {
    sendPresenceMoveDirect(targetSession, runtimeId, targetX, targetY, `${reason}:direct-initial`);
    return;
  }

  const dx = targetX - (previous.x >>> 0);
  const dy = targetY - (previous.y >>> 0);
  const distance = Math.max(Math.abs(dx), Math.abs(dy));

  if (distance === 0) {
    return;
  }

  if (distance === 1) {
    sendPresenceMoveSmooth(targetSession, runtimeId, targetX, targetY, reason);
    return;
  }

  if (distance > PLAYER_MOVE_SMOOTH_DISTANCE_LIMIT) {
    sendPresenceMoveDirect(targetSession, runtimeId, targetX, targetY, `${reason}:direct-large-jump`);
    return;
  }

  sendPresenceMoveSmooth(targetSession, runtimeId, targetX, targetY, reason);
}

function sendPetMoveDirect(
  targetSession: GameSession,
  pet: WorldPetPresence,
  reason: string
): void {
  updateObservedPetState(targetSession, pet);
  targetSession.writePacket(
    buildEntityPositionSyncPacket(pet.runtimeId >>> 0, pet.x >>> 0, pet.y >>> 0),
    DEFAULT_FLAGS,
    `Sending pet move sync reason=${reason} runtimeId=${pet.runtimeId >>> 0} pos=${pet.x >>> 0},${pet.y >>> 0}`
  );
}

function sendPetMoveSmooth(
  targetSession: GameSession,
  pet: WorldPetPresence,
  reason: string
): void {
  updateObservedPetState(targetSession, pet);
  targetSession.writePacket(
    buildEntityWalkSyncPacket(pet.runtimeId >>> 0, pet.x >>> 0, pet.y >>> 0),
    DEFAULT_FLAGS,
    `Sending pet walk sync reason=${reason} runtimeId=${pet.runtimeId >>> 0} pos=${pet.x >>> 0},${pet.y >>> 0}`
  );
}

function updateObservedPetState(
  targetSession: GameSession,
  pet: WorldPetPresence
): void {
  targetSession.observedPetStates.set(pet.runtimeId >>> 0, {
    ownerRuntimeId: pet.ownerRuntimeId >>> 0,
    x: pet.x >>> 0,
    y: pet.y >>> 0,
    entityType: pet.entityType >>> 0,
  });
}

function sendPetMove(targetSession: GameSession, pet: WorldPetPresence, reason: string): void {
  const runtimeId = pet.runtimeId >>> 0;
  const targetX = pet.x >>> 0;
  const targetY = pet.y >>> 0;
  const previous = targetSession.observedPetStates.get(runtimeId) || null;

  if (!previous) {
    sendPetMoveDirect(targetSession, pet, `${reason}:direct-initial`);
    return;
  }

  const dx = targetX - (previous.x >>> 0);
  const dy = targetY - (previous.y >>> 0);
  const distance = Math.max(Math.abs(dx), Math.abs(dy));

  if (distance === 0) {
    return;
  }

  if (distance > PLAYER_MOVE_SMOOTH_DISTANCE_LIMIT) {
    sendPetMoveDirect(targetSession, pet, `${reason}:direct-large-jump`);
    return;
  }

  sendPetMoveSmooth(targetSession, pet, reason);
}

function hideStaleOwnedPets(
  viewerSession: GameSession,
  ownerRuntimeId: number,
  keepRuntimeId: number | null,
  reason: string
): void {
  for (const [runtimeId, observed] of [...viewerSession.observedPetStates.entries()]) {
    if ((observed?.ownerRuntimeId >>> 0) !== (ownerRuntimeId >>> 0)) {
      continue;
    }
    if (keepRuntimeId !== null && (runtimeId >>> 0) === (keepRuntimeId >>> 0)) {
      continue;
    }
    sendPetHide(viewerSession, runtimeId >>> 0, reason);
  }
}

function syncOwnedPetForViewer(
  viewerSession: GameSession,
  owner: WorldPlayerPresence,
  reason: string,
  ownerVisibleToViewer: boolean
): void {
  if (!ownerVisibleToViewer) {
    hideStaleOwnedPets(viewerSession, owner.runtimeId >>> 0, null, `${reason}:owner-hidden`);
    return;
  }

  const pet = resolveWorldPetPresence(owner);
  if (!pet) {
    hideStaleOwnedPets(viewerSession, owner.runtimeId >>> 0, null, `${reason}:unsummoned`);
    return;
  }

  hideStaleOwnedPets(
    viewerSession,
    owner.runtimeId >>> 0,
    pet.runtimeId >>> 0,
    `${reason}:active-switch`
  );

  const previous = viewerSession.observedPetStates.get(pet.runtimeId >>> 0) || null;
  if (!previous) {
    sendPetSpawn(viewerSession, pet, `${reason}:spawn`);
    return;
  }

  if ((previous.entityType >>> 0) !== (pet.entityType >>> 0)) {
    sendPetHide(viewerSession, pet.runtimeId, `${reason}:template-reset`);
    sendPetSpawn(viewerSession, pet, `${reason}:template-reset`);
    return;
  }

  sendPetMove(viewerSession, pet, reason);
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
  presence.entityType = session.entityType >>> 0;
  presence.roleEntityType = session.roleEntityType >>> 0;
  presence.roleData = session.roleData >>> 0;
  presence.level = session.level >>> 0;
  presence.selectedAptitude = session.selectedAptitude >>> 0;
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
    entityType: session.entityType >>> 0,
    roleEntityType: session.roleEntityType >>> 0,
    roleData: session.roleData >>> 0,
    level: session.level >>> 0,
    selectedAptitude: session.selectedAptitude >>> 0,
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

export function syncWorldPresence(
  session: GameSession,
  reason: string,
  options: { skipSourceViewerAdd?: boolean } = {}
): void {
  const world = getWorldState(session.sharedState);
  const source = ensureWorldPresence(session);
  updatePresenceFromSession(source, session);
  void upsertRuntimeOnlinePlayer(session).catch(() => {
    // Keep world sync resilient if the admin runtime table is unavailable.
  });
  const skipSourceViewerAdd = options.skipSourceViewerAdd === true;

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
        if (!skipSourceViewerAdd) {
          sendPresenceSpawn(session, [other], `${reason}:viewer-add`);
          session.visiblePlayerRuntimeIds.add(runtimeId >>> 0);
        }
      }

      if (!otherSeesSource) {
        sendPresenceSpawn(other.session, [source], `${reason}:peer-add`);
        other.session.visiblePlayerRuntimeIds.add(source.runtimeId >>> 0);
      } else {
        sendPresenceMove(other.session, source, `${reason}:peer-move`);
      }

      syncOwnedPetForViewer(
        session,
        other,
        `${reason}:viewer-pet`,
        session.visiblePlayerRuntimeIds.has(other.runtimeId >>> 0)
      );
      syncOwnedPetForViewer(
        other.session,
        source,
        `${reason}:peer-pet`,
        other.session.visiblePlayerRuntimeIds.has(source.runtimeId >>> 0)
      );
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
    syncOwnedPetForViewer(session, other, `${reason}:viewer-pet`, false);
    syncOwnedPetForViewer(other.session, source, `${reason}:peer-pet`, false);
  }
}

export function syncWorldPetState(session: GameSession, reason: string): void {
  const world = getWorldState(session.sharedState);
  const owner = world.playersBySessionId.get(session.id);
  if (!owner) {
    return;
  }

  for (const other of world.playersByRuntimeId.values()) {
    if (!other || other.session.id === session.id) {
      continue;
    }

    syncOwnedPetForViewer(
      other.session,
      owner,
      reason,
      other.session.visiblePlayerRuntimeIds.has(owner.runtimeId >>> 0)
    );
  }
}

export function refreshWorldPresenceForVisibleViewers(session: GameSession, reason: string): void {
  const world = getWorldState(session.sharedState);
  const presence = world.playersBySessionId.get(session.id >>> 0) || null;
  if (!presence) {
    return;
  }

  updatePresenceFromSession(presence, session);
  for (const other of world.playersByRuntimeId.values()) {
    if (!other || other.session.id === session.id) {
      continue;
    }
    if (!other.session.visiblePlayerRuntimeIds.has(presence.runtimeId >>> 0)) {
      continue;
    }

    sendPresenceHide(other.session, presence.runtimeId >>> 0, `${reason}:refresh-remove`);
    other.session.visiblePlayerRuntimeIds.delete(presence.runtimeId >>> 0);
    if (!shouldSessionsSeeEachOther(presence, other)) {
      continue;
    }

    sendPresenceSpawn(other.session, [presence], `${reason}:refresh-add`);
    other.session.visiblePlayerRuntimeIds.add(presence.runtimeId >>> 0);
  }
}

export function removeWorldPresence(session: GameSession, reason: string): void {
  const world = getWorldState(session.sharedState);
  const presence = world.playersBySessionId.get(session.id);
  if (!presence) {
    void removeRuntimeOnlinePlayer(session).catch(() => {
      // Best-effort cleanup only.
    });
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
      sendPresenceMoveDirect(
        other.session,
        presence.runtimeId >>> 0,
        presence.x >>> 0,
        presence.y >>> 0,
        `${reason}:disconnect-stop`
      );
      sendPresenceHide(other.session, presence.runtimeId, `${reason}:disconnect`);
      other.session.visiblePlayerRuntimeIds.delete(presence.runtimeId >>> 0);
    }
    syncOwnedPetForViewer(other.session, presence, `${reason}:pet-disconnect`, false);
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
  session.observedPetStates.clear();
  void removeRuntimeOnlinePlayer(session).catch(() => {
    // Best-effort cleanup only.
  });
}
