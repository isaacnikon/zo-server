'use strict';

const INN_REST_BASELINE = Object.freeze({
  health: 398,
  mana: 600,
  rage: 100,
});

function resolveInnRestVitals(currentVitals) {
  return {
    health: Math.max(currentVitals.health || 0, INN_REST_BASELINE.health),
    mana: Math.max(currentVitals.mana || 0, INN_REST_BASELINE.mana),
    rage: Math.max(currentVitals.rage || 0, INN_REST_BASELINE.rage),
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
  buildDefeatRespawnState,
  resolveInnRestVitals,
};
