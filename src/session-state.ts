interface SessionState {
  sessionCount: number;
  nextSessionIsGame: boolean;
  pendingGameCharacter: Record<string, unknown> | null;
  characterStore: Record<string, unknown> | null;
}

export function createSessionState(): SessionState {
  return {
    sessionCount: 0,
    nextSessionIsGame: false,
    pendingGameCharacter: null,
    characterStore: null,
  };
}
