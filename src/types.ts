// --- Packet field types (used by declarative schemas) ---
export interface PositionUpdate { x: number; y: number; mapId: number }
export interface ServerRunRequestData {
  subcmd: number;
  rawArgs: number[];
  npcId?: number;
  scriptId?: number;
  awardId?: number;
}
export interface CreateRoleData { templateIndex: number; roleName: string; birthMonth: number; birthDay: number; selectedAptitude: number; extra1: number; extra2: number }
export interface QuestPacketData { subcmd: number; taskId: number }
export interface EquipmentStateData { instanceId: number; equipFlag: number; unequipFlag: number }
export interface AttributeAllocationData { strengthDelta: number; dexterityDelta: number; vitalityDelta: number; intelligenceDelta: number }
export interface AttackSelectionData { attackMode: number; targetA: number; targetB: number }
export type QuestSyncMode = 'login' | 'runtime';
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
}

// --- Quest events (discriminated union — replaces if/else type dispatch) ---
export interface QuestEventBase {
  taskId: number;
  definition: QuestDefinition;
  reason?: string;
}
export interface QuestAcceptedEvent extends QuestEventBase {
  type: 'accepted';
  status: number;
  stepDescription?: string;
  progressObjectiveId?: number;
  progressCount?: number;
  markerNpcId?: number;
}
export interface QuestProgressEvent extends QuestEventBase {
  type: 'progress';
  status: number;
  stepDescription?: string;
  progressObjectiveId?: number;
  progressCount?: number;
  markerNpcId?: number;
}
export interface QuestAdvancedEvent extends QuestEventBase {
  type: 'advanced';
  status: number;
  stepDescription?: string;
  progressObjectiveId?: number;
  progressCount?: number;
  markerNpcId?: number;
}
export interface QuestCompletedEvent extends QuestEventBase {
  type: 'completed';
  reward: QuestReward;
}
export interface QuestAbandonedEvent extends QuestEventBase {
  type: 'abandoned';
  resetItemTemplateIds: number[];
}
export interface QuestItemGrantedEvent extends QuestEventBase {
  type: 'item-granted';
  templateId: number;
  quantity: number;
  itemName?: string;
}
export interface QuestItemConsumedEvent extends QuestEventBase {
  type: 'item-consumed';
  templateId: number;
  quantity: number;
  itemName?: string;
}
export interface QuestItemMissingEvent extends QuestEventBase {
  type: 'item-missing';
  templateId: number;
  quantity: number;
  itemName?: string;
}
export type QuestEvent =
  | QuestAcceptedEvent
  | QuestProgressEvent
  | QuestAdvancedEvent
  | QuestCompletedEvent
  | QuestAbandonedEvent
  | QuestItemGrantedEvent
  | QuestItemConsumedEvent
  | QuestItemMissingEvent;

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

// --- Session interface (what handlers receive) ---
export interface GameSession {
  // Core identity
  id: number;
  state: string;
  isGame: boolean;
  accountName: string | null;
  sharedState: Record<string, any>;
  charName: string;
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
  // Currency
  gold: number;
  bankGold: number;
  boundGold: number;
  coins: number;
  renown: number;
  // Position
  currentMapId: number;
  currentX: number;
  currentY: number;
  // Skills
  skillState: SkillState;
  // Inventory
  bagItems: any[];
  bagSize: number;
  nextItemInstanceId: number;
  nextBagSlot: number;
  // Quests
  activeQuests: QuestRecord[];
  completedQuests: number[];
  hasAnnouncedQuestOverview: boolean;
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
  gatheringNodes: Map<number, { nodeId: number; templateId: number; x: number; y: number; toolType: number; dropItemId: number }> | null;
  activeGather: { runtimeId: number; startedAt: number } | null;
  // Scene/NPC state
  pendingSceneNpcSpawnMapId: number | null;
  activeNpcShop: any;
  // Equipment
  equipmentReplayTimer: NodeJS.Timeout | null;
  // Persisted data
  persistedCharacter: CharacterRecord | null;
  objectiveRegistry: any;
  socket: { destroyed?: boolean; destroy(): void; write(data: Buffer): void };
  // I/O methods
  writePacket(payload: Buffer, flags?: number, message?: string): void;
  log(message: string): void;
  sendPong(token: number): void;
  // Persistence methods
  persistCurrentCharacter(overrides?: Record<string, unknown>): void;
  getPersistedCharacter(): Record<string, unknown> | null;
  saveCharacter(character: Record<string, unknown>): void;
  buildCharacterSnapshot(overrides?: Record<string, unknown>): Record<string, unknown>;
  // Scene/map methods
  sendMapNpcSpawns(mapId: number): void;
  sendSceneEnter(mapId: number, x: number, y: number, subtype?: number): void;
  sendEnterGameOk(options?: { syncMode?: QuestSyncMode }): void;
  // Combat methods
  sendCombatEncounterProbe(action: Record<string, unknown>): void;
  sendCombatExitProbe(action: Record<string, unknown>): void;
  // Stat/UI sync methods
  sendSelfStateAptitudeSync(): void;
  sendGameDialogue(speaker: string, message: string, subtype?: number, flags?: number, extraText?: string | null): void;
  sendServerRunScriptImmediate(scriptId: number): void;
  sendServerRunScriptDeferred(scriptId: number): void;
  // Equipment/Pet sync methods
  scheduleEquipmentReplay(delayMs?: number): void;
  sendPetStateSync(reason?: string): void;
  // Quest methods
  ensureQuestStateReady(): void;
  syncQuestStateToClient(options?: { mode?: QuestSyncMode }): void;
  refreshQuestStateForItemTemplates(templateIds: number[]): void;
  handleQuestMonsterDefeat(monsterId: number, count?: number): void;
  applyQuestEvents(events: any[], source?: string, options?: Record<string, unknown>): void;
  // Objective methods
  dispatchObjectiveMonsterDefeat(monsterId: number, count?: number, source?: string, options?: Record<string, unknown>): boolean;
  reconcileObjectives(source?: string, options?: Record<string, unknown>): boolean;
}

// --- Packet handler type (async for I/O) ---
export type PacketHandler = (session: GameSession, payload: Buffer) => Promise<void> | void;

// --- Supporting types ---
export interface PrimaryAttributes { intelligence: number; vitality: number; dexterity: number; strength: number }
export interface PlayerVitals { health: number; mana: number; rage: number }
export interface CharacterRecord { [key: string]: unknown }
export interface QuestRecord { id: number; stepIndex: number; status: number; progress: Record<string, unknown>; acceptedAt: number }
export interface QuestDefinition { id: number; name: string; acceptMessage: string; completionMessage: string; [key: string]: unknown }
export interface QuestReward { [key: string]: unknown }
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
  appearanceTypes: number[];
  appearanceVariants: number[];
  drops?: DropEntry[];
  name: string;
}
export interface CombatPlayerStatus {
  defiantRoundsRemaining?: number;
  defiantDefenseBonusPercent?: number;
  defiantAttackPenaltyPercent?: number;
}
export interface CombatEnemyStatus {
  enervateRoundsRemaining?: number;
  enervateAttackPenaltyPercent?: number;
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
}
export interface PendingCounterattack {
  enemyEntityId: number;
  reason: 'normal' | 'post-kill';
  played: boolean;
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
  playerStatus: CombatPlayerStatus;
  enemyStatuses: Record<number, CombatEnemyStatus>;
}
