'use strict';

const fs = require('fs');
const { COMBAT_PROBE_STATE_FILE } = require('../config');
const { buildCombatTurnProfiles } = require('../combat-reference');

const COMBAT_TURN_PROBE_PROFILES = buildCombatTurnProfiles();

function loadCombatProbeIndex() {
  try {
    const raw = fs.readFileSync(COMBAT_PROBE_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Number.isInteger(parsed?.nextProbeIndex) && parsed.nextProbeIndex >= 0
      ? parsed.nextProbeIndex
      : 0;
  } catch (err) {
    return 0;
  }
}

function saveCombatProbeIndex(nextProbeIndex) {
  const payload = JSON.stringify({ nextProbeIndex }, null, 2);
  fs.writeFileSync(COMBAT_PROBE_STATE_FILE, `${payload}\n`);
}

function selectCombatTurnProbeProfile() {
  const persistedProbeIndex = loadCombatProbeIndex();
  const probeIndex = persistedProbeIndex % COMBAT_TURN_PROBE_PROFILES.length;
  const probeProfile = COMBAT_TURN_PROBE_PROFILES[probeIndex];
  saveCombatProbeIndex(persistedProbeIndex + 1);
  return {
    index: probeIndex,
    profile: probeProfile,
  };
}

module.exports = {
  loadCombatProbeIndex,
  saveCombatProbeIndex,
  selectCombatTurnProbeProfile,
};
