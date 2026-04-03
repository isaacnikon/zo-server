import { applyObjectiveEvents } from './objective-dispatcher.js';

import type { GameSession } from '../types.js';
type UnknownRecord = Record<string, any>;

type RegisteredSystem = {
  system: {
    name: string;
    onMonsterDefeat(state: UnknownRecord, monsterId: number, count: number): UnknownRecord[];
    reconcile(state: UnknownRecord): UnknownRecord[];
  };
  handler: UnknownRecord;
  getState(session: GameSession): UnknownRecord;
};

class ObjectiveRegistry {
  systems: RegisteredSystem[] = [];

  register(entry: RegisteredSystem): void {
    this.systems.push(entry);
  }

  dispatchMonsterDefeat(session: GameSession, monsterId: number, count = 1, source = 'monster-defeat', options: UnknownRecord = {}): boolean {
    let handled = false;
    for (const entry of this.systems) {
      const events = entry.system.onMonsterDefeat(entry.getState(session), monsterId, count);
      handled = handled || events.length > 0;
      applyObjectiveEvents(session, events, entry.handler as any, source, options);
    }
    return handled;
  }

  reconcileAll(session: GameSession, source = 'bootstrap', options: UnknownRecord = {}): boolean {
    let handled = false;
    for (const entry of this.systems) {
      const events = entry.system.reconcile(entry.getState(session));
      handled = handled || events.length > 0;
      applyObjectiveEvents(session, events, entry.handler as any, source, options);
    }
    return handled;
  }
}

export {
  ObjectiveRegistry,
};
