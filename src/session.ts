import type { GameSession, PrimaryAttributes, QuestSyncMode } from './types';

const { parsePingToken } = require('./protocol/inbound-packets');
const { dispatchGamePacket } = require('./handlers/packet-dispatcher');
const {
  createIdleCombatState,
  disposeCombatTimers: combatHandlerDisposeTimers,
  handleCombatPacket: combatHandlerHandleCombatPacket,
  sendCombatEncounterProbe: combatHandlerSendCombatEncounterProbe,
  sendCombatExitProbe: combatHandlerSendCombatExitProbe,
} = require('./handlers/combat-handler');
const {
  handleLogin: loginHandlerHandleLogin,
  handleRolePacket: loginHandlerHandleRolePacket,
} = require('./handlers/login-handler');
const {
  handleQuestPacket: questHandlerHandleQuestPacket,
  applyQuestEvents: questHandlerApplyQuestEvents,
  questEventHandler,
  handleQuestMonsterDefeat: questHandlerHandleQuestMonsterDefeat,
  syncQuestStateToClient: questHandlerSyncQuestStateToClient,
  ensureQuestStateReady: questHandlerEnsureQuestStateReady,
  refreshQuestStateForItemTemplates: questHandlerRefreshQuestStateForItemTemplates,
} = require('./handlers/quest-handler');
const {
  scheduleEquipmentReplay: playerStateHandlerScheduleEquipmentReplay,
  tryHandleAttributeAllocationPacket: playerStateHandlerTryHandleAttributeAllocationPacket,
  tryHandleEquipmentStatePacket: playerStateHandlerTryHandleEquipmentStatePacket,
  tryHandleFightResultItemActionProbe: playerStateHandlerTryHandleFightResultItemActionProbe,
  tryHandleItemUsePacket: playerStateHandlerTryHandleItemUsePacket,
} = require('./handlers/player-state-handler');
const {
  schedulePetReplay: petHandlerSchedulePetReplay,
  sendPetStateSync: petHandlerSendPetStateSync,
  tryHandlePetActionPacket: petHandlerTryHandlePetActionPacket,
  disposePetTimers: petHandlerDisposeTimers,
} = require('./handlers/pet-handler');
const {
  sendEnterGameOk: sessionBootstrapHandlerSendEnterGameOk,
  sendMapNpcSpawns: sessionBootstrapHandlerSendMapNpcSpawns,
} = require('./handlers/session-bootstrap-handler');
const {
  DEFAULT_FLAGS,
  ENTITY_TYPE,
  GAME_DIALOG_CMD,
  GAME_DIALOG_MESSAGE_SUBCMD,
  GAME_ITEM_CONTAINER_CMD,
  GAME_ITEM_CMD,
  GAME_SCENE_ENTER_CMD,
  GAME_SELF_STATE_CMD,
  HANDSHAKE_CMD,
  MAP_ID,
  PING_CMD,
  PONG_CMD,
  SCENE_ENTER_LOAD_SUBCMD,
  SERVER_SCRIPT_DEFERRED_SUBCMD,
  SERVER_SCRIPT_IMMEDIATE_SUBCMD,
  SELF_STATE_APTITUDE_SUBCMD,
  SPAWN_X,
  SPAWN_Y,
  SPECIAL_FLAGS,
  VALID_FLAG_MASK,
  VALID_FLAG_VALUE,
} = require('./config');
const { PacketWriter, buildPacket } = require('./protocol');
const {
  buildGameDialoguePacket,
  buildSceneEnterPacket,
  buildServerRunScriptPacket,
  buildSelfStateAptitudeSyncPacket,
} = require('./protocol/gameplay-packets');
const { ObjectiveRegistry } = require('./objectives/objective-registry');
const { questObjectiveSystem } = require('./objectives/quest-objective-system');
const { CHARACTER_VITALS_BASELINE, resolveCurrentPlayerVitals } = require('./gameplay/session-flows');
const { stopAutoMapRotation } = require('./scenes/map-rotation');
const {
  buildCharacterSnapshot: sessionHydrationBuildCharacterSnapshot,
  getPersistedCharacter: sessionHydrationGetPersistedCharacter,
  hydratePendingGameCharacter,
  persistCurrentCharacter: sessionHydrationPersistCurrentCharacter,
  saveCharacter: sessionHydrationSaveCharacter,
} = require('./character/session-hydration');
const { defaultBonusAttributes } = require('./character/normalize');

type SharedState = Record<string, any>;
type LoggerLike = {
  log(message: string): void;
  hexDump(buffer: Buffer, prefix: string): string;
};
type SocketLike = {
  destroyed?: boolean;
  destroy(): void;
  write(packet: Buffer): void;
};
type CharacterOverrides = Record<string, unknown>;

const SELF_STATE_PROBE_FIELD_A = Number.isFinite(Number(process.env.SELF_STATE_PROBE_FIELD_A))
  ? Number(process.env.SELF_STATE_PROBE_FIELD_A)
  : 0;
const SELF_STATE_PROBE_FIELD_B = Number.isFinite(Number(process.env.SELF_STATE_PROBE_FIELD_B))
  ? Number(process.env.SELF_STATE_PROBE_FIELD_B)
  : 1;

class Session implements GameSession {
  socket: SocketLike;
  id: number;
  isGame: boolean;
  sharedState: SharedState;
  logger: LoggerLike;
  recvBuf: Buffer;
  serverSeq: number;
  clientSeq: number;
  state: string;
  accountName: string | null;
  charName: string;
  entityType: number;
  roleEntityType: number;
  roleData: number;
  selectedAptitude: number;
  level: number;
  experience: number;
  currentHealth: number;
  currentMana: number;
  currentRage: number;
  maxHealth: number;
  maxMana: number;
  maxRage: number;
  gold: number;
  bankGold: number;
  boundGold: number;
  coins: number;
  renown: number;
  primaryAttributes: PrimaryAttributes;
  bonusAttributes: PrimaryAttributes;
  statusPoints: number;
  activeQuests: any[];
  completedQuests: number[];
  pets: any[];
  selectedPetRuntimeId: number | null;
  petSummoned: boolean;
  bagItems: any[];
  bagSize: number;
  nextItemInstanceId: number;
  nextBagSlot: number;
  currentMapId: number;
  currentX: number;
  currentY: number;
  equipmentReplayTimer: NodeJS.Timeout | null;
  petReplayTimer: NodeJS.Timeout | null;
  defeatRespawnPending: boolean;
  hasAnnouncedQuestOverview: boolean;
  persistedCharacter: Record<string, unknown> | null;
  objectiveRegistry: any;
  combatState: Record<string, unknown>;
  combatDefeatTimer: NodeJS.Timeout | null;
  mapRotationTimer: NodeJS.Timeout | null;
  mapRotationTargets: Array<{ mapId: number; mapName: string; x: number; y: number }>;
  mapRotationIndex: number;
  mapRotationAwaitingMapId: number | null;
  mapRotationLastSentAt: number | null;

  constructor(
    socket: SocketLike,
    id: number,
    isGame: boolean,
    sharedState: SharedState,
    logger: LoggerLike
  ) {
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
    this.maxHealth = CHARACTER_VITALS_BASELINE.health;
    this.maxMana = CHARACTER_VITALS_BASELINE.mana;
    this.maxRage = 100;
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
    this.bonusAttributes = defaultBonusAttributes();
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
    this.equipmentReplayTimer = null;
    this.petReplayTimer = null;
    this.defeatRespawnPending = false;
    this.hasAnnouncedQuestOverview = false;
    this.persistedCharacter = null;
    this.objectiveRegistry = new ObjectiveRegistry();
    this.combatState = createIdleCombatState();
    this.combatDefeatTimer = null;
    this.mapRotationTimer = null;
    this.mapRotationTargets = [];
    this.mapRotationIndex = 0;
    this.mapRotationAwaitingMapId = null;
    this.mapRotationLastSentAt = null;
    this.objectiveRegistry.register({
      system: questObjectiveSystem,
      handler: questEventHandler,
      getState: (session: Session) => ({
        activeQuests: session.activeQuests,
        completedQuests: session.completedQuests,
        level: session.level,
      }),
    });

    hydratePendingGameCharacter(this, sharedState);
  }

  feed(data: Buffer): void {
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

  handlePacket(flags: number, seq: number, payload: Buffer): void {
    if (payload.length === 0) {
      return;
    }

    const cmdByte = payload[0];
    const cmdWord = payload.length >= 2 ? payload.readUInt16LE(0) : cmdByte;
    this.log(
      `CMD8=0x${cmdByte.toString(16).padStart(2, '0')} CMD16=0x${cmdWord.toString(16).padStart(4, '0')} state=${this.state}`
    );
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

  handleLogin(payload: Buffer): void {
    loginHandlerHandleLogin(this, payload);
  }

  handleLoggedInPacket(flags: number, payload: Buffer): void {
    const cmdByte = payload[0];
    const cmdWord = payload.length >= 2 ? payload.readUInt16LE(0) : cmdByte;
    this.log(
      `Game packet flags=0x${flags.toString(16)} cmd8=0x${cmdByte.toString(16).padStart(2, '0')} cmd16=0x${cmdWord.toString(16).padStart(4, '0')}`
    );

    if (dispatchGamePacket(this, cmdWord, flags, payload)) {
      return;
    }

    if (
      cmdWord === GAME_ITEM_CONTAINER_CMD ||
      cmdWord === GAME_ITEM_CMD ||
      cmdWord === GAME_ITEM_CMD + 1 ||
      cmdWord === 0x0400
    ) {
      this.log(
        `Unhandled inventory-related cmd16=0x${cmdWord.toString(16)} payload=${payload.toString('hex')}`
      );
    }

    this.log(`Unhandled game cmd8=0x${cmdByte.toString(16)} cmd16=0x${cmdWord.toString(16)}`);
  }

  tryHandleEquipmentStatePacket(payload: Buffer): boolean {
    return playerStateHandlerTryHandleEquipmentStatePacket(this, payload);
  }

  tryHandlePetActionPacket(payload: Buffer): boolean {
    return petHandlerTryHandlePetActionPacket(this, payload);
  }

  tryHandleAttributeAllocationPacket(payload: Buffer): boolean {
    return playerStateHandlerTryHandleAttributeAllocationPacket(this, payload);
  }

  tryHandleFightResultItemActionProbe(payload: Buffer): boolean {
    return playerStateHandlerTryHandleFightResultItemActionProbe(this, payload);
  }

  tryHandleItemUsePacket(cmdWord: number, payload: Buffer): boolean {
    return playerStateHandlerTryHandleItemUsePacket(this, cmdWord, payload);
  }

  handleCombatPacket(cmdWord: number, payload: Buffer): void {
    combatHandlerHandleCombatPacket(this, cmdWord, payload);
  }

  handleSpecialPacket(cmdWord: number, payload: Buffer): void {
    if (cmdWord === PING_CMD) {
      const { token } = parsePingToken(payload);
      this.sendPong(token);
      return;
    }

    this.log(`Unhandled special cmd16=0x${cmdWord.toString(16)}`);
  }

  handleRolePacket(payload: Buffer): void {
    loginHandlerHandleRolePacket(this, payload);
  }

  sendHandshake(): void {
    const writer = new PacketWriter();
    writer.writeUint16(HANDSHAKE_CMD);
    writer.writeUint32(0);
    this.writePacket(
      writer.payload(),
      SPECIAL_FLAGS,
      'Sending handshake (flags=0x44, seed=0, no encryption)'
    );
  }

  sendEnterGameOk(options: { syncMode?: QuestSyncMode } = {}): void {
    sessionBootstrapHandlerSendEnterGameOk(this, options);
  }

  scheduleEquipmentReplay(delayMs = 300): void {
    playerStateHandlerScheduleEquipmentReplay(this, delayMs);
  }

  schedulePetReplay(delayMs = 500): void {
    petHandlerSchedulePetReplay(this, delayMs);
  }

  sendPong(token: number): void {
    const writer = new PacketWriter();
    writer.writeUint16(PONG_CMD);
    writer.writeUint32(token);
    this.writePacket(writer.payload(), SPECIAL_FLAGS, `Sending pong token=0x${token.toString(16)}`);
  }

  writePacket(payload: Buffer, flags = DEFAULT_FLAGS, message = ''): void {
    const packet = buildPacket(payload, this.serverSeq, flags);
    if (payload.length >= 2) {
      const cmdWord = payload.readUInt16LE(0);
      if (
        (cmdWord === GAME_ITEM_CMD || cmdWord === GAME_ITEM_CONTAINER_CMD) &&
        payload.includes(Buffer.from([0xed, 0x13]))
      ) {
        this.log(
          `Debug item packet cmd=0x${cmdWord.toString(16)} payload=${payload.toString('hex')}`
        );
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

  log(message: string): void {
    this.logger.log(`[S${this.id}] ${message}`);
  }

  getPersistedCharacter(): Record<string, unknown> | null {
    this.persistedCharacter = sessionHydrationGetPersistedCharacter(this);
    return this.persistedCharacter;
  }

  saveCharacter(character: Record<string, unknown>): void {
    sessionHydrationSaveCharacter(this, character);
  }

  ensureQuestStateReady(): void {
    questHandlerEnsureQuestStateReady(this);
  }

  buildCharacterSnapshot(overrides: CharacterOverrides = {}): Record<string, unknown> {
    return sessionHydrationBuildCharacterSnapshot(this, overrides);
  }

  persistCurrentCharacter(overrides: CharacterOverrides = {}): void {
    sessionHydrationPersistCurrentCharacter(this, overrides);
  }

  handleQuestPacket(payload: Buffer): void {
    questHandlerHandleQuestPacket(this, payload);
  }

  applyQuestEvents(events: any[], source = 'runtime', options: Record<string, unknown> = {}): void {
    questHandlerApplyQuestEvents(this, events, source, options);
  }

  dispatchObjectiveMonsterDefeat(monsterId: number, count = 1, source = 'monster-defeat', options: Record<string, unknown> = {}): boolean {
    return this.objectiveRegistry.dispatchMonsterDefeat(this, monsterId, count, source, options);
  }

  reconcileObjectives(source = 'bootstrap', options: Record<string, unknown> = {}): boolean {
    return this.objectiveRegistry.reconcileAll(this, source, options);
  }

  handleQuestMonsterDefeat(monsterId: number, count = 1): void {
    questHandlerHandleQuestMonsterDefeat(this, monsterId, count);
  }

  syncQuestStateToClient(options: { mode?: QuestSyncMode } = {}): void {
    questHandlerSyncQuestStateToClient(this, options);
  }

  refreshQuestStateForItemTemplates(templateIds: number[]): void {
    questHandlerRefreshQuestStateForItemTemplates(this, templateIds);
  }

  sendSelfStateAptitudeSync(): void {
    const vitals = resolveCurrentPlayerVitals(this);
    const packet = buildSelfStateAptitudeSyncPacket({
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
      currentHealth: vitals.health,
      currentMana: vitals.mana,
      currentRage: vitals.rage,
      petCapacity: Array.isArray(this.pets) && this.pets.length > 0 ? Math.max(1, this.pets.length) : 0,
      probeFieldA: SELF_STATE_PROBE_FIELD_A,
      probeFieldB: SELF_STATE_PROBE_FIELD_B,
    });

    this.writePacket(
      packet,
      DEFAULT_FLAGS,
      `Sending self-state stat sync cmd=0x${GAME_SELF_STATE_CMD.toString(16)} sub=0x${SELF_STATE_APTITUDE_SUBCMD.toString(16)} aptitude=${this.selectedAptitude} level=${this.level} hp/mp/rage=${vitals.health}/${vitals.mana}/${vitals.rage} stats=${this.primaryAttributes.intelligence}/${this.primaryAttributes.vitality}/${this.primaryAttributes.dexterity}/${this.primaryAttributes.strength} statusPoints=${this.statusPoints} probeFields=${SELF_STATE_PROBE_FIELD_A}/${SELF_STATE_PROBE_FIELD_B} packetHex=${packet.toString('hex')}`
    );
  }

  sendServerRunScriptImmediate(scriptId: number): void {
    this.writePacket(
      buildServerRunScriptPacket(scriptId, SERVER_SCRIPT_IMMEDIATE_SUBCMD),
      DEFAULT_FLAGS,
      `Sending script-event immediate cmd=0x0407 sub=0x${SERVER_SCRIPT_IMMEDIATE_SUBCMD.toString(16)} script=${scriptId}`
    );
  }

  sendServerRunScriptDeferred(scriptId: number): void {
    this.writePacket(
      buildServerRunScriptPacket(scriptId, SERVER_SCRIPT_DEFERRED_SUBCMD),
      DEFAULT_FLAGS,
      `Sending script-event deferred cmd=0x0407 sub=0x${SERVER_SCRIPT_DEFERRED_SUBCMD.toString(16)} script=${scriptId}`
    );
  }

  sendSceneEnter(mapId: number, x: number, y: number, subtype = SCENE_ENTER_LOAD_SUBCMD): void {
    this.writePacket(
      buildSceneEnterPacket(mapId, x, y, subtype),
      DEFAULT_FLAGS,
      `Sending scene-enter cmd=0x${GAME_SCENE_ENTER_CMD.toString(16)} sub=0x${subtype.toString(16)} map=${mapId} pos=${x},${y}`
    );
    sessionBootstrapHandlerSendMapNpcSpawns(this, mapId);
  }

  sendPetStateSync(reason = 'runtime'): void {
    petHandlerSendPetStateSync(this, reason);
  }

  dispose(): void {
    combatHandlerDisposeTimers(this);
    petHandlerDisposeTimers(this);
    stopAutoMapRotation(this);
    if (this.equipmentReplayTimer) {
      clearTimeout(this.equipmentReplayTimer);
      this.equipmentReplayTimer = null;
    }
  }

  sendGameDialogue(
    speaker: string,
    message: string,
    subtype = GAME_DIALOG_MESSAGE_SUBCMD,
    flags = 0,
    extraText: string | null = null
  ): void {
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

  sendCombatEncounterProbe(action: Record<string, unknown>): void {
    combatHandlerSendCombatEncounterProbe(this, action);
  }

  sendCombatExitProbe(action: Record<string, unknown>): void {
    combatHandlerSendCombatExitProbe(this, action);
  }
}

export {
  Session,
};
