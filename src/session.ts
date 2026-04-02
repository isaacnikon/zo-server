import type { CombatEnemyInstance, CombatState, FieldEventSpawn, FrogTeleporterUnlocks, GameSession, OnlineActivityState, PrimaryAttributes, QuestRecord, QuestSyncMode, SkillState } from './types.js';

import { dispatchGamePacket } from './handlers/packet-dispatcher.js';
import { createIdleCombatState, disposeCombatTimers as combatHandlerDisposeTimers, handleSharedCombatParticipantDisposed as combatHandlerHandleSharedCombatParticipantDisposed, sendCombatEncounterProbe as combatHandlerSendCombatEncounterProbe, sendCombatExitProbe as combatHandlerSendCombatExitProbe, } from './handlers/combat-handler.js';
import { handleLogin as loginHandlerHandleLogin, } from './handlers/login-handler.js';
import { applyQuestEvents as questHandlerApplyQuestEvents, questEventHandler, handleQuestMonsterDefeat as questHandlerHandleQuestMonsterDefeat, syncQuestStateToClient as questHandlerSyncQuestStateToClient, ensureQuestStateReady as questHandlerEnsureQuestStateReady, refreshQuestStateForItemTemplates as questHandlerRefreshQuestStateForItemTemplates, } from './handlers/quest-handler.js';
import { scheduleEquipmentReplay as playerStateHandlerScheduleEquipmentReplay, } from './handlers/player-state-handler.js';
import { schedulePetReplay as petHandlerSchedulePetReplay, sendPetStateSync as petHandlerSendPetStateSync, disposePetTimers as petHandlerDisposeTimers, } from './handlers/pet-handler.js';
import { sendEnterGameOk as sessionBootstrapHandlerSendEnterGameOk, sendMapNpcSpawns as sessionBootstrapHandlerSendMapNpcSpawns, } from './handlers/session-bootstrap-handler.js';
import { DEFAULT_FLAGS, ENTITY_TYPE, GAME_DIALOG_CMD, GAME_DIALOG_MESSAGE_SUBCMD, GAME_FIGHT_STREAM_CMD, GAME_FIGHT_TURN_CMD, GAME_ITEM_CONTAINER_CMD, GAME_ITEM_CMD, GAME_SCENE_ENTER_CMD, GAME_SELF_STATE_CMD, HANDSHAKE_CMD, MAP_ID, PING_CMD, PONG_CMD, SCENE_ENTER_LOAD_SUBCMD, SERVER_SCRIPT_DEFERRED_SUBCMD, SERVER_SCRIPT_IMMEDIATE_SUBCMD, SELF_STATE_APTITUDE_SUBCMD, SPAWN_X, SPAWN_Y, SPECIAL_FLAGS, VALID_FLAG_MASK, VALID_FLAG_VALUE, } from './config.js';
import { PacketWriter, buildPacket } from './protocol.js';
import { buildGameDialoguePacket, buildSceneEnterPacket, buildServerRunScriptPacket, buildSelfStateAptitudeSyncPacket, } from './protocol/gameplay-packets.js';
import { ObjectiveRegistry } from './objectives/objective-registry.js';
import { getClientVisibleExperience } from './gameplay/progression.js';
import { questObjectiveSystem } from './objectives/quest-objective-system.js';
import { CHARACTER_VITALS_BASELINE, resolveCurrentPlayerVitals } from './gameplay/session-flows.js';
import { stopAutoMapRotation } from './scenes/map-rotation.js';
import { removeWorldPresence } from './world-state.js';
import { buildEncounterEnemies } from './combat/encounter-builder.js';
import { buildCharacterSnapshot as sessionHydrationBuildCharacterSnapshot, getPersistedCharacter as sessionHydrationGetPersistedCharacter, hydratePendingGameCharacter, persistCurrentCharacter as sessionHydrationPersistCurrentCharacter, saveCharacter as sessionHydrationSaveCharacter, } from './character/session-hydration.js';
import { defaultBonusAttributes, defaultSkillState } from './character/normalize.js';
import { defaultFrogTeleporterUnlocks, syncFrogTeleporterClientState } from './gameplay/frog-teleporter-service.js';
import { defaultOnlineState, flushOnlinePresence, touchOnlinePresence } from './gameplay/online-runtime.js';
import { claimPostTwentyOnlineRenownReward, defaultRenownTaskDailyState } from './gameplay/renown-task-runtime.js';
import { sendSelfStateValueUpdate } from './gameplay/stat-sync.js';
import { beginSharedTeamCombat, getSharedTeamCombatFollowers, getSharedTeamCombatOwnerSession, getTeamCombatParticipants, handleTeamSessionDisposed, isSharedTeamCombatOwner, syncTeamFollowersToLeader } from './gameplay/team-runtime.js';

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
const VERBOSE_SESSION_PACKET_LOGS =
  typeof process.env.VERBOSE_SESSION_PACKET_LOGS === 'string' &&
  ['1', 'true', 'yes', 'on'].includes(process.env.VERBOSE_SESSION_PACKET_LOGS.trim().toLowerCase());
const GAME_PLAYER_ACTION_STATE_CMD = 0x040d;

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
  remoteAddress: string | null;
  accountName: string | null;
  accountKey: string | null;
  charName: string;
  runtimeId: number;
  teamId: number | null;
  teamSize: number;
  teamMembers: number[];
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
  derivedMaxHealth: number;
  derivedMaxMana: number;
  derivedMaxRage: number;
  clientObservedMaxHealth: number | null;
  clientObservedMaxMana: number | null;
  gold: number;
  bankGold: number;
  boundGold: number;
  coins: number;
  renown: number;
  onlineState: OnlineActivityState;
  onlineCreditCursorAt: number | null;
  onlineLastPersistAt: number | null;
  lastHeartbeatAt: number | null;
  primaryAttributes: PrimaryAttributes;
  bonusAttributes: PrimaryAttributes;
  skillState: SkillState;
  statusPoints: number;
  activeQuests: QuestRecord[];
  completedQuests: number[];
  pets: any[];
  selectedPetRuntimeId: number | null;
  petSummoned: boolean;
  renownTaskDailyState: import('./types.js').RenownTaskDailyState;
  bagItems: any[];
  bagSize: number;
  warehouseItems: any[];
  warehouseSize: number;
  nextItemInstanceId: number;
  nextBagSlot: number;
  nextWarehouseSlot: number;
  warehousePassword: string;
  warehouseUnlocked: boolean;
  currentMapId: number;
  currentX: number;
  currentY: number;
  equipmentReplayTimer: NodeJS.Timeout | null;
  petReplayTimer: NodeJS.Timeout | null;
  defeatRespawnPending: boolean;
  hasAnnouncedQuestOverview: boolean;
  persistedCharacter: Record<string, unknown> | null;
  objectiveRegistry: any;
  combatState: CombatState;
  combatDefeatTimer: NodeJS.Timeout | null;
  combatSkillResolutionTimer: NodeJS.Timeout | null;
  activeNpcShop: any;
  activeNpcService: any;
  frogTeleporterUnlocks: FrogTeleporterUnlocks;
  attackMin?: number;
  attackMax?: number;
  characterAttackMin?: number;
  characterAttackMax?: number;
  mapRotationTimer: NodeJS.Timeout | null;
  mapRotationTargets: Array<{ mapId: number; mapName: string; x: number; y: number }>;
  mapRotationIndex: number;
  mapRotationAwaitingMapId: number | null;
  mapRotationLastSentAt: number | null;
  gatheringNodes: Map<number, {
    runtimeId: number;
    nodeId: number;
    templateId: number;
    x: number;
    y: number;
    toolType: number;
    dropItemId: number;
    level: number;
    name: string;
  }> | null;
  activeGather: { runtimeId: number; startedAt: number } | null;
  fieldEventSpawns: Map<number, FieldEventSpawn> | null;
  pendingSceneNpcSpawnMapId: number | null;
  pendingLoginQuestSyncMapId: number | null;
  pendingLoginQuestSyncTimer: NodeJS.Timeout | null;
  fieldCombatCooldownUntil: number | null;
  lastFieldCombatProbeKey: string | null;
  worldRegistered: boolean;
  visiblePlayerRuntimeIds: Set<number>;
  observedPlayerPositions: Map<number, { x: number; y: number }>;
  observedPetStates: Map<number, { ownerRuntimeId: number; x: number; y: number; entityType: number }>;

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
    this.remoteAddress = typeof (socket as any)?.remoteAddress === 'string' ? (socket as any).remoteAddress : null;
    this.accountName = null;
    this.accountKey = null;
    this.charName = 'Hero';
    this.runtimeId = ENTITY_TYPE;
    this.teamId = null;
    this.teamSize = 0;
    this.teamMembers = [];
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
    this.derivedMaxHealth = CHARACTER_VITALS_BASELINE.health;
    this.derivedMaxMana = CHARACTER_VITALS_BASELINE.mana;
    this.derivedMaxRage = 100;
    this.clientObservedMaxHealth = null;
    this.clientObservedMaxMana = null;
    this.gold = 0;
    this.bankGold = 0;
    this.boundGold = 0;
    this.coins = 0;
    this.renown = 0;
    this.onlineState = defaultOnlineState();
    this.onlineCreditCursorAt = null;
    this.onlineLastPersistAt = null;
    this.lastHeartbeatAt = null;
    this.primaryAttributes = {
      intelligence: 15,
      vitality: 15,
      dexterity: 15,
      strength: 15,
    };
    this.bonusAttributes = defaultBonusAttributes();
    this.skillState = defaultSkillState();
    this.statusPoints = 0;
    this.activeQuests = [];
    this.completedQuests = [];
    this.renownTaskDailyState = defaultRenownTaskDailyState();
    this.pets = [];
    this.selectedPetRuntimeId = null;
    this.petSummoned = false;
    this.bagItems = [];
    this.bagSize = 24;
    this.warehouseItems = [];
    this.warehouseSize = 30;
    this.nextItemInstanceId = 1;
    this.nextBagSlot = 0;
    this.nextWarehouseSlot = 0;
    this.warehousePassword = '000000';
    this.warehouseUnlocked = false;
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
    this.combatSkillResolutionTimer = null;
    this.activeNpcShop = null;
    this.activeNpcService = null;
    this.frogTeleporterUnlocks = defaultFrogTeleporterUnlocks();
    this.mapRotationTimer = null;
    this.mapRotationTargets = [];
    this.mapRotationIndex = 0;
    this.mapRotationAwaitingMapId = null;
    this.mapRotationLastSentAt = null;
    this.gatheringNodes = null;
    this.activeGather = null;
    this.fieldEventSpawns = null;
    this.pendingSceneNpcSpawnMapId = null;
    this.pendingLoginQuestSyncMapId = null;
    this.pendingLoginQuestSyncTimer = null;
    this.fieldCombatCooldownUntil = null;
    this.lastFieldCombatProbeKey = null;
    this.worldRegistered = false;
    this.visiblePlayerRuntimeIds = new Set<number>();
    this.observedPlayerPositions = new Map<number, { x: number; y: number }>();
    this.observedPetStates = new Map<number, { ownerRuntimeId: number; x: number; y: number; entityType: number }>();
    this.objectiveRegistry.register({
      system: questObjectiveSystem,
      handler: questEventHandler,
      getState: (session: Session) => ({
        activeQuests: session.activeQuests,
        completedQuests: session.completedQuests,
        level: session.level,
      }),
    });

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

      this.logInboundPacket(flags, payloadLen, seq, payload);
      this.handlePacket(flags, seq, payload);
    }
  }

  handlePacket(flags: number, seq: number, payload: Buffer): void {
    if (payload.length === 0) {
      return;
    }

    const cmdByte = payload[0];
    const cmdWord = payload.length >= 2 ? payload.readUInt16LE(0) : cmdByte;
    this.logDecodedPacket(cmdByte, cmdWord, payload);

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
    this.logGamePacketHeader(flags, cmdByte, cmdWord);

    touchOnlinePresence(this, {
      isHeartbeat: (flags & 0x04) !== 0 && cmdWord === PING_CMD,
    });
    const automaticRenownGain = claimPostTwentyOnlineRenownReward(this);
    if (automaticRenownGain > 0) {
      this.renown += automaticRenownGain;
      sendSelfStateValueUpdate(this, 'renown', this.renown);
      this.persistCurrentCharacter();
      this.onlineLastPersistAt = Date.now();
      this.log(`Auto renown granted amount=${automaticRenownGain} total=${this.renown}`);
    }

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

  writePacket(payload: Buffer, flags: number = DEFAULT_FLAGS, message = ''): void {
    const packet = buildPacket(payload, this.serverSeq, flags);
    let cmdWord = -1;
    if (payload.length >= 2) {
      cmdWord = payload.readUInt16LE(0);
      if (
        VERBOSE_SESSION_PACKET_LOGS &&
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
    if (this.shouldLogPacketMessage(message)) {
      this.log(message);
    }
    this.logOutboundPacket(packet);
    this.socket.write(packet);

    const isMirroredSharedCombatPacket = message.includes('mirrored-owner=');
    const shouldMirrorSharedCombatPacket =
      !isMirroredSharedCombatPacket &&
      cmdWord === GAME_FIGHT_STREAM_CMD &&
      payload.length >= 3 &&
      (
        payload[2] === 0x03 ||
        payload[2] === 0x04 ||
        payload[2] === 0x33
      );

    const sharedCombatOwner = getSharedTeamCombatOwnerSession(this);
    if (sharedCombatOwner && shouldMirrorSharedCombatPacket) {
      const participants = [
        sharedCombatOwner,
        ...getSharedTeamCombatFollowers(sharedCombatOwner),
      ];
      for (const participant of participants) {
        if ((participant.id >>> 0) === (this.id >>> 0)) {
          continue;
        }
        participant.writePacket(payload, flags, `${message} mirrored-owner=S${sharedCombatOwner.id}`);
      }
    }
  }

  log(message: string): void {
    this.logger.log(`[S${this.id}] ${message}`);
  }

  private logInboundPacket(flags: number, payloadLen: number, seq: number, payload: Buffer): void {
    if (!VERBOSE_SESSION_PACKET_LOGS) {
      return;
    }
    this.log(`RECV pkt flags=0x${flags.toString(16)} len=${payloadLen} seq=${seq}`);
    this.logger.log(this.logger.hexDump(payload, `[S${this.id}] < `));
  }

  private logDecodedPacket(cmdByte: number, cmdWord: number, payload: Buffer): void {
    if (!VERBOSE_SESSION_PACKET_LOGS) {
      return;
    }
    this.log(
      `CMD8=0x${cmdByte.toString(16).padStart(2, '0')} CMD16=0x${cmdWord.toString(16).padStart(4, '0')} state=${this.state}`
    );
    const readable = payload.toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    this.log(`ASCII: ${readable}`);
  }

  private logGamePacketHeader(flags: number, cmdByte: number, cmdWord: number): void {
    if (!VERBOSE_SESSION_PACKET_LOGS) {
      return;
    }
    this.log(
      `Game packet flags=0x${flags.toString(16)} cmd8=0x${cmdByte.toString(16).padStart(2, '0')} cmd16=0x${cmdWord.toString(16).padStart(4, '0')}`
    );
  }

  private shouldLogPacketMessage(message: string): boolean {
    if (!message) {
      return false;
    }
    return VERBOSE_SESSION_PACKET_LOGS || !message.startsWith('Sending ');
  }

  private logOutboundPacket(packet: Buffer): void {
    if (!VERBOSE_SESSION_PACKET_LOGS) {
      return;
    }
    this.logger.log(this.logger.hexDump(packet, `[S${this.id}] > `));
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

  applyQuestEvents(events: any[], source = 'runtime', options: Record<string, unknown> = {}): void {
    questHandlerApplyQuestEvents(this, events, source, options);
  }

  dispatchObjectiveMonsterDefeat(monsterId: number, count = 1, source = 'monster-defeat', options: Record<string, unknown> = {}): boolean {
    return this.objectiveRegistry.dispatchMonsterDefeat(this, monsterId, count, source, options);
  }

  reconcileObjectives(source = 'bootstrap', options: Record<string, unknown> = {}): boolean {
    return this.objectiveRegistry.reconcileAll(this, source, options);
  }

  handleQuestMonsterDefeat(monsterId: number, count = 1): { handled: boolean; grantedItems: Array<{ templateId: number; quantity: number }> } {
    return questHandlerHandleQuestMonsterDefeat(this, monsterId, count);
  }

  syncQuestStateToClient(options: { mode?: QuestSyncMode } = {}): void {
    questHandlerSyncQuestStateToClient(this, options);
  }

  refreshQuestStateForItemTemplates(templateIds: number[]): void {
    questHandlerRefreshQuestStateForItemTemplates(this, templateIds);
  }

  sendSelfStateAptitudeSync(): void {
    const vitals = resolveCurrentPlayerVitals(this);
    const displayExperience = getClientVisibleExperience(this.level, this.experience);
    const packet = buildSelfStateAptitudeSyncPacket({
      selectedAptitude: this.selectedAptitude,
      level: this.level,
      experience: displayExperience,
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
      petCapacity: 3,
      probeFieldA: SELF_STATE_PROBE_FIELD_A,
      probeFieldB: SELF_STATE_PROBE_FIELD_B,
    });

    this.writePacket(
      packet,
      DEFAULT_FLAGS,
      `Sending self-state stat sync cmd=0x${GAME_SELF_STATE_CMD.toString(16)} sub=0x${SELF_STATE_APTITUDE_SUBCMD.toString(16)} aptitude=${this.selectedAptitude} level=${this.level} exp=${displayExperience} hp/mp/rage=${vitals.health}/${vitals.mana}/${vitals.rage} stats=${this.primaryAttributes.intelligence}/${this.primaryAttributes.vitality}/${this.primaryAttributes.dexterity}/${this.primaryAttributes.strength} statusPoints=${this.statusPoints} probeFields=${SELF_STATE_PROBE_FIELD_A}/${SELF_STATE_PROBE_FIELD_B} packetHex=${packet.toString('hex')}`
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
    this.pendingSceneNpcSpawnMapId = mapId;
    this.currentMapId = mapId >>> 0;
    this.currentX = x >>> 0;
    this.currentY = y >>> 0;
    this.sendMapNpcSpawns(mapId >>> 0);
    this.syncQuestStateToClient({ mode: 'runtime' });
    syncFrogTeleporterClientState(this, `scene-enter:${mapId >>> 0}`);
    this.pendingSceneNpcSpawnMapId = null;
    syncTeamFollowersToLeader(this);
  }

  sendMapNpcSpawns(mapId: number): void {
    sessionBootstrapHandlerSendMapNpcSpawns(this, mapId);
  }

  sendPetStateSync(reason = 'runtime'): void {
    petHandlerSendPetStateSync(this, reason);
  }

  dispose(): void {
    const nowMs = Date.now();
    flushOnlinePresence(this, nowMs);
    const automaticRenownGain = claimPostTwentyOnlineRenownReward(this, new Date(nowMs));
    if (automaticRenownGain > 0) {
      this.renown += automaticRenownGain;
      this.persistCurrentCharacter();
      this.log(`Auto renown granted on disconnect amount=${automaticRenownGain} total=${this.renown}`);
    }
    if (this.pendingLoginQuestSyncTimer) {
      clearTimeout(this.pendingLoginQuestSyncTimer);
      this.pendingLoginQuestSyncTimer = null;
    }
    combatHandlerHandleSharedCombatParticipantDisposed(this);
    handleTeamSessionDisposed(this);
    removeWorldPresence(this, 'session-dispose');
    combatHandlerDisposeTimers(this);
    petHandlerDisposeTimers(this);
    stopAutoMapRotation(this);
    if (this.equipmentReplayTimer) {
      clearTimeout(this.equipmentReplayTimer);
      this.equipmentReplayTimer = null;
    }
    this.observedPlayerPositions.clear();
    this.observedPetStates.clear();
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
    const participants = getTeamCombatParticipants(this);
    const hadActiveCombat = this.combatState?.active === true;
    if (participants.length <= 1) {
      combatHandlerSendCombatEncounterProbe(this, action);
      if (!hadActiveCombat && this.combatState?.active) {
        beginSharedTeamCombat(this, [this]);
      }
      return;
    }

    const enemies = buildEncounterEnemies(action, this.currentMapId) as CombatEnemyInstance[];
    if (!Array.isArray(enemies) || enemies.length === 0) {
      combatHandlerSendCombatEncounterProbe(this, action);
      return;
    }

    this.log(
      `Mirroring team combat trigger=${String((action as Record<string, unknown>)?.probeId || 'unknown')} participants=${participants.map((member) => `${member.charName || member.id}@${member.id}`).join(',')}`
    );
    for (const participant of participants) {
      combatHandlerSendCombatEncounterProbe(participant, action, {
        enemies,
        allies: participants.filter((member) => (member.id >>> 0) !== (participant.id >>> 0)),
      });
    }
    if (!hadActiveCombat && this.combatState?.active) {
      beginSharedTeamCombat(this, participants);
    }
  }

  sendCombatExitProbe(action: Record<string, unknown>): void {
    combatHandlerSendCombatExitProbe(this, action);
  }
}

export {
  Session,
};
