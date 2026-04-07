import type { GameSession } from './types.js';

import { createWorldState } from './world-state.js';

interface SessionState {
  sessionCount: number;
  pendingGameCharacters: Map<string, Record<string, unknown>>;
  deletedCharacterIds: Set<string>;
  characterStore: Record<string, unknown> | null;
  worldState: ReturnType<typeof createWorldState>;
  sessionsById: Map<number, GameSession>;
}

export function createSessionState(): SessionState {
  return {
    sessionCount: 0,
    pendingGameCharacters: new Map(),
    deletedCharacterIds: new Set<string>(),
    characterStore: null,
    worldState: createWorldState(),
    sessionsById: new Map(),
  };
}
