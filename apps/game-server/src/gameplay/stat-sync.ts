import { DEFAULT_FLAGS, GAME_SELF_STATE_CMD } from '../config.js';
import { buildSelfStateValueUpdatePacket } from '../protocol/gameplay-packets.js';
import type { SessionPorts } from '../types.js';
import { getClientVisibleExperience } from './progression.js';
type ValueUpdateKind = 'gold' | 'coins' | 'renown' | 'experience' | 'health' | 'mana' | 'rage';

export const VALUE_UPDATE_DISCRIMINATORS = Object.freeze({
  gold: '$',
  coins: 'N',
  renown: '-',
  experience: '!',
  health: 0x0b,
  mana: 0x0c,
  rage: 0x0d,
});

export function sendSelfStateValueUpdate(session: SessionPorts, kind: ValueUpdateKind, value: number): void {
  const discriminator = VALUE_UPDATE_DISCRIMINATORS[kind];
  if (discriminator == null) {
    return;
  }
  const normalizedValue =
    kind === 'experience' ? getClientVisibleExperience(session.level || 1, value) : value;

  const encodedDiscriminator =
    typeof discriminator === 'string' ? discriminator.charCodeAt(0) : discriminator & 0xff;

  session.writePacket(
    buildSelfStateValueUpdatePacket({
      discriminator: encodedDiscriminator,
      value: normalizedValue,
    }),
    DEFAULT_FLAGS,
    `Sending self-state value update cmd=0x${GAME_SELF_STATE_CMD.toString(16)} kind=${kind} discriminator=0x${encodedDiscriminator.toString(16)} value=${normalizedValue}`
  );
}

export function sendSelfStateVitalsUpdate(
  session: SessionPorts,
  vitals: { health: number; mana: number; rage: number }
): void {
  sendSelfStateValueUpdate(session, 'health', vitals.health);
  sendSelfStateValueUpdate(session, 'mana', vitals.mana);
  sendSelfStateValueUpdate(session, 'rage', vitals.rage);
}
