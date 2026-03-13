'use strict';

function createSessionState() {
  return {
    sessionCount: 0,
    nextSessionIsGame: false,
    pendingGameCharacter: null,
    characterStore: null,
  };
}

module.exports = {
  createSessionState,
};
