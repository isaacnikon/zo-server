'use strict';

const { DEFAULT_FLAGS, GAME_SELF_STATE_CMD } = require('../config');
const { buildSelfStateValueUpdatePacket } = require('../protocol/gameplay-packets');

const VALUE_UPDATE_DISCRIMINATORS = Object.freeze({
  gold: '$',
  coins: 'N',
  renown: '-',
  experience: '!',
});

function sendSelfStateValueUpdate(session, kind, value) {
  const discriminator = VALUE_UPDATE_DISCRIMINATORS[kind];
  if (!discriminator) {
    return;
  }

  session.writePacket(
    buildSelfStateValueUpdatePacket({
      discriminator: discriminator.charCodeAt(0),
      value,
    }),
    DEFAULT_FLAGS,
    `Sending self-state value update cmd=0x${GAME_SELF_STATE_CMD.toString(16)} kind=${kind} value=${value}`
  );
}

module.exports = {
  sendSelfStateValueUpdate,
  VALUE_UPDATE_DISCRIMINATORS,
};
