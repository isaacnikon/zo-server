import type { ServerRunEvent } from '../types';

interface ObjectiveSystem<TState, TEvent> {
  readonly name: string;
  onServerRun(state: TState, event: ServerRunEvent): TEvent[];
  onMonsterDefeat(state: TState, monsterId: number, count: number): TEvent[];
  onSceneTransition(state: TState, mapId: number): TEvent[];
  reconcile(state: TState): TEvent[];
}

export type {
  ObjectiveSystem,
};
