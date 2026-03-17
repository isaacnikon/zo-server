'use strict';

const CHARACTER_VITALS_BASELINE = Object.freeze({
  // Current validated player baseline for the local early-game flow.
  // The client may derive higher/lower caps from later level/stat/equipment logic,
  // so all callers should go through this shared resolver instead of hardcoding.
  health: 432,
  mana: 630,
  rage: 100,
});

function resolveCharacterMaxVitals() {
  return CHARACTER_VITALS_BASELINE;
}

function resolveInnRestVitals(currentVitals) {
  const maxVitals = resolveCharacterMaxVitals();
  return {
    health: Math.max(currentVitals.health || 0, maxVitals.health),
    mana: Math.max(currentVitals.mana || 0, maxVitals.mana),
    rage: Math.max(currentVitals.rage || 0, maxVitals.rage),
  };
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
      health: Math.max(1, player?.maxHp ? Math.min(player.maxHp, 1) : 1),
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
