interface ObjectiveSystem<TState, TEvent> {
  readonly name: string;
  onMonsterDefeat(state: TState, monsterId: number, count: number): TEvent[];
  reconcile(state: TState): TEvent[];
}

export type {
  ObjectiveSystem,
};
