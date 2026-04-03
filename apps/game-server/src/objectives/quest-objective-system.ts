import type { QuestEvent } from '../types.js';
import type { ObjectiveSystem } from './objective-system.js';

import { applyMonsterDefeat, reconcileAutoAccept, } from '../quest-engine/index.js';

type QuestState = Record<string, any>;

const questObjectiveSystem: ObjectiveSystem<QuestState, QuestEvent> = {
  name: 'quest',
  onMonsterDefeat: (state: QuestState, monsterId: number, count: number) => applyMonsterDefeat(state as any, monsterId, count),
  reconcile: (state: QuestState) => reconcileAutoAccept(state as any),
};

export {
  questObjectiveSystem,
};
