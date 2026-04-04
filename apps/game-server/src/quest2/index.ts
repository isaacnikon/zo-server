export type {
  AcceptRuleDef,
  ClientQuestHints,
  ClientStepHints,
  ItemStackDef,
  QuestDef,
  QuestEffectDef,
  QuestProgressDef,
  QuestStepKind,
  QuestTriggerType,
  RequirementDef,
  ResolvedRewardDef,
  RewardChoiceDef,
  RewardDef,
  StepDef,
  TriggerDef,
} from './schema.js';

export type {
  QuestAbandonEvent,
  QuestCombatWonEvent,
  QuestEvent,
  QuestItemChangedEvent,
  QuestMonsterDefeatEvent,
  QuestNpcInteractEvent,
  QuestReducerContext,
} from './events.js';

export type {
  QuestInstance,
  QuestState,
} from './state.js';

export type {
  QuestReducerResult,
  QuestTransition,
} from './reducer.js';

export type {
  QuestService,
} from './service.js';

export {
  QUEST2_DEFINITIONS_FILE,
  initializeQuestDefinitions,
  refreshQuestDefinitions,
  loadQuestDefinitions,
  normalizeQuestDefinition,
  getQuestDefinition,
  listQuestDefinitions,
  isQuest2DefinitionId,
} from './definitions.js';

export {
  createEmptyQuestState,
  createQuestInstance,
  cloneQuestInstance,
  cloneQuestState,
  normalizeQuestInstance,
  normalizeQuestState,
  isQuestActive,
  isQuestCompleted,
  getQuestInstance,
} from './state.js';

export {
  reduceQuestEvent,
  resolveReward,
  buildRewardEffects,
} from './reducer.js';

export {
  createQuestService,
  questService,
} from './service.js';

export {
  dispatchQuestEventToSession,
} from './runtime.js';

export type {
  Quest2SyncState,
} from './sync.js';

export {
  buildQuest2SyncState,
  replayQuest2TrackerScripts,
  sendQuest2AcceptWithState,
  sendQuest2Marker,
  sendQuest2UpdateWithState,
  usesQuest2TrackerMarkerPacket,
} from './sync.js';
