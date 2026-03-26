import { createWorldState } from './world-state.js';

interface SessionState {
  sessionCount: number;
  pendingGameCharacters: Map<string, Record<string, unknown>>;
  characterStore: Record<string, unknown> | null;
  worldState: ReturnType<typeof createWorldState>;
}

export function createSessionState(): SessionState {
  return {
    sessionCount: 0,
    pendingGameCharacters: new Map(),
    characterStore: null,
    worldState: createWorldState(),
  };
}
