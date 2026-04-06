import type { GameSession } from '../types.js';

import { DEFAULT_FLAGS, GAME_FIGHT_RESULT_CMD } from '../config.js';
import { buildPetPanelClearPacket, buildPetPanelModePacket } from '../protocol/gameplay-packets.js';
import { getPrimaryPet, normalizePets } from '../pet-runtime.js';
import { syncWorldPetState } from '../world-state.js';
import { sendPetStateSync } from '../gameplay/pet-service.js';

export { schedulePetReplay, sendPetStateSync } from '../gameplay/pet-service.js';
export { disposePetTimers } from '../gameplay/pet-service.js';

type PetRecord = Record<string, any>;

export async function tryHandlePetActionPacket(session: GameSession, payload: Buffer): Promise<boolean> {
  if (payload.length < 3) {
    return false;
  }

  const subcmd = payload[2];
  const selectedPetRuntimeId =
    typeof session.selectedPetRuntimeId === 'number' ? session.selectedPetRuntimeId : null;
  const selectedPet = Array.isArray(session.pets)
    ? (selectedPetRuntimeId !== null
        ? session.pets.find(
            (entry: PetRecord) => (entry?.runtimeId >>> 0) === (selectedPetRuntimeId >>> 0)
          ) || null
        : null) || getPrimaryPet(session.pets)
    : null;

  if (subcmd === 0x03 && payload.length >= 6) {
    if (!selectedPet) {
      return false;
    }

    selectedPet.stateFlags = {
      ...(selectedPet.stateFlags || {}),
      activeFlag: payload[3] & 0xff,
      modeA: payload[4] & 0xff,
      modeB: payload[5] & 0xff,
    };
    await session.persistCurrentCharacter();
    session.log(
      `Pet position update runtimeId=${selectedPet.runtimeId >>> 0} side=${selectedPet.stateFlags.activeFlag} row=${selectedPet.stateFlags.modeA} col=${selectedPet.stateFlags.modeB}`
    );
    if (session.petSummoned) {
      sendPetStateSync(session, 'client-03f5-03');
    }
    return true;
  }

  if (payload.length !== 7) {
    return false;
  }

  const runtimeId = payload.readUInt32LE(3) >>> 0;
  const pet = Array.isArray(session.pets)
    ? session.pets.find((entry: PetRecord) => (entry?.runtimeId >>> 0) === runtimeId) || null
    : null;

  if (subcmd === 0x51) {
    if (!pet) {
      return false;
    }
    session.log(
      `Pet action request sub=0x${subcmd.toString(16)} runtimeId=${runtimeId} known=1`
    );
    session.selectedPetRuntimeId = runtimeId >>> 0;
    session.petSummoned = true;
    session.pets = normalizePets([
      pet,
      ...session.pets.filter((entry: PetRecord) => (entry?.runtimeId >>> 0) !== runtimeId),
    ]);
    await session.persistCurrentCharacter();
    sendPetStateSync(session, 'client-03f5-51');
    return true;
  }

  if (subcmd === 0x58) {
    if (!pet && (selectedPetRuntimeId === null || (selectedPetRuntimeId >>> 0) !== runtimeId)) {
      return false;
    }
    session.log(
      `Pet action request sub=0x${subcmd.toString(16)} runtimeId=${runtimeId} known=${pet ? 1 : 0}`
    );
    if (pet) {
      session.selectedPetRuntimeId = runtimeId >>> 0;
    }
    session.petSummoned = false;
    await session.persistCurrentCharacter();
    const ownerRuntimeId = session.runtimeId >>> 0;
    session.writePacket(
      buildPetPanelModePacket({
        ownerRuntimeId,
        enabled: false,
      }),
      DEFAULT_FLAGS,
      `Sending pet panel mode cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x57 reason=client-03f5-58 ownerRuntimeId=${ownerRuntimeId} enabled=0`
    );
    session.writePacket(
      buildPetPanelClearPacket({
        ownerRuntimeId,
      }),
      DEFAULT_FLAGS,
      `Sending pet panel clear cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x58 reason=client-03f5-58 ownerRuntimeId=${ownerRuntimeId}`
    );
    syncWorldPetState(session, 'client-03f5-58');
    return true;
  }

  return false;
}
