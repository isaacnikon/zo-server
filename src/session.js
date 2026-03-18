'use strict';

const {
  parsePositionUpdate,
  parseEquipmentState,
  parseAttributeAllocation,
  parseAttackSelection,
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
  loadCombatReference,
} = require('./combat-reference');

const {
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
  GAME_ITEM_CONTAINER_CMD,
  GAME_ITEM_CMD,
  GAME_SPAWN_BATCH_SUBCMD,
  GAME_POSITION_QUERY_CMD,
  GAME_SERVER_RUN_CMD,
  GAME_SCRIPT_EVENT_CMD,
  GAME_SELF_STATE_CMD,
  HANDSHAKE_CMD,
  LOGIN_CMD,
  LOGIN_SERVER_LIST_RESULT,
  MAP_ID,
  FORCE_START_SCENE,
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
  describeCombatCommand,
  isCombatCommand,
  parseCombatPacket,
  recordInboundCombatPacket,
  recordOutboundCombatPacket,
} = require('./combat-runtime');
const { PacketWriter, buildPacket } = require('./protocol');
const {
  buildGameDialoguePacket,
  buildPetActiveSelectPacket,
  buildPetPanelBindPacket,
  buildPetPanelClearPacket,
  buildPetPanelModePacket,
  buildPetPanelNamePacket,
  buildPetPanelPropertyPacket,
  buildPetPanelRebindPacket,
  buildPetCreateSyncPacket,
  buildPetRosterSyncPacket,
  buildPetStatsSyncPacket,
  buildPetSummonSyncPacket,
  buildPetTreeRegistrationPacket,
  buildSelfStateAptitudeSyncPacket,
  buildServerRunMessagePacket,
  buildServerRunScriptPacket,
  buildSyntheticAttackMirrorUpdatePacket,
  buildSyntheticAttackPlaybackPacket,
  buildSyntheticAttackResultUpdatePacket,
  buildSyntheticFightVictoryClosePacket,
} = require('./protocol/gameplay-packets');
const {
  sendEquipmentContainerSync,
  syncInventoryStateToClient,
} = require('./gameplay/inventory-runtime');
const {
  getPrimaryPet,
  normalizePets,
} = require('./pet-runtime');
const {
  rollSyntheticFightDrops,
} = require('./gameplay/combat-drop-runtime');
const {
  handleServerRunRequest: processNpcInteractionRequest,
  restoreAtInn: processInnRest,
} = require('./gameplay/npc-interactions');
const {
  CHARACTER_VITALS_BASELINE,
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
const { getRoleName, getRolePrimaryDrop } = require('./roleinfo');
const {
  numberOrDefault,
  normalizePrimaryAttributes,
  normalizeCharacterRecord,
} = require('./character/normalize');
const {
  buildSyntheticEncounterEnemies,
} = require('./combat/encounter-builder');
const {
  selectCombatTurnProbeProfile,
} = require('./combat/combat-probe');
const {
  applySceneTransition,
  normalizeQuestState,
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

    if (isGame && sharedState.pendingGameCharacter) {
      this.charName = sharedState.pendingGameCharacter.charName;
      this.entityType = sharedState.pendingGameCharacter.entityType;
      this.roleEntityType = sharedState.pendingGameCharacter.roleEntityType || this.entityType;
      this.roleData = sharedState.pendingGameCharacter.roleData || 0;
      this.selectedAptitude = numberOrDefault(sharedState.pendingGameCharacter.selectedAptitude, 0);
      this.level = numberOrDefault(sharedState.pendingGameCharacter.level, 1);
      this.experience = numberOrDefault(sharedState.pendingGameCharacter.experience, 0);
      this.currentHealth = numberOrDefault(
        sharedState.pendingGameCharacter.currentHealth,
        CHARACTER_VITALS_BASELINE.health
      );
      this.currentMana = numberOrDefault(
        sharedState.pendingGameCharacter.currentMana,
        CHARACTER_VITALS_BASELINE.mana
      );
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
      this.pets = normalizePets(sharedState.pendingGameCharacter.pets);
      this.selectedPetRuntimeId =
        typeof sharedState.pendingGameCharacter.selectedPetRuntimeId === 'number'
          ? (sharedState.pendingGameCharacter.selectedPetRuntimeId >>> 0)
          : null;
      this.petSummoned = sharedState.pendingGameCharacter.petSummoned === true;
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
    const parsed = parseEquipmentState(payload);
    if (!parsed) {
      return false;
    }

    const { instanceId, equipFlag } = parsed;
    const item = Array.isArray(this.bagItems)
      ? this.bagItems.find((entry) => (entry.instanceId >>> 0) === (instanceId >>> 0))
      : null;
    if (!item) {
      this.log(`Ignoring equipment state for unknown instanceId=${instanceId}`);
      return true;
    }

    item.equipped = equipFlag === 1;
    this.log(
      `Equipment state update instanceId=${instanceId} templateId=${item.templateId} equipped=${item.equipped ? 1 : 0}`
    );
    this.persistCurrentCharacter();
    sendEquipmentContainerSync(this);
    return true;
  }

  tryHandlePetActionPacket(payload) {
    if (payload.length !== 7) {
      return false;
    }

    const subcmd = payload[2];
    const runtimeId = payload.readUInt32LE(3) >>> 0;
    const pet = Array.isArray(this.pets)
      ? this.pets.find((entry) => (entry?.runtimeId >>> 0) === runtimeId) || null
      : null;

    this.log(`Pet action request sub=0x${subcmd.toString(16)} runtimeId=${runtimeId} known=${pet ? 1 : 0}`);

    if (subcmd === 0x51) {
      if (!pet) {
        return true;
      }
      this.selectedPetRuntimeId = runtimeId >>> 0;
      this.petSummoned = true;
      this.pets = normalizePets([
        pet,
        ...this.pets.filter((entry) => (entry?.runtimeId >>> 0) !== runtimeId),
      ]);
      this.persistCurrentCharacter();
      this.sendPetStateSync('client-03f5-51');
      return true;
    }

    if (subcmd === 0x58) {
      if (pet) {
        this.selectedPetRuntimeId = runtimeId >>> 0;
      }
      this.petSummoned = false;
      this.persistCurrentCharacter();
      const ownerRuntimeId = this.getPetOwnerRuntimeId();
      this.writePacket(
        buildPetPanelModePacket({
          ownerRuntimeId,
          enabled: false,
        }),
        DEFAULT_FLAGS,
        `Sending pet panel mode cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x57 reason=client-03f5-58 ownerRuntimeId=${ownerRuntimeId} enabled=0`
      );
      this.writePacket(
        buildPetPanelClearPacket({
          ownerRuntimeId,
        }),
        DEFAULT_FLAGS,
        `Sending pet panel clear cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x58 reason=client-03f5-58 ownerRuntimeId=${ownerRuntimeId}`
      );
      return true;
    }

    return true;
  }

  tryHandleAttributeAllocationPacket(payload) {
    const allocation = parseAttributeAllocation(payload);
    if (!allocation) {
      return false;
    }

    const { strengthDelta, dexterityDelta, vitalityDelta, intelligenceDelta } = allocation;
    const requestedTotal = strengthDelta + vitalityDelta + dexterityDelta + intelligenceDelta;

    this.log(
      `Attribute allocation confirm sub=0x1e str=${strengthDelta} dex=${dexterityDelta} vit=${vitalityDelta} int=${intelligenceDelta} available=${this.statusPoints}`
    );

    if (requestedTotal <= 0) {
      this.log('Ignoring empty attribute allocation confirm');
      return true;
    }

    const spendableTotal = Math.min(requestedTotal, Math.max(0, this.statusPoints));
    if (spendableTotal <= 0) {
      this.log('Ignoring attribute allocation with no spendable status points');
      this.sendSelfStateAptitudeSync();
      return true;
    }

    let remaining = spendableTotal;
    const applied = {
      strength: Math.min(strengthDelta, remaining),
      dexterity: 0,
      vitality: 0,
      intelligence: 0,
    };
    remaining -= applied.strength;
    applied.dexterity = Math.min(dexterityDelta, remaining);
    remaining -= applied.dexterity;
    applied.vitality = Math.min(vitalityDelta, remaining);
    remaining -= applied.vitality;
    applied.intelligence = Math.min(intelligenceDelta, remaining);

    this.primaryAttributes = normalizePrimaryAttributes({
      intelligence: this.primaryAttributes.intelligence + applied.intelligence,
      vitality: this.primaryAttributes.vitality + applied.vitality,
      dexterity: this.primaryAttributes.dexterity + applied.dexterity,
      strength: this.primaryAttributes.strength + applied.strength,
    });
    this.statusPoints = Math.max(0, this.statusPoints - (applied.strength + applied.vitality + applied.dexterity + applied.intelligence));

    this.persistCurrentCharacter({
      primaryAttributes: this.primaryAttributes,
      statusPoints: this.statusPoints,
    });
    this.sendSelfStateAptitudeSync();
    return true;
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
    this.scheduleEquipmentReplay();
    this.syncQuestStateToClient();
    if (this.petSummoned) {
      this.schedulePetReplay();
    } else {
      this.sendPetStateSync('enter-game');
    }
  }

  scheduleEquipmentReplay(delayMs = 300) {
    if (this.equipmentReplayTimer) {
      clearTimeout(this.equipmentReplayTimer);
      this.equipmentReplayTimer = null;
    }

    this.equipmentReplayTimer = setTimeout(() => {
      this.equipmentReplayTimer = null;
      if (this.state !== 'LOGGED_IN') {
        return;
      }
      sendEquipmentContainerSync(this);
    }, Math.max(0, delayMs | 0));
  }

  schedulePetReplay(delayMs = 500) {
    if (this.petReplayTimer) {
      clearTimeout(this.petReplayTimer);
      this.petReplayTimer = null;
    }

    this.petReplayTimer = setTimeout(() => {
      this.petReplayTimer = null;
      if (this.state !== 'LOGGED_IN' || !this.petSummoned) {
        return;
      }
      this.sendPetStateSync('client-03f5-51-replay');
    }, Math.max(0, delayMs | 0));
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
    questHandlerEnsureQuestStateReady(this);
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
      pets: normalizePets(this.pets),
      selectedPetRuntimeId:
        typeof this.selectedPetRuntimeId === 'number'
          ? (this.selectedPetRuntimeId >>> 0)
          : null,
      petSummoned: this.petSummoned === true,
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

  handlePositionUpdate(payload) {
    if (payload.length < 8) {
      this.log('Short 0x03eb payload');
      return;
    }

    if (this.defeatRespawnPending) {
      this.log('Ignoring position update while defeat respawn is pending');
      return;
    }

    const { x, y, mapId } = parsePositionUpdate(payload);
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
    if (!action) {
      this.currentEncounterTriggerId = null;
      return;
    }

    if (action.kind === 'encounterProbe') {
      if (this.shouldSuppressEncounterProbe(action, mapId)) {
        if (triggerId !== this.currentEncounterTriggerId) {
          this.log(
            `Encounter probe suppressed trigger=${triggerId} map=${mapId} pos=${x},${y} reason=active quest encounter owns this area`
          );
        }
        this.currentEncounterTriggerId = triggerId;
        return;
      }

      if (triggerId === this.currentEncounterTriggerId) {
        return;
      }

      const profile = action.encounterProfile || {};
      const cooldownMs = Math.max(0, Number.isFinite(profile.cooldownMs) ? profile.cooldownMs : 0);
      if (cooldownMs > 0) {
        const elapsedMs = Date.now() - this.lastEncounterProbeAt;
        if (elapsedMs < cooldownMs) {
          this.log(
            `Encounter cooldown active trigger=${triggerId} map=${mapId} pos=${x},${y} elapsed=${elapsedMs} cooldown=${cooldownMs}`
          );
          return;
        }
      }
      const chancePercent = Math.max(
        0,
        Math.min(100, Number.isFinite(profile.encounterChancePercent) ? profile.encounterChancePercent : 100)
      );
      if (chancePercent < 100) {
        const roll = Math.random() * 100;
        if (roll >= chancePercent) {
          this.log(
            `Encounter roll miss trigger=${triggerId} map=${mapId} pos=${x},${y} roll=${roll.toFixed(2)} chance=${chancePercent}`
          );
          return;
        }
        this.log(
          `Encounter roll hit trigger=${triggerId} map=${mapId} pos=${x},${y} roll=${roll.toFixed(2)} chance=${chancePercent}`
        );
      }

      this.currentEncounterTriggerId = triggerId;
      this.lastEncounterProbeAt = Date.now();
      this.sendCombatEncounterProbe(action);
      return;
    }

    if (action.kind === 'encounterProbeExit') {
      this.currentEncounterTriggerId = null;
      this.sendCombatExitProbe(action);
    }
  }

  shouldSuppressEncounterProbe(action, mapId) {
    if (!action || action.kind !== 'encounterProbe') {
      return false;
    }

    if (mapId !== 103 || action.probeId !== 'blingSpringField') {
      return false;
    }

    const petQuest = Array.isArray(this.activeQuests)
      ? this.activeQuests.find((quest) => (quest?.id >>> 0) === 51)
      : null;
    if (!petQuest) {
      return false;
    }

    return (petQuest.stepIndex >>> 0) === 3;
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

    const { attackMode, targetA, targetB } = parseAttackSelection(payload);
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
      `Synthetic attack selection mode=${attackMode} targetA=${targetA} targetB=${targetB} targetMatches=${resolution.enemy ? 1 : 0} retargeted=${resolution.retargeted ? 1 : 0} enemy=${resolution.enemy?.name || 'none'} hp=${resolution.enemy?.hp || 0}`
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
      this.sendCombatCommandHide(
        {
          probeId: 'enemy-defeated',
          entityId: resolution.enemy.entityId,
        },
        'enemy-defeated'
      );
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

    this.log(`Synthetic enemy defeated enemy=${resolution.enemy.name} entity=${resolution.enemy.entityId}`);
    this.awaitingCombatTurnHandshake = false;
    this.pendingCombatTurnProbe = null;
    this.sendSyntheticFightVictoryClose();
    this.finishSyntheticFight('victory', resolution.message);
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
    let dropResult = null;
    if (outcome === 'victory') {
      dropResult = rollSyntheticFightDrops(this, this.syntheticFight);
      if (dropResult?.granted?.length > 0) {
        this.refreshQuestStateForItemTemplates(
          dropResult.granted.map((drop) => drop.item?.templateId || drop.definition?.templateId).filter(Number.isInteger)
        );
      }
    }
    const finished = finalizeSyntheticFightState(this.syntheticFight, outcome);
    const player = finished.player;
    this.awaitingCombatTurnHandshake = false;
    this.pendingCombatTurnProbe = null;
    this.combatState = createCombatState();
    this.log(`Synthetic fight finished outcome=${outcome}`);
    if (dropResult?.granted?.length > 0 || dropResult?.skipped?.length > 0) {
      const dropText = [
        ...dropResult.granted.map((drop) => `${drop.definition?.name || drop.item.templateId} x${drop.quantity}`),
        ...dropResult.skipped.map((drop) => `${drop.templateId} skipped (${drop.reason})`),
      ].join(', ');
      this.log(`Synthetic fight drops outcome=${outcome} ${dropText}`);
    }
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
    if (dropResult?.inventoryDirty) {
      this.persistCurrentCharacter();
    }
    this.currentEncounterTriggerId = null;
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

  sendSyntheticFightVictoryClose() {
    const player = this.getSyntheticPlayerFighter();

    this.writePacket(
      buildSyntheticFightVictoryClosePacket({
        playerVitals: {
          health: player?.hp || this.currentHealth,
          mana: player?.mp || this.currentMana,
          rage: player?.rage || this.currentRage,
        },
      }),
      DEFAULT_FLAGS,
      `Sending synthetic fight victory close cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_RESULT_VICTORY_SUBCMD.toString(16)} hp=${player?.hp || this.currentHealth} mp=${player?.mp || this.currentMana} rage=${player?.rage || this.currentRage}`
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
        petCapacity: Array.isArray(this.pets) && this.pets.length > 0 ? Math.max(1, this.pets.length) : 0,
      }),
      DEFAULT_FLAGS,
      `Sending self-state stat sync cmd=0x${GAME_SELF_STATE_CMD.toString(16)} sub=0x${SELF_STATE_APTITUDE_SUBCMD.toString(16)} aptitude=${this.selectedAptitude} level=${this.level} hp/mp/rage=${currentHealth}/${currentMana}/${currentRage} stats=${this.primaryAttributes.intelligence}/${this.primaryAttributes.vitality}/${this.primaryAttributes.dexterity}/${this.primaryAttributes.strength} statusPoints=${this.statusPoints}`
    );
  }

  sendPetStateSync(reason = 'runtime') {
    this.pets = normalizePets(this.pets);
    if (this.pets.length === 0) {
      return;
    }
    const selectedPet = typeof this.selectedPetRuntimeId === 'number'
      ? this.pets.find((entry) => (entry?.runtimeId >>> 0) === this.selectedPetRuntimeId) || null
      : null;
    const pet = selectedPet || getPrimaryPet(this.pets);
    if (!pet) {
      return;
    }
    if (selectedPet) {
      this.pets = normalizePets([
        selectedPet,
        ...this.pets.filter((entry) => (entry?.runtimeId >>> 0) !== selectedPet.runtimeId),
      ]);
    }
    this.selectedPetRuntimeId = pet.runtimeId >>> 0;
    const ownerRuntimeId = this.getPetOwnerRuntimeId();

    this.writePacket(
      buildPetTreeRegistrationPacket({
        pet,
      }),
      DEFAULT_FLAGS,
      `Sending pet tree registration cmd=0x03eb type=0x02 reason=${reason} runtimeId=${pet.runtimeId} templateId=${pet.templateId} name="${pet.name}"`
    );
    this.writePacket(
      buildPetRosterSyncPacket({
        pets: this.pets,
      }),
      DEFAULT_FLAGS,
      `Sending pet roster sync cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x7f reason=${reason} count=${this.pets.length}`
    );
    const isPanelSummonSync = reason === 'client-03f5-51';
    const isReplaySync = reason === 'client-03f5-51-replay';
    if (!isPanelSummonSync) {
      this.writePacket(
        buildPetPanelBindPacket({
          ownerRuntimeId,
          pet,
        }),
        DEFAULT_FLAGS,
        `Sending pet panel bind cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x51 reason=${reason} ownerRuntimeId=${ownerRuntimeId} templateId=${pet.templateId} name="${pet.name}"`
      );
      this.writePacket(
        buildPetPanelNamePacket({
          ownerRuntimeId,
          pet,
        }),
        DEFAULT_FLAGS,
        `Sending pet panel name cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x59 reason=${reason} ownerRuntimeId=${ownerRuntimeId} name="${pet.name}"`
      );
    }
    this.writePacket(
      buildPetPanelModePacket({
        ownerRuntimeId,
        enabled: true,
      }),
      DEFAULT_FLAGS,
      `Sending pet panel mode cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x56 reason=${reason} ownerRuntimeId=${ownerRuntimeId} enabled=1`
    );
    this.sendPetPropertySync(ownerRuntimeId, pet, reason);
    this.writePacket(
      buildPetStatsSyncPacket({ pet }),
      DEFAULT_FLAGS,
      `Sending pet stat sync cmd=0x${GAME_SELF_STATE_CMD.toString(16)} sub=0x1f reason=${reason} runtimeId=${pet.runtimeId} stats=${pet.stats.strength}/${pet.stats.dexterity}/${pet.stats.vitality}/${pet.stats.intelligence} points=${pet.statPoints}`
    );
    if (!isPanelSummonSync) {
      this.writePacket(
        buildPetPanelRebindPacket({
          ownerRuntimeId,
        }),
        DEFAULT_FLAGS,
        `Sending pet panel rebind cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x53 reason=${reason} ownerRuntimeId=${ownerRuntimeId}`
      );
    }
    if (isReplaySync) {
      this.writePacket(
        buildPetActiveSelectPacket({
          runtimeId: pet.runtimeId,
        }),
        DEFAULT_FLAGS,
        `Sending pet active select cmd=0x03f5 reason=${reason} runtimeId=${pet.runtimeId}`
      );
    }
  }

  getPetOwnerRuntimeId() {
    return this.entityType >>> 0;
  }

  sendPetPropertySync(ownerRuntimeId, pet, reason = 'runtime') {
    const properties = [
      pet.level,
      pet.currentHealth,
      pet.currentMana,
      pet.loyalty,
      pet.stats?.strength,
      pet.stats?.dexterity,
      pet.stats?.vitality,
      pet.stats?.intelligence,
      pet.statPoints,
    ];

    properties.forEach((value, index) => {
      this.writePacket(
        buildPetPanelPropertyPacket({
          ownerRuntimeId,
          index,
          value: value >>> 0,
        }),
        DEFAULT_FLAGS,
        `Sending pet property sync cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x55 reason=${reason} ownerRuntimeId=${ownerRuntimeId} index=${index} value=${value >>> 0}`
      );
    });
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

  dispose() {
    if (this.petReplayTimer) {
      clearTimeout(this.petReplayTimer);
      this.petReplayTimer = null;
    }
  }

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
    const enemies = buildSyntheticEncounterEnemies(action, this.currentMapId);
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
      `Sending experimental combat encounter probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_ENCOUNTER_PROBE_SUBCMD.toString(16)} trigger=${action.probeId} active=${this.entityType} enemies=${enemies.map((enemy) => `${enemy.typeId}@${enemy.entityId}`).join('/')} count=${enemies.length} map=${this.currentMapId} pos=${this.currentX},${this.currentY} referenceCommands=${this.combatReference.fightCommands.map((command) => command.id).join('/') || 'none'} referenceSkills=${this.combatReference.skills.slice(0, 6).map((skill) => skill.id).join('/') || 'none'}`
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


module.exports = {
  Session,
};
