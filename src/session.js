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
  FIGHT_ACTIVE_STATE_SUBCMD,
  FIGHT_CLIENT_ATTACK_SELECTION_SUBCMD,
  FIGHT_CLIENT_READY_SUBCMD,
  FIGHT_CONTROL_INIT_SUBCMD,
  FIGHT_CONTROL_RING_OPEN_SUBCMD,
  FIGHT_CONTROL_SHOW_SUBCMD,
  FIGHT_ENCOUNTER_PROBE_SUBCMD,
  FIGHT_ENTITY_FLAG_HIDE_SUBCMD,
  FIGHT_RESULT_DEFEAT_SUBCMD,
  FIGHT_RESULT_VICTORY_SUBCMD,
  FIGHT_STATE_MODE_SUBCMD,
  GAME_FIGHT_ACTION_CMD,
  GAME_FIGHT_CLIENT_CMD,
  GAME_FIGHT_MISC_CMD,
  GAME_FIGHT_RESULT_CMD,
  GAME_FIGHT_STATE_CMD,
  GAME_FIGHT_STREAM_CMD,
  GAME_FIGHT_TURN_CMD,
  GAME_DIALOG_CMD,
  GAME_DIALOG_MESSAGE_SUBCMD,
  GAME_ITEM_CMD,
  GAME_SPAWN_BATCH_SUBCMD,
  GAME_POSITION_QUERY_CMD,
  GAME_QUEST_CMD,
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
  SERVER_RUN_MESSAGE_SUBCMD,
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
  buildGameDialoguePacket,
  buildQuestPacket,
  buildSelfStateAptitudeSyncPacket,
  buildServerRunMessagePacket,
  buildServerRunScriptPacket,
  buildSyntheticAttackMirrorUpdatePacket,
  buildSyntheticAttackPlaybackPacket,
  buildSyntheticAttackResultUpdatePacket,
} = require('./protocol/gameplay-packets');
const {
  applyInventoryQuestEvent,
  syncInventoryStateToClient,
} = require('./gameplay/inventory-runtime');
const {
  applyQuestCompletionReward,
} = require('./gameplay/reward-runtime');
const {
  handleServerRunRequest: processNpcInteractionRequest,
  restoreAtInn: processInnRest,
} = require('./gameplay/npc-interactions');
const {
  buildDefeatRespawnState,
} = require('./gameplay/session-flows');
const {
  computeSyntheticDamage,
  createSyntheticFightState,
  findSyntheticEnemyTarget,
  getSyntheticPlayerFighter,
  hasLivingSyntheticAllies,
  initializeSyntheticEnemyTurnQueue,
  selectSyntheticEnemyAttacker,
} = require('./combat/synthetic-fight');
const {
  finalizeSyntheticFightState,
  resolvePlayerAttackSelection,
  resolveQueuedEnemyTurn,
} = require('./combat/synthetic-fight-flow');
const {
  buildCombatEncounterProbePacket,
  buildCombatTurnProbePacket,
  buildFightActiveStateProbePacket,
  buildFightControlInitProbePacket,
  buildFightControlShowProbePacket,
  buildFightEntityFlagProbePacket,
  buildFightRingOpenProbePacket,
  buildFightStateModeProbe64Packet,
} = require('./combat/synthetic-fight-packets');
const {
  abandonQuest,
  applyMonsterDefeat,
  applySceneTransition,
  buildQuestSyncState,
  normalizeQuestState,
  reconcileAutoAccept,
} = require('./quest-engine');
const {
  buildInventorySnapshot,
  normalizeInventoryState,
} = require('./inventory');
const {
  describeScene,
  getBootstrapWorldSpawns,
  isTownScene,
  resolveCharacterScene,
  resolveEncounterAction,
  resolveTownRespawn,
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
    this.activeQuests = [];
    this.completedQuests = [];
    this.bagItems = [];
    this.bagSize = 24;
    this.nextItemInstanceId = 1;
    this.nextBagSlot = 0;
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
    this.defeatRespawnPending = false;
    this.hasAnnouncedQuestOverview = false;

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
      const questState = normalizeQuestState(sharedState.pendingGameCharacter);
      this.activeQuests = questState.activeQuests;
      this.completedQuests = questState.completedQuests;
      const inventoryState = normalizeInventoryState(sharedState.pendingGameCharacter);
      this.bagItems = inventoryState.inventory.bag;
      this.bagSize = inventoryState.inventory.bagSize;
      this.nextItemInstanceId = inventoryState.inventory.nextItemInstanceId;
      this.nextBagSlot = inventoryState.inventory.nextBagSlot;
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

    if (cmdWord === GAME_QUEST_CMD) {
      this.handleQuestPacket(payload);
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
    this.activeQuests = [];
    this.completedQuests = [];
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
      activeQuests: this.activeQuests,
      completedQuests: this.completedQuests,
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
      charName: persisted?.charName || persisted?.roleName || this.charName,
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
      activeQuests: normalizeQuestState(persisted || {}).activeQuests,
      completedQuests: normalizeQuestState(persisted || {}).completedQuests,
      lastTownMapId: persisted?.lastTownMapId,
      lastTownX: persisted?.lastTownX,
      lastTownY: persisted?.lastTownY,
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
    this.ensureQuestStateReady();

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
    syncInventoryStateToClient(this);
    this.syncQuestStateToClient();
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
    this.log(
      `Persisted character "${normalized.charName || normalized.roleName || 'Hero'}" for account "${this.accountName}"`
    );
  }

  ensureQuestStateReady() {
    const persisted = this.getPersistedCharacter();
    if (persisted) {
      const questState = normalizeQuestState(persisted);
      this.activeQuests = questState.activeQuests;
      this.completedQuests = questState.completedQuests;
      const inventoryState = normalizeInventoryState(persisted);
      this.bagItems = inventoryState.inventory.bag;
      this.bagSize = inventoryState.inventory.bagSize;
      this.nextItemInstanceId = inventoryState.inventory.nextItemInstanceId;
      this.nextBagSlot = inventoryState.inventory.nextBagSlot;
    }

    const events = reconcileAutoAccept({
      activeQuests: this.activeQuests,
      completedQuests: this.completedQuests,
    });
    if (events.length > 0) {
      this.applyQuestEvents(events, 'bootstrap', {
        suppressPackets: true,
        suppressDialogues: true,
        suppressStatSync: true,
      });
    }

    const transitionEvents = applySceneTransition(
      {
        activeQuests: this.activeQuests,
        completedQuests: this.completedQuests,
      },
      this.currentMapId
    );
    if (transitionEvents.length > 0) {
      this.applyQuestEvents(transitionEvents, 'bootstrap-scene', {
        suppressPackets: true,
        suppressDialogues: true,
        suppressStatSync: true,
      });
    }
  }

  buildCharacterSnapshot(overrides = {}) {
    const persisted = this.getPersistedCharacter() || {};
    return {
      ...persisted,
      roleName: this.charName,
      roleData: this.roleData,
      entityType: this.entityType,
      roleEntityType: this.roleEntityType,
      selectedAptitude: this.selectedAptitude,
      level: this.level,
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
      activeQuests: this.activeQuests,
      completedQuests: this.completedQuests,
      inventory: buildInventorySnapshot(this),
      mapId: this.currentMapId,
      x: this.currentX,
      y: this.currentY,
      ...overrides,
    };
  }

  persistCurrentCharacter(overrides = {}) {
    this.saveCharacter(this.buildCharacterSnapshot(overrides));
  }

  updateTownRespawnAnchor(mapId, x, y) {
    if (!isTownScene(mapId)) {
      return;
    }

    this.persistCurrentCharacter({
      lastTownMapId: mapId,
      lastTownX: x,
      lastTownY: y,
    });
  }

  replayPersistedCharacter() {
    const character = this.getPersistedCharacter();
    if (!character) {
      return;
    }

    this.charName = character.charName || character.roleName || 'Hero';
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
    const questState = normalizeQuestState(character);
    this.activeQuests = questState.activeQuests;
    this.completedQuests = questState.completedQuests;
    const inventoryState = normalizeInventoryState(character);
    this.bagItems = inventoryState.inventory.bag;
    this.bagSize = inventoryState.inventory.bagSize;
    this.nextItemInstanceId = inventoryState.inventory.nextItemInstanceId;
    this.nextBagSlot = inventoryState.inventory.nextBagSlot;
    const scene = resolveCharacterScene(character);
    this.currentMapId = scene.mapId;
    this.currentX = scene.x;
    this.currentY = scene.y;
    this.saveCharacter(character);
    this.updateTownRespawnAnchor(this.currentMapId, this.currentX, this.currentY);
    this.sendCreateRoleOk({
      ...character,
      entityType: this.roleEntityType,
    });
    this.log(
      `Replayed persisted character "${character.charName || character.roleName || 'Hero'}" for account "${this.accountName}"`
    );
  }

  handlePositionUpdate(payload) {
    if (payload.length < 8) {
      this.log('Short 0x03eb payload');
      return;
    }

    if (this.defeatRespawnPending) {
      this.log('Ignoring position update while defeat respawn is pending');
      return;
    }

    const x = payload.readUInt16LE(2);
    const y = payload.readUInt16LE(4);
    const mapId = payload.readUInt16LE(6);
    const previousMapId = this.currentMapId;
    this.currentX = x;
    this.currentY = y;
    this.currentMapId = mapId;
    this.log(`Position update map=${mapId} pos=${x},${y}`);
    this.handleTileSceneTrigger(mapId, x, y);
    this.handleEncounterTrigger(mapId, x, y);

    this.persistCurrentCharacter({
      mapId,
      x,
      y,
    });
    this.updateTownRespawnAnchor(mapId, x, y);

    if (previousMapId !== mapId) {
      const questEvents = applySceneTransition(
        {
          activeQuests: this.activeQuests,
          completedQuests: this.completedQuests,
        },
        mapId
      );
      if (questEvents.length > 0) {
        this.applyQuestEvents(questEvents, 'position-map-change');
      }
    }
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
    processNpcInteractionRequest(this, payload);
  }

  restoreAtInn(npcId) {
    processInnRest(this, npcId);
  }

  handleQuestPacket(payload) {
    if (payload.length < 5) {
      this.log('Short 0x03ff payload');
      return;
    }

    const subcmd = payload[2];
    const taskId = payload.readUInt16LE(3);
    this.log(`Quest packet sub=0x${subcmd.toString(16)} taskId=${taskId}`);

    if (subcmd === 0x05) {
      const events = abandonQuest(
        {
          activeQuests: this.activeQuests,
          completedQuests: this.completedQuests,
        },
        taskId
      );
      if (events.length > 0) {
        this.applyQuestEvents(events, 'client-abandon');
      }
      return;
    }

    if (subcmd === 0x0c) {
      const syncState = buildQuestSyncState({
        activeQuests: this.activeQuests,
        completedQuests: this.completedQuests,
      }).find((quest) => quest.taskId === taskId);
      if (syncState?.markerNpcId) {
        this.sendQuestFindNpc(taskId, syncState.markerNpcId);
      }
      return;
    }

    this.log(`Unhandled quest subcmd=0x${subcmd.toString(16)} taskId=${taskId}`);
  }

  applyQuestEvents(events, source = 'runtime', options = {}) {
    if (!Array.isArray(events) || events.length === 0) {
      return;
    }

    const suppressPackets = options.suppressPackets === true;
    const suppressDialogues = options.suppressDialogues === true;
    const suppressStatSync = options.suppressStatSync === true;
    let statsDirty = false;
    let questStateDirty = false;
    let inventoryDirty = false;

    for (const event of events) {
      this.log(
        `Quest event source=${source} type=${event.type} taskId=${numberOrDefault(event.taskId, 0)}${typeof event.status === 'number' ? ` status=${event.status}` : ''}${typeof event.markerNpcId === 'number' ? ` markerNpcId=${event.markerNpcId}` : ''}${event.stepDescription ? ` step="${event.stepDescription}"` : ''}`
      );

      const inventoryEventResult = applyInventoryQuestEvent(this, event, {
        suppressPackets,
        suppressDialogues,
      });
      if (inventoryEventResult.handled) {
        inventoryDirty = inventoryDirty || inventoryEventResult.dirty;
        continue;
      }

      if (event.type === 'accepted') {
        questStateDirty = true;
        if (!suppressPackets) {
          this.sendQuestAccept(event.taskId);
          if (event.status > 0) {
            this.sendQuestUpdate(event.taskId, event.status);
          }
          if (event.markerNpcId > 0) {
            this.sendQuestFindNpc(event.taskId, event.markerNpcId);
          }
        }
        if (!suppressDialogues) {
          this.sendGameDialogue(
            'Quest',
            `${event.definition.acceptMessage || `${event.definition.name} accepted.`}${event.stepDescription ? ` Objective: ${event.stepDescription}` : ''}`
          );
        }
        continue;
      }

      if (event.type === 'progress' || event.type === 'advanced') {
        questStateDirty = true;
        if (!suppressPackets) {
          this.sendQuestUpdate(event.taskId, event.status);
          if (event.markerNpcId > 0) {
            this.sendQuestFindNpc(event.taskId, event.markerNpcId);
          }
        }
        if (!suppressDialogues) {
          const progressText = event.type === 'progress' ? ` Progress: ${event.status}.` : '';
          this.sendGameDialogue(
            'Quest',
            `Quest updated: ${event.definition.name}.${event.stepDescription ? ` ${event.stepDescription}` : ''}${progressText}`
          );
        }
        continue;
      }

      if (event.type === 'completed') {
        questStateDirty = true;
        const rewardResult = applyQuestCompletionReward(this, event.reward, {
          suppressPackets,
          suppressDialogues,
        });
        statsDirty = statsDirty || rewardResult.statsDirty;
        inventoryDirty = inventoryDirty || rewardResult.inventoryDirty;
        if (!suppressPackets) {
          this.sendQuestComplete(event.taskId);
        }
        if (!suppressDialogues) {
          const rewardText = rewardResult.rewardMessages.length > 0
            ? rewardResult.rewardMessages.join(', ')
            : 'no reward';
          const levelText = rewardResult.levelSummary?.levelsGained > 0
            ? ` Level up: ${rewardResult.levelSummary.levelsGained} -> level ${this.level}, status points +${rewardResult.levelSummary.statusPointsGained}.`
            : '';
          this.sendGameDialogue(
            'Quest',
            `${event.definition.completionMessage || `${event.definition.name} completed.`} Reward: ${rewardText}.${levelText}`
          );
        }
        continue;
      }

      if (event.type === 'abandoned') {
        questStateDirty = true;
        if (!suppressPackets) {
          this.sendQuestAbandon(event.taskId);
        }
        if (!suppressDialogues) {
          this.sendGameDialogue('Quest', `${event.definition.name} abandoned.`);
        }
      }
    }

    if (statsDirty && !suppressStatSync) {
      this.sendSelfStateAptitudeSync();
    }

    if (questStateDirty || statsDirty || inventoryDirty) {
      this.persistCurrentCharacter();
    }
  }

  handleQuestMonsterDefeat(monsterId, count = 1) {
    const events = applyMonsterDefeat(
      {
        activeQuests: this.activeQuests,
        completedQuests: this.completedQuests,
      },
      monsterId,
      count
    );
    if (events.length > 0) {
      this.applyQuestEvents(events, 'monster-defeat');
    }
  }

  syncQuestStateToClient() {
    const syncState = buildQuestSyncState({
      activeQuests: this.activeQuests,
      completedQuests: this.completedQuests,
    });

    for (const quest of syncState) {
      this.sendQuestAccept(quest.taskId);
      if (quest.status > 0) {
        this.sendQuestUpdate(quest.taskId, quest.status);
      }
      if (quest.markerNpcId > 0) {
        this.sendQuestFindNpc(quest.taskId, quest.markerNpcId);
      }
    }

    if (!this.hasAnnouncedQuestOverview && syncState.length > 0) {
      const activeQuest = syncState[0];
      this.sendGameDialogue(
        'Quest',
        `Active quest loaded.${activeQuest.stepDescription ? ` ${activeQuest.stepDescription}` : ''}`
      );
      this.hasAnnouncedQuestOverview = true;
    }
  }

  sendQuestAccept(taskId) {
    this.writePacket(
      buildQuestPacket(0x03, taskId),
      DEFAULT_FLAGS,
      `Sending quest accept cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x03 taskId=${taskId}`
    );
  }

  sendQuestUpdate(taskId, status) {
    this.writePacket(
      buildQuestPacket(0x08, taskId, status & 0xffff, 'u16'),
      DEFAULT_FLAGS,
      `Sending quest update cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x08 taskId=${taskId} status=${status}`
    );
  }

  sendQuestComplete(taskId) {
    this.writePacket(
      buildQuestPacket(0x04, taskId),
      DEFAULT_FLAGS,
      `Sending quest complete cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x04 taskId=${taskId}`
    );
  }

  sendQuestAbandon(taskId) {
    this.writePacket(
      buildQuestPacket(0x05, taskId),
      DEFAULT_FLAGS,
      `Sending quest abandon cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x05 taskId=${taskId}`
    );
  }

  sendQuestFindNpc(taskId, npcId) {
    this.writePacket(
      buildQuestPacket(0x0c, taskId, npcId >>> 0),
      DEFAULT_FLAGS,
      `Sending quest marker cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x0c taskId=${taskId} npcId=${npcId}`
    );
  }

  getServerRunActionHandlers() {
    return {
      restoreAtInn: this.restoreAtInn.bind(this),
      sendGameDialogue: this.sendGameDialogue.bind(this),
      sendServerRunMessage: this.sendServerRunMessage.bind(this),
      sendServerRunScriptDeferred: this.sendServerRunScriptDeferred.bind(this),
      sendServerRunScriptImmediate: this.sendServerRunScriptImmediate.bind(this),
      transitionToScene: this.transitionToScene.bind(this),
    };
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
      packet.subcmd === FIGHT_CLIENT_READY_SUBCMD &&
      this.awaitingCombatTurnHandshake &&
      this.pendingCombatTurnProbe
    ) {
      const action = this.pendingCombatTurnProbe;
      this.awaitingCombatTurnHandshake = false;
      this.pendingCombatTurnProbe = null;
      if (this.syntheticFight) {
        this.syntheticFight.phase = 'command';
      }
      this.sendCombatCommandRefresh(action, `client-03ed-${FIGHT_CLIENT_READY_SUBCMD.toString(16)}`);
      return;
    }

    if (
      this.defeatRespawnPending &&
      (cmdWord === GAME_FIGHT_ACTION_CMD ||
        cmdWord === GAME_FIGHT_STREAM_CMD ||
        cmdWord === GAME_FIGHT_RESULT_CMD ||
        cmdWord === GAME_FIGHT_STATE_CMD ||
        cmdWord === GAME_FIGHT_TURN_CMD ||
        cmdWord === GAME_FIGHT_CLIENT_CMD ||
        cmdWord === GAME_FIGHT_MISC_CMD)
    ) {
      this.log(`Ignoring lingering combat packet cmd=0x${cmdWord.toString(16)} during defeat respawn`);
      return;
    }

    if (
      cmdWord === GAME_FIGHT_ACTION_CMD &&
      packet.subcmd === FIGHT_CLIENT_READY_SUBCMD &&
      this.syntheticFight &&
      !this.awaitingCombatTurnHandshake
    ) {
      if (this.syntheticFight.phase === 'finished') {
        this.log(`Ignoring client 0x03ed/0x${FIGHT_CLIENT_READY_SUBCMD.toString(16)} because synthetic fight is finished`);
        return;
      }
      if (this.syntheticFight.suppressNextReadyRepeat) {
        this.syntheticFight.suppressNextReadyRepeat = false;
        this.log(`Ignoring duplicate client 0x03ed/0x${FIGHT_CLIENT_READY_SUBCMD.toString(16)} immediately after command refresh`);
        return;
      }
      if (this.syntheticFight.phase === 'command' && this.syntheticFight.awaitingPlayerAction) {
        this.log(`Ignoring client 0x03ed/0x${FIGHT_CLIENT_READY_SUBCMD.toString(16)} while waiting for player action`);
        return;
      }
      if (this.syntheticFight.turnQueue.length > 0) {
        this.resolveSyntheticQueuedTurn({ probeId: 'client-ready-repeat' });
        return;
      }
      this.syntheticFight.phase = 'command';
      this.sendCombatCommandRefresh(
        { probeId: 'client-ready-repeat' },
        `client-03ed-${FIGHT_CLIENT_READY_SUBCMD.toString(16)}-repeat`
      );
      return;
    }

    if (cmdWord === GAME_FIGHT_ACTION_CMD && packet.subcmd === FIGHT_CLIENT_ATTACK_SELECTION_SUBCMD) {
      if (this.syntheticFight?.phase === 'finished') {
        this.log(`Ignoring client 0x03ed/0x${FIGHT_CLIENT_ATTACK_SELECTION_SUBCMD.toString(16)} because synthetic fight is finished`);
        return;
      }
      this.handleSyntheticAttackSelection(payload);
    }
  }

  handleSyntheticAttackSelection(payload) {
    if (!this.syntheticFight || payload.length < 6) {
      return;
    }

    const attackMode = payload[3] & 0xff;
    const targetA = payload[4] & 0xff;
    const targetB = payload[5] & 0xff;
    const resolution = resolvePlayerAttackSelection({
      syntheticFight: this.syntheticFight,
      attackMode,
      targetA,
      targetB,
      charName: this.charName,
      findSyntheticEnemyTarget,
      computeSyntheticDamage,
      initializeSyntheticEnemyTurnQueue,
    });

    this.log(
      `Synthetic attack selection mode=${attackMode} targetA=${targetA} targetB=${targetB} targetMatches=${resolution.enemy ? 1 : 0} enemy=${resolution.enemy?.name || 'none'} hp=${resolution.enemy?.hp || 0}`
    );

    if (resolution.kind === 'noop') {
      return;
    }

    if (resolution.kind === 'invalid-target') {
      this.sendCombatTurnProbe({ probeId: 'attack-reprompt' }, 'attack-invalid-target');
      return;
    }

    this.log(
      `Synthetic combat resolved attack damage=${resolution.damage} enemy=${resolution.enemy.name} remainingHp=${resolution.enemy.hp}`
    );

    this.sendSyntheticAttackPlayback({
      attackerEntityId: resolution.player.entityId,
      targetEntityId: resolution.enemy.entityId,
      resultCode: resolution.enemy.hp === 0 ? FIGHT_ACTIVE_STATE_SUBCMD : FIGHT_CONTROL_RING_OPEN_SUBCMD,
      damage: resolution.damage,
    });

    if (resolution.enemy.hp === 0) {
      this.handleQuestMonsterDefeat(resolution.enemy.typeId, 1);
    }

    if (resolution.kind === 'enemy-turn-queue') {
      this.awaitingCombatTurnHandshake = false;
      this.pendingCombatTurnProbe = null;
      this.sendCombatCommandHide(
        { probeId: 'enemy-turn-queue', entityId: resolution.nextEnemyActor },
        'player-action-complete'
      );
      this.log(
        `Queued synthetic enemy turns count=${this.syntheticFight.turnQueue.length} after player action livingEnemies=${resolution.livingEnemies.length}`
      );
      return;
    }

    this.sendSyntheticAttackResultUpdate({
      actionMode: FIGHT_RESULT_VICTORY_SUBCMD,
      target: resolution.enemy,
      damage: resolution.damage,
    });
    this.sendSyntheticAttackMirrorUpdate({
      actionMode: FIGHT_RESULT_DEFEAT_SUBCMD,
    });

    this.log(`Synthetic enemy defeated enemy=${resolution.enemy.name} entity=${resolution.enemy.entityId}`);
    this.awaitingCombatTurnHandshake = false;
    this.pendingCombatTurnProbe = null;
    this.sendGameDialogue('Combat', resolution.message);
  }

  getSyntheticPlayerFighter() {
    return getSyntheticPlayerFighter(this.syntheticFight);
  }

  findSyntheticEnemyTarget(targetA, targetB) {
    return findSyntheticEnemyTarget(this.syntheticFight, targetA, targetB);
  }

  computeSyntheticDamage(attacker, defender) {
    return computeSyntheticDamage(attacker, defender);
  }

  hasLivingSyntheticAllies(fighter) {
    return hasLivingSyntheticAllies(this.syntheticFight, fighter);
  }

  initializeSyntheticEnemyTurnQueue(targetEntityId) {
    initializeSyntheticEnemyTurnQueue(this.syntheticFight, targetEntityId);
  }

  selectSyntheticEnemyAttacker(preferredEnemy = null) {
    return selectSyntheticEnemyAttacker(this.syntheticFight, preferredEnemy);
  }

  resolveSyntheticQueuedTurn(action) {
    const resolution = resolveQueuedEnemyTurn({
      syntheticFight: this.syntheticFight,
      selectSyntheticEnemyAttacker,
      computeSyntheticDamage,
      hasLivingSyntheticAllies,
    });

    if (resolution.kind === 'missing-turn') {
      this.sendCombatCommandRefresh(action, 'enemy-turn-missing');
      return;
    }

    if (resolution.kind === 'skipped') {
      if (this.syntheticFight?.turnQueue?.length === 0) {
        this.sendCombatCommandRefresh(action, 'enemy-turn-skipped');
      }
      return;
    }

    this.currentHealth = resolution.player.hp;
    this.log(
      `Synthetic enemy turn attacker=${resolution.attacker.name} damage=${resolution.damage} playerHp=${resolution.player.hp}`
    );

    this.sendSyntheticAttackPlayback({
      attackerEntityId: resolution.attacker.entityId,
      targetEntityId: resolution.player.entityId,
      resultCode: resolution.player.hp === 0 ? FIGHT_ACTIVE_STATE_SUBCMD : FIGHT_CONTROL_RING_OPEN_SUBCMD,
      damage: resolution.damage,
    });

    if (resolution.kind === 'downed-awaiting-allies' || resolution.kind === 'defeat') {
      this.sendSyntheticAttackMirrorUpdate({
        actionMode: FIGHT_RESULT_DEFEAT_SUBCMD,
      });
      if (resolution.kind === 'downed-awaiting-allies') {
        this.log(`Synthetic fighter downed entity=${resolution.player.entityId} awaiting ally outcome`);
        return;
      }
      this.finishSyntheticFight('defeat', `${this.charName} was defeated.`);
      return;
    }

    if (resolution.kind === 'enemy-turn-continues') {
      this.sendCombatCommandHide(
        { ...action, entityId: resolution.nextEnemyActor },
        'enemy-turn-continues'
      );
      return;
    }

    this.scheduleSyntheticCommandRefresh(action, 'enemy-turn-complete', 1500);
  }

  finishSyntheticFight(outcome, message) {
    if (!this.syntheticFight) {
      return;
    }
    this.clearSyntheticCommandRefreshTimer();
    const finished = finalizeSyntheticFightState(this.syntheticFight, outcome);
    const player = finished.player;
    this.awaitingCombatTurnHandshake = false;
    this.pendingCombatTurnProbe = null;
    this.combatState = createCombatState();
    this.log(`Synthetic fight finished outcome=${outcome}`);
    if (message && outcome !== 'defeat') {
      this.sendGameDialogue('Combat', message);
    }
    if (outcome === 'defeat') {
      const persisted = this.getPersistedCharacter();
      const defeatRespawn = buildDefeatRespawnState({
        persistedCharacter: persisted,
        currentMapId: this.currentMapId,
        currentX: this.currentX,
        currentY: this.currentY,
        player,
        currentMana: this.currentMana,
        currentRage: this.currentRage,
        resolveTownRespawn,
      });
      const { respawn, vitals } = defeatRespawn;

      this.currentHealth = 0;
      this.currentMana = Math.max(0, player?.mp || this.currentMana || 0);
      this.currentRage = Math.max(0, player?.rage || this.currentRage || 0);
      this.currentEncounterTriggerId = null;
      this.syntheticFight = null;
      this.defeatRespawnPending = true;
      setTimeout(() => {
        if (this.socket.destroyed) {
          return;
        }
        this.currentHealth = vitals.health;
        this.currentMana = vitals.mana;
        this.currentRage = vitals.rage;
        this.persistCurrentCharacter({
          currentHealth: vitals.health,
          currentMana: vitals.mana,
          currentRage: vitals.rage,
          mapId: respawn.mapId,
          x: respawn.x,
          y: respawn.y,
          lastTownMapId: respawn.mapId,
          lastTownX: respawn.x,
          lastTownY: respawn.y,
        });
        this.currentMapId = respawn.mapId;
        this.currentX = respawn.x;
        this.currentY = respawn.y;
        this.currentTileSceneId = 0;
        this.currentEncounterTriggerId = null;
        this.transitionToScene(respawn.mapId, respawn.x, respawn.y, 'defeat-respawn');
      }, 900);
      return;
    }
    this.syntheticFight = null;
  }

  ignorePostDefeatCombatPacket() {
    if (!this.syntheticFight && this.currentHealth <= 0) {
      this.log('Ignoring lingering combat packet after defeat teardown');
      return true;
    }
    return false;
  }

  createSyntheticFight(action, enemies) {
    this.clearSyntheticCommandRefreshTimer();
    return createSyntheticFightState({
      action,
      entityType: this.entityType,
      roleEntityType: this.roleEntityType,
      currentHealth: this.currentHealth,
      currentMana: this.currentMana,
      currentRage: this.currentRage,
      primaryAttributes: this.primaryAttributes,
      level: this.level,
      charName: this.charName,
      enemies,
      turnProfile: selectCombatTurnProbeProfile(),
    });
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
    this.writePacket(
      buildSyntheticAttackPlaybackPacket({
        attackerEntityId,
        targetEntityId,
        resultCode,
        damage,
      }),
      DEFAULT_FLAGS,
      `Sending synthetic fight playback cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x03 attacker=${attackerEntityId} target=${targetEntityId} result=${resultCode} damage=${damage}`
    );
  }

  sendSyntheticAttackResultUpdate({ actionMode, target, damage, targetStateOverride = null, includeEntityId = null }) {
    const player = this.getSyntheticPlayerFighter();
    const targetState = targetStateOverride === null ? (target.hp > 0 ? 0 : 1) : (targetStateOverride >>> 0);

    this.writePacket(
      buildSyntheticAttackResultUpdatePacket({
        actionMode,
        playerVitals: {
          health: player?.hp || this.currentHealth,
          mana: player?.mp || this.currentMana,
          rage: player?.rage || this.currentRage,
        },
        target,
        damage,
        targetStateOverride,
        includeEntityId,
      }),
      DEFAULT_FLAGS,
      `Sending synthetic fight result update cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${actionMode.toString(16)} target=${target.entityId} row=${target.row} col=${target.col} damage=${damage} remainingHp=${target.hp} targetState=${targetState}`
    );
  }

  sendSyntheticAttackMirrorUpdate({ actionMode }) {
    const player = this.getSyntheticPlayerFighter();

    this.writePacket(
      buildSyntheticAttackMirrorUpdatePacket({
        actionMode,
        playerVitals: {
          health: player?.hp || this.currentHealth,
          mana: player?.mp || this.currentMana,
          rage: player?.rage || this.currentRage,
        },
      }),
      DEFAULT_FLAGS,
      `Sending synthetic fight mirror update cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${actionMode.toString(16)} hp=${player?.hp || this.currentHealth} mp=${player?.mp || this.currentMana} rage=${player?.rage || this.currentRage}`
    );
  }

  sendSelfStateAptitudeSync() {
    const player = this.getSyntheticPlayerFighter();
    const currentHealth = (player?.hp || this.currentHealth) >>> 0;
    const currentMana = (player?.mp || this.currentMana) >>> 0;
    const currentRage = (player?.rage || this.currentRage) >>> 0;

    this.writePacket(
      buildSelfStateAptitudeSyncPacket({
        selectedAptitude: this.selectedAptitude,
        level: this.level,
        experience: this.experience,
        bankGold: this.bankGold,
        gold: this.gold,
        boundGold: this.boundGold,
        coins: this.coins,
        renown: this.renown,
        primaryAttributes: this.primaryAttributes,
        statusPoints: this.statusPoints,
        currentHealth,
        currentMana,
        currentRage,
      }),
      DEFAULT_FLAGS,
      `Sending self-state stat sync cmd=0x${GAME_SELF_STATE_CMD.toString(16)} sub=0x${SELF_STATE_APTITUDE_SUBCMD.toString(16)} aptitude=${this.selectedAptitude} level=${this.level} hp/mp/rage=${currentHealth}/${currentMana}/${currentRage} stats=${this.primaryAttributes.intelligence}/${this.primaryAttributes.vitality}/${this.primaryAttributes.dexterity}/${this.primaryAttributes.strength} statusPoints=${this.statusPoints}`
    );
  }

  transitionToScene(mapId, x, y, reason) {
    this.defeatRespawnPending = false;
    this.currentMapId = mapId;
    this.currentX = x;
    this.currentY = y;
    this.currentTileSceneId = 0;
    this.currentEncounterTriggerId = null;
    this.log(`Transitioning scene reason="${reason}" map=${mapId} (${describeScene(mapId)}) pos=${x},${y}`);

    this.persistCurrentCharacter({
      mapId,
      x,
      y,
    });

    this.updateTownRespawnAnchor(mapId, x, y);
    const questEvents = applySceneTransition(
      {
        activeQuests: this.activeQuests,
        completedQuests: this.completedQuests,
      },
      mapId
    );
    if (questEvents.length > 0) {
      this.applyQuestEvents(questEvents, 'scene-transition');
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
    this.writePacket(
      buildServerRunScriptPacket(scriptId, SERVER_SCRIPT_IMMEDIATE_SUBCMD),
      DEFAULT_FLAGS,
      `Sending script event cmd=0x${GAME_SCRIPT_EVENT_CMD.toString(16)} sub=0x${SERVER_SCRIPT_IMMEDIATE_SUBCMD.toString(16)} script=${scriptId}`
    );
  }

  sendServerRunScriptDeferred(scriptId) {
    this.writePacket(
      buildServerRunScriptPacket(scriptId, SERVER_SCRIPT_DEFERRED_SUBCMD),
      DEFAULT_FLAGS,
      `Sending deferred script event cmd=0x${GAME_SCRIPT_EVENT_CMD.toString(16)} sub=0x${SERVER_SCRIPT_DEFERRED_SUBCMD.toString(16)} script=${scriptId}`
    );
  }

  sendServerRunMessage(npcId, msgId) {
    this.writePacket(
      buildServerRunMessagePacket(npcId, msgId),
      DEFAULT_FLAGS,
      `Sending server-run message cmd=0x${GAME_SERVER_RUN_CMD.toString(16)} sub=0x${SERVER_RUN_MESSAGE_SUBCMD.toString(16)} npcId=${npcId} msg=${msgId}`
    );
  }

  sendGameDialogue(speaker, message, subtype = GAME_DIALOG_MESSAGE_SUBCMD, flags = 0, extraText = null) {
    this.writePacket(
      buildGameDialoguePacket({
        speaker,
        message,
        subtype,
        flags,
        extraText,
      }),
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
        typeId: 5001,
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
      {
        side: 1,
        entityId: 0x700002,
        logicalId: 2,
        typeId: 5001,
        row: 0,
        col: 3,
        hpLike: 120,
        mpLike: 0,
        aptitude: 0,
        levelLike: 15,
        appearanceTypes: [0, 0, 0],
        appearanceVariants: [0, 0, 0],
        name: 'Enemy B',
      },
    ];
    const syntheticFight = this.createSyntheticFight(action, enemies);
    const player = syntheticFight.fighters[0];
    const playerEntry = {
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
      extended: true,
    };
    this.writePacket(
      buildCombatEncounterProbePacket({
        activeEntityId: this.entityType,
        playerEntry,
        enemies,
      }),
      DEFAULT_FLAGS,
      `Sending experimental combat encounter probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_ENCOUNTER_PROBE_SUBCMD.toString(16)} trigger=${action.probeId} active=${this.entityType} enemies=${enemies.map((enemy) => enemy.entityId).join('/')} map=${this.currentMapId} pos=${this.currentX},${this.currentY} referenceCommands=${this.combatReference.fightCommands.map((command) => command.id).join('/') || 'none'} referenceSkills=${this.combatReference.skills.slice(0, 6).map((skill) => skill.id).join('/') || 'none'}`
    );
    this.syntheticFight = syntheticFight;
    this.sendReducedFightStartup(action, enemies.length);
    this.pendingCombatTurnProbe = action;
    this.awaitingCombatTurnHandshake = true;
    this.log(
      `Deferring combat turn probe until client readiness handshake trigger=${action.probeId} expected=0x${GAME_FIGHT_ACTION_CMD.toString(16)}/0x${FIGHT_CLIENT_READY_SUBCMD.toString(16)}`
    );
  }

  sendReducedFightStartup(action, enemyCount) {
    this.sendFightRingOpenProbe(action);
    this.sendFightStateModeProbe64(action);
    this.sendFightControlInitProbe(action);
    this.sendFightActiveStateProbe(action);
    this.sendFightEntityFlagProbe(action, FIGHT_ENTITY_FLAG_HIDE_SUBCMD);
    this.sendFightControlShowProbe(action);
  }

  sendFightControlInitProbe(action) {
    this.writePacket(
      buildFightControlInitProbePacket(),
      DEFAULT_FLAGS,
      `Sending experimental fight control init probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_CONTROL_INIT_SUBCMD.toString(16)} trigger=${action.probeId}`
    );
  }

  sendFightRingOpenProbe(action) {
    this.writePacket(
      buildFightRingOpenProbePacket(),
      DEFAULT_FLAGS,
      `Sending experimental fight ring-open probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_CONTROL_RING_OPEN_SUBCMD.toString(16)} trigger=${action.probeId}`
    );
  }

  sendFightStateModeProbe64(action) {
    this.writePacket(
      buildFightStateModeProbe64Packet(),
      DEFAULT_FLAGS,
      `Sending experimental fight mode probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_STATE_MODE_SUBCMD.toString(16)} trigger=${action.probeId} stateA=-1 stateB=0 stateC=0`
    );
  }

  sendFightActiveStateProbe(action) {
    this.writePacket(
      buildFightActiveStateProbePacket(this.entityType),
      DEFAULT_FLAGS,
      `Sending experimental fight active-state probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_ACTIVE_STATE_SUBCMD.toString(16)} trigger=${action.probeId} active=${this.entityType} enabled=1 state=0,0,0 linked=0`
    );
  }

  sendFightEntityFlagProbe(action, subcommand) {
    const activeEntityId =
      typeof action?.entityId === 'number' ? action.entityId >>> 0 : this.entityType >>> 0;
    this.writePacket(
      buildFightEntityFlagProbePacket(activeEntityId, subcommand),
      DEFAULT_FLAGS,
      `Sending experimental fight entity flag probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${subcommand.toString(16)} trigger=${action.probeId} active=${activeEntityId}`
    );
  }

  sendFightControlShowProbe(action) {
    const activeEntityId =
      typeof action?.entityId === 'number' ? action.entityId >>> 0 : this.entityType >>> 0;
    this.writePacket(
      buildFightControlShowProbePacket(activeEntityId),
      DEFAULT_FLAGS,
      `Sending experimental fight control probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_CONTROL_SHOW_SUBCMD.toString(16)} trigger=${action.probeId} active=${activeEntityId}`
    );
  }

  sendCombatTurnProbe(action, reason = 'startup-sequence') {
    const activeTurnProfile = this.syntheticFight?.turnProfile || selectCombatTurnProbeProfile();
    const probeIndex = activeTurnProfile.index;
    const probeProfile = activeTurnProfile.profile;
    if (this.syntheticFight) {
      this.syntheticFight.phase = 'command';
    }

    this.writePacket(
      buildCombatTurnProbePacket(probeProfile),
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
      FIGHT_ENTITY_FLAG_HIDE_SUBCMD
    );
  }

  sendCombatExitProbe(action) {
    this.log(
      `Ignoring synthetic combat-exit probe trigger=${action.probeId} map=${this.currentMapId} pos=${this.currentX},${this.currentY}`
    );
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
  const mapId = numberOrDefault(character.mapId, MAP_ID);
  const x = numberOrDefault(character.x, SPAWN_X);
  const y = numberOrDefault(character.y, SPAWN_Y);
  const lastTownMapId =
    typeof character.lastTownMapId === 'number'
      ? character.lastTownMapId
      : (isTownScene(mapId) ? mapId : undefined);
  const lastTownX =
    typeof character.lastTownX === 'number'
      ? character.lastTownX
      : (isTownScene(mapId) ? x : undefined);
  const lastTownY =
    typeof character.lastTownY === 'number'
      ? character.lastTownY
      : (isTownScene(mapId) ? y : undefined);
  const questState = normalizeQuestState(character);
  const inventoryState = normalizeInventoryState(character);
  return {
    ...character,
    charName: character.charName || character.roleName || 'Hero',
    roleName: character.roleName || character.charName || 'Hero',
    mapId,
    x,
    y,
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
    lastTownMapId,
    lastTownX,
    lastTownY,
    primaryAttributes: normalizePrimaryAttributes(character.primaryAttributes),
    activeQuests: questState.activeQuests,
    completedQuests: questState.completedQuests,
    inventory: inventoryState.inventory,
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
