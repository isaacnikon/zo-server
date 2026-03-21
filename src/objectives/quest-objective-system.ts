import type { QuestEvent } from '../types';
import type { ObjectiveSystem } from './objective-system';

const {
  applyMonsterDefeat,
  reconcileAutoAccept,
} = require('../quest-engine');

type QuestState = Record<string, any>;

const questObjectiveSystem: ObjectiveSystem<QuestState, QuestEvent> = {
  name: 'quest',
  onMonsterDefeat: (state: QuestState, monsterId: number, count: number) => applyMonsterDefeat(state, monsterId, count),
  reconcile: (state: QuestState) => reconcileAutoAccept(state),
};

export {
  questObjectiveSystem,
};
