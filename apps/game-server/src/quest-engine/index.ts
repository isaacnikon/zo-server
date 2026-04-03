export type {
  GrantedItem,
  RewardChoiceGroup,
  QuestStep,
  QuestInteractionTriggerRecord,
  QuestStepUiRecord,
  QuestActionRecord,
  QuestActionKind,
  QuestObjectiveRecord,
  QuestObjectiveKind,
  QuestTrackerRecord,
  QuestRewards,
  QuestDefinitionRecord,
  QuestRecord,
  QuestState,
} from './data.js';

export {
  QUEST_DEFINITIONS,
  getCurrentStep,
  getCurrentObjective,
  getCurrentStepUi,
  getQuestDefinition,
  getQuestProgressObjectiveId,
  getQuestMarkerNpcId,
  getClientTasklistEntry,
  isClientTasklistFamilyTask,
} from './data.js';

export {
  buildQuestSyncState,
  normalizeQuestState,
  reconcileAutoAccept,
  interactWithNpc,
  getQuestAcceptBlocker,
  applyMonsterDefeat,
  abandonQuest,
} from './state.js';
