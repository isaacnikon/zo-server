'use strict';

// --- Packet field types (used by declarative schemas) ---
export interface PositionUpdate { x: number; y: number; mapId: number }
export interface CreateRoleData { templateIndex: number; roleName: string; birthMonth: number; birthDay: number; selectedAptitude: number; extra1: number; extra2: number }
export interface QuestPacketData { subcmd: number; taskId: number }
export interface EquipmentStateData { instanceId: number; equipFlag: number; unequipFlag: number }
export interface AttributeAllocationData { strengthDelta: number; dexterityDelta: number; vitalityDelta: number; intelligenceDelta: number }
export interface AttackSelectionData { attackMode: number; targetA: number; targetB: number }
export type QuestSyncMode = 'login' | 'scene-transition' | 'runtime';
export interface ServerRunEvent {
  subtype?: number;
  npcId?: number;
  mapId?: number;
  scriptId?: number;
  contextId?: number;
  extra?: number;
  inventory?: Record<string, any>[];
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
  markerNpcId: number;
  stepDescription?: string;
  progressObjectiveId?: number;
}
export interface QuestProgressEvent extends QuestEventBase {
  type: 'progress';
  status: number;
  markerNpcId: number;
  stepDescription?: string;
  progressObjectiveId?: number;
}
export interface QuestAdvancedEvent extends QuestEventBase {
  type: 'advanced';
  status: number;
  markerNpcId: number;
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
export interface QuestCombatTriggerEvent extends QuestEventBase {
  type: 'quest-combat-trigger';
  monsterId: number;
  count: number;
  npcId: number;
  mapId: number;
}
export type QuestEvent =
  | QuestAcceptedEvent
  | QuestProgressEvent
  | QuestAdvancedEvent
  | QuestCompletedEvent
  | QuestAbandonedEvent
  | QuestItemGrantedEvent
  | QuestItemConsumedEvent
  | QuestItemMissingEvent
  | QuestCombatTriggerEvent;

// --- Game effects (shared across quest/combat/inventory/NPC) ---
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
  | { kind: 'change-scene'; mapId: number; x: number; y: number }
  | { kind: 'dialogue'; title: string; message: string }
  | { kind: 'send-script'; scriptId: number; mode: 'immediate' | 'deferred' };

// --- Combat states (replaces string phase checks) ---
export enum CombatPhase {
  Idle = 'idle',
  AwaitingHandshake = 'awaiting-handshake',
  Command = 'command',
  EnemyTurn = 'enemy-turn',
  Finished = 'finished',
}

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
  syntheticFight: SyntheticFightState | null;
  combatState: CombatState;
  defeatRespawnPending: boolean;
  persistedCharacter: CharacterRecord | null;

  // I/O methods
  writePacket(payload: Buffer, flags?: number, message?: string): void;
  log(message: string): void;
  persistCurrentCharacter(overrides?: Record<string, unknown>): void;
  dispatchObjectiveServerRun?(event: ServerRunEvent, source?: string, options?: Record<string, unknown>): boolean;
  dispatchObjectiveMonsterDefeat?(monsterId: number, count?: number, source?: string, options?: Record<string, unknown>): boolean;
  dispatchObjectiveSceneTransition?(mapId: number, source?: string, options?: Record<string, unknown>): boolean;
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
export interface SyntheticFightState { phase: string; enemies: SyntheticEnemy[]; turnQueue: unknown[]; [key: string]: unknown }
export interface SyntheticEnemy { side: number; entityId: number; typeId: number; row: number; col: number; hp: number; name: string; drops: DropEntry[] }
export interface DropEntry { templateId: number; chance: number; quantity?: number; source?: string }
export interface CombatState { [key: string]: unknown }
