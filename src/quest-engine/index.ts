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
  getQuestDefinition,
  getQuestProgressObjectiveId,
  getQuestMarkerNpcId,
} from './data.js';

export {
  buildQuestSyncState,
  normalizeQuestState,
  reconcileAutoAccept,
  interactWithNpc,
  applyMonsterDefeat,
  abandonQuest,
} from './state.js';
