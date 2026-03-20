'use strict';
export {};

const { DEFAULT_FLAGS, GAME_SELF_STATE_CMD } = require('../config');
const { buildSelfStateValueUpdatePacket } = require('../protocol/gameplay-packets');
type SessionLike = Record<string, any>;
type ValueUpdateKind = 'gold' | 'coins' | 'renown' | 'experience' | 'health' | 'mana' | 'rage';

const VALUE_UPDATE_DISCRIMINATORS = Object.freeze({
  gold: '$',
  coins: 'N',
  renown: '-',
  experience: '!',
  health: 0x0b,
  mana: 0x0c,
  rage: 0x0d,
});

function sendSelfStateValueUpdate(session: SessionLike, kind: ValueUpdateKind, value: number): void {
  const discriminator = VALUE_UPDATE_DISCRIMINATORS[kind];
  if (discriminator == null) {
    return;
  }

  const encodedDiscriminator =
    typeof discriminator === 'string' ? discriminator.charCodeAt(0) : discriminator & 0xff;

  session.writePacket(
    buildSelfStateValueUpdatePacket({
      discriminator: encodedDiscriminator,
      value,
    }),
    DEFAULT_FLAGS,
    `Sending self-state value update cmd=0x${GAME_SELF_STATE_CMD.toString(16)} kind=${kind} discriminator=0x${encodedDiscriminator.toString(16)} value=${value}`
  );
}

function sendSelfStateVitalsUpdate(
  session: SessionLike,
  vitals: { health: number; mana: number; rage: number }
): void {
  sendSelfStateValueUpdate(session, 'health', vitals.health);
  sendSelfStateValueUpdate(session, 'mana', vitals.mana);
  sendSelfStateValueUpdate(session, 'rage', vitals.rage);
}

module.exports = {
  sendSelfStateVitalsUpdate,
  sendSelfStateValueUpdate,
  VALUE_UPDATE_DISCRIMINATORS,
};
