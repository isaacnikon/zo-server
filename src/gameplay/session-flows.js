'use strict';

const CHARACTER_VITALS_BASELINE = Object.freeze({
  // Current validated player baseline for the local early-game flow.
  // The client may derive higher/lower caps from later level/stat/equipment logic,
  // so all callers should go through this shared resolver instead of hardcoding.
  health: 432,
  mana: 630,
  rage: 100,
});

function resolveCharacterMaxVitals(currentVitals = null) {
  return {
    health: Math.max(numberOrDefault(currentVitals?.health, 0), CHARACTER_VITALS_BASELINE.health),
    mana: Math.max(numberOrDefault(currentVitals?.mana, 0), CHARACTER_VITALS_BASELINE.mana),
    rage: Math.max(numberOrDefault(currentVitals?.rage, 0), CHARACTER_VITALS_BASELINE.rage),
  };
}

function resolveInnRestVitals(currentVitals) {
  const maxVitals = resolveCharacterMaxVitals(currentVitals);
  return {
    health: maxVitals.health,
    mana: maxVitals.mana,
    rage: maxVitals.rage,
  };
}

function numberOrDefault(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function buildDefeatRespawnState({
  persistedCharacter,
  currentMapId,
  currentX,
  currentY,
  player,
  currentMana,
  currentRage,
  resolveTownRespawn,
}) {
  const respawn = resolveTownRespawn({
    ...(persistedCharacter || {}),
    mapId: currentMapId,
    x: currentX,
    y: currentY,
  });

  return {
    respawn,
    vitals: {
      health: Math.max(1, player?.maxHp || 1),
      mana: Math.max(0, player?.mp || currentMana || 0),
      rage: Math.max(0, player?.rage || currentRage || 0),
    },
  };
}

module.exports = {
  CHARACTER_VITALS_BASELINE,
  buildDefeatRespawnState,
  resolveCharacterMaxVitals,
  resolveInnRestVitals,
};
