'use strict';

const fs = require('fs');

const {
  buildCombatTurnProfiles,
  loadCombatReference,
} = require('./combat-reference');

const {
  AREA_ID,
  COMBAT_PROBE_STATE_FILE,
  DEFAULT_FLAGS,
  ENTITY_TYPE,
  GAME_FIGHT_ACTION_CMD,
  GAME_FIGHT_CLIENT_CMD,
  GAME_FIGHT_MISC_CMD,
  GAME_FIGHT_RESULT_CMD,
  GAME_FIGHT_STATE_CMD,
  GAME_FIGHT_STREAM_CMD,
  GAME_FIGHT_TURN_CMD,
  GAME_DIALOG_CMD,
  GAME_SPAWN_BATCH_SUBCMD,
  GAME_POSITION_QUERY_CMD,
  GAME_SERVER_RUN_CMD,
  GAME_SCRIPT_EVENT_CMD,
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
  SERVER_SCRIPT_DEFERRED_SUBCMD,
  SERVER_SCRIPT_IMMEDIATE_SUBCMD,
  SPAWN_X,
  SPAWN_Y,
  SPECIAL_FLAGS,
  VALID_FLAG_MASK,
  VALID_FLAG_VALUE,
} = require('./config');
const {
  createCombatState,
  describeCombatCommand,
  isCombatCommand,
  parseCombatPacket,
  recordInboundCombatPacket,
  recordOutboundCombatPacket,
} = require('./combat-runtime');
const { PacketWriter, buildPacket } = require('./protocol');
const {
  describeScene,
  getBootstrapWorldSpawns,
  resolveCharacterScene,
  resolveEncounterAction,
  resolveServerRunAction,
  resolveTileSceneAction,
} = require('./scene-runtime');

const COMBAT_REFERENCE = loadCombatReference();
const COMBAT_TURN_PROBE_PROFILES = buildCombatTurnProfiles();

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
    this.level = 1;
    this.experience = 0;
    this.currentHealth = 398;
    this.currentMana = 600;
    this.currentRage = 100;
    this.gold = 0;
    this.bankGold = 0;
    this.boundGold = 0;
    this.coins = 0;
    this.renown = 0;
    this.primaryAttributes = {
      intelligence: 15,
      vitality: 15,
      dexterity: 15,
      strength: 15,
    };
    this.statusPoints = 0;
    this.currentMapId = MAP_ID;
    this.currentX = SPAWN_X;
    this.currentY = SPAWN_Y;
    this.currentTileSceneId = 0;
    this.currentEncounterTriggerId = null;
    this.combatState = createCombatState();
    this.pendingCombatTurnProbe = null;
    this.awaitingCombatTurnHandshake = false;
    this.syntheticFight = null;
    this.combatReference = COMBAT_REFERENCE;
    this.syntheticCommandRefreshTimer = null;

    if (isGame && sharedState.pendingGameCharacter) {
      this.charName = sharedState.pendingGameCharacter.charName;
      this.entityType = sharedState.pendingGameCharacter.entityType;
      this.roleEntityType = sharedState.pendingGameCharacter.roleEntityType || this.entityType;
      this.roleData = sharedState.pendingGameCharacter.roleData || 0;
      this.selectedAptitude = numberOrDefault(sharedState.pendingGameCharacter.selectedAptitude, 0);
      this.level = numberOrDefault(sharedState.pendingGameCharacter.level, 1);
      this.experience = numberOrDefault(sharedState.pendingGameCharacter.experience, 0);
      this.currentHealth = numberOrDefault(sharedState.pendingGameCharacter.currentHealth, 398);
      this.currentMana = numberOrDefault(sharedState.pendingGameCharacter.currentMana, 600);
      this.currentRage = numberOrDefault(sharedState.pendingGameCharacter.currentRage, 100);
      this.gold = numberOrDefault(sharedState.pendingGameCharacter.gold, 0);
      this.bankGold = numberOrDefault(sharedState.pendingGameCharacter.bankGold, 0);
      this.boundGold = numberOrDefault(sharedState.pendingGameCharacter.boundGold, 0);
      this.coins = numberOrDefault(sharedState.pendingGameCharacter.coins, 0);
      this.renown = numberOrDefault(sharedState.pendingGameCharacter.renown, 0);
      this.primaryAttributes = normalizePrimaryAttributes(sharedState.pendingGameCharacter.primaryAttributes);
      this.statusPoints = numberOrDefault(sharedState.pendingGameCharacter.statusPoints, 0);
      const scene = resolveCharacterScene(sharedState.pendingGameCharacter);
      this.currentMapId = scene.mapId;
      this.currentX = scene.x;
      this.currentY = scene.y;
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

    if (cmdWord === GAME_SERVER_RUN_CMD) {
      this.handleServerRunRequest(payload);
      return;
    }

    if (cmdWord === GAME_FIGHT_CLIENT_CMD || isCombatCommand(cmdWord)) {
      this.handleCombatPacket(cmdWord, payload);
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
    this.level = 1;
    this.experience = 0;
    this.currentHealth = 398;
    this.currentMana = 600;
    this.currentRage = 100;
    this.gold = 0;
    this.bankGold = 0;
    this.boundGold = 0;
    this.coins = 0;
    this.renown = 0;
    this.primaryAttributes = defaultPrimaryAttributes();
    this.statusPoints = 0;
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
      experience: this.experience,
      currentHealth: this.currentHealth,
      currentMana: this.currentMana,
      currentRage: this.currentRage,
      gold: this.gold,
      bankGold: this.bankGold,
      boundGold: this.boundGold,
      coins: this.coins,
      renown: this.renown,
      primaryAttributes: this.primaryAttributes,
      statusPoints: this.statusPoints,
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
      level: persisted?.level || this.level || 1,
      experience: persisted?.experience || this.experience || 0,
      currentHealth: persisted?.currentHealth || this.currentHealth || 398,
      currentMana: persisted?.currentMana || this.currentMana || 600,
      currentRage: persisted?.currentRage || this.currentRage || 100,
      gold: persisted?.gold || this.gold || 0,
      bankGold: persisted?.bankGold || this.bankGold || 0,
      boundGold: persisted?.boundGold || this.boundGold || 0,
      coins: persisted?.coins || this.coins || 0,
      renown: persisted?.renown || this.renown || 0,
      primaryAttributes: normalizePrimaryAttributes(persisted?.primaryAttributes || this.primaryAttributes),
      statusPoints: persisted?.statusPoints || this.statusPoints || 0,
      ...resolveCharacterScene({
        mapId: persisted?.mapId || this.currentMapId || MAP_ID,
        x: persisted?.x || this.currentX || SPAWN_X,
        y: persisted?.y || this.currentY || SPAWN_Y,
      }),
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
    writer.writeUint32(this.entityType >>> 0);
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
      `Sending enter-game success char="${this.charName}" runtimeId=0x${this.entityType.toString(16)} entity=0x${this.entityType.toString(16)} roleEntity=0x${this.roleEntityType.toString(16)} aptitude=${this.selectedAptitude} map=${this.currentMapId} (${describeScene(this.currentMapId)}) pos=${this.currentX},${this.currentY}`
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
    if (payload.length >= 2) {
      const cmdWord = payload.readUInt16LE(0);
      if (isCombatCommand(cmdWord)) {
        const combatPacket = parseCombatPacket(cmdWord, payload);
        const recorded = recordOutboundCombatPacket(this.combatState, combatPacket);
        this.combatState = recorded.state;

        if (Array.isArray(this.sharedState.combatTrace)) {
          this.sharedState.combatTrace.push({
            sessionId: this.id,
            timestamp: Date.now(),
            direction: 'outbound',
            inFight: recorded.snapshot.inFight,
            stateChanged: recorded.snapshot.stateChanged,
            ...combatPacket,
          });
          if (this.sharedState.combatTrace.length > 200) {
            this.sharedState.combatTrace.shift();
          }
        }

        const pieces = [
          `Combat send kind=${combatPacket.kind}`,
          `cmd=0x${cmdWord.toString(16)}`,
        ];
        if (combatPacket.subcmd !== null) {
          pieces.push(`sub=0x${combatPacket.subcmd.toString(16)}`);
        }
        if (combatPacket.detail16 !== null) {
          pieces.push(`detail16=${combatPacket.detail16}`);
        }
        if (combatPacket.detail32 !== null) {
          pieces.push(`detail32=${combatPacket.detail32}`);
        }
        pieces.push(`len=${combatPacket.payloadLength}`);
        pieces.push(`inFight=${recorded.snapshot.inFight ? 1 : 0}`);
        if (recorded.snapshot.stateChanged) {
          pieces.push('stateChanged=1');
        }
        this.log(pieces.join(' '));
      }
    }
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
    const character = this.sharedState.characterStore?.get(this.accountName) || null;
    if (!character) {
      return null;
    }
    return normalizeCharacterRecord(character);
  }

  saveCharacter(character) {
    if (!this.accountName || !this.sharedState.characterStore) {
      return;
    }
    const normalized = normalizeCharacterRecord(character);
    this.sharedState.characterStore.set(this.accountName, normalized);
    this.log(`Persisted character "${normalized.roleName}" for account "${this.accountName}"`);
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
    this.selectedAptitude = numberOrDefault(character.selectedAptitude, 0);
    this.level = numberOrDefault(character.level, 1);
    this.experience = numberOrDefault(character.experience, 0);
    this.currentHealth = numberOrDefault(character.currentHealth, 398);
    this.currentMana = numberOrDefault(character.currentMana, 600);
    this.currentRage = numberOrDefault(character.currentRage, 100);
    this.gold = numberOrDefault(character.gold, 0);
    this.bankGold = numberOrDefault(character.bankGold, 0);
    this.boundGold = numberOrDefault(character.boundGold, 0);
    this.coins = numberOrDefault(character.coins, 0);
    this.renown = numberOrDefault(character.renown, 0);
    this.primaryAttributes = normalizePrimaryAttributes(character.primaryAttributes);
    this.statusPoints = numberOrDefault(character.statusPoints, 0);
    const scene = resolveCharacterScene(character);
    this.currentMapId = scene.mapId;
    this.currentX = scene.x;
    this.currentY = scene.y;
    this.saveCharacter(character);
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
    this.handleTileSceneTrigger(mapId, x, y);
    this.handleEncounterTrigger(mapId, x, y);

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

  handleTileSceneTrigger(mapId, x, y) {
    const cell = this.sharedState.mapCellStore?.getCell(mapId, x, y) || null;
    const tileSceneId = cell?.sceneId || 0;

    if (tileSceneId === this.currentTileSceneId) {
      return;
    }

    const previousTileSceneId = this.currentTileSceneId;
    this.currentTileSceneId = tileSceneId;

    if (tileSceneId === 0) {
      if (previousTileSceneId !== 0) {
        this.log(`Left tile scene trigger sceneId=${previousTileSceneId} map=${mapId} pos=${x},${y}`);
      }
      return;
    }

    this.log(
      `Entered tile scene trigger map=${mapId} (${describeScene(mapId)}) pos=${x},${y} sceneId=${tileSceneId} flags=0x${(cell.flags || 0).toString(16)} aux=${cell.auxValue || 0}`
    );

    const action = resolveTileSceneAction({
      mapId,
      tileSceneId,
    });

    if (!action) {
      return;
    }

    if (action.kind === 'transition') {
      this.currentTileSceneId = 0;
      this.transitionToScene(action.targetSceneId, action.targetX, action.targetY, action.reason);
      return;
    }

    this.log(
      `No server-side tile scene action mapped for map=${mapId} (${describeScene(mapId)}) sceneId=${tileSceneId}`
    );
  }

  handleEncounterTrigger(mapId, x, y) {
    const action = resolveEncounterAction({
      mapId,
      x,
      y,
    });

    const triggerId = action?.probeId || null;
    if (triggerId === this.currentEncounterTriggerId) {
      return;
    }

    this.currentEncounterTriggerId = triggerId;
    if (!action) {
      return;
    }

    if (action.kind === 'encounterProbe') {
      this.sendCombatEncounterProbe(action);
      return;
    }

    if (action.kind === 'encounterProbeExit') {
      this.sendCombatExitProbe(action);
    }
  }

  handleServerRunRequest(payload) {
    if (payload.length < 5) {
      this.log('Short 0x03f1 payload');
      return;
    }

    const subtype = payload[2];
    if (subtype === 0x01) {
      const scriptId = payload.readUInt16LE(3);
      const mapId = payload.length >= 7 ? payload.readUInt16LE(5) : 0;
      this.log(`Server-run request sub=0x01 script=${scriptId} map=${mapId} pos=${this.currentX},${this.currentY}`);
      const action = resolveServerRunAction({
        mapId,
        subtype,
        scriptId,
        x: this.currentX,
        y: this.currentY,
      });
      if (action.kind === 'transition') {
        this.transitionToScene(action.targetSceneId, action.targetX, action.targetY, action.reason);
        return;
      }
      if (action.kind === 'scriptEvent') {
        if (action.mode === 'deferred') {
          this.sendServerRunScriptDeferred(action.scriptId);
          return;
        }
        this.sendServerRunScriptImmediate(action.scriptId);
        return;
      }
      if (action.kind === 'dialogue') {
        this.sendGameDialogue(
          action.speaker,
          action.message,
          action.subtype,
          action.flags,
          action.extraText
        );
        return;
      }
      this.sendServerRunMessage(action.npcId, action.msgId);
      return;
    }

    if (subtype === 0x02) {
      if (payload.length < 9) {
        this.log('Short 0x03f1/0x02 payload');
        return;
      }
      const mode = payload[3];
      const contextId = payload.readUInt16LE(4);
      const extra = payload[6];
      const scriptId = payload.length >= 9 ? payload.readUInt16LE(7) : 0;
      this.log(
        `Server-run request sub=0x02 mode=${mode} contextId=${contextId} extra=${extra} script=${scriptId} map=${this.currentMapId} pos=${this.currentX},${this.currentY}`
      );
      const action = resolveServerRunAction({
        mapId: this.currentMapId,
        subtype,
        mode,
        scriptId,
        x: this.currentX,
        y: this.currentY,
      });
      if (action.kind === 'transition') {
        this.transitionToScene(action.targetSceneId, action.targetX, action.targetY, action.reason);
        return;
      }
      if (action.kind === 'scriptEvent') {
        if (action.mode === 'deferred') {
          this.sendServerRunScriptDeferred(action.scriptId);
          return;
        }
        this.sendServerRunScriptImmediate(action.scriptId);
        return;
      }
      if (action.kind === 'dialogue') {
        this.sendGameDialogue(
          action.speaker,
          action.message,
          action.subtype,
          action.flags,
          action.extraText
        );
        return;
      }
      this.sendServerRunMessage(action.npcId, action.msgId);
      return;
    }

    this.log(`Unhandled 0x03f1 subtype=0x${subtype.toString(16)}`);
  }

  handleCombatPacket(cmdWord, payload) {
    const packet = parseCombatPacket(cmdWord, payload);
    const recorded = recordInboundCombatPacket(this.combatState, packet);
    this.combatState = recorded.state;

    if (Array.isArray(this.sharedState.combatTrace)) {
      this.sharedState.combatTrace.push({
        sessionId: this.id,
        timestamp: Date.now(),
        direction: 'inbound',
        inFight: recorded.snapshot.inFight,
        stateChanged: recorded.snapshot.stateChanged,
        ...packet,
      });
      if (this.sharedState.combatTrace.length > 200) {
        this.sharedState.combatTrace.shift();
      }
    }

    const pieces = [
      `Combat packet kind=${describeCombatCommand(cmdWord)}`,
      `cmd=0x${cmdWord.toString(16)}`,
    ];
    if (packet.subcmd !== null) {
      pieces.push(`sub=0x${packet.subcmd.toString(16)}`);
    }
    if (packet.detail16 !== null) {
      pieces.push(`detail16=${packet.detail16}`);
    }
    if (packet.detail32 !== null) {
      pieces.push(`detail32=${packet.detail32}`);
    }
    pieces.push(`len=${packet.payloadLength}`);
    pieces.push(`inFight=${recorded.snapshot.inFight ? 1 : 0}`);
    if (recorded.snapshot.stateChanged) {
      pieces.push('stateChanged=1');
    }
    this.log(pieces.join(' '));

    if (
      cmdWord === GAME_FIGHT_ACTION_CMD &&
      packet.subcmd === 0x09 &&
      this.awaitingCombatTurnHandshake &&
      this.pendingCombatTurnProbe
    ) {
      const action = this.pendingCombatTurnProbe;
      this.awaitingCombatTurnHandshake = false;
      this.pendingCombatTurnProbe = null;
      if (this.syntheticFight) {
        this.syntheticFight.phase = 'command';
      }
      this.sendCombatCommandRefresh(action, 'client-03ed-09');
      return;
    }

    if (
      cmdWord === GAME_FIGHT_ACTION_CMD &&
      packet.subcmd === 0x09 &&
      this.syntheticFight &&
      !this.awaitingCombatTurnHandshake
    ) {
      if (this.syntheticFight.phase === 'finished') {
        this.log('Ignoring client 0x03ed/0x09 because synthetic fight is finished');
        return;
      }
      if (this.syntheticFight.suppressNextReadyRepeat) {
        this.syntheticFight.suppressNextReadyRepeat = false;
        this.log('Ignoring duplicate client 0x03ed/0x09 immediately after command refresh');
        return;
      }
      if (this.syntheticFight.phase === 'command' && this.syntheticFight.awaitingPlayerAction) {
        this.log('Ignoring client 0x03ed/0x09 while waiting for player action');
        return;
      }
      if (this.syntheticFight.turnQueue.length > 0) {
        this.resolveSyntheticQueuedTurn({ probeId: 'client-ready-repeat' });
        return;
      }
      this.syntheticFight.phase = 'command';
      this.sendCombatCommandRefresh({ probeId: 'client-ready-repeat' }, 'client-03ed-09-repeat');
      return;
    }

    if (cmdWord === GAME_FIGHT_ACTION_CMD && packet.subcmd === 0x03) {
      if (this.syntheticFight?.phase === 'finished') {
        this.log('Ignoring client 0x03ed/0x03 because synthetic fight is finished');
        return;
      }
      this.handleSyntheticAttackSelection(payload);
    }
  }

  handleSyntheticAttackSelection(payload) {
    if (!this.syntheticFight || payload.length < 6) {
      return;
    }

    const player = this.getSyntheticPlayerFighter();
    if (!player) {
      return;
    }

    const attackMode = payload[3] & 0xff;
    const targetA = payload[4] & 0xff;
    const targetB = payload[5] & 0xff;
    const enemy = this.findSyntheticEnemyTarget(targetA, targetB);
    const targetMatches = enemy !== null;

    this.syntheticFight.lastAction = {
      actorEntityId: player.entityId,
      attackMode,
      targetA,
      targetB,
      targetMatches,
      targetEntityId: enemy?.entityId || 0,
      timestamp: Date.now(),
    };
    this.syntheticFight.phase = 'resolving';
    this.syntheticFight.awaitingPlayerAction = false;
    this.syntheticFight.suppressNextReadyRepeat = false;

    this.log(
      `Synthetic attack selection mode=${attackMode} targetA=${targetA} targetB=${targetB} targetMatches=${targetMatches ? 1 : 0} enemy=${enemy?.name || 'none'} hp=${enemy?.hp || 0}`
    );

    if (!targetMatches) {
      this.sendCombatTurnProbe({ probeId: 'attack-reprompt' }, 'attack-invalid-target');
      return;
    }

    const damage = Math.min(enemy.hp, 40);
    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.alive = enemy.hp > 0;
    player.lastActionAt = Date.now();
    this.log(
      `Synthetic combat resolved attack damage=${damage} enemy=${enemy.name} remainingHp=${enemy.hp}`
    );

    this.sendSyntheticAttackPlayback({
      attackerEntityId: player.entityId,
      targetEntityId: enemy.entityId,
      resultCode: enemy.hp === 0 ? 0x03 : 0x01,
      damage,
    });

    const livingEnemies = this.syntheticFight.enemies.filter((candidate) => candidate.hp > 0);

    if (livingEnemies.length > 0) {
      this.awaitingCombatTurnHandshake = false;
      this.pendingCombatTurnProbe = null;
      this.initializeSyntheticEnemyTurnQueue(player.entityId);
      const nextEnemyActor = this.syntheticFight.turnQueue[0]?.attackerEntityId || enemy.entityId;
      this.sendCombatCommandHide(
        { probeId: 'enemy-turn-queue', entityId: nextEnemyActor },
        'player-action-complete'
      );
      this.log(
        `Queued synthetic enemy turns count=${this.syntheticFight.turnQueue.length} after player action livingEnemies=${livingEnemies.length}`
      );
      return;
    }

    this.sendSyntheticAttackResultUpdate({
      actionMode: 0x66,
      enemy,
      damage,
    });
    this.sendSyntheticAttackMirrorUpdate({
      actionMode: 0x67,
    });

    if (enemy.hp === 0) {
      this.log(`Synthetic enemy defeated enemy=${enemy.name} entity=${enemy.entityId}`);
      if (livingEnemies.length === 0) {
        this.syntheticFight.phase = 'finished';
        this.syntheticFight.awaitingPlayerAction = false;
        this.sendGameDialogue('Combat', `${this.charName} defeats the enemy group.`);
        this.awaitingCombatTurnHandshake = false;
        this.pendingCombatTurnProbe = null;
        return;
      }
    }

    if (this.awaitingCombatTurnHandshake && this.pendingCombatTurnProbe) {
      this.log(
        `Skipping attack follow-up turn probe while startup handshake is still pending expected=0x${GAME_FIGHT_ACTION_CMD.toString(16)}/0x09`
      );
      return;
    }

    this.sendCombatCommandRefresh({ probeId: 'attack-followup' }, 'attack-selected');
  }

  findSyntheticEnemyTarget(targetA, targetB) {
    if (!this.syntheticFight || !Array.isArray(this.syntheticFight.enemies)) {
      return null;
    }

    return this.syntheticFight.enemies.find((enemy) => {
      if (enemy.hp <= 0) {
        return false;
      }
      return targetA === enemy.row && targetB === enemy.col;
    }) || null;
  }

  getSyntheticPlayerFighter() {
    if (!this.syntheticFight || !Array.isArray(this.syntheticFight.fighters)) {
      return null;
    }
    return this.syntheticFight.fighters.find((fighter) => fighter.side === 0xff) || null;
  }

  selectSyntheticEnemyAttacker(preferredEnemy = null) {
    if (!this.syntheticFight || !Array.isArray(this.syntheticFight.enemies)) {
      return null;
    }
    if (preferredEnemy && preferredEnemy.hp > 0) {
      return preferredEnemy;
    }
    return this.syntheticFight.enemies.find((enemy) => enemy.hp > 0) || null;
  }

  initializeSyntheticEnemyTurnQueue(targetEntityId) {
    if (!this.syntheticFight) {
      return;
    }
    const liveEnemies = this.syntheticFight.enemies.filter((enemy) => enemy.hp > 0);
    const ordered = liveEnemies
      .map((enemy) => ({
        attackerEntityId: enemy.entityId,
        targetEntityId,
        plannedDamage: 18,
        initiative: this.getSyntheticInitiative(enemy),
      }))
      .sort((left, right) => right.initiative - left.initiative || left.attackerEntityId - right.attackerEntityId);
    this.syntheticFight.turnQueue = ordered;
    this.syntheticFight.phase = ordered.length > 0 ? 'enemy-turn' : 'command';
  }

  getSyntheticInitiative(fighter) {
    if (!fighter) {
      return 0;
    }
    if (fighter.side === 0xff) {
      return 100 + ((fighter.level || 0) * 2);
    }
    return 80 + ((fighter.level || 0) * 2) + ((fighter.logicalId || 0) % 3);
  }

  resolveSyntheticQueuedTurn(action) {
    if (!this.syntheticFight?.turnQueue?.length) {
      this.sendCombatCommandRefresh(action, 'enemy-turn-missing');
      return;
    }

    const player = this.getSyntheticPlayerFighter();
    const currentTurn = this.syntheticFight.turnQueue.shift();
    const attacker = this.syntheticFight.enemies.find(
      (enemy) => enemy.entityId === currentTurn.attackerEntityId && enemy.hp > 0
    ) || this.selectSyntheticEnemyAttacker();
    if (!player || !attacker) {
      if (this.syntheticFight.turnQueue.length === 0) {
        this.syntheticFight.phase = 'command';
        this.syntheticFight.round += 1;
        this.sendCombatCommandRefresh(action, 'enemy-turn-skipped');
      }
      return;
    }

    this.syntheticFight.phase = 'resolving';
    this.syntheticFight.awaitingPlayerAction = false;
    this.syntheticFight.suppressNextReadyRepeat = false;
    const damage = Math.min(player.hp, currentTurn.plannedDamage || 18);
    player.hp = Math.max(0, player.hp - damage);
    player.alive = player.hp > 0;
    this.currentHealth = player.hp;
    player.lastActionAt = Date.now();
    this.syntheticFight.lastAction = {
      actorEntityId: attacker.entityId,
      attackMode: 1,
      targetA: player.row,
      targetB: player.col,
      targetMatches: true,
      targetEntityId: player.entityId,
      timestamp: Date.now(),
    };
    this.log(
      `Synthetic enemy turn attacker=${attacker.name} damage=${damage} playerHp=${player.hp}`
    );

    this.sendSyntheticAttackPlayback({
      attackerEntityId: attacker.entityId,
      targetEntityId: player.entityId,
      resultCode: player.hp === 0 ? 0x03 : 0x01,
      damage,
    });
    this.sendSelfStateAptitudeSync();
    if (player.hp === 0) {
      this.finishSyntheticFight('defeat', `${this.charName} was defeated.`);
      return;
    }
    if (this.syntheticFight.turnQueue.length > 0) {
      this.syntheticFight.phase = 'enemy-turn';
      const nextEnemyActor = this.syntheticFight.turnQueue[0]?.attackerEntityId || attacker.entityId;
      this.sendCombatCommandHide(
        { ...action, entityId: nextEnemyActor },
        'enemy-turn-continues'
      );
      return;
    }

    this.syntheticFight.phase = 'command';
    this.syntheticFight.round += 1;
    this.scheduleSyntheticCommandRefresh(action, 'enemy-turn-complete', 1500);
  }

  finishSyntheticFight(outcome, message) {
    if (!this.syntheticFight) {
      return;
    }
    this.clearSyntheticCommandRefreshTimer();
    this.syntheticFight.phase = 'finished';
    this.syntheticFight.turnQueue = [];
    this.syntheticFight.awaitingPlayerAction = false;
    this.syntheticFight.suppressNextReadyRepeat = false;
    this.awaitingCombatTurnHandshake = false;
    this.pendingCombatTurnProbe = null;
    this.log(`Synthetic fight finished outcome=${outcome}`);
    if (message) {
      this.sendGameDialogue('Combat', message);
    }
  }

  createSyntheticFight(action, enemies) {
    this.clearSyntheticCommandRefreshTimer();
    const player = {
      side: 0xff,
      entityId: this.entityType >>> 0,
      logicalId: 0,
      typeId: (this.roleEntityType || this.entityType) & 0xffff,
      row: 1,
      col: 2,
      hp: this.currentHealth >>> 0,
      maxHp: this.currentHealth >>> 0,
      mp: this.currentMana >>> 0,
      maxMp: this.currentMana >>> 0,
      rage: this.currentRage >>> 0,
      aptitude: 0,
      level: this.level & 0xffff,
      appearanceTypes: [0, 0, 0],
      appearanceVariants: [0, 0, 0],
      alive: true,
      name: this.charName || 'Hero',
      templateFlags: 0,
      lastActionAt: 0,
    };
    const enemyFighters = enemies.map((enemy) => ({
      side: enemy.side & 0xff,
      entityId: enemy.entityId >>> 0,
      logicalId: enemy.logicalId & 0xffff,
      typeId: enemy.typeId & 0xffff,
      row: enemy.row & 0xff,
      col: enemy.col & 0xff,
      hp: enemy.hpLike >>> 0,
      maxHp: enemy.hpLike >>> 0,
      mp: enemy.mpLike >>> 0,
      maxMp: enemy.mpLike >>> 0,
      rage: 0,
      aptitude: enemy.aptitude & 0xff,
      level: enemy.levelLike & 0xffff,
      appearanceTypes: Array.isArray(enemy.appearanceTypes) ? enemy.appearanceTypes.slice(0, 3) : [0, 0, 0],
      appearanceVariants: Array.isArray(enemy.appearanceVariants) ? enemy.appearanceVariants.slice(0, 3) : [0, 0, 0],
      alive: true,
      name: enemy.name,
      templateFlags: 0,
      lastActionAt: 0,
    }));
    return {
      trigger: action.probeId,
      startedAt: Date.now(),
      round: 1,
      phase: 'command',
      activeEntityId: player.entityId,
      activeName: player.name,
      turnProfile: selectCombatTurnProbeProfile(),
      fighters: [player, ...enemyFighters],
      enemies: enemyFighters,
      lastAction: null,
      turnQueue: [],
      awaitingPlayerAction: false,
      suppressNextReadyRepeat: false,
    };
  }

  clearSyntheticCommandRefreshTimer() {
    if (this.syntheticCommandRefreshTimer) {
      clearTimeout(this.syntheticCommandRefreshTimer);
      this.syntheticCommandRefreshTimer = null;
    }
  }

  scheduleSyntheticCommandRefresh(action, reason, delayMs) {
    this.clearSyntheticCommandRefreshTimer();
    this.syntheticCommandRefreshTimer = setTimeout(() => {
      this.syntheticCommandRefreshTimer = null;
      if (!this.syntheticFight || this.syntheticFight.phase === 'finished') {
        return;
      }
      this.sendCombatCommandRefresh(action, reason);
    }, Math.max(0, delayMs | 0));
  }

  sendSyntheticAttackPlayback({ attackerEntityId, targetEntityId, resultCode, damage }) {
    const writer = new PacketWriter();

    writer.writeUint16(GAME_FIGHT_STREAM_CMD);
    writer.writeUint8(0x03);

    // Original-server anchor from `gc_server.exe`:
    // attack case 3 writes:
    //   u32 attacker_runtime_id
    //   u32 target_runtime_id
    //   u8  result_code
    //   u32 damage
    // before any death/state follow-up.
    writer.writeUint32(attackerEntityId >>> 0);
    writer.writeUint32(targetEntityId >>> 0);
    writer.writeUint8(resultCode & 0xff);
    writer.writeUint32(damage >>> 0);

    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending synthetic fight playback cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x03 attacker=${attackerEntityId} target=${targetEntityId} result=${resultCode} damage=${damage}`
    );
  }

  sendSyntheticAttackResultUpdate({ actionMode, enemy, damage }) {
    const writer = new PacketWriter();
    const player = this.getSyntheticPlayerFighter();
    const targetState = enemy.hp > 0 ? 0 : 1;
    const encodedBoardSlot = (((enemy.row & 0xff) << 8) | (enemy.col & 0xff)) >>> 0;

    writer.writeUint16(GAME_FIGHT_STREAM_CMD);
    writer.writeUint8(actionMode & 0xff);

    // Minimal `0x03fa / 0x66` result/state update modeled on the original server's
    // post-attack packet family. This keeps the no-companion path and feeds the client
    // a compact target/result update before the next turn refresh.
    writer.writeUint32(Math.max(1, player?.hp || this.currentHealth) >>> 0);
    writer.writeUint32((player?.mp || this.currentMana) >>> 0);
    writer.writeUint32((player?.rage || this.currentRage) >>> 0);
    writer.writeUint32(0xfffe7960); // -100000 sentinel for absent companion block
    writer.writeUint32(encodedBoardSlot);
    writer.writeUint32(damage >>> 0);
    writer.writeUint32(targetState >>> 0);

    if (targetState > 0) {
      writer.writeUint32(enemy.entityId >>> 0);
    }

    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending synthetic fight result update cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${actionMode.toString(16)} enemy=${enemy.entityId} row=${enemy.row} col=${enemy.col} damage=${damage} remainingHp=${enemy.hp} targetState=${targetState}`
    );
  }

  sendSyntheticAttackMirrorUpdate({ actionMode }) {
    const writer = new PacketWriter();
    const player = this.getSyntheticPlayerFighter();

    writer.writeUint16(GAME_FIGHT_STREAM_CMD);
    writer.writeUint8(actionMode & 0xff);
    writer.writeUint32(Math.max(1, player?.hp || this.currentHealth) >>> 0);
    writer.writeUint32((player?.mp || this.currentMana) >>> 0);
    writer.writeUint32((player?.rage || this.currentRage) >>> 0);
    writer.writeUint32(0xfffe7960); // -100000 sentinel for absent companion block

    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending synthetic fight mirror update cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${actionMode.toString(16)} hp=${player?.hp || this.currentHealth} mp=${player?.mp || this.currentMana} rage=${player?.rage || this.currentRage}`
    );
  }

  sendSelfStateAptitudeSync() {
    const player = this.getSyntheticPlayerFighter();
    const currentHealth = (player?.hp || this.currentHealth) >>> 0;
    const currentMana = (player?.mp || this.currentMana) >>> 0;
    const currentRage = (player?.rage || this.currentRage) >>> 0;
    const writer = new PacketWriter();
    writer.writeUint16(GAME_SELF_STATE_CMD);
    writer.writeUint8(SELF_STATE_APTITUDE_SUBCMD);
    writer.writeUint8(this.selectedAptitude & 0xff);

    // Active-entity subtype 0x0a snapshot used by DispatchActiveEntitySubtypeUpdate03f6.
    writer.writeUint32(currentHealth);
    writer.writeUint32(currentMana);
    writer.writeUint32(currentRage);
    writer.writeUint8(this.level & 0xff);
    writer.writeUint32(this.experience >>> 0);
    writer.writeUint32(this.bankGold >>> 0);
    writer.writeUint32(this.gold >>> 0);
    writer.writeUint32(this.boundGold >>> 0);
    writer.writeUint32(this.coins >>> 0);
    writer.writeUint32(this.renown >>> 0);
    // Two 16-bit fields here are still not fully identified client-side.
    writer.writeUint16(0);
    writer.writeUint16(1);
    writer.writeUint16(this.primaryAttributes.intelligence & 0xffff);
    writer.writeUint16(this.primaryAttributes.vitality & 0xffff);
    writer.writeUint16(this.primaryAttributes.dexterity & 0xffff);
    writer.writeUint16(this.primaryAttributes.strength & 0xffff);
    writer.writeUint16(this.statusPoints & 0xffff);
    writer.writeUint8(0);

    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending self-state stat sync cmd=0x${GAME_SELF_STATE_CMD.toString(16)} sub=0x${SELF_STATE_APTITUDE_SUBCMD.toString(16)} aptitude=${this.selectedAptitude} level=${this.level} hp/mp/rage=${currentHealth}/${currentMana}/${currentRage} stats=${this.primaryAttributes.intelligence}/${this.primaryAttributes.vitality}/${this.primaryAttributes.dexterity}/${this.primaryAttributes.strength} statusPoints=${this.statusPoints}`
    );
  }

  transitionToScene(mapId, x, y, reason) {
    this.currentMapId = mapId;
    this.currentX = x;
    this.currentY = y;
    this.currentTileSceneId = 0;
    this.currentEncounterTriggerId = null;
    this.log(`Transitioning scene reason="${reason}" map=${mapId} (${describeScene(mapId)}) pos=${x},${y}`);

    const persisted = this.getPersistedCharacter();
    if (persisted) {
      this.saveCharacter({
        ...persisted,
        mapId,
        x,
        y,
      });
    }

    this.sendEnterGameOk();
  }

  dispose() {}

  sendStaticNpcSpawns() {
    const staticNpcs = getBootstrapWorldSpawns(this.currentMapId);
    if (!Array.isArray(staticNpcs) || staticNpcs.length === 0) {
      return;
    }

    const writer = new PacketWriter();
    writer.writeUint16(GAME_POSITION_QUERY_CMD);
    writer.writeUint8(GAME_SPAWN_BATCH_SUBCMD);
    writer.writeUint16(staticNpcs.length);

    for (const npc of staticNpcs) {
      this.writeNpcSpawnRecord(writer, npc);
    }

    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending static NPC spawn batch cmd=0x${GAME_POSITION_QUERY_CMD.toString(16)} map=${this.currentMapId} (${describeScene(this.currentMapId)}) count=${staticNpcs.length}`
    );
  }

  writeNpcSpawnRecord(writer, npc) {
    const x = (typeof npc.x === 'number' ? npc.x : this.currentX + (npc.dx || 0)) & 0xffff;
    const y = (typeof npc.y === 'number' ? npc.y : this.currentY + (npc.dy || 0)) & 0xffff;

    writer.writeUint32(npc.id >>> 0);
    writer.writeUint16(npc.entityType & 0xffff);
    writer.writeUint16(x);
    writer.writeUint16(y);
    writer.writeUint32((npc.templateFlags || 0) >>> 0);

    if (!npc.richSpawn) {
      return;
    }

    // Rich class-1 ParseEntitySpawnFrom03eb form:
    // u32, u16 level, string name, then 3x (u16 appearanceType + u8 variant), then u16 extraFlags.
    writer.writeUint32((npc.richValue || 0) >>> 0);
    writer.writeUint16((npc.level || 0) & 0xffff);
    writer.writeString(`${npc.name || ''}\0`);

    const triples = Array.isArray(npc.appearanceTriples) ? npc.appearanceTriples : [];
    for (let i = 0; i < 3; i += 1) {
      const triple = triples[i] || {};
      writer.writeUint16((triple.type || 0) & 0xffff);
      writer.writeUint8((triple.variant || 0) & 0xff);
    }

    writer.writeUint16((npc.extraFlags || 0) & 0xffff);
  }

  sendServerRunScriptImmediate(scriptId) {
    const writer = new PacketWriter();
    writer.writeUint16(GAME_SCRIPT_EVENT_CMD);
    writer.writeUint8(SERVER_SCRIPT_IMMEDIATE_SUBCMD);
    writer.writeUint16(scriptId & 0xffff);
    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending script event cmd=0x${GAME_SCRIPT_EVENT_CMD.toString(16)} sub=0x${SERVER_SCRIPT_IMMEDIATE_SUBCMD.toString(16)} script=${scriptId}`
    );
  }

  sendServerRunScriptDeferred(scriptId) {
    const writer = new PacketWriter();
    writer.writeUint16(GAME_SCRIPT_EVENT_CMD);
    writer.writeUint8(SERVER_SCRIPT_DEFERRED_SUBCMD);
    writer.writeUint16(scriptId & 0xffff);
    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending deferred script event cmd=0x${GAME_SCRIPT_EVENT_CMD.toString(16)} sub=0x${SERVER_SCRIPT_DEFERRED_SUBCMD.toString(16)} script=${scriptId}`
    );
  }

  sendServerRunMessage(npcId, msgId) {
    const writer = new PacketWriter();
    writer.writeUint16(GAME_SERVER_RUN_CMD);
    writer.writeUint8(0x01);
    writer.writeUint32(npcId >>> 0);
    writer.writeUint16(msgId & 0xffff);
    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending server-run message cmd=0x${GAME_SERVER_RUN_CMD.toString(16)} sub=0x01 npcId=${npcId} msg=${msgId}`
    );
  }

  sendGameDialogue(speaker, message, subtype = 0x01, flags = 0, extraText = null) {
    const writer = new PacketWriter();
    writer.writeUint16(GAME_DIALOG_CMD);
    writer.writeUint8(subtype & 0xff);
    writer.writeUint8(flags & 0xff);
    writer.writeString(`${speaker}\0`);
    if (subtype === 0x05) {
      writer.writeString(`${extraText || ''}\0`);
    }
    writer.writeString(`${message}\0`);
    writer.writeUint8(0);
    writer.writeUint8(0);
    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending dialogue cmd=0x${GAME_DIALOG_CMD.toString(16)} sub=0x${subtype.toString(16)} speaker="${speaker}"`
    );
  }

  sendCombatEncounterProbe(action) {
    const enemies = [
      {
        side: 1,
        entityId: 0x700001,
        logicalId: 1,
        typeId: 5015,
        row: 0,
        col: 2,
        hpLike: 120,
        mpLike: 0,
        aptitude: 0,
        levelLike: 15,
        appearanceTypes: [0, 0, 0],
        appearanceVariants: [0, 0, 0],
        name: 'Enemy A',
      },
    ];
    const writer = new PacketWriter();
    writer.writeUint16(GAME_FIGHT_STREAM_CMD);
    writer.writeUint8(0x65);
    writer.writeUint32(this.entityType >>> 0);
    const syntheticFight = this.createSyntheticFight(action, enemies);
    const player = syntheticFight.fighters[0];
    this.writeFightProbeEntry(writer, {
      side: player.side,
      entityId: player.entityId,
      typeId: player.typeId,
      row: player.row,
      col: player.col,
      hpLike: player.hp,
      mpLike: player.mp,
      aptitude: player.aptitude,
      levelLike: player.level,
      appearanceTypes: player.appearanceTypes,
      appearanceVariants: player.appearanceVariants,
      name: player.name,
    });
    for (const enemy of enemies) {
      this.writeFightProbeEntry(writer, enemy);
    }
    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending experimental combat encounter probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x65 trigger=${action.probeId} active=${this.entityType} enemies=${enemies.map((enemy) => enemy.entityId).join('/')} map=${this.currentMapId} pos=${this.currentX},${this.currentY} referenceCommands=${this.combatReference.fightCommands.map((command) => command.id).join('/') || 'none'} referenceSkills=${this.combatReference.skills.slice(0, 6).map((skill) => skill.id).join('/') || 'none'}`
    );
    this.syntheticFight = syntheticFight;
    this.sendReducedFightStartup(action, enemies.length);
    this.pendingCombatTurnProbe = action;
    this.awaitingCombatTurnHandshake = true;
    this.log(
      `Deferring combat turn probe until client readiness handshake trigger=${action.probeId} expected=0x${GAME_FIGHT_ACTION_CMD.toString(16)}/0x09`
    );
  }

  sendReducedFightStartup(action, enemyCount) {
    if (enemyCount > 1) {
      this.log(
        `Using reduced multi-enemy startup probe trigger=${action.probeId} enemyCount=${enemyCount} probes=0x34`
      );
      this.sendFightControlShowProbe(action);
      return;
    }

    this.sendFightRingOpenProbe(action);
    this.sendFightStateModeProbe64(action);
    this.sendFightControlInitProbe(action);
    this.sendFightActiveStateProbe(action);
    this.sendFightEntityFlagProbe(action, 0x33);
    this.sendFightControlShowProbe(action);
  }

  sendFightControlInitProbe(action) {
    const writer = new PacketWriter();
    writer.writeUint16(GAME_FIGHT_STREAM_CMD);
    writer.writeUint8(0x02);
    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending experimental fight control init probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x02 trigger=${action.probeId}`
    );
  }

  sendFightRingOpenProbe(action) {
    const writer = new PacketWriter();
    writer.writeUint16(GAME_FIGHT_STREAM_CMD);
    writer.writeUint8(0x01);
    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending experimental fight ring-open probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x01 trigger=${action.probeId}`
    );
  }

  sendFightStateModeProbe64(action) {
    const writer = new PacketWriter();
    writer.writeUint16(GAME_FIGHT_STREAM_CMD);
    writer.writeUint8(0x64);

    // Minimal structured body for the `0x64` control-state branch:
    // u32 stateA, u32 stateB, u32 stateC, then optional extras only when stateC > 0.
    // Using stateA = -1 preserves the branch's "snapshot current active fighter" path
    // without forcing the optional fields.
    writer.writeUint32(0xffffffff);
    writer.writeUint32(0);
    writer.writeUint32(0);

    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending experimental fight mode probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x64 trigger=${action.probeId} stateA=-1 stateB=0 stateC=0`
    );
  }

  sendFightActiveStateProbe(action) {
    const writer = new PacketWriter();
    writer.writeUint16(GAME_FIGHT_STREAM_CMD);
    writer.writeUint8(0x03);
    writer.writeUint32(this.entityType >>> 0);
    writer.writeUint8(0x01);

    // `0x03` gates through the active entity's board slot type and can consume
    // one of two 3x u32 state blocks before a trailing linked-entity id.
    // The synthetic start path has those globals zeroed, so probe with zeros.
    writer.writeUint32(0);
    writer.writeUint32(0);
    writer.writeUint32(0);
    writer.writeUint32(0);

    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending experimental fight active-state probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x03 trigger=${action.probeId} active=${this.entityType} enabled=1 state=0,0,0 linked=0`
    );
  }

  sendFightEntityFlagProbe(action, subcommand) {
    const activeEntityId =
      typeof action?.entityId === 'number' ? action.entityId >>> 0 : this.entityType >>> 0;
    const writer = new PacketWriter();
    writer.writeUint16(GAME_FIGHT_STREAM_CMD);
    writer.writeUint8(subcommand & 0xff);
    writer.writeUint32(activeEntityId);
    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending experimental fight entity flag probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${subcommand.toString(16)} trigger=${action.probeId} active=${activeEntityId}`
    );
  }

  sendFightControlShowProbe(action) {
    const activeEntityId =
      typeof action?.entityId === 'number' ? action.entityId >>> 0 : this.entityType >>> 0;
    const writer = new PacketWriter();
    writer.writeUint16(GAME_FIGHT_STREAM_CMD);
    writer.writeUint8(0x34);
    writer.writeUint32(activeEntityId);
    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending experimental fight control probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x34 trigger=${action.probeId} active=${activeEntityId}`
    );
  }

  sendCombatTurnProbe(action, reason = 'startup-sequence') {
    const activeTurnProfile = this.syntheticFight?.turnProfile || selectCombatTurnProbeProfile();
    const probeIndex = activeTurnProfile.index;
    const probeProfile = activeTurnProfile.profile;
    if (this.syntheticFight) {
      this.syntheticFight.phase = 'command';
    }

    const writer = new PacketWriter();
    writer.writeUint16(GAME_FIGHT_TURN_CMD);
    writer.writeUint8(0);
    writer.writeUint16(probeProfile.rows.length);
    for (const row of probeProfile.rows) {
      writer.writeUint16(row.fieldA & 0xffff);
      writer.writeUint16(row.fieldB & 0xffff);
      writer.writeUint16(row.fieldC & 0xffff);
    }
    this.writePacket(
      writer.payload(),
      DEFAULT_FLAGS,
      `Sending experimental combat turn probe cmd=0x${GAME_FIGHT_TURN_CMD.toString(16)} trigger=${action.probeId} reason=${reason} count=${probeProfile.rows.length} probeIndex=${probeIndex} profile=${probeProfile.profile} rows=${probeProfile.rows.map((row) => `${row.fieldA}/${row.fieldB}/${row.fieldC}`).join(',')}`
    );
  }

  sendCombatCommandRefresh(action, reason) {
    if (this.syntheticFight) {
      this.syntheticFight.phase = 'command';
      this.syntheticFight.awaitingPlayerAction = true;
      this.syntheticFight.suppressNextReadyRepeat = true;
    }
    const playerEntityId = this.getSyntheticPlayerFighter()?.entityId || this.entityType;
    this.sendFightRingOpenProbe({
      ...action,
      probeId: `${action.probeId || 'refresh'}:${reason}`,
    });
    this.sendFightControlShowProbe({
      ...action,
      probeId: `${action.probeId || 'refresh'}:${reason}`,
      entityId: playerEntityId,
    });
    this.sendCombatTurnProbe(action, reason);
  }

  sendCombatCommandHide(action, reason) {
    this.sendFightEntityFlagProbe(
      {
        ...action,
        probeId: `${action.probeId || 'hide'}:${reason}`,
      },
      0x33
    );
  }

  sendCombatExitProbe(action) {
    this.log(
      `Ignoring synthetic combat-exit probe trigger=${action.probeId} map=${this.currentMapId} pos=${this.currentX},${this.currentY}`
    );
  }

  writeFightProbeEntry(writer, entry) {
    writer.writeUint8(entry.side & 0xff);
    writer.writeUint32(entry.entityId >>> 0);
    writer.writeUint16(entry.typeId & 0xffff);
    writer.writeUint8(entry.row & 0xff);
    writer.writeUint8(entry.col & 0xff);
    writer.writeUint32(entry.hpLike >>> 0);
    writer.writeUint32(entry.mpLike >>> 0);
    writer.writeUint8(entry.aptitude & 0xff);
    writer.writeUint16(entry.levelLike & 0xffff);

    const appearanceTypes = Array.isArray(entry.appearanceTypes) ? entry.appearanceTypes : [0, 0, 0];
    for (let i = 0; i < 3; i += 1) {
      writer.writeUint16((appearanceTypes[i] || 0) & 0xffff);
    }

    const appearanceVariants = Array.isArray(entry.appearanceVariants) ? entry.appearanceVariants : [0, 0, 0];
    for (let i = 0; i < 3; i += 1) {
      writer.writeUint8((appearanceVariants[i] || 0) & 0xff);
    }

    writer.writeString(`${entry.name || 'Unknown'}\0`);
  }
}

function packRoleData(extra1, extra2) {
  return ((extra2 & 0xffff) << 16) | (extra1 & 0xffff);
}

function loadCombatProbeIndex() {
  try {
    const raw = fs.readFileSync(COMBAT_PROBE_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Number.isInteger(parsed?.nextProbeIndex) && parsed.nextProbeIndex >= 0
      ? parsed.nextProbeIndex
      : 0;
  } catch (err) {
    return 0;
  }
}

function selectCombatTurnProbeProfile() {
  const persistedProbeIndex = loadCombatProbeIndex();
  const probeIndex = persistedProbeIndex % COMBAT_TURN_PROBE_PROFILES.length;
  const probeProfile = COMBAT_TURN_PROBE_PROFILES[probeIndex];
  saveCombatProbeIndex(persistedProbeIndex + 1);
  return {
    index: probeIndex,
    profile: probeProfile,
  };
}

function saveCombatProbeIndex(nextProbeIndex) {
  const payload = JSON.stringify({ nextProbeIndex }, null, 2);
  fs.writeFileSync(COMBAT_PROBE_STATE_FILE, `${payload}\n`);
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

function defaultPrimaryAttributes() {
  return {
    intelligence: 15,
    vitality: 15,
    dexterity: 15,
    strength: 15,
  };
}

function numberOrDefault(value, fallback) {
  return typeof value === 'number' ? value : fallback;
}

function normalizePrimaryAttributes(primaryAttributes) {
  const defaults = defaultPrimaryAttributes();
  return {
    intelligence:
      typeof primaryAttributes?.intelligence === 'number'
        ? primaryAttributes.intelligence
        : (typeof primaryAttributes?.ene === 'number' ? primaryAttributes.ene : defaults.intelligence),
    vitality:
      typeof primaryAttributes?.vitality === 'number'
        ? primaryAttributes.vitality
        : (typeof primaryAttributes?.con === 'number' ? primaryAttributes.con : defaults.vitality),
    dexterity:
      typeof primaryAttributes?.dexterity === 'number'
        ? primaryAttributes.dexterity
        : (typeof primaryAttributes?.dex === 'number' ? primaryAttributes.dex : defaults.dexterity),
    strength:
      typeof primaryAttributes?.strength === 'number'
        ? primaryAttributes.strength
        : (typeof primaryAttributes?.str === 'number' ? primaryAttributes.str : defaults.strength),
  };
}

function normalizeCharacterRecord(character) {
  return {
    ...character,
    level: numberOrDefault(character.level, 1),
    selectedAptitude: numberOrDefault(character.selectedAptitude, 0),
    experience: numberOrDefault(character.experience, 0),
    currentHealth: numberOrDefault(character.currentHealth, 398),
    currentMana: numberOrDefault(character.currentMana, 600),
    currentRage: numberOrDefault(character.currentRage, 100),
    gold: numberOrDefault(character.gold, 0),
    bankGold: numberOrDefault(character.bankGold, 0),
    boundGold: numberOrDefault(character.boundGold, 0),
    coins: numberOrDefault(character.coins, 0),
    renown: numberOrDefault(character.renown, 0),
    statusPoints: numberOrDefault(character.statusPoints, 0),
    primaryAttributes: normalizePrimaryAttributes(character.primaryAttributes),
  };
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
