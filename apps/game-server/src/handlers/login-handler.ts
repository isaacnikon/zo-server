import { parseCreateRole, parseLoginPacket } from '../protocol/inbound-packets.js';
import { PacketWriter } from '../protocol.js';
import { AREA_ID, DEFAULT_FLAGS, ENTITY_TYPE, LOGIN_CMD, LOGIN_SERVER_LIST_RESULT, LINE_SELECT_RESULT, MAP_ID, PORT, REDIRECT_RESULT, ROLE_CMD, SERVER_HOST, SINGLE_WORLD_SESSION_PER_REMOTE, SPAWN_X, SPAWN_Y, } from '../config.js';
import { deriveStableRoleData, packRoleData, resolveRoleData, resolveRoleLevel, resolveBirthMonth, resolveBirthDay, } from '../character/role-utils.js';
import { defaultBonusAttributes, numberOrDefault, defaultPrimaryAttributes, normalizeBonusAttributes, normalizePrimaryAttributes, normalizeCharacterRecord, normalizeSkillState, } from '../character/normalize.js';
import { normalizeInventoryState } from '../inventory/index.js';
import { normalizePets } from '../gameplay/pet-runtime.js';
import { CHARACTER_VITALS_BASELINE, recomputeSessionMaxVitals } from '../gameplay/session-flows.js';
import { hasActiveWorldAccount, replaceExistingWorldSessionsForRemote } from '../world-state.js';
import {
  deletePersistedCharacter,
  hydratePendingGameCharacter,
  listPersistedCharacters,
  persistedCharacterNameExists,
  selectPersistedCharacter,
} from '../character/session-hydration.js';
import { authenticateGameLogin } from '../db/game-login-auth.js';
import {
  createEmptyQuestState,
  normalizeQuestState as normalizeQuestStateV2,
} from '../quest2/index.js';
import {
  blockWorldEntryFor,
  consumeBlockedWorldEntry,
  getPairedSession,
  isLoginSession,
  isLiveWorldSession,
  isWorldSession,
  setSessionKind,
} from '../session-role.js';
import { traceWorldExitLifecycle } from '../observability/packet-tracing.js';

import type { UnknownRecord } from '../utils.js';
import type { GameSession } from '../types.js';

const MAX_CHARACTER_SLOTS = 3;
const LOGIN_CHARACTER_ROSTER_RESULT = 0x13;
const LOGIN_WORLD_REENTRY_DEBOUNCE_MS = 2_500;
const LOGIN_WORLD_ENTRY_REQUEST_TIMEOUT_MS = 20_000;

function parseLoginPayload(_session: GameSession, payload: Buffer): UnknownRecord | null {
  if (payload.length < 6 || payload.readUInt16LE(0) !== LOGIN_CMD) {
    return null;
  }
  return parseLoginPacket(payload);
}

function findFirstAvailableCharacterSlot(characters: Array<Record<string, unknown>>): number {
  const occupiedSlots = new Set(
    characters
      .map((character) => numberOrDefault(character.slot, -1))
      .filter((slot) => slot >= 0 && slot < MAX_CHARACTER_SLOTS)
  );
  for (let slot = 0; slot < MAX_CHARACTER_SLOTS; slot += 1) {
    if (!occupiedSlots.has(slot)) {
      return slot;
    }
  }
  return -1;
}

function findLiveWorldSessionForAccount(
  session: GameSession,
  accountKey: string
): GameSession | null {
  const pairedSession = getPairedSession(session);
  if (
    pairedSession &&
    isLiveWorldSession(pairedSession) &&
    typeof pairedSession.accountKey === 'string' &&
    pairedSession.accountKey.trim() === accountKey
  ) {
    return pairedSession;
  }

  const sessionsById =
    session.sharedState?.sessionsById instanceof Map
      ? session.sharedState.sessionsById as Map<number, GameSession>
      : null;
  if (!sessionsById) {
    return null;
  }

  for (const candidate of sessionsById.values()) {
    if (!isLiveWorldSession(candidate)) {
      continue;
    }
    if ((candidate.id >>> 0) === (session.id >>> 0)) {
      continue;
    }
    if (typeof candidate.accountKey !== 'string' || candidate.accountKey.trim() !== accountKey) {
      continue;
    }
    return candidate;
  }

  return null;
}

function clearPendingWorldEntryRequest(session: GameSession): void {
  session.pendingWorldEntrySlot = null;
  session.pendingWorldEntryRequestedAt = null;
}

function hasPendingWorldEntryRequest(session: GameSession): boolean {
  const requestedAt = Number.isFinite(Number(session.pendingWorldEntryRequestedAt))
    ? Math.max(0, Number(session.pendingWorldEntryRequestedAt))
    : 0;
  if (session.pendingWorldEntrySlot === null) {
    clearPendingWorldEntryRequest(session);
    return false;
  }
  if (requestedAt <= 0) {
    clearPendingWorldEntryRequest(session);
    return false;
  }
  if (Date.now() - requestedAt > LOGIN_WORLD_ENTRY_REQUEST_TIMEOUT_MS) {
    session.log(
      `Clearing stale pending world-entry request slot=${session.pendingWorldEntrySlot} ageMs=${Date.now() - requestedAt}`
    );
    clearPendingWorldEntryRequest(session);
    return false;
  }
  return true;
}

function queuePendingWorldEntryRequest(session: GameSession, slotIndex: number): void {
  session.pendingWorldEntrySlot = slotIndex & 0xff;
  session.pendingWorldEntryRequestedAt = Date.now();
}

async function handleLogin(session: GameSession, payload: Buffer): Promise<void> {
  const cmdByte = payload[0];
  session.log(`Login packet cmd=0x${cmdByte.toString(16)} role=${session.sessionKind}`);

  const login = parseLoginPayload(session, payload);
  if (login) {
    const authResult = await authenticateGameLogin({
      username: login.username,
      passwordDigest: login.passwordDigest,
    });
    if (!authResult.ok) {
      session.log(`Rejected login for username="${login.username}" reason=${authResult.reason}`);
      session.socket.destroy();
      return;
    }

    session.accountName = authResult.accountId;
    session.accountKey = authResult.accountKey;
    session.log(
      `Authenticated login username="${login.username}" accountId="${authResult.accountId}" mode=${authResult.mode}`
    );
    const enteringWorld =
      session.sharedState?.pendingGameCharacters instanceof Map &&
      session.sharedState.pendingGameCharacters.has(session.accountKey || authResult.accountId);
    if (enteringWorld) {
      if (hasActiveWorldAccount(session.sharedState, session.accountKey || authResult.accountId, session.id)) {
        session.log(`Rejecting duplicate login for account="${authResult.accountId}" key="${session.accountKey}"`);
        session.socket.destroy();
        return;
      }
    }
    setSessionKind(session, enteringWorld ? 'world' : 'login');
  }

  session.state = 'LOGGED_IN';
  if (isWorldSession(session)) {
    if (SINGLE_WORLD_SESSION_PER_REMOTE) {
      const replacedCount = replaceExistingWorldSessionsForRemote(
        session.sharedState,
        session.remoteAddress,
        session.id
      );
      if (replacedCount > 0) {
        session.log(
          `Replaced ${replacedCount} existing live session(s) for remote=${session.remoteAddress || 'unknown'}`
        );
      }
    } else {
      session.log(
        `Allowing concurrent live sessions for remote=${session.remoteAddress || 'unknown'}`
      );
    }
    hydratePendingGameCharacter(session, session.sharedState);
    session.sendEnterGameOk();
  } else {
    sendLoginServerList(session);
  }
}

async function handleRolePacket(session: GameSession, payload: Buffer): Promise<void> {
  if (payload.length < 3) {
    session.log('Short 0x044c payload');
    return;
  }

  const subcmd = payload[2];
  const roleHandlers: Record<number, () => Promise<void>> = {
    0x04: () => handleCreateRole(session, payload),
    0x07: () => handleDeleteRole(session, payload),
    0x0d: async () => {
      const slotIndex = payload.length >= 4 ? payload[3] : 0;
      session.log(`Enter game request slot=${slotIndex}`);
      if (isWorldSession(session)) {
        session.sendEnterGameOk();
      } else {
        const blockedReason = consumeBlockedWorldEntry(session);
        if (blockedReason) {
          blockWorldEntryFor(session, LOGIN_WORLD_REENTRY_DEBOUNCE_MS, blockedReason);
          session.log(
            `Ignoring enter-game request on login session during shutdown debounce due to ${blockedReason}`
          );
          await sendCharacterRoster(session, 1);
          return;
        }
        if (hasPendingWorldEntryRequest(session)) {
          session.log(
            `Keeping world-entry request queued while teardown/redirect is still pending slot=${session.pendingWorldEntrySlot}`
          );
          return;
        }
        const accountKey = typeof session.accountKey === 'string' ? session.accountKey.trim() : '';
        const hasPendingWorldEntry =
          accountKey &&
          session.sharedState?.pendingGameCharacters instanceof Map &&
          session.sharedState.pendingGameCharacters.has(accountKey);
        const liveWorldSession = accountKey ? findLiveWorldSessionForAccount(session, accountKey) : null;
        const hasLiveWorldSession = Boolean(liveWorldSession);
        if (liveWorldSession) {
          queuePendingWorldEntryRequest(session, slotIndex);
          traceWorldExitLifecycle(session, 'login-enter-detected-live-world', {
            worldSessionId: liveWorldSession.id >>> 0,
            holdReentryMs: LOGIN_WORLD_ENTRY_REQUEST_TIMEOUT_MS,
            queuedSlot: slotIndex & 0xff,
          });
          traceWorldExitLifecycle(liveWorldSession, 'destroy-world-from-login-enter', {
            loginSessionId: session.id >>> 0,
          });
          session.log(
            `Login session requested enter-game while world session S${liveWorldSession.id} is still active; closing world session and queueing redirect for slot=${slotIndex}`
          );
          liveWorldSession.socket.destroy();
          return;
        }
        if (hasPendingWorldEntry) {
          queuePendingWorldEntryRequest(session, slotIndex);
          session.log(
            `Keeping world-entry request queued while redirect is already pending key="${accountKey}" slot=${slotIndex}`
          );
          return;
        }
        if (hasActiveWorldAccount(session.sharedState, accountKey, null)) {
          session.log(
            `Ignoring duplicate enter-game request while a live world session is still mapped key="${accountKey}" live=${hasLiveWorldSession ? 1 : 0}`
          );
          await sendCharacterRoster(session, 1);
          return;
        }
        const selectedCharacter = await selectPersistedCharacter(session, { slot: slotIndex });
        if (!selectedCharacter) {
          session.log(`Ignoring enter-game request for empty slot=${slotIndex}`);
          return;
        }
        clearPendingWorldEntryRequest(session);
        return sendGameServerRedirect(session);
      }
    },
    0x1c: () => {
      const lineNo = payload.length >= 4 ? payload[3] : 0;
      session.log(`Line select request for line ${lineNo}`);
      return sendLineSelectOk(session, lineNo);
    },
  };

  const handler = roleHandlers[subcmd];
  if (handler) {
    await handler();
  } else {
    session.log(`Unhandled 0x044c subcmd=0x${subcmd.toString(16)}`);
  }
}

async function handleCreateRole(session: GameSession, payload: Buffer): Promise<void> {
  if (payload.length < 6) {
    session.log('Short create-role payload');
    return;
  }

  const { templateIndex, roleName, birthMonth, birthDay, selectedAptitude, extra1, extra2 } = parseCreateRole(payload);
  const normalizedRoleName = roleName.trim();

  session.log(
    `Create role request template=0x${templateIndex.toString(16)} name="${normalizedRoleName}" month=${birthMonth} day=${birthDay} selectedAptitude=${selectedAptitude} extra1=0x${extra1.toString(16)} extra2=0x${extra2.toString(16)}`
  );

  if (normalizedRoleName.length < 1) {
    session.log('Rejecting create-role request with empty name');
    sendCreateRoleFailed(session);
    return;
  }

  const existingCharacters = await listPersistedCharacters(session, { forceReload: true });
  const slot = findFirstAvailableCharacterSlot(existingCharacters);
  if (slot < 0) {
    session.log(`Rejecting create-role request for "${normalizedRoleName}" because all ${MAX_CHARACTER_SLOTS} slots are occupied`);
    sendCreateRoleFailed(session);
    return;
  }

  if (await persistedCharacterNameExists(session, normalizedRoleName)) {
    session.log(`Rejecting create-role request for "${normalizedRoleName}" because the name already exists`);
    sendCreateRoleNameExists(session);
    return;
  }

  session.charName = normalizedRoleName;
  session.runtimeId = ENTITY_TYPE;
  session.entityType = ENTITY_TYPE;
  session.roleEntityType = ENTITY_TYPE + templateIndex;
  session.roleData = packRoleData(extra1, extra2) || deriveStableRoleData({
    accountName: session.accountName,
    accountKey: session.accountKey,
    charName: session.charName,
    roleName: session.charName,
    entityType: session.entityType,
    roleEntityType: session.roleEntityType,
    selectedAptitude,
  });
  session.selectedAptitude = selectedAptitude;
  session.level = 1;
  session.experience = 0;
  session.currentHealth = CHARACTER_VITALS_BASELINE.health;
  session.currentMana = CHARACTER_VITALS_BASELINE.mana;
  session.currentRage = 100;
  session.gold = 0;
  session.bankGold = 0;
  session.boundGold = 0;
  session.coins = 0;
  session.renown = 0;
  session.primaryAttributes = defaultPrimaryAttributes();
  session.bonusAttributes = defaultBonusAttributes();
  session.statusPoints = 0;
  recomputeSessionMaxVitals(session, {
    currentHealth: session.currentHealth,
    currentMana: session.currentMana,
    currentRage: session.currentRage,
    maxHealth: 0,
    maxMana: 0,
    maxRage: 0,
  });
  session.questStateV2 = createEmptyQuestState();
  await session.saveCharacter({
    slot,
    roleName: session.charName,
    charName: session.charName,
    birthMonth,
    birthDay,
    selectedAptitude,
    extra1,
    extra2,
    level: 1,
    requestedTemplateIndex: templateIndex,
    entityType: session.entityType,
    roleEntityType: session.roleEntityType,
    runtimeId: 0,
    roleData: session.roleData,
    experience: session.experience,
    currentHealth: session.currentHealth,
    currentMana: session.currentMana,
    currentRage: session.currentRage,
    gold: session.gold,
    bankGold: session.bankGold,
    boundGold: session.boundGold,
    coins: session.coins,
    renown: session.renown,
    primaryAttributes: session.primaryAttributes,
    bonusAttributes: session.bonusAttributes,
    statusPoints: session.statusPoints,
    questStateV2: session.questStateV2,
    mapId: MAP_ID,
    x: SPAWN_X,
    y: SPAWN_Y,
  });
  sendCreateRoleOk(session, {
    slot,
    roleName: session.charName,
    birthMonth,
    birthDay,
    level: 1,
    extra1,
    extra2,
    entityType: session.roleEntityType,
    roleData: session.roleData,
  });
}

async function handleDeleteRole(session: GameSession, payload: Buffer): Promise<void> {
  if (payload.length < 4) {
    session.log('Short delete-role payload');
    sendDeleteRoleFailed(session);
    return;
  }

  const slotIndex = payload[3] & 0xff;
  session.log(`Delete role request slot=${slotIndex}`);

  const deleted = await deletePersistedCharacter(session, { slot: slotIndex });
  if (!deleted) {
    session.log(`Delete role failed for slot=${slotIndex}`);
    sendDeleteRoleFailed(session);
    return;
  }

  const remainingCharacters = await listPersistedCharacters(session, { forceReload: true });
  const selectedCharacter = remainingCharacters.find((character) => character.selected === true) || remainingCharacters[0] || null;
  if (selectedCharacter) {
    session.persistedCharacter = normalizeCharacterRecord(selectedCharacter);
    session.charName = String(selectedCharacter.charName || selectedCharacter.roleName || session.charName || '');
  } else {
    session.persistedCharacter = null;
    session.charName = '';
  }

  sendDeleteRoleOk(session, slotIndex);
  await sendCharacterRoster(session, 1);
}

function sendLoginServerList(session: GameSession): void {
  const writer = new PacketWriter();
  writer.writeUint16(LOGIN_CMD);
  writer.writeUint8(LOGIN_SERVER_LIST_RESULT);
  writer.writeUint8(0);
  writer.writeUint8(0);
  writer.writeUint32(0);
  writer.writeBytes(Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]));
  writer.writeUint32(AREA_ID);
  writer.writeUint16(PORT);
  writer.writeUint8(1);
  writer.writeString(SERVER_HOST);
  writer.writeUint8(0);
  writer.writeUint8(0);
  writer.writeUint32(0);
  writer.writeUint32(0);
  writer.writeString('');
  writer.writeUint8(0);
  session.writePacket(writer.payload(), DEFAULT_FLAGS, 'Sending login server-list response');
}

async function sendLineSelectOk(session: GameSession, lineNo: number): Promise<void> {
  const writer = new PacketWriter();
  writer.writeUint16(LOGIN_CMD);
  writer.writeUint8(LINE_SELECT_RESULT);
  writer.writeUint8(lineNo & 0xff);
  session.writePacket(writer.payload(), DEFAULT_FLAGS, `Sending line-select success for line ${lineNo}`);
  await sendCharacterRoster(session, lineNo);
}

function sendCreateRoleFailed(session: GameSession): void {
  const writer = new PacketWriter();
  writer.writeUint16(ROLE_CMD);
  writer.writeUint8(0x06);
  session.writePacket(writer.payload(), DEFAULT_FLAGS, 'Sending create-role failed');
}

function sendDeleteRoleOk(session: GameSession, slot: number): void {
  const writer = new PacketWriter();
  writer.writeUint16(ROLE_CMD);
  writer.writeUint8(0x08);
  writer.writeUint8(slot & 0xff);
  session.writePacket(writer.payload(), DEFAULT_FLAGS, `Sending delete-role success for slot=${slot}`);
}

function sendDeleteRoleFailed(session: GameSession): void {
  const writer = new PacketWriter();
  writer.writeUint16(ROLE_CMD);
  writer.writeUint8(0x09);
  session.writePacket(writer.payload(), DEFAULT_FLAGS, 'Sending delete-role failed');
}

function sendCreateRoleNameExists(session: GameSession): void {
  const writer = new PacketWriter();
  writer.writeUint16(ROLE_CMD);
  writer.writeUint8(0x0e);
  session.writePacket(writer.payload(), DEFAULT_FLAGS, 'Sending create-role name-exists');
}

function sendCreateRoleOk(session: GameSession, role: UnknownRecord): void {
  const writer = new PacketWriter();
  writer.writeUint16(ROLE_CMD);
  writer.writeUint8(0x05);
  writer.writeUint8(role.slot & 0xff);
  writer.writeUint32(resolveRoleData(role));
  writer.writeUint16(role.entityType || session.roleEntityType || ENTITY_TYPE);
  writer.writeUint8(resolveRoleLevel(role));
  writer.writeString(`${role.roleName}\0`);
  writer.writeUint8(resolveBirthMonth(role));
  writer.writeUint8(resolveBirthDay(role));
  session.writePacket(
    writer.payload(),
    DEFAULT_FLAGS,
    `Sending create-role success for "${role.roleName}" entity_type=0x${(role.entityType || session.roleEntityType || ENTITY_TYPE).toString(16)}`
  );
}

async function sendCharacterRoster(session: GameSession, lineNo: number): Promise<void> {
  const characters = await listPersistedCharacters(session, { forceReload: true });
  const charactersBySlot = new Map<number, Record<string, unknown>>();
  for (const character of characters) {
    const slot = numberOrDefault(character.slot, -1);
    if (slot >= 0 && slot < MAX_CHARACTER_SLOTS && !charactersBySlot.has(slot)) {
      charactersBySlot.set(slot, normalizeCharacterRecord(character));
    }
  }

  const writer = new PacketWriter();
  writer.writeUint16(LOGIN_CMD);
  writer.writeUint8(LOGIN_CHARACTER_ROSTER_RESULT);
  for (let index = 0; index < 8; index += 1) {
    writer.writeUint8(index === 0 ? (lineNo & 0xff) : 0);
  }

  for (let slot = 0; slot < MAX_CHARACTER_SLOTS; slot += 1) {
    const character = charactersBySlot.get(slot) || null;
    if (!character) {
      writer.writeUint32(0);
      continue;
    }

    writer.writeUint32(resolveRoleData(character));
    writer.writeUint16(
      numberOrDefault(character.roleEntityType, numberOrDefault(character.entityType, ENTITY_TYPE))
    );
    writer.writeUint8(resolveRoleLevel(character));
    writer.writeString(`${String(character.charName || character.roleName || 'Hero')}\0`);
    writer.writeUint8(resolveBirthMonth(character));
    writer.writeUint8(resolveBirthDay(character));
  }

  session.writePacket(
    writer.payload(),
    DEFAULT_FLAGS,
    `Sending character roster with ${characters.length} persisted role(s) for line ${lineNo}`
  );
}

async function sendGameServerRedirect(session: GameSession): Promise<void> {
  const persisted = (await session.loadPersistedCharacter({ forceReload: true })) || session.getPersistedCharacter();
  const roleData = persisted ? resolveRoleData(persisted) : session.roleData;
  const questStateV2 = normalizeQuestStateV2(
    persisted?.questStateV2 && typeof persisted.questStateV2 === 'object'
      ? persisted.questStateV2 as UnknownRecord
      : (
        session.questStateV2 && typeof session.questStateV2 === 'object'
          ? session.questStateV2 as UnknownRecord
          : {}
      )
  );
  const accountKey = typeof session.accountKey === 'string' ? session.accountKey.trim() : '';
  if (!accountKey) {
    session.log('Cannot prepare game-server redirect without account name');
    session.socket.destroy();
    return;
  }
  session.sharedState.pendingGameCharacters.set(accountKey, {
    redirectSourceSessionId: session.id >>> 0,
    accountName: session.accountName,
    accountKey,
    charName: persisted?.charName || persisted?.roleName || session.charName,
    runtimeId: 0,
    entityType: session.entityType || ENTITY_TYPE,
    roleEntityType: persisted?.roleEntityType || session.roleEntityType,
    roleData,
    selectedAptitude: persisted?.selectedAptitude || session.selectedAptitude || 0,
    level: persisted?.level || session.level || 1,
    experience: persisted?.experience || session.experience || 0,
    currentHealth: persisted?.currentHealth || session.currentHealth || CHARACTER_VITALS_BASELINE.health,
    currentMana: persisted?.currentMana || session.currentMana || CHARACTER_VITALS_BASELINE.mana,
    currentRage: persisted?.currentRage || session.currentRage || 100,
    maxHealth: persisted?.maxHealth || session.maxHealth || CHARACTER_VITALS_BASELINE.health,
    maxMana: persisted?.maxMana || session.maxMana || CHARACTER_VITALS_BASELINE.mana,
    maxRage: persisted?.maxRage || session.maxRage || 100,
    gold: persisted?.gold || session.gold || 0,
    bankGold: persisted?.bankGold || session.bankGold || 0,
    boundGold: persisted?.boundGold || session.boundGold || 0,
    coins: persisted?.coins || session.coins || 0,
    renown: persisted?.renown || session.renown || 0,
    primaryAttributes: normalizePrimaryAttributes(persisted?.primaryAttributes || session.primaryAttributes),
    bonusAttributes: normalizeBonusAttributes(persisted?.bonusAttributes || session.bonusAttributes),
    skillState: normalizeSkillState(persisted?.skillState || session.skillState),
    statusPoints: persisted?.statusPoints || session.statusPoints || 0,
    questStateV2,
    pets: normalizePets(Array.isArray(persisted?.pets) ? persisted.pets : session.pets),
    selectedPetRuntimeId:
      typeof persisted?.selectedPetRuntimeId === 'number'
        ? persisted.selectedPetRuntimeId >>> 0
        : session.selectedPetRuntimeId,
    petSummoned: persisted?.petSummoned === true || session.petSummoned === true,
    frogTeleporterUnlocks:
      persisted?.frogTeleporterUnlocks && typeof persisted.frogTeleporterUnlocks === 'object'
        ? persisted.frogTeleporterUnlocks
        : session.frogTeleporterUnlocks,
    inventory: normalizeInventoryState(persisted || session).inventory,
    slot: typeof persisted?.slot === 'number' ? persisted.slot : 0,
    characterId: typeof persisted?.characterId === 'string' ? persisted.characterId : null,
    birthMonth: typeof persisted?.birthMonth === 'number' ? persisted.birthMonth : 0,
    birthDay: typeof persisted?.birthDay === 'number' ? persisted.birthDay : 0,
    mapId: typeof persisted?.mapId === 'number' ? persisted.mapId : session.currentMapId,
    x: typeof persisted?.x === 'number' ? persisted.x : session.currentX,
    y: typeof persisted?.y === 'number' ? persisted.y : session.currentY,
  });

  const writer = new PacketWriter();
  writer.writeUint16(LOGIN_CMD);
  writer.writeUint8(REDIRECT_RESULT);
  writer.writeString(`${SERVER_HOST}\0`);
  writer.writeUint16(PORT);
  writer.writeUint32(0);
  session.writePacket(writer.payload(), DEFAULT_FLAGS, `Sending 0x0d game-server redirect to ${SERVER_HOST}:${PORT}`);
}

async function resumePendingWorldEntryAfterWorldTeardown(session: GameSession): Promise<void> {
  if (!isWorldSession(session)) {
    return;
  }

  const loginSession = getPairedSession(session);
  if (!loginSession || !isLoginSession(loginSession) || loginSession.socket.destroyed) {
    return;
  }
  if (!hasPendingWorldEntryRequest(loginSession)) {
    return;
  }

  const slotIndex = loginSession.pendingWorldEntrySlot;
  if (slotIndex === null) {
    clearPendingWorldEntryRequest(loginSession);
    return;
  }

  try {
    await session.saveCharacter(session.buildCharacterSnapshot());
    traceWorldExitLifecycle(session, 'persisted-before-queued-world-entry-resume', {
      loginSessionId: loginSession.id >>> 0,
      queuedSlot: slotIndex & 0xff,
    });
  } catch (error) {
    session.log(`Failed to persist world state before queued world-entry resume: ${(error as Error).message}`);
  }

  const accountKey = typeof loginSession.accountKey === 'string' ? loginSession.accountKey.trim() : '';
  if (accountKey && hasActiveWorldAccount(loginSession.sharedState, accountKey, null)) {
    loginSession.log(
      `Waiting to resume queued world-entry request because another world session is still active key="${accountKey}"`
    );
    return;
  }

  const selectedCharacter = await selectPersistedCharacter(loginSession, { slot: slotIndex });
  if (!selectedCharacter) {
    loginSession.log(`Queued world-entry request resolved to empty slot=${slotIndex}`);
    clearPendingWorldEntryRequest(loginSession);
    await sendCharacterRoster(loginSession, 1);
    return;
  }

  traceWorldExitLifecycle(loginSession, 'resume-queued-world-entry', {
    previousWorldSessionId: session.id >>> 0,
    queuedSlot: slotIndex & 0xff,
  });
  clearPendingWorldEntryRequest(loginSession);
  await sendGameServerRedirect(loginSession);
}

async function replayPersistedCharacter(session: GameSession): Promise<void> {
  const characters = await listPersistedCharacters(session, { forceReload: true });
  if (characters.length < 1) {
    session.log('No persisted role to replay');
    return;
  }

  for (const character of characters) {
    const normalized = normalizeCharacterRecord(character);
    sendCreateRoleOk(session, {
      slot: numberOrDefault(normalized.slot, 0),
      roleName: normalized.charName || normalized.roleName || session.charName,
      entityType: normalized.roleEntityType || session.roleEntityType || ENTITY_TYPE,
      roleData: resolveRoleData(normalized),
      level: resolveRoleLevel(normalized),
      birthMonth: resolveBirthMonth(normalized),
      birthDay: resolveBirthDay(normalized),
    });
  }
}

export {
  handleLogin,
  handleRolePacket,
  handleCreateRole,
  resumePendingWorldEntryAfterWorldTeardown,
  sendLoginServerList,
  sendLineSelectOk,
  sendGameServerRedirect,
  sendCreateRoleOk,
  sendCharacterRoster,
  replayPersistedCharacter,
};
