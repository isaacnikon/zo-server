export interface QuestNpcInteractEvent {
  type: 'npc_interact';
  npcId: number;
  mapId?: number;
  scriptId?: number;
  subtype?: number;
  contextId?: number;
  rewardChoiceId?: number;
}

export interface QuestMonsterDefeatEvent {
  type: 'monster_defeat';
  monsterId: number;
  count: number;
  mapId?: number;
}

export interface QuestItemChangedEvent {
  type: 'item_changed';
  templateId: number;
  delta: number;
  quantity: number;
}

export interface QuestCombatWonEvent {
  type: 'combat_won';
  mapId?: number;
  npcId?: number;
  monsterId?: number;
}

export interface QuestAbandonEvent {
  type: 'quest_abandon';
  questId: number;
}

export type QuestEvent =
  | QuestNpcInteractEvent
  | QuestMonsterDefeatEvent
  | QuestItemChangedEvent
  | QuestCombatWonEvent
  | QuestAbandonEvent;

export interface QuestReducerContext {
  now?: number;
  level?: number;
  mapId?: number;
  selectedAptitude?: number;
  roleEntityType?: number;
  inventoryCounts?: Record<number, number>;
  capturedMonsterCounts?: Record<number, number>;
}
