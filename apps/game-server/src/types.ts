import type { QuestState as QuestStateV2 } from './quest2/index.js';

// --- Packet field types (used by declarative schemas) ---
export interface PositionUpdate { x: number; y: number; mapId: number }
export interface ServerRunRequestData {
  subcmd: number;
  rawArgs: number[];
  npcId?: number;
  scriptId?: number;
  awardId?: number;
}
export interface TeamClientAction03FD {
  subcmd: number;
}
export interface TeamClientAction03FE {
  subcmd: number;
  targetIds: number[];
}
export interface TeamClientAction0442 {
  subcmd: number;
  targetIds: number[];
}

export interface FrogTeleporterUnlocks {
  cloudCityToRainbowValley: boolean;
  cloudCityToGoalManor: boolean;
  cloudCityToTimberTown: boolean;
  cloudCityToChillPass: boolean;
  cloudCityToArielManor: boolean;
  cloudCityToCelestialState: boolean;
  rainbowValleyToCloudCity: boolean;
  goalManorToCloudCity: boolean;
}
export interface FieldEventSpawn {
  eventId: string;
  runtimeId: number;
  sceneIndex: number;
  npcId: number;
  entityType: number;
  monsterId: number;
  name: string;
  mapId: number;
  x: number;
  y: number;
}
export interface CreateRoleData { templateIndex: number; roleName: string; birthMonth: number; birthDay: number; selectedAptitude: number; extra1: number; extra2: number }
export interface QuestPacketData { subcmd: number; taskId: number }
export interface EquipmentStateData { instanceId: number; equipFlag: number; unequipFlag: number }
export interface AttributeAllocationData { strengthDelta: number; dexterityDelta: number; vitalityDelta: number; intelligenceDelta: number }
export interface ItemContainerActionData {
  containerType: number;
  subcmd: number;
  instanceId?: number;
  slotIndex?: number;
  column?: number;
  row?: number;
  quantity?: number;
}
export interface ItemStackSplitRequestData {
  subcmd: number;
  mode: number;
  instanceId: number;
  quantity: number;
}
export interface ItemStackCombineRequestData {
  subcmd: number;
  sourceInstanceId: number;
  targetInstanceId: number;
}
export interface ItemContainerMoveRequestData {
  subcmd: number;
  instanceId: number;
  fromContainerType: number;
  toContainerType: number;
}
export interface WarehousePasswordRequestData {
  subcmd: number;
  mode: number;
  password: string;
}
export interface RenownTaskDailyState {
  dayKey: string;
  takenToday: number;
  finishedToday: number;
  firstTwentyStreakToday: number;
  postTwentyOnlineClaimedMsToday: number;
}
export interface OnlineActivityState {
  dayKey: string;
  accumulatedTodayMs: number;
  accumulatedTotalMs: number;
}
export interface AttackSelectionData { attackMode: number; targetA: number; targetB: number }
export type QuestSyncMode = 'login' | 'runtime' | 'quest';
export interface LearnedSkillRecord {
  skillId: number;
  name: string;
  level?: number;
  proficiency?: number;
  sourceTemplateId?: number;
  learnedAt: number;
  requiredLevel?: number;
  requiredAttribute?: 'strength' | 'dexterity' | 'vitality' | 'intelligence' | null;
  requiredAttributeValue?: number;
  hotbarSlot?: number | null;
}
export interface SkillState {
  learnedSkills: LearnedSkillRecord[];
  hotbarSkillIds: number[];
  lastCombatAction?: 'attack' | 'skill';
  lastCombatSkillId?: number | null;
}

// --- Game effects (shared across quest/inventory) ---
export type GameEffect =
  | {
      kind: 'grant-item';
      templateId: number;
      quantity: number;
      dialoguePrefix?: string;
      itemName?: string;
      idempotent?: boolean;
      successMessage?: string;
      failureMessage?: string;
    }
  | {
      kind: 'remove-item';
      templateId: number;
      quantity: number;
      dialoguePrefix?: string;
      itemName?: string;
      successMessage?: string;
      failureMessage?: string;
    }
  | {
      kind: 'item-missing';
      templateId: number;
      quantity: number;
      dialoguePrefix?: string;
      itemName?: string;
      failureMessage?: string;
    }
  | { kind: 'update-stat'; stat: 'gold' | 'coins' | 'renown' | 'experience'; delta: number }
  | { kind: 'dialogue'; title: string; message: string }
  | { kind: 'send-script'; scriptId: number; mode: 'immediate' | 'deferred' };

// --- SessionPorts interface (what gameplay services / layer-2 code receive) ---
export interface SessionPorts {
  // Core identity
  id: number;
  state: string;
  isGame: boolean;
  remoteAddress: string | null;
  accountName: string | null;
  accountKey: string | null;
  sharedState: Record<string, any>;
  charName: string;
  runtimeId: number;
  teamId?: number | null;
  teamSize?: number;
  teamMembers?: number[];
  entityType: number;
  roleEntityType: number;
  roleData: number;
  selectedAptitude: number;
  // Character stats
  level: number;
  experience: number;
  statusPoints: number;
  primaryAttributes: PrimaryAttributes;
  bonusAttributes: PrimaryAttributes;
  // Vitals
  currentHealth: number;
  currentMana: number;
  currentRage: number;
  maxHealth: number;
  maxMana: number;
  maxRage: number;
  derivedMaxHealth?: number;
  derivedMaxMana?: number;
  derivedMaxRage?: number;
  clientObservedMaxHealth?: number | null;
  clientObservedMaxMana?: number | null;
  // Currency
  gold: number;
  bankGold: number;
  boundGold: number;
  coins: number;
  renown: number;
  onlineState: OnlineActivityState;
  onlineCreditCursorAt: number | null;
  onlineLastPersistAt: number | null;
  lastHeartbeatAt: number | null;
  // Position
  currentMapId: number;
  currentX: number;
  currentY: number;
  // Skills
  skillState: SkillState;
  // Inventory
  bagItems: any[];
  bagSize: number;
  warehouseItems: any[];
  warehouseSize: number;
  nextItemInstanceId: number;
  nextBagSlot: number;
  nextWarehouseSlot: number;
  warehousePassword: string;
  warehouseUnlocked: boolean;
  pendingBagSplitMove?: {
    instanceId: number;
    fromSlot: number;
    toSlot: number;
    createdAt: number;
  } | null;
  // Quests
  questStateV2: QuestStateV2;
  hasAnnouncedQuestOverview: boolean;
  renownTaskDailyState: RenownTaskDailyState;
  // Pets
  pets: any[];
  selectedPetRuntimeId: number | null;
  petSummoned: boolean;
  petReplayTimer: NodeJS.Timeout | null;
  // Combat
  combatState: CombatState;
  combatDefeatTimer: NodeJS.Timeout | null;
  combatSkillResolutionTimer: NodeJS.Timeout | null;
  defeatRespawnPending: boolean;
  fieldCombatCooldownUntil: number | null;
  lastFieldCombatProbeKey: string | null;
  attackMin?: number;
  attackMax?: number;
  characterAttackMin?: number;
  characterAttackMax?: number;
  // Map rotation
  mapRotationTimer: NodeJS.Timeout | null;
  mapRotationTargets: Array<{ mapId: number; mapName: string; x: number; y: number }>;
  mapRotationIndex: number;
  mapRotationAwaitingMapId: number | null;
  mapRotationLastSentAt: number | null;
  // Gathering
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
  // Scene/NPC state
  pendingSceneNpcSpawnMapId: number | null;
  pendingLoginQuestSyncMapId: number | null;
  pendingLoginQuestSyncTimer: NodeJS.Timeout | null;
  activeNpcShop: any;
  activeNpcService: any;
  frogTeleporterUnlocks: FrogTeleporterUnlocks;
  // Equipment
  equipmentReplayTimer: NodeJS.Timeout | null;
  // Persisted data
  persistedCharacter: CharacterRecord | null;
  persistenceBlockedCharacterId: string | null;
  socket: { destroyed?: boolean; destroy(): void; write(data: Buffer): void };
  worldRegistered: boolean;
  visiblePlayerRuntimeIds: Set<number>;
  observedPlayerPositions: Map<number, { x: number; y: number }>;
  observedPetStates: Map<number, { ownerRuntimeId: number; x: number; y: number; entityType: number }>;
  // Core I/O methods
  writePacket(payload: Buffer, flags?: number, message?: string): void;
  log(message: string): void;
  sendPong(token: number): void;
  sendGameDialogue(speaker: string, message: string, subtype?: number, flags?: number, extraText?: string | null): void;
  // Script helpers
  sendServerRunScriptImmediate(scriptId: number): void;
  sendServerRunScriptDeferred(scriptId: number): void;
  // Sync helpers
  sendPetStateSync(reason?: string): void;
  syncQuestStateToClient(options?: { mode?: QuestSyncMode }): void;
  refreshQuestStateForItemTemplates(templateIds: number[]): Promise<void>;
  // Stat/UI sync
  sendSelfStateAptitudeSync(): void;
}

// --- Session interface (what handlers receive) ---
export interface GameSession extends SessionPorts {
  // Persistence methods
  persistCurrentCharacter(overrides?: Record<string, unknown>): Promise<void>;
  getPersistedCharacter(): Record<string, unknown> | null;
  loadPersistedCharacter(options?: { forceReload?: boolean }): Promise<Record<string, unknown> | null>;
  saveCharacter(character: Record<string, unknown>): Promise<void>;
  buildCharacterSnapshot(overrides?: Record<string, unknown>): Record<string, unknown>;
  // Scene/map orchestration methods
  sendMapNpcSpawns(mapId: number): void;
  sendSceneEnter(mapId: number, x: number, y: number, subtype?: number): void;
  sendEnterGameOk(options?: { syncMode?: QuestSyncMode }): void;
  // Combat orchestration methods
  sendCombatEncounterProbe(action: Record<string, unknown>): void;
  sendCombatExitProbe(action: Record<string, unknown>): void;
  // Stat/UI orchestration methods
  sendSelfStateAptitudeSync(): void;
  // Equipment/Pet orchestration methods
  scheduleEquipmentReplay(delayMs?: number): void;
  // Quest handler methods
  ensureQuestStateReady(): void;
  handleQuestMonsterDefeat(monsterId: number, count?: number): Promise<{ handled: boolean; grantedItems: Array<{ templateId: number; quantity: number }> }>;
}

// --- Packet handler type (async for I/O) ---
export type PacketHandler = (session: GameSession, payload: Buffer) => Promise<void> | void;

// --- Supporting types ---
export interface PrimaryAttributes { intelligence: number; vitality: number; dexterity: number; strength: number }
export interface PlayerVitals { health: number; mana: number; rage: number }
export interface CharacterRecord { [key: string]: unknown }
export interface DropEntry { templateId: number; chance: number; quantity?: number; source?: string }
export interface CombatEnemyTemplate {
  typeId: number;
  logicalId?: number;
  levelMin?: number;
  levelMax?: number;
  hpBase?: number;
  hpPerLevel?: number;
  aptitude?: number;
  weight?: number;
  appearanceTypes?: number[];
  appearanceVariants?: number[];
  drops?: DropEntry[];
  name?: string;
}
export interface CombatEncounterProfile {
  source?: string;
  minEnemies?: number;
  maxEnemies?: number;
  encounterChancePercent?: number;
  cooldownMs?: number;
  locationName?: string;
  fixedEnemies?: Array<CombatEnemyTemplate & { row: number; col: number }>;
  pool: CombatEnemyTemplate[];
}
export type CombatPhase = 'idle' | 'intro' | 'command' | 'enemy-turn' | 'resolved';
export interface CombatEnemyInstance {
  side: number;
  entityId: number;
  logicalId: number;
  typeId: number;
  row: number;
  col: number;
  hp: number;
  maxHp: number;
  level: number;
  aptitude: number;
  attackPriority?: number;
  appearanceTypes: number[];
  appearanceVariants: number[];
  drops?: DropEntry[];
  name: string;
}
export interface CombatPlayerStatus {
  defendPending?: boolean;
  protectTargetEntityId?: number;
  defiantRoundsRemaining?: number;
  defiantDefenseBonusPercent?: number;
  defiantAttackPenaltyPercent?: number;
  lionsRoarRoundsRemaining?: number;
  lionsRoarAttackBonusPercent?: number;
  lionsRoarDefenseBonusPercent?: number;
  divineBlessRoundsRemaining?: number;
  divineBlessMagicAttackBonusPercent?: number;
  divineBlessMagicDefenseBonusPercent?: number;
  hasteRoundsRemaining?: number;
  puzzleRoundsRemaining?: number;
  puzzleManaCostReductionPercent?: number;
  concealRoundsRemaining?: number;
  regenerateRoundsRemaining?: number;
  regenerateHealAmount?: number;
}
export interface CombatEnemyStatus {
  enervateRoundsRemaining?: number;
  enervateAttackPenaltyPercent?: number;
  actionDisabledRoundsRemaining?: number;
  actionDisabledReason?: 'confuse' | 'freeze' | 'seal' | 'sleep' | 'slow' | 'stun';
  bleedRoundsRemaining?: number;
  bleedDamagePerRound?: number;
}
export interface PendingSkillOutcome {
  skillId: number;
  targetEntityId: number;
  playerDamage?: number;
  healAmount?: number;
  targetDied?: boolean;
}
export interface PendingSkillContext {
  skillId: number;
  implementationClass?: number | null;
  followUpMode?: 'none' | 'delayed_cast';
  allowEnemyCounterattack?: boolean;
  deferSharedTeamPostResolution?: boolean;
}
export interface PendingCounterattack {
  enemyEntityId: number;
  reason: 'normal' | 'post-kill';
  played: boolean;
}
export interface PendingActionResolution {
  reason: 'normal' | 'post-kill' | 'victory';
}
export interface CombatState {
  active: boolean;
  phase: CombatPhase;
  round: number;
  triggerId: string | null;
  encounterAction: Record<string, unknown> | null;
  enemies: CombatEnemyInstance[];
  pendingEnemyTurnQueue: number[];
  pendingPostKillCounterattack: boolean;
  enemyTurnReason?: 'normal' | 'post-kill' | null;
  awaitingClientReady: boolean;
  awaitingPlayerAction: boolean;
  startedAt: number;
  playerStartHealth: number;
  playerMaxHealthAtStart: number;
  totalEnemyMaxHp: number;
  averageEnemyLevel: number;
  damageDealt: number;
  damageTaken: number;
  awaitingSkillResolution?: boolean;
  skillResolutionStartedAt?: number;
  skillResolutionReason?: string | null;
  skillResolutionPhase?: 'await-cast-ready' | 'await-impact-ready' | null;
  pendingSkillOutcomes?: PendingSkillOutcome[] | null;
  pendingSkillContext?: PendingSkillContext | null;
  pendingCounterattack?: PendingCounterattack | null;
  pendingActionResolution?: PendingActionResolution | null;
  sharedActionSequenceToken?: number | null;
  sharedRoundEntries?: Array<Record<string, any>> | null;
  sharedRoundIndex?: number | null;
  sharedAwaitingActionReady?: boolean;
  sharedAwaitingReadySessionId?: number | null;
  commandReadyFallbackToken?: number | null;
  commandReadyFallbackRound?: number | null;
  selectorToken?: number | null;
  selectorTokenSource?: 'server' | 'client' | null;
  selectedSkillTargetEntityId?: number | null;
  playerStatus: CombatPlayerStatus;
  enemyStatuses: Record<number, CombatEnemyStatus>;
}
