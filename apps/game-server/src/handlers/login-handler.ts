import { parseCreateRole, parseLoginPacket } from '../protocol/inbound-packets.js';
import { PacketWriter } from '../protocol.js';
import { AREA_ID, DEFAULT_FLAGS, ENTITY_TYPE, LOGIN_CMD, LOGIN_SERVER_LIST_RESULT, LINE_SELECT_RESULT, MAP_ID, PORT, REDIRECT_RESULT, ROLE_CMD, SERVER_HOST, SINGLE_WORLD_SESSION_PER_REMOTE, SPAWN_X, SPAWN_Y, } from '../config.js';
import { deriveStableRoleData, packRoleData, resolveRoleData, resolveRoleLevel, resolveBirthMonth, resolveBirthDay, } from '../character/role-utils.js';
import { defaultBonusAttributes, numberOrDefault, defaultPrimaryAttributes, normalizeBonusAttributes, normalizePrimaryAttributes, normalizeCharacterRecord, normalizeSkillState, } from '../character/normalize.js';
import { normalizeQuestState } from '../quest-engine/index.js';
import { normalizeInventoryState } from '../inventory/index.js';
import { normalizePets } from '../pet-runtime.js';
import { CHARACTER_VITALS_BASELINE, recomputeSessionMaxVitals } from '../gameplay/session-flows.js';
import { hasActiveWorldAccount, replaceExistingWorldSessionsForRemote } from '../world-state.js';
import { hydratePendingGameCharacter } from '../character/session-hydration.js';
import { authenticateGameLogin } from '../db/game-login-auth.js';
import {
  filterLegacyCompletedQuestIds,
  filterLegacyQuestRecords,
  normalizeQuestState as normalizeQuestStateV2,
} from '../quest2/index.js';

import type { UnknownRecord } from '../utils.js';
import type { GameSession } from '../types.js';

function parseLoginPayload(_session: GameSession, payload: Buffer): UnknownRecord | null {
  if (payload.length < 6 || payload.readUInt16LE(0) !== LOGIN_CMD) {
    return null;
  }
  return parseLoginPacket(payload);
}

function handleLogin(session: GameSession, payload: Buffer): void {
  const cmdByte = payload[0];
  session.log(`Login packet cmd=0x${cmdByte.toString(16)} mode=${session.isGame ? 'GAME' : 'LOGIN'}`);

  const login = parseLoginPayload(session, payload);
  if (login) {
    const authResult = authenticateGameLogin({
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
    if (hasActiveWorldAccount(session.sharedState, session.accountKey || authResult.accountId, session.id)) {
      session.log(`Rejecting duplicate login for account="${authResult.accountId}" key="${session.accountKey}"`);
      session.socket.destroy();
      return;
    }
    session.isGame =
      session.sharedState?.pendingGameCharacters instanceof Map &&
      session.sharedState.pendingGameCharacters.has(session.accountKey || authResult.accountId);
  }

  session.state = 'LOGGED_IN';
  if (session.isGame) {
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

function handleRolePacket(session: GameSession, payload: Buffer): void {
  if (payload.length < 3) {
    session.log('Short 0x044c payload');
    return;
  }

  const subcmd = payload[2];
  const roleHandlers: Record<number, () => void> = {
    0x04: () => handleCreateRole(session, payload),
    0x0d: () => {
      const slotIndex = payload.length >= 4 ? payload[3] : 0;
      session.log(`Enter game request slot=${slotIndex}`);
      if (session.isGame) {
        session.sendEnterGameOk();
      } else {
        sendGameServerRedirect(session);
      }
    },
    0x1c: () => {
      const lineNo = payload.length >= 4 ? payload[3] : 0;
      session.log(`Line select request for line ${lineNo}`);
      sendLineSelectOk(session, lineNo);
    },
  };

  const handler = roleHandlers[subcmd];
  if (handler) {
    handler();
  } else {
    session.log(`Unhandled 0x044c subcmd=0x${subcmd.toString(16)}`);
  }
}

function handleCreateRole(session: GameSession, payload: Buffer): void {
  if (payload.length < 6) {
    session.log('Short create-role payload');
    return;
  }

  const { templateIndex, roleName, birthMonth, birthDay, selectedAptitude, extra1, extra2 } = parseCreateRole(payload);

  session.log(
    `Create role request template=0x${templateIndex.toString(16)} name="${roleName}" month=${birthMonth} day=${birthDay} selectedAptitude=${selectedAptitude} extra1=0x${extra1.toString(16)} extra2=0x${extra2.toString(16)}`
  );

  session.charName = roleName || 'Hero';
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
  session.activeQuests = [];
  session.completedQuests = [];
  session.saveCharacter({
    slot: 0,
    roleName: session.charName,
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
    activeQuests: session.activeQuests,
    completedQuests: session.completedQuests,
    mapId: MAP_ID,
    x: SPAWN_X,
    y: SPAWN_Y,
  });
  sendCreateRoleOk(session, {
    slot: 0,
    roleName: session.charName,
    birthMonth,
    birthDay,
    level: 1,
    extra1,
    extra2,
    roleData: session.roleData,
  });
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

function sendLineSelectOk(session: GameSession, lineNo: number): void {
  const writer = new PacketWriter();
  writer.writeUint16(LOGIN_CMD);
  writer.writeUint8(LINE_SELECT_RESULT);
  writer.writeUint8(lineNo & 0xff);
  session.writePacket(writer.payload(), DEFAULT_FLAGS, `Sending line-select success for line ${lineNo}`);
  replayPersistedCharacter(session);
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

function sendGameServerRedirect(session: GameSession): void {
  const persisted = session.getPersistedCharacter();
  const roleData = persisted ? resolveRoleData(persisted) : session.roleData;
  const legacyQuestState = normalizeQuestState(persisted || {});
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
    activeQuests: filterLegacyQuestRecords(legacyQuestState.activeQuests as UnknownRecord[]),
    completedQuests: filterLegacyCompletedQuestIds(legacyQuestState.completedQuests),
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

function replayPersistedCharacter(session: GameSession): void {
  const character = session.getPersistedCharacter();
  if (!character) {
    session.log('No persisted role to replay');
    return;
  }

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

export {
  handleLogin,
  handleRolePacket,
  handleCreateRole,
  sendLoginServerList,
  sendLineSelectOk,
  sendGameServerRedirect,
  sendCreateRoleOk,
  replayPersistedCharacter,
};
