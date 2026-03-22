'use strict';

// --- Packet field types (used by declarative schemas) ---
export interface PositionUpdate { x: number; y: number; mapId: number }
export interface ServerRunRequestData {
  subcmd: number;
  rawArgs: number[];
  npcId?: number;
  scriptId?: number;
}
export interface CreateRoleData { templateIndex: number; roleName: string; birthMonth: number; birthDay: number; selectedAptitude: number; extra1: number; extra2: number }
export interface QuestPacketData { subcmd: number; taskId: number }
export interface EquipmentStateData { instanceId: number; equipFlag: number; unequipFlag: number }
export interface AttributeAllocationData { strengthDelta: number; dexterityDelta: number; vitalityDelta: number; intelligenceDelta: number }
export interface AttackSelectionData { attackMode: number; targetA: number; targetB: number }
export type QuestSyncMode = 'login' | 'runtime';

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
}
export interface QuestProgressEvent extends QuestEventBase {
  type: 'progress';
  status: number;
  stepDescription?: string;
  progressObjectiveId?: number;
}
export interface QuestAdvancedEvent extends QuestEventBase {
  type: 'advanced';
  status: number;
  stepDescription?: string;
  progressObjectiveId?: number;
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
  id: number;
  charName: string;
  entityType: number;
  roleEntityType: number;
  roleData: number;
  selectedAptitude: number;
  currentMapId: number;
  currentX: number;
  currentY: number;
  level: number;
  experience: number;
  currentHealth: number;
  currentMana: number;
  currentRage: number;
  statusPoints: number;
  gold: number;
  bankGold: number;
  boundGold: number;
  coins: number;
  renown: number;
  primaryAttributes: PrimaryAttributes;
  bonusAttributes?: PrimaryAttributes;
  activeQuests: QuestRecord[];
  completedQuests: number[];
  defeatRespawnPending: boolean;
  persistedCharacter: CharacterRecord | null;
  mapRotationTimer?: NodeJS.Timeout | null;
  mapRotationTargets?: Array<{ mapId: number; mapName: string; x: number; y: number }>;
  mapRotationIndex?: number;
  mapRotationAwaitingMapId?: number | null;
  mapRotationLastSentAt?: number | null;
  pendingSceneNpcSpawnMapId?: number | null;

  // I/O methods
  writePacket(payload: Buffer, flags?: number, message?: string): void;
  log(message: string): void;
  persistCurrentCharacter(overrides?: Record<string, unknown>): void;
  sendMapNpcSpawns?(mapId: number): void;
  sendSceneEnter?(mapId: number, x: number, y: number, subtype?: number): void;
  dispatchObjectiveMonsterDefeat?(monsterId: number, count?: number, source?: string, options?: Record<string, unknown>): boolean;
  reconcileObjectives?(source?: string, options?: Record<string, unknown>): boolean;
}

// --- Packet handler type (async for I/O) ---
export type PacketHandler = (session: GameSession, payload: Buffer) => Promise<void> | void;

// --- Supporting types ---
export interface PrimaryAttributes { intelligence: number; vitality: number; dexterity: number; strength: number }
export interface PlayerVitals { health: number; mana: number; rage: number }
export interface CharacterRecord { [key: string]: unknown }
export interface QuestRecord { id: number; stepIndex: number; status: number; progress: Record<string, unknown> }
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
}
