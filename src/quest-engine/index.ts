export type {
  GrantedItem,
  RewardChoiceGroup,
  QuestStep,
  QuestRewards,
  QuestDefinitionRecord,
  QuestRecord,
  QuestState,
  ClientQuestMetadata,
  ClientHelpQuestMetadata,
} from './data.js';

export {
  QUEST_DEFINITIONS,
  getCurrentStep,
  getQuestDefinition,
  getQuestProgressObjectiveId,
  getQuestMarkerNpcId,
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
