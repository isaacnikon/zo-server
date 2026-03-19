const { parseCreateRole, parseLoginPacket } = require('../protocol/inbound-packets');
const { PacketWriter } = require('../protocol');
const {
  AREA_ID,
  DEFAULT_FLAGS,
  ENTITY_TYPE,
  LOGIN_CMD,
  LOGIN_SERVER_LIST_RESULT,
  LINE_SELECT_RESULT,
  MAP_ID,
  PORT,
  REDIRECT_RESULT,
  ROLE_CMD,
  SERVER_HOST,
  SPAWN_X,
  SPAWN_Y,
} = require('../config');
const {
  packRoleData,
  resolveRoleData,
  resolveRoleLevel,
  resolveBirthMonth,
  resolveBirthDay,
} = require('../character/role-utils');
const {
  numberOrDefault,
  defaultPrimaryAttributes,
  normalizePrimaryAttributes,
  normalizeCharacterRecord,
} = require('../character/normalize');
const { normalizeQuestState } = require('../quest-engine');
const { normalizeInventoryState } = require('../inventory');
const { normalizePets } = require('../pet-runtime');
const { CHARACTER_VITALS_BASELINE } = require('../gameplay/session-flows');
const { resolveCharacterScene } = require('../scene-runtime');

type SessionLike = Record<string, any>;
type UnknownRecord = Record<string, any>;

function parseLoginPayload(_session: SessionLike, payload: Buffer): UnknownRecord | null {
  if (payload.length < 6 || payload.readUInt16LE(0) !== LOGIN_CMD) {
    return null;
  }
  return parseLoginPacket(payload);
}

function handleLogin(session: SessionLike, payload: Buffer): void {
  const cmdByte = payload[0];
  session.log(`Login packet cmd=0x${cmdByte.toString(16)} mode=${session.isGame ? 'GAME' : 'LOGIN'}`);
  session.log(`Full payload hex: ${payload.toString('hex')}`);

  for (let i = 0; i < payload.length - 1; i += 1) {
    let str = '';
    while (i < payload.length && payload[i] >= 0x20 && payload[i] < 0x7f) {
      str += String.fromCharCode(payload[i]);
      i += 1;
    }
    if (str.length > 3) {
      session.log(`String at ${i}: "${str}"`);
    }
  }

  const login = parseLoginPayload(session, payload);
  if (login) {
    session.accountName = login.username;
    session.log(`Parsed account="${login.username}"`);
  }

  session.state = 'LOGGED_IN';
  if (session.isGame) {
    session.sendEnterGameOk();
  } else {
    sendLoginServerList(session);
  }
}

function handleRolePacket(session: SessionLike, payload: Buffer): void {
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

function handleCreateRole(session: SessionLike, payload: Buffer): void {
  if (payload.length < 6) {
    session.log('Short create-role payload');
    return;
  }

  const { templateIndex, roleName, birthMonth, birthDay, selectedAptitude, extra1, extra2 } = parseCreateRole(payload);

  session.log(
    `Create role request template=0x${templateIndex.toString(16)} name="${roleName}" month=${birthMonth} day=${birthDay} selectedAptitude=${selectedAptitude} extra1=0x${extra1.toString(16)} extra2=0x${extra2.toString(16)}`
  );

  session.charName = roleName || 'Hero';
  session.entityType = ENTITY_TYPE;
  session.roleEntityType = ENTITY_TYPE + templateIndex;
  session.roleData = packRoleData(extra1, extra2);
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
  session.statusPoints = 0;
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

function sendLoginServerList(session: SessionLike): void {
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

function sendLineSelectOk(session: SessionLike, lineNo: number): void {
  const writer = new PacketWriter();
  writer.writeUint16(LOGIN_CMD);
  writer.writeUint8(LINE_SELECT_RESULT);
  writer.writeUint8(lineNo & 0xff);
  session.writePacket(writer.payload(), DEFAULT_FLAGS, `Sending line-select success for line ${lineNo}`);
  replayPersistedCharacter(session);
}

function sendCreateRoleOk(session: SessionLike, role: UnknownRecord): void {
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

function sendGameServerRedirect(session: SessionLike): void {
  const persisted = session.getPersistedCharacter();
  const roleData = persisted ? resolveRoleData(persisted) : session.roleData;
  session.sharedState.pendingGameCharacter = {
    accountName: session.accountName,
    charName: persisted?.charName || persisted?.roleName || session.charName,
    entityType: persisted?.roleEntityType || session.roleEntityType || session.entityType,
    roleEntityType: persisted?.roleEntityType || session.roleEntityType,
    roleData,
    selectedAptitude: persisted?.selectedAptitude || session.selectedAptitude || 0,
    level: persisted?.level || session.level || 1,
    experience: persisted?.experience || session.experience || 0,
    currentHealth: persisted?.currentHealth || session.currentHealth || CHARACTER_VITALS_BASELINE.health,
    currentMana: persisted?.currentMana || session.currentMana || CHARACTER_VITALS_BASELINE.mana,
    currentRage: persisted?.currentRage || session.currentRage || 100,
    gold: persisted?.gold || session.gold || 0,
    bankGold: persisted?.bankGold || session.bankGold || 0,
    boundGold: persisted?.boundGold || session.boundGold || 0,
    coins: persisted?.coins || session.coins || 0,
    renown: persisted?.renown || session.renown || 0,
    primaryAttributes: normalizePrimaryAttributes(persisted?.primaryAttributes || session.primaryAttributes),
    statusPoints: persisted?.statusPoints || session.statusPoints || 0,
    activeQuests: normalizeQuestState(persisted || {}).activeQuests,
    completedQuests: normalizeQuestState(persisted || {}).completedQuests,
    pets: normalizePets(Array.isArray(persisted?.pets) ? persisted.pets : session.pets),
    selectedPetRuntimeId:
      typeof persisted?.selectedPetRuntimeId === 'number'
        ? persisted.selectedPetRuntimeId >>> 0
        : session.selectedPetRuntimeId,
    petSummoned: persisted?.petSummoned === true || session.petSummoned === true,
    lastTownMapId: persisted?.lastTownMapId,
    lastTownX: persisted?.lastTownX,
    lastTownY: persisted?.lastTownY,
    inventory: normalizeInventoryState(persisted || session).inventory,
    mapId: resolveCharacterScene(persisted || session).mapId,
    x: resolveCharacterScene(persisted || session).x,
    y: resolveCharacterScene(persisted || session).y,
  };

  const writer = new PacketWriter();
  writer.writeUint16(LOGIN_CMD);
  writer.writeUint8(REDIRECT_RESULT);
  writer.writeString(`${SERVER_HOST}\0`);
  writer.writeUint16(PORT);
  writer.writeUint32(0);
  session.writePacket(writer.payload(), DEFAULT_FLAGS, `Sending 0x0d game-server redirect to ${SERVER_HOST}:${PORT}`);
  session.sharedState.nextSessionIsGame = true;
}

function replayPersistedCharacter(session: SessionLike): void {
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
