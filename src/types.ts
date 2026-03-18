'use strict';

// --- Packet field types (used by declarative schemas) ---
export interface PositionUpdate { x: number; y: number; mapId: number }
export interface CreateRoleData { templateIndex: number; roleName: string; birthMonth: number; birthDay: number; selectedAptitude: number; extra1: number; extra2: number }
export interface QuestPacketData { subcmd: number; taskId: number }
export interface EquipmentStateData { instanceId: number; equipFlag: number; unequipFlag: number }
export interface AttributeAllocationData { strengthDelta: number; dexterityDelta: number; vitalityDelta: number; intelligenceDelta: number }
export interface AttackSelectionData { attackMode: number; targetA: number; targetB: number }

// --- Quest events (discriminated union — replaces if/else type dispatch) ---
export type QuestEvent =
  | { type: 'accepted'; taskId: number; status: number; markerNpcId: number; definition: QuestDefinition; stepDescription?: string }
  | { type: 'progress'; taskId: number; status: number; markerNpcId: number; definition: QuestDefinition; stepDescription?: string }
  | { type: 'advanced'; taskId: number; status: number; markerNpcId: number; definition: QuestDefinition; stepDescription?: string }
  | { type: 'completed'; taskId: number; reward: QuestReward; definition: QuestDefinition }
  | { type: 'abandoned'; taskId: number; definition: QuestDefinition; resetItemTemplateIds: number[] };

// --- Game effects (shared across quest/combat/inventory/NPC) ---
export type GameEffect =
  | { kind: 'grant-item'; templateId: number; quantity: number }
  | { kind: 'remove-item'; templateId: number; quantity: number }
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
