'use strict';

const {
  parsePingToken,
} = require('./protocol/inbound-packets');

const { dispatchGamePacket } = require('./handlers/packet-dispatcher');
const {
  handleLogin: loginHandlerHandleLogin,
  handleRolePacket: loginHandlerHandleRolePacket,
} = require('./handlers/login-handler');
const {
  handleQuestPacket: questHandlerHandleQuestPacket,
  applyQuestEvents: questHandlerApplyQuestEvents,
  handleQuestMonsterDefeat: questHandlerHandleQuestMonsterDefeat,
  syncQuestStateToClient: questHandlerSyncQuestStateToClient,
  ensureQuestStateReady: questHandlerEnsureQuestStateReady,
  refreshQuestStateForItemTemplates: questHandlerRefreshQuestStateForItemTemplates,
} = require('./handlers/quest-handler');
const {
  updateTownRespawnAnchor: sceneHandlerUpdateTownRespawnAnchor,
  handlePositionUpdate: sceneHandlerHandlePositionUpdate,
  transitionToScene: sceneHandlerTransitionToScene,
  sendStaticNpcSpawns: sceneHandlerSendStaticNpcSpawns,
} = require('./handlers/scene-handler');
const {
  handleCombatPacket: combatHandlerHandleCombatPacket,
  sendCombatEncounterProbe: combatHandlerSendCombatEncounterProbe,
  sendCombatExitProbe: combatHandlerSendCombatExitProbe,
  disposeCombatTimers: combatHandlerDisposeTimers,
} = require('./handlers/combat-handler');
const {
  scheduleEquipmentReplay: playerStateHandlerScheduleEquipmentReplay,
  tryHandleAttributeAllocationPacket: playerStateHandlerTryHandleAttributeAllocationPacket,
  tryHandleEquipmentStatePacket: playerStateHandlerTryHandleEquipmentStatePacket,
} = require('./handlers/player-state-handler');
const {
  schedulePetReplay: petHandlerSchedulePetReplay,
  sendPetStateSync: petHandlerSendPetStateSync,
  tryHandlePetActionPacket: petHandlerTryHandlePetActionPacket,
  disposePetTimers: petHandlerDisposeTimers,
} = require('./handlers/pet-handler');
const {
  sendEnterGameOk: sessionBootstrapHandlerSendEnterGameOk,
} = require('./handlers/session-bootstrap-handler');

const {
  loadCombatReference,
} = require('./combat-reference');

const {
  DEFAULT_FLAGS,
  ENTITY_TYPE,
  GAME_FIGHT_RESULT_CMD,
  GAME_DIALOG_CMD,
  GAME_DIALOG_MESSAGE_SUBCMD,
  GAME_ITEM_CONTAINER_CMD,
  GAME_ITEM_CMD,
  GAME_SERVER_RUN_CMD,
  GAME_SCRIPT_EVENT_CMD,
  GAME_SELF_STATE_CMD,
  HANDSHAKE_CMD,
  MAP_ID,
  PING_CMD,
  PONG_CMD,
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
  isCombatCommand,
  parseCombatPacket,
  recordOutboundCombatPacket,
} = require('./combat-runtime');
const { PacketWriter, buildPacket } = require('./protocol');
const {
  buildGameDialoguePacket,
  buildSelfStateAptitudeSyncPacket,
  buildServerRunMessagePacket,
  buildServerRunScriptPacket,
} = require('./protocol/gameplay-packets');
const {
  handleServerRunRequest: processNpcInteractionRequest,
  restoreAtInn: processInnRest,
} = require('./gameplay/npc-interactions');
const {
  CHARACTER_VITALS_BASELINE,
} = require('./gameplay/session-flows');
const {
  buildCharacterSnapshot: sessionHydrationBuildCharacterSnapshot,
  getPersistedCharacter: sessionHydrationGetPersistedCharacter,
  hydratePendingGameCharacter,
  persistCurrentCharacter: sessionHydrationPersistCurrentCharacter,
  saveCharacter: sessionHydrationSaveCharacter,
} = require('./character/session-hydration');

const COMBAT_REFERENCE = loadCombatReference();

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
    this.currentHealth = CHARACTER_VITALS_BASELINE.health;
    this.currentMana = CHARACTER_VITALS_BASELINE.mana;
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
    this.pets = [];
    this.selectedPetRuntimeId = null;
    this.petSummoned = false;
    this.bagItems = [];
    this.bagSize = 24;
    this.nextItemInstanceId = 1;
    this.nextBagSlot = 0;
    this.currentMapId = MAP_ID;
    this.currentX = SPAWN_X;
    this.currentY = SPAWN_Y;
    this.currentTileSceneId = 0;
    this.currentEncounterTriggerId = null;
    this.lastEncounterProbeAt = 0;
    this.combatState = createCombatState();
    this.pendingCombatTurnProbe = null;
    this.awaitingCombatTurnHandshake = false;
    this.syntheticFight = null;
    this.combatReference = COMBAT_REFERENCE;
    this.syntheticCommandRefreshTimer = null;
    this.equipmentReplayTimer = null;
    this.petReplayTimer = null;
    this.defeatRespawnPending = false;
    this.hasAnnouncedQuestOverview = false;

    hydratePendingGameCharacter(this, sharedState);
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
    loginHandlerHandleLogin(this, payload);
  }

  handleLoggedInPacket(flags, payload) {
    const cmdByte = payload[0];
    const cmdWord = payload.length >= 2 ? payload.readUInt16LE(0) : cmdByte;
    this.log(`Game packet flags=0x${flags.toString(16)} cmd8=0x${cmdByte.toString(16).padStart(2, '0')} cmd16=0x${cmdWord.toString(16).padStart(4, '0')}`);

    if (dispatchGamePacket(this, cmdWord, flags, payload)) {
      return;
    }

    if (
      cmdWord === GAME_ITEM_CONTAINER_CMD ||
      cmdWord === GAME_ITEM_CMD ||
      cmdWord === (GAME_ITEM_CMD + 1) ||
      cmdWord === 0x03f8 ||
      cmdWord === 0x0400
    ) {
      this.log(
        `Unhandled inventory-related cmd16=0x${cmdWord.toString(16)} payload=${payload.toString('hex')}`
      );
    }

    this.log(`Unhandled game cmd8=0x${cmdByte.toString(16)} cmd16=0x${cmdWord.toString(16)}`);
  }

  tryHandleEquipmentStatePacket(payload) {
    return playerStateHandlerTryHandleEquipmentStatePacket(this, payload);
  }

  tryHandlePetActionPacket(payload) {
    return petHandlerTryHandlePetActionPacket(this, payload);
  }

  tryHandleAttributeAllocationPacket(payload) {
    return playerStateHandlerTryHandleAttributeAllocationPacket(this, payload);
  }

  handleSpecialPacket(cmdWord, payload) {
    if (cmdWord === PING_CMD) {
      const { token } = parsePingToken(payload);
      this.sendPong(token);
      return;
    }

    this.log(`Unhandled special cmd16=0x${cmdWord.toString(16)}`);
  }

  handleRolePacket(payload) {
    loginHandlerHandleRolePacket(this, payload);
  }

  sendHandshake() {
    const writer = new PacketWriter();
    writer.writeUint16(HANDSHAKE_CMD);
    writer.writeUint32(0);
    this.writePacket(writer.payload(), SPECIAL_FLAGS, 'Sending handshake (flags=0x44, seed=0, no encryption)');
  }

  sendEnterGameOk() {
    sessionBootstrapHandlerSendEnterGameOk(this);
  }

  scheduleEquipmentReplay(delayMs = 300) {
    playerStateHandlerScheduleEquipmentReplay(this, delayMs);
  }

  schedulePetReplay(delayMs = 500) {
    petHandlerSchedulePetReplay(this, delayMs);
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

  getPersistedCharacter() {
    return sessionHydrationGetPersistedCharacter(this);
  }

  saveCharacter(character) {
    sessionHydrationSaveCharacter(this, character);
  }

  ensureQuestStateReady() {
    questHandlerEnsureQuestStateReady(this);
  }

  buildCharacterSnapshot(overrides = {}) {
    return sessionHydrationBuildCharacterSnapshot(this, overrides);
  }

  persistCurrentCharacter(overrides = {}) {
    sessionHydrationPersistCurrentCharacter(this, overrides);
  }

  updateTownRespawnAnchor(mapId, x, y) {
    sceneHandlerUpdateTownRespawnAnchor(this, mapId, x, y);
  }

  handlePositionUpdate(payload) {
    sceneHandlerHandlePositionUpdate(this, payload);
  }

  handleServerRunRequest(payload) {
    processNpcInteractionRequest(this, payload);
  }

  restoreAtInn(npcId) {
    processInnRest(this, npcId);
  }

  handleQuestPacket(payload) {
    questHandlerHandleQuestPacket(this, payload);
  }

  applyQuestEvents(events, source = 'runtime', options = {}) {
    questHandlerApplyQuestEvents(this, events, source, options);
  }

  handleQuestMonsterDefeat(monsterId, count = 1) {
    questHandlerHandleQuestMonsterDefeat(this, monsterId, count);
  }

  syncQuestStateToClient() {
    questHandlerSyncQuestStateToClient(this);
  }

  refreshQuestStateForItemTemplates(templateIds) {
    questHandlerRefreshQuestStateForItemTemplates(this, templateIds);
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
    combatHandlerHandleCombatPacket(this, cmdWord, payload);
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
        petCapacity: Array.isArray(this.pets) && this.pets.length > 0 ? Math.max(1, this.pets.length) : 0,
      }),
      DEFAULT_FLAGS,
      `Sending self-state stat sync cmd=0x${GAME_SELF_STATE_CMD.toString(16)} sub=0x${SELF_STATE_APTITUDE_SUBCMD.toString(16)} aptitude=${this.selectedAptitude} level=${this.level} hp/mp/rage=${currentHealth}/${currentMana}/${currentRage} stats=${this.primaryAttributes.intelligence}/${this.primaryAttributes.vitality}/${this.primaryAttributes.dexterity}/${this.primaryAttributes.strength} statusPoints=${this.statusPoints}`
    );
  }

  sendPetStateSync(reason = 'runtime') {
    petHandlerSendPetStateSync(this, reason);
  }

  transitionToScene(mapId, x, y, reason) {
    sceneHandlerTransitionToScene(this, mapId, x, y, reason);
  }

  dispose() {
    petHandlerDisposeTimers(this);
    combatHandlerDisposeTimers(this);
    if (this.equipmentReplayTimer) {
      clearTimeout(this.equipmentReplayTimer);
      this.equipmentReplayTimer = null;
    }
  }

  sendStaticNpcSpawns() {
    sceneHandlerSendStaticNpcSpawns(this);
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
    combatHandlerSendCombatEncounterProbe(this, action);
  }

  sendCombatExitProbe(action) {
    combatHandlerSendCombatExitProbe(this, action);
  }
}


module.exports = {
  Session,
};
