import type { QuestEvent, ServerRunEvent } from '../types';
import type { ObjectiveSystem } from './objective-system';

const {
  applyMonsterDefeat,
  applySceneTransition,
  applyServerRunEvent,
  reconcileAutoAccept,
  resolveQuestServerRunAuxiliaryActions,
} = require('../quest-engine');

type QuestState = Record<string, any>;

const questObjectiveSystem: ObjectiveSystem<QuestState, QuestEvent> = {
  name: 'quest',
  onServerRun: (state: QuestState, event: ServerRunEvent) => {
    const auxiliaryEvents = resolveQuestServerRunAuxiliaryActions(state, event);
    const immediateAuxiliaryEvents: QuestEvent[] = [];
    let deferredQuestCombatTrigger: QuestEvent | null = null;

    for (const auxiliaryEvent of auxiliaryEvents) {
      if (auxiliaryEvent.type === 'quest-combat-trigger') {
        deferredQuestCombatTrigger = auxiliaryEvent;
        continue;
      }
      immediateAuxiliaryEvents.push(auxiliaryEvent);
    }

    const questEvents = applyServerRunEvent(state, event);
    if (questEvents.length > 0) {
      return immediateAuxiliaryEvents.concat(questEvents);
    }
    if (deferredQuestCombatTrigger) {
      return immediateAuxiliaryEvents.concat([deferredQuestCombatTrigger]);
    }
    return immediateAuxiliaryEvents;
  },
  onMonsterDefeat: (state: QuestState, monsterId: number, count: number) => applyMonsterDefeat(state, monsterId, count),
  onSceneTransition: (state: QuestState, mapId: number) => applySceneTransition(state, mapId),
  reconcile: (state: QuestState) => reconcileAutoAccept(state),
};

export {
  questObjectiveSystem,
};
