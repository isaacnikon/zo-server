'use strict';
export {};

interface SessionState {
  sessionCount: number;
  nextSessionIsGame: boolean;
  pendingGameCharacter: Record<string, unknown> | null;
  characterStore: Record<string, unknown> | null;
  mapCellStore: Record<string, unknown> | null;
}

function createSessionState(): SessionState {
  return {
    sessionCount: 0,
    nextSessionIsGame: false,
    pendingGameCharacter: null,
    characterStore: null,
    mapCellStore: null,
  };
}

module.exports = {
  createSessionState,
};
