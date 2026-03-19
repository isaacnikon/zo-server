const { applyObjectiveEvents } = require('./objective-dispatcher');

type UnknownRecord = Record<string, any>;
type SessionLike = Record<string, any>;

type RegisteredSystem = {
  system: {
    name: string;
    onServerRun(state: UnknownRecord, event: UnknownRecord): UnknownRecord[];
    onMonsterDefeat(state: UnknownRecord, monsterId: number, count: number): UnknownRecord[];
    onSceneTransition(state: UnknownRecord, mapId: number): UnknownRecord[];
    reconcile(state: UnknownRecord): UnknownRecord[];
  };
  handler: UnknownRecord;
  getState(session: SessionLike): UnknownRecord;
};

class ObjectiveRegistry {
  systems: RegisteredSystem[] = [];

  register(entry: RegisteredSystem): void {
    this.systems.push(entry);
  }

  dispatchServerRun(session: SessionLike, event: UnknownRecord, source = 'server-run', options: UnknownRecord = {}): boolean {
    let handled = false;
    for (const entry of this.systems) {
      const events = entry.system.onServerRun(entry.getState(session), event);
      handled = handled || events.length > 0;
      applyObjectiveEvents(session, events, entry.handler, source, options);
    }
    return handled;
  }

  dispatchMonsterDefeat(session: SessionLike, monsterId: number, count = 1, source = 'monster-defeat', options: UnknownRecord = {}): boolean {
    let handled = false;
    for (const entry of this.systems) {
      const events = entry.system.onMonsterDefeat(entry.getState(session), monsterId, count);
      handled = handled || events.length > 0;
      applyObjectiveEvents(session, events, entry.handler, source, options);
    }
    return handled;
  }

  dispatchSceneTransition(session: SessionLike, mapId: number, source = 'scene-transition', options: UnknownRecord = {}): boolean {
    let handled = false;
    for (const entry of this.systems) {
      const events = entry.system.onSceneTransition(entry.getState(session), mapId);
      handled = handled || events.length > 0;
      applyObjectiveEvents(session, events, entry.handler, source, options);
    }
    return handled;
  }

  reconcileAll(session: SessionLike, source = 'bootstrap', options: UnknownRecord = {}): boolean {
    let handled = false;
    for (const entry of this.systems) {
      const events = entry.system.reconcile(entry.getState(session));
      handled = handled || events.length > 0;
      applyObjectiveEvents(session, events, entry.handler, source, options);
    }
    return handled;
  }
}

export {
  ObjectiveRegistry,
};
