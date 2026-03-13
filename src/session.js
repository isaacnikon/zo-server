'use strict';

const {
  AREA_ID,
  DEFAULT_FLAGS,
  ENTITY_TYPE,
  GAME_SPAWN_BATCH_SUBCMD,
  GAME_POSITION_QUERY_CMD,
  GAME_SELF_STATE_CMD,
  HANDSHAKE_CMD,
  LOGIN_CMD,
  LOGIN_SERVER_LIST_RESULT,
  LINE_SELECT_RESULT,
  MAP_ID,
  FORCE_START_SCENE,
  PING_CMD,
  PONG_CMD,
  PORT,
  REDIRECT_RESULT,
  ROLE_CMD,
  SELF_STATE_APTITUDE_SUBCMD,
  SPAWN_X,
  SPAWN_Y,
  STATIC_NPCS,
  SPECIAL_FLAGS,
  VALID_FLAG_MASK,
  VALID_FLAG_VALUE,
} = require('./config');
const { PacketWriter, buildPacket } = require('./protocol');

class Session {
  constructor(socket, id, isGame, sharedState, logger) {
    this.socket = socket;
    this.id = id;
    this.isGame = isGame;
    this.sharedState = sharedState;
    this.logger = logger;
    this.recvBuf = Buffer.alloc(0);
    this.serverSeq = 0;
    this.clientSeq = 0;
    this.state = 'CONNECTED';
    this.accountName = null;
    this.charName = 'Hero';
    this.entityType = ENTITY_TYPE;
    this.roleEntityType = ENTITY_TYPE;
    this.roleData = 0;
    this.selectedAptitude = 0;
    this.currentMapId = MAP_ID;
    this.currentX = SPAWN_X;
    this.currentY = SPAWN_Y;

    if (isGame && sharedState.pendingGameCharacter) {
      this.charName = sharedState.pendingGameCharacter.charName;
      this.entityType = sharedState.pendingGameCharacter.entityType;
      this.roleEntityType = sharedState.pendingGameCharacter.roleEntityType || this.entityType;
      this.roleData = sharedState.pendingGameCharacter.roleData || 0;
      this.selectedAptitude = sharedState.pendingGameCharacter.selectedAptitude || 0;
      this.currentMapId = FORCE_START_SCENE ? MAP_ID : (sharedState.pendingGameCharacter.mapId || MAP_ID);
      this.currentX = FORCE_START_SCENE ? SPAWN_X : (sharedState.pendingGameCharacter.x || SPAWN_X);
      this.currentY = FORCE_START_SCENE ? SPAWN_Y : (sharedState.pendingGameCharacter.y || SPAWN_Y);
      sharedState.pendingGameCharacter = null;
    }
  }

  feed(data) {
    this.recvBuf = Buffer.concat([this.recvBuf, data]);
    while (this.recvBuf.length >= 5) {
      const flags = this.recvBuf[0];
      if ((flags & VALID_FLAG_MASK) !== VALID_FLAG_VALUE) {
        this.log(`Bad flags byte: 0x${flags.toString(16)} — dropping connection`);
        this.socket.destroy();
        return;
      }

      const payloadLen = this.recvBuf.readUInt16LE(1);
      const totalLen = 5 + payloadLen;
      if (this.recvBuf.length < totalLen) {
        break;
      }

      const seq = this.recvBuf.readUInt16LE(3);
      const payload = this.recvBuf.slice(5, totalLen);
      this.recvBuf = this.recvBuf.slice(totalLen);

      this.log(`RECV pkt flags=0x${flags.toString(16)} len=${payloadLen} seq=${seq}`);
      this.logger.log(this.logger.hexDump(payload, `[S${this.id}] < `));
      this.handlePacket(flags, seq, payload);
    }
  }

  handlePacket(flags, seq, payload) {
    if (payload.length === 0) {
      return;
    }

    const cmdByte = payload[0];
    const cmdWord = payload.length >= 2 ? payload.readUInt16LE(0) : cmdByte;
    this.log(`CMD8=0x${cmdByte.toString(16).padStart(2, '0')} CMD16=0x${cmdWord.toString(16).padStart(4, '0')} state=${this.state}`);
    const readable = payload.toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    this.log(`ASCII: ${readable}`);

    if (this.state === 'CONNECTED') {
      this.handleLogin(payload);
      return;
    }

    if (this.state === 'LOGGED_IN') {
      this.handleLoggedInPacket(flags, payload);
    }
  }

  handleLogin(payload) {
    const cmdByte = payload[0];
    this.log(`Login packet cmd=0x${cmdByte.toString(16)} mode=${this.isGame ? 'GAME' : 'LOGIN'}`);
    this.log(`Full payload hex: ${payload.toString('hex')}`);

    for (let i = 0; i < payload.length - 1; i += 1) {
      let str = '';
      while (i < payload.length && payload[i] >= 0x20 && payload[i] < 0x7f) {
        str += String.fromCharCode(payload[i]);
        i += 1;
      }
      if (str.length > 3) {
        this.log(`String at ${i}: "${str}"`);
      }
    }

    const login = this.parseLoginPayload(payload);
    if (login) {
      this.accountName = login.username;
      this.log(`Parsed account="${login.username}"`);
    }

    this.state = 'LOGGED_IN';
    if (this.isGame) {
      this.sendEnterGameOk();
    } else {
      this.sendLoginServerList();
    }
  }

  handleLoggedInPacket(flags, payload) {
    const cmdByte = payload[0];
    const cmdWord = payload.length >= 2 ? payload.readUInt16LE(0) : cmdByte;
    this.log(`Game packet flags=0x${flags.toString(16)} cmd8=0x${cmdByte.toString(16).padStart(2, '0')} cmd16=0x${cmdWord.toString(16).padStart(4, '0')}`);

    if ((flags & 0x04) !== 0 && payload.length >= 6) {
      this.handleSpecialPacket(cmdWord, payload);
      return;
    }

    if (cmdWord === ROLE_CMD) {
      this.handleRolePacket(payload);
      return;
    }

    if (cmdWord === GAME_POSITION_QUERY_CMD) {
      this.handlePositionUpdate(payload);
      return;
    }

    this.log(`Unhandled game cmd8=0x${cmdByte.toString(16)} cmd16=0x${cmdWord.toString(16)}`);
  }

  handleSpecialPacket(cmdWord, payload) {
    if (cmdWord === PING_CMD) {
      const token = payload.readUInt32LE(2);
      this.sendPong(token);
      return;
    }

    this.log(`Unhandled special cmd16=0x${cmdWord.toString(16)}`);
  }

  handleRolePacket(payload) {
    if (payload.length < 3) {
      this.log('Short 0x044c payload');
      return;
    }

    const subcmd = payload[2];
    if (subcmd === 0x04) {
      this.handleCreateRole(payload);
      return;
    }

    if (subcmd === 0x0d) {
      const slotIndex = payload.length >= 4 ? payload[3] : 0;
      this.log(`Enter game request slot=${slotIndex}`);
      if (this.isGame) {
        this.sendEnterGameOk();
      } else {
        this.sendGameServerRedirect();
      }
      return;
    }

    if (subcmd === 0x1c) {
      const lineNo = payload.length >= 4 ? payload[3] : 0;
      this.log(`Line select request for line ${lineNo}`);
      this.sendLineSelectOk(lineNo);
      return;
    }

    this.log(`Unhandled 0x044c subcmd=0x${subcmd.toString(16)}`);
  }

  handleCreateRole(payload) {
    if (payload.length < 6) {
      this.log('Short create-role payload');
      return;
    }

    const templateIndex = payload[3];
    const nameLen = payload.readUInt16LE(4);
    const nameStart = 6;
    const nameEnd = Math.min(payload.length, nameStart + nameLen);
    const roleName = payload.slice(nameStart, nameEnd).toString('latin1').replace(/\0.*$/, '');
    const birthMonth = payload.length > nameEnd ? payload[nameEnd] : 0;
    const birthDay = payload.length > nameEnd + 1 ? payload[nameEnd + 1] : 0;
    const selectedAptitude = payload.length > nameEnd + 2 ? payload[nameEnd + 2] : 0;
    const extra1 = payload.length >= nameEnd + 5 ? payload.readUInt16LE(nameEnd + 3) : 0;
    const extra2 = payload.length >= nameEnd + 7 ? payload.readUInt16LE(nameEnd + 5) : 0;

    this.log(
      `Create role request template=0x${templateIndex.toString(16)} name="${roleName}" month=${birthMonth} day=${birthDay} selectedAptitude=${selectedAptitude} extra1=0x${extra1.toString(16)} extra2=0x${extra2.toString(16)}`
    );

    this.charName = roleName || 'Hero';
    this.entityType = ENTITY_TYPE;
    this.roleEntityType = ENTITY_TYPE + templateIndex;
    this.roleData = packRoleData(extra1, extra2);
    this.selectedAptitude = selectedAptitude;
    this.saveCharacter({
      slot: 0,
      roleName: this.charName,
      birthMonth,
      birthDay,
      selectedAptitude,
      extra1,
      extra2,
      level: 1,
      requestedTemplateIndex: templateIndex,
      entityType: this.entityType,
      roleEntityType: this.roleEntityType,
      roleData: this.roleData,
      mapId: MAP_ID,
      x: SPAWN_X,
      y: SPAWN_Y,
    });
    this.sendCreateRoleOk({
      slot: 0,
      roleName: this.charName,
      birthMonth,
      birthDay,
      level: 1,
      extra1,
      extra2,
      roleData: this.roleData,
    });
  }

  sendHandshake() {
    const writer = new PacketWriter();
    writer.writeUint16(HANDSHAKE_CMD);
    writer.writeUint32(0);
    this.writePacket(writer.payload(), SPECIAL_FLAGS, 'Sending handshake (flags=0x44, seed=0, no encryption)');
  }

  sendLoginServerList() {
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
    writer.writeString('127.0.0.1');
    writer.writeUint8(0);
    writer.writeUint8(0);
    writer.writeUint32(0);
    writer.writeUint32(0);
    writer.writeString('');
    writer.writeUint8(0);
    this.writePacket(writer.payload(), DEFAULT_FLAGS, 'Sending login server-list response');
  }

  sendLineSelectOk(lineNo) {
    const writer = new PacketWriter();
    writer.writeUint16(LOGIN_CMD);
    writer.writeUint8(LINE_SELECT_RESULT);
    writer.writeUint8(lineNo & 0xff);
    this.writePacket(writer.payload(), DEFAULT_FLAGS, `Sending line-select success for line ${lineNo}`);
    this.replayPersistedCharacter();
  }

  sendCreateRoleOk(role) {
    const writer = new PacketWriter();
    writer.writeUint16(ROLE_CMD);
    writer.writeUint8(0x05);
    writer.writeUint8(role.slot & 0xff);
    writer.writeUint32(resolveRoleData(role));
    writer.writeUint16(role.entityType || this.roleEntityType || ENTITY_TYPE);
    writer.writeUint8(resolveRoleLevel(role));
    writer.writeString(`${role.roleName}\0`);
    writer.writeUint8(resolveBirthMonth(role));
    writer.writeUint8(resolveBirthDay(role));
    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending create-role success for "${role.roleName}" entity_type=0x${(role.entityType || this.roleEntityType || ENTITY_TYPE).toString(16)}`
    );
  }

  sendGameServerRedirect() {
    const persisted = this.getPersistedCharacter();
    const roleData = persisted ? resolveRoleData(persisted) : this.roleData;
    this.sharedState.pendingGameCharacter = {
      accountName: this.accountName,
      charName: persisted?.roleName || this.charName,
      entityType: persisted?.roleEntityType || this.roleEntityType || this.entityType,
      roleEntityType: persisted?.roleEntityType || this.roleEntityType,
      roleData,
      selectedAptitude: persisted?.selectedAptitude || this.selectedAptitude || 0,
      mapId: FORCE_START_SCENE ? MAP_ID : (persisted?.mapId || this.currentMapId || MAP_ID),
      x: FORCE_START_SCENE ? SPAWN_X : (persisted?.x || this.currentX || SPAWN_X),
      y: FORCE_START_SCENE ? SPAWN_Y : (persisted?.y || this.currentY || SPAWN_Y),
    };
    this.sharedState.nextSessionIsGame = true;

    const writer = new PacketWriter();
    writer.writeUint16(LOGIN_CMD);
    writer.writeUint8(REDIRECT_RESULT);
    writer.writeString('127.0.0.1\0');
    writer.writeUint16(PORT);
    writer.writeUint16(0);
    writer.writeUint16(0);
    this.writePacket(writer.payload(), DEFAULT_FLAGS, `Sending 0x0d game-server redirect to 127.0.0.1:${PORT}`);
  }

  sendEnterGameOk() {
    const writer = new PacketWriter();
    writer.writeUint16(LOGIN_CMD);
    writer.writeUint8(LOGIN_SERVER_LIST_RESULT);
    writer.writeUint32(0);
    writer.writeUint16(this.entityType);
    writer.writeUint32(this.roleData);
    writer.writeUint16(this.currentX);
    writer.writeUint16(this.currentY);
    writer.writeUint16(0);
    writer.writeString(`${this.charName}\0`);
    writer.writeUint8(0);
    writer.writeUint16(this.currentMapId);
    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending enter-game success char="${this.charName}" entity=0x${this.entityType.toString(16)} roleEntity=0x${this.roleEntityType.toString(16)} aptitude=${this.selectedAptitude} map=${this.currentMapId} pos=${this.currentX},${this.currentY}`
    );
    this.sendSelfStateAptitudeSync();
    this.sendStaticNpcSpawns();
  }

  sendPong(token) {
    const writer = new PacketWriter();
    writer.writeUint16(PONG_CMD);
    writer.writeUint32(token);
    this.writePacket(writer.payload(), SPECIAL_FLAGS, `Sending pong token=0x${token.toString(16)}`);
  }

  writePacket(payload, flags, message) {
    const packet = buildPacket(payload, this.serverSeq, flags);
    this.serverSeq += 1;
    if (this.serverSeq > 65000) {
      this.serverSeq = 1;
    }
    this.log(message);
    this.logger.log(this.logger.hexDump(packet, `[S${this.id}] > `));
    this.socket.write(packet);
  }

  log(message) {
    this.logger.log(`[S${this.id}] ${message}`);
  }

  parseLoginPayload(payload) {
    if (payload.length < 6 || payload.readUInt16LE(0) !== LOGIN_CMD) {
      return null;
    }

    const usernameLen = payload.readUInt16LE(2);
    const usernameStart = 4;
    const usernameEnd = usernameStart + usernameLen;
    if (usernameEnd > payload.length) {
      return null;
    }

    const username = payload.slice(usernameStart, usernameEnd).toString('latin1').replace(/\0.*$/, '');
    return username ? { username } : null;
  }

  getPersistedCharacter() {
    return this.sharedState.characterStore?.get(this.accountName) || null;
  }

  saveCharacter(character) {
    if (!this.accountName || !this.sharedState.characterStore) {
      return;
    }
    this.sharedState.characterStore.set(this.accountName, character);
    this.log(`Persisted character "${character.roleName}" for account "${this.accountName}"`);
  }

  replayPersistedCharacter() {
    const character = this.getPersistedCharacter();
    if (!character) {
      return;
    }

    this.charName = character.roleName;
    this.entityType = ENTITY_TYPE;
    this.roleEntityType = character.roleEntityType || ENTITY_TYPE;
    this.roleData = resolveRoleData(character);
    this.selectedAptitude = character.selectedAptitude || 0;
    this.currentMapId = FORCE_START_SCENE ? MAP_ID : (character.mapId || MAP_ID);
    this.currentX = FORCE_START_SCENE ? SPAWN_X : (character.x || SPAWN_X);
    this.currentY = FORCE_START_SCENE ? SPAWN_Y : (character.y || SPAWN_Y);
    this.sendCreateRoleOk({
      ...character,
      entityType: this.roleEntityType,
    });
    this.log(`Replayed persisted character "${character.roleName}" for account "${this.accountName}"`);
  }

  handlePositionUpdate(payload) {
    if (payload.length < 8) {
      this.log('Short 0x03eb payload');
      return;
    }

    const x = payload.readUInt16LE(2);
    const y = payload.readUInt16LE(4);
    const mapId = payload.readUInt16LE(6);
    this.currentX = x;
    this.currentY = y;
    this.currentMapId = mapId;
    this.log(`Position update map=${mapId} pos=${x},${y}`);

    const persisted = this.getPersistedCharacter();
    if (!persisted) {
      return;
    }

    this.saveCharacter({
      ...persisted,
      mapId,
      x,
      y,
    });
  }

  sendSelfStateAptitudeSync() {
    const writer = new PacketWriter();
    writer.writeUint16(GAME_SELF_STATE_CMD);
    writer.writeUint8(SELF_STATE_APTITUDE_SUBCMD);
    writer.writeUint8(this.selectedAptitude & 0xff);

    // Minimal self-state payload for FUN_00430300 case 10.
    writer.writeUint32(0);
    writer.writeUint32(0);
    writer.writeUint32(0);
    writer.writeUint8(0);
    writer.writeUint32(0);
    writer.writeUint32(0);
    writer.writeUint32(0);
    writer.writeUint32(0);
    writer.writeUint32(0);
    writer.writeUint32(0);
    writer.writeUint16(0);
    writer.writeUint16(1);
    writer.writeUint16(15);
    writer.writeUint16(15);
    writer.writeUint16(15);
    writer.writeUint16(15);
    writer.writeUint16(0);
    writer.writeUint8(0);

    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending self-state aptitude sync cmd=0x${GAME_SELF_STATE_CMD.toString(16)} sub=0x${SELF_STATE_APTITUDE_SUBCMD.toString(16)} aptitude=${this.selectedAptitude}`
    );
  }

  dispose() {}

  sendStaticNpcSpawns() {
    if (!Array.isArray(STATIC_NPCS) || STATIC_NPCS.length === 0) {
      return;
    }

    const writer = new PacketWriter();
    writer.writeUint16(GAME_POSITION_QUERY_CMD);
    writer.writeUint8(GAME_SPAWN_BATCH_SUBCMD);
    writer.writeUint16(STATIC_NPCS.length);

    for (const npc of STATIC_NPCS) {
      this.writeNpcSpawnRecord(writer, npc);
    }

    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending static NPC spawn batch cmd=0x${GAME_POSITION_QUERY_CMD.toString(16)} count=${STATIC_NPCS.length}`
    );
  }

  writeNpcSpawnRecord(writer, npc) {
    const x = (typeof npc.x === 'number' ? npc.x : this.currentX + (npc.dx || 0)) & 0xffff;
    const y = (typeof npc.y === 'number' ? npc.y : this.currentY + (npc.dy || 0)) & 0xffff;

    writer.writeUint32(npc.id >>> 0);
    writer.writeUint16(npc.entityType & 0xffff);
    writer.writeUint16(x);
    writer.writeUint16(y);

    if (typeof npc.clientNpcType !== 'number') {
      return;
    }

    // Extended ParseEntitySpawnFrom03eb form used for entities that need
    // a client-side NPC appearance override via entity+0x5d8.
    writer.writeUint32(0);
    writer.writeUint16(0);
    writer.writeString(`${npc.name || ''}\0`);

    writer.writeUint16(npc.clientNpcType & 0xffff);
    writer.writeUint8(0);
    writer.writeUint16(0);
    writer.writeUint8(0);
    writer.writeUint16(2);
    writer.writeUint8(0);

    writer.writeUint16(0);
  }
}

function packRoleData(extra1, extra2) {
  return ((extra2 & 0xffff) << 16) | (extra1 & 0xffff);
}

function resolveRoleData(role) {
  if (typeof role.extra1 === 'number' || typeof role.extra2 === 'number') {
    return packRoleData(role.extra1 || 0, role.extra2 || 0) >>> 0;
  }
  if (typeof role.roleData === 'number' && typeof role.aptitude === 'number') {
    return role.roleData >>> 0;
  }
  return 0;
}

function resolveRoleLevel(role) {
  if (typeof role.level === 'number') {
    return role.level & 0xff;
  }
  return 1;
}

function resolveBirthMonth(role) {
  if (typeof role.birthMonth === 'number') {
    return role.birthMonth & 0xff;
  }
  return (role.trait1 || 0) & 0xff;
}

function resolveBirthDay(role) {
  if (typeof role.birthDay === 'number') {
    return role.birthDay & 0xff;
  }
  return (role.trait2 || 0) & 0xff;
}

module.exports = {
  Session,
};
