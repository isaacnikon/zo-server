'use strict';

const {
  DEFAULT_FLAGS,
  GAME_FIGHT_RESULT_CMD,
  GAME_FIGHT_STREAM_CMD,
  GAME_SELF_STATE_CMD,
} = require('../config');
const {
  buildPetActiveSelectPacket,
  buildPetPanelBindPacket,
  buildPetPanelClearPacket,
  buildPetPanelModePacket,
  buildPetPanelNamePacket,
  buildPetPanelPropertyPacket,
  buildPetPanelRebindPacket,
  buildPetRosterSyncPacket,
  buildPetStatsSyncPacket,
  buildPetTreeRegistrationPacket,
} = require('../protocol/gameplay-packets');
const {
  getPrimaryPet,
  normalizePets,
} = require('../pet-runtime');

function getPetOwnerRuntimeId(session) {
  return session.entityType >>> 0;
}

function tryHandlePetActionPacket(session, payload) {
  if (payload.length !== 7) {
    return false;
  }

  const subcmd = payload[2];
  const runtimeId = payload.readUInt32LE(3) >>> 0;
  const pet = Array.isArray(session.pets)
    ? session.pets.find((entry) => (entry?.runtimeId >>> 0) === runtimeId) || null
    : null;

  session.log(
    `Pet action request sub=0x${subcmd.toString(16)} runtimeId=${runtimeId} known=${pet ? 1 : 0}`
  );

  if (subcmd === 0x51) {
    if (!pet) {
      return true;
    }
    session.selectedPetRuntimeId = runtimeId >>> 0;
    session.petSummoned = true;
    session.pets = normalizePets([
      pet,
      ...session.pets.filter((entry) => (entry?.runtimeId >>> 0) !== runtimeId),
    ]);
    session.persistCurrentCharacter();
    sendPetStateSync(session, 'client-03f5-51');
    return true;
  }

  if (subcmd === 0x58) {
    if (pet) {
      session.selectedPetRuntimeId = runtimeId >>> 0;
    }
    session.petSummoned = false;
    session.persistCurrentCharacter();
    const ownerRuntimeId = getPetOwnerRuntimeId(session);
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
    return true;
  }

  return true;
}

function schedulePetReplay(session, delayMs = 500) {
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

function sendPetStateSync(session, reason = 'runtime') {
  session.pets = normalizePets(session.pets);
  if (session.pets.length === 0) {
    return;
  }
  const selectedPet = typeof session.selectedPetRuntimeId === 'number'
    ? session.pets.find((entry) => (entry?.runtimeId >>> 0) === session.selectedPetRuntimeId) || null
    : null;
  const pet = selectedPet || getPrimaryPet(session.pets);
  if (!pet) {
    return;
  }
  if (selectedPet) {
    session.pets = normalizePets([
      selectedPet,
      ...session.pets.filter((entry) => (entry?.runtimeId >>> 0) !== selectedPet.runtimeId),
    ]);
  }
  session.selectedPetRuntimeId = pet.runtimeId >>> 0;
  const ownerRuntimeId = getPetOwnerRuntimeId(session);

  session.writePacket(
    buildPetTreeRegistrationPacket({ pet }),
    DEFAULT_FLAGS,
    `Sending pet tree registration cmd=0x03eb type=0x02 reason=${reason} runtimeId=${pet.runtimeId} templateId=${pet.templateId} name="${pet.name}"`
  );
  session.writePacket(
    buildPetRosterSyncPacket({ pets: session.pets }),
    DEFAULT_FLAGS,
    `Sending pet roster sync cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x7f reason=${reason} count=${session.pets.length}`
  );
  const isPanelSummonSync = reason === 'client-03f5-51';
  const isReplaySync = reason === 'client-03f5-51-replay';
  if (!isPanelSummonSync) {
    session.writePacket(
      buildPetPanelBindPacket({
        ownerRuntimeId,
        pet,
      }),
      DEFAULT_FLAGS,
      `Sending pet panel bind cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x51 reason=${reason} ownerRuntimeId=${ownerRuntimeId} templateId=${pet.templateId} name="${pet.name}"`
    );
    session.writePacket(
      buildPetPanelNamePacket({
        ownerRuntimeId,
        pet,
      }),
      DEFAULT_FLAGS,
      `Sending pet panel name cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x59 reason=${reason} ownerRuntimeId=${ownerRuntimeId} name="${pet.name}"`
    );
  }
  session.writePacket(
    buildPetPanelModePacket({
      ownerRuntimeId,
      enabled: true,
    }),
    DEFAULT_FLAGS,
    `Sending pet panel mode cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x56 reason=${reason} ownerRuntimeId=${ownerRuntimeId} enabled=1`
  );
  sendPetPropertySync(session, ownerRuntimeId, pet, reason);
  session.writePacket(
    buildPetStatsSyncPacket({ pet }),
    DEFAULT_FLAGS,
    `Sending pet stat sync cmd=0x${GAME_SELF_STATE_CMD.toString(16)} sub=0x1f reason=${reason} runtimeId=${pet.runtimeId} stats=${pet.stats.strength}/${pet.stats.dexterity}/${pet.stats.vitality}/${pet.stats.intelligence} points=${pet.statPoints}`
  );
  if (!isPanelSummonSync) {
    session.writePacket(
      buildPetPanelRebindPacket({ ownerRuntimeId }),
      DEFAULT_FLAGS,
      `Sending pet panel rebind cmd=0x${GAME_FIGHT_RESULT_CMD.toString(16)} sub=0x53 reason=${reason} ownerRuntimeId=${ownerRuntimeId}`
    );
  }
  if (isReplaySync) {
    session.writePacket(
      buildPetActiveSelectPacket({ runtimeId: pet.runtimeId }),
      DEFAULT_FLAGS,
      `Sending pet active select cmd=0x03f5 reason=${reason} runtimeId=${pet.runtimeId}`
    );
  }
}

function sendPetPropertySync(session, ownerRuntimeId, pet, reason = 'runtime') {
  const properties = [
    pet.level,
    pet.currentHealth,
    pet.currentMana,
    pet.loyalty,
    pet.stats?.strength,
    pet.stats?.dexterity,
    pet.stats?.vitality,
    pet.stats?.intelligence,
    pet.statPoints,
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

function disposePetTimers(session) {
  if (session.petReplayTimer) {
    clearTimeout(session.petReplayTimer);
    session.petReplayTimer = null;
  }
}

module.exports = {
  disposePetTimers,
  schedulePetReplay,
  sendPetStateSync,
  tryHandlePetActionPacket,
};
