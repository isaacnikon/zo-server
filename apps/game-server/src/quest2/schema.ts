export type QuestTriggerType =
  | 'npc_interact'
  | 'monster_defeat'
  | 'item_changed'
  | 'combat_won';

export type QuestStepKind =
  | 'talk'
  | 'kill'
  | 'collect'
  | 'turn_in'
  | 'trigger_combat'
  | 'escort';

export interface ItemStackDef {
  templateId: number;
  quantity: number;
  name?: string;
}

export interface TriggerDef {
  type: QuestTriggerType;
}

export type RequirementDef =
  | { kind: 'level_at_least'; level: number }
  | { kind: 'quest_completed'; questId: number }
  | { kind: 'quest_active'; questId: number }
  | { kind: 'map_is'; mapId: number }
  | { kind: 'npc_is'; npcId: number }
  | { kind: 'turn_in_map_is'; mapId: number }
  | { kind: 'turn_in_npc_is'; npcId: number }
  | { kind: 'monster_is'; monsterId: number }
  | { kind: 'item_is'; templateId: number }
  | { kind: 'item_count_at_least'; templateId: number; quantity: number }
  | { kind: 'captured_monster_count_at_least'; monsterId: number; quantity: number }
  | { kind: 'flag_is'; flag: string; value: boolean }
  | { kind: 'counter_at_least'; counter: string; value: number }
  | { kind: 'script_is'; scriptId: number }
  | { kind: 'subtype_is'; subtype: number }
  | { kind: 'context_is'; contextId: number };

export type QuestEffectDef =
  | { kind: 'set_flag'; flag: string; value?: boolean }
  | { kind: 'clear_flag'; flag: string }
  | { kind: 'increment_counter'; counter: string; amount?: number }
  | { kind: 'reset_counter'; counter: string }
  | { kind: 'select_reward_choice'; rewardChoiceId: number }
  | { kind: 'grant_item'; item: ItemStackDef; idempotent?: boolean }
  | { kind: 'remove_item'; item: ItemStackDef }
  | { kind: 'remove_captured_monster_item'; monsterId: number; quantity: number; templateId?: number; name?: string }
  | { kind: 'update_stat'; stat: 'gold' | 'coins' | 'renown' | 'experience'; delta: number }
  | { kind: 'grant_pet'; petTemplateId: number }
  | { kind: 'start_combat'; monsterId: number; count?: number }
  | { kind: 'show_dialogue'; title: string; message: string };

export interface QuestProgressDef {
  counter: string;
  target: number;
  eventValue?: 'count' | 'delta' | 'one' | 'quantity';
}

export interface ClientQuestHints {
  familyTaskId?: number;
}

export interface ClientStepHints {
  markerNpcId?: number;
  overNpcId?: number;
  taskRoleNpcId?: number;
  taskType?: number;
  maxAward?: number;
  taskStep?: number;
  status?: number;
  trackerScriptIds?: number[];
}

export interface StepReactionDef {
  id: string;
  trigger: TriggerDef;
  requirements: RequirementDef[];
  effects: QuestEffectDef[];
}

export interface AcceptRuleDef {
  trigger: TriggerDef;
  requirements: RequirementDef[];
  effects: QuestEffectDef[];
}

export interface RewardChoiceDef {
  id: number;
  label?: string;
  gold: number;
  experience: number;
  coins: number;
  renown: number;
  pets: number[];
  items: ItemStackDef[];
}

export interface RewardDef {
  gold: number;
  experience: number;
  coins: number;
  renown: number;
  petByAptitudeBaseTemplateId?: number;
  pets: number[];
  items: ItemStackDef[];
  choiceGroups: RewardChoiceDef[];
}

export interface ResolvedRewardDef {
  gold: number;
  experience: number;
  coins: number;
  renown: number;
  pets: number[];
  items: ItemStackDef[];
  selectedChoiceId?: number;
}

export interface StepDef {
  id: string;
  kind: QuestStepKind;
  description?: string;
  trigger: TriggerDef;
  requirements: RequirementDef[];
  eventEffects?: QuestEffectDef[];
  effects: QuestEffectDef[];
  reactions?: StepReactionDef[];
  progress?: QuestProgressDef;
  nextStepId: string | null;
  client?: ClientStepHints;
}

export interface QuestDef {
  id: number;
  name: string;
  repeatable: boolean;
  accept: AcceptRuleDef;
  steps: StepDef[];
  rewards: RewardDef;
  client?: ClientQuestHints;
}
