import type { GameSession, SessionPorts } from '../types.js';

import { DEFAULT_FLAGS, GAME_FIGHT_RESULT_CMD, GAME_FIGHT_STREAM_CMD, GAME_SELF_STATE_CMD } from '../config.js';
import { buildPetActiveSelectPacket, buildPetPanelBindPacket, buildPetPanelModePacket, buildPetPanelNamePacket, buildPetPanelPropertyPacket, buildPetPanelRebindPacket, buildPetPlacementSyncPacket, buildPetRosterSyncPacket, buildPetStatsSyncPacket, buildPetTreeRegistrationPacket } from '../protocol/gameplay-packets.js';
import { createOwnedPet, getPrimaryPet, normalizePets } from '../pet-runtime.js';
import { syncWorldPetState } from '../world-state.js';

type PetRecord = Record<string, any>;

export const MAX_PET_CAPACITY = 3;

export function addPetToSession(
  session: SessionPorts,
  petTemplateId: number,
  overrides: Record<string, unknown> = {}
): boolean {
  if (!Array.isArray(session.pets)) {
    session.pets = [];
  }
  const pet = createOwnedPet(petTemplateId >>> 0, overrides, session.pets.length);
  if (!pet) {
    return false;
  }
  session.pets.push(pet);
  return true;
}

export function schedulePetReplay(session: GameSession, delayMs = 500): void {
  if (session.petReplayTimer) {
    clearTimeout(session.petReplayTimer);
    session.petReplayTimer = null;
  }

  session.petReplayTimer = setTimeout(() => {
    session.petReplayTimer = null;
    if (session.state !== 'LOGGED_IN' || !session.petSummoned) {
      return;
    }
    sendPetStateSync(session, 'client-03f5-51-replay');
  }, Math.max(0, delayMs | 0));
}

export function sendPetStateSync(session: GameSession, reason = 'runtime'): void {
  session.pets = normalizePets(session.pets);
  if (session.pets.length === 0) {
    syncWorldPetState(session, `${reason}:no-pets`);
    return;
  }
  const selectedPet =
    typeof session.selectedPetRuntimeId === 'number'
      ? session.pets.find(
          (entry: PetRecord) => (entry?.runtimeId >>> 0) === session.selectedPetRuntimeId
        ) || null
      : null;
  const pet = selectedPet || getPrimaryPet(session.pets);
  if (!pet) {
    return;
  }
  if (selectedPet) {
    session.pets = normalizePets([
      selectedPet,
      ...session.pets.filter(
        (entry: PetRecord) => (entry?.runtimeId >>> 0) !== selectedPet.runtimeId
      ),
    ]);
  }
  session.selectedPetRuntimeId = pet.runtimeId >>> 0;
  const ownerRuntimeId = session.runtimeId >>> 0;
  const isEnterGameSync = reason === 'enter-game';

  for (const rosterPet of session.pets) {
    session.writePacket(
      buildPetTreeRegistrationPacket({ pet: rosterPet }),
      DEFAULT_FLAGS,
      `Sending pet tree registration cmd=0x03eb type=0x02 reason=${reason} runtimeId=${rosterPet.runtimeId} templateId=${rosterPet.templateId} name="${rosterPet.name}"`
    );
  }
  session.writePacket(
    buildPetRosterSyncPacket({ pets: session.pets }),
    DEFAULT_FLAGS,
    `Sending pet roster sync cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x7f reason=${reason} count=${session.pets.length}`
  );
  const isPanelSummonSync = reason === 'client-03f5-51';
  const isReplaySync = reason === 'client-03f5-51-replay';
  const isItemUseSync = reason === 'item-use';
  if (!isPanelSummonSync) {
    session.writePacket(
      buildPetPanelBindPacket({ ownerRuntimeId, pet }),
      DEFAULT_FLAGS,
      `Sending pet panel bind cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x51 reason=${reason} ownerRuntimeId=${ownerRuntimeId} templateId=${pet.templateId} name="${pet.name}"`
    );
    session.writePacket(
      buildPetPanelNamePacket({ ownerRuntimeId, pet }),
      DEFAULT_FLAGS,
      `Sending pet panel name cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x59 reason=${reason} ownerRuntimeId=${ownerRuntimeId} name="${pet.name}"`
    );
  }
  if (!isEnterGameSync) {
    session.writePacket(
      buildPetPanelModePacket({
        ownerRuntimeId,
        enabled: true,
      }),
      DEFAULT_FLAGS,
      `Sending pet panel mode cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x56 reason=${reason} ownerRuntimeId=${ownerRuntimeId} enabled=1`
    );
  }
  sendPetPropertySync(session, ownerRuntimeId, pet, reason);
  session.writePacket(
    buildPetStatsSyncPacket({ pet }),
    DEFAULT_FLAGS,
    `Sending pet stat sync cmd=0x${GAME_SELF_STATE_CMD.toString(16)} sub=0x1f reason=${reason} runtimeId=${pet.runtimeId} stats=${pet.stats.strength}/${pet.stats.dexterity}/${pet.stats.vitality}/${pet.stats.intelligence} points=${pet.statPoints}`
  );
  if (session.petSummoned) {
    session.writePacket(
      buildPetPlacementSyncPacket({ pet }),
      DEFAULT_FLAGS,
      `Sending pet placement sync cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x0f reason=${reason} runtimeId=${pet.runtimeId} row=${pet.stateFlags?.modeA ?? 0} col=${pet.stateFlags?.modeB ?? 0}`
    );
  }
  if (!isPanelSummonSync) {
    session.writePacket(
      buildPetPanelRebindPacket({ ownerRuntimeId }),
      DEFAULT_FLAGS,
      `Sending pet panel rebind cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x53 reason=${reason} ownerRuntimeId=${ownerRuntimeId}`
    );
  }
  if ((isReplaySync || isItemUseSync) && !isEnterGameSync) {
    session.writePacket(
      buildPetActiveSelectPacket({ runtimeId: pet.runtimeId }),
      DEFAULT_FLAGS,
      `Sending pet active select cmd=0x03f5 reason=${reason} runtimeId=${pet.runtimeId}`
    );
  }
  syncWorldPetState(session, reason);
}

function sendPetPropertySync(
  session: GameSession,
  ownerRuntimeId: number,
  pet: PetRecord,
  reason = 'runtime'
): void {
  const properties = [
    pet.stats?.strength,
    pet.stats?.dexterity,
    pet.stats?.vitality,
    pet.stats?.intelligence,
  ];

  properties.forEach((value, index) => {
    session.writePacket(
      buildPetPanelPropertyPacket({
        ownerRuntimeId,
        index,
        value: value >>> 0,
      }),
      DEFAULT_FLAGS,
      `Sending pet property sync cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x55 reason=${reason} ownerRuntimeId=${ownerRuntimeId} index=${index} value=${value >>> 0}`
    );
  });
}

export function disposePetTimers(session: GameSession): void {
  if (session.petReplayTimer) {
    clearTimeout(session.petReplayTimer);
    session.petReplayTimer = null;
  }
}
