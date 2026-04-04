import { getQuestDefinition, listQuestDefinitions } from './definitions.js';
import type { QuestEvent, QuestReducerContext } from './events.js';
import { reduceQuestEvent, type QuestReducerResult } from './reducer.js';
import {
  createEmptyQuestState,
  normalizeQuestState,
  type QuestState,
} from './state.js';
import type { QuestDef } from './schema.js';
import type { UnknownRecord } from '../utils.js';

export interface QuestService {
  readonly definitions: readonly QuestDef[];
  createEmptyState(): QuestState;
  normalizeState(source: UnknownRecord): QuestState;
  getDefinition(questId: number): QuestDef | null;
  listDefinitions(): readonly QuestDef[];
  dispatch(state: QuestState, event: QuestEvent, context?: QuestReducerContext): QuestReducerResult;
}

function createQuestService(): QuestService {
  return {
    get definitions(): readonly QuestDef[] {
      return listQuestDefinitions();
    },
    createEmptyState: createEmptyQuestState,
    normalizeState: normalizeQuestState,
    getDefinition: getQuestDefinition,
    listDefinitions: listQuestDefinitions,
    dispatch(state: QuestState, event: QuestEvent, context: QuestReducerContext = {}): QuestReducerResult {
      return reduceQuestEvent(listQuestDefinitions(), state, event, context);
    },
  };
}

const questService = createQuestService();

export {
  createQuestService,
  questService,
};
