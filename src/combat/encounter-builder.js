'use strict';

const { getRoleName, getRolePrimaryDrop } = require('../roleinfo');

const SYNTHETIC_ENCOUNTER_POSITIONS = [
  { row: 0, col: 2 },
  { row: 1, col: 1 },
  { row: 1, col: 3 },
];

function randomIntInclusive(min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + Math.floor(Math.random() * ((high - low) + 1));
}

function pickWeightedEncounterTemplate(pool) {
  const weightedPool = Array.isArray(pool)
    ? pool.filter((entry) => entry && Number.isInteger(entry.typeId) && (entry.weight || 1) > 0)
    : [];
  if (weightedPool.length === 0) {
    return null;
  }

  const totalWeight = weightedPool.reduce((sum, entry) => sum + Math.max(1, entry.weight || 1), 0);
  let roll = Math.floor(Math.random() * totalWeight);
  for (const entry of weightedPool) {
    roll -= Math.max(1, entry.weight || 1);
    if (roll < 0) {
      return entry;
    }
  }

  return weightedPool[weightedPool.length - 1];
}

function buildSyntheticEncounterEnemies(action, mapId) {
  const profile = action?.encounterProfile;
  if (!profile || !Array.isArray(profile.pool) || profile.pool.length === 0) {
    const fallbackDrop = getRolePrimaryDrop(5001);
    const fallbackName = getRoleName(5001) || `Map ${mapId} Enemy 5001`;
    return [
      {
        side: 1,
        entityId: 0x700001,
        logicalId: 1,
        typeId: 5001,
        row: 0,
        col: 2,
        hpLike: 120,
        mpLike: 0,
        aptitude: 0,
        levelLike: 15,
        appearanceTypes: [0, 0, 0],
        appearanceVariants: [0, 0, 0],
        drops: fallbackDrop ? [fallbackDrop] : [],
        name: fallbackName,
      },
      {
        side: 1,
        entityId: 0x700002,
        logicalId: 2,
        typeId: 5001,
        row: 1,
        col: 1,
        hpLike: 120,
        mpLike: 0,
        aptitude: 0,
        levelLike: 15,
        appearanceTypes: [0, 0, 0],
        appearanceVariants: [0, 0, 0],
        drops: fallbackDrop ? [fallbackDrop] : [],
        name: fallbackName,
      },
    ];
  }

  const count = randomIntInclusive(
    profile.minEnemies || 1,
    Math.min(profile.maxEnemies || 1, SYNTHETIC_ENCOUNTER_POSITIONS.length)
  );
  const enemies = [];
  for (let index = 0; index < count; index += 1) {
    const template = pickWeightedEncounterTemplate(profile.pool) || profile.pool[0];
    const position = SYNTHETIC_ENCOUNTER_POSITIONS[index];
    const levelLike = randomIntInclusive(template.levelMin || 1, template.levelMax || template.levelMin || 1);
    const hpLike = (template.hpBase || 80) + ((template.hpPerLevel || 5) * Math.max(0, levelLike - (template.levelMin || 1)));

    enemies.push({
      side: 1,
      entityId: 0x700001 + index,
      logicalId: Number.isInteger(template.logicalId) ? template.logicalId : (template.typeId & 0xffff),
      typeId: template.typeId & 0xffff,
      row: position.row,
      col: position.col,
      hpLike,
      mpLike: 0,
      aptitude: template.aptitude || 0,
      levelLike,
      appearanceTypes: Array.isArray(template.appearanceTypes) ? template.appearanceTypes.slice(0, 3) : [0, 0, 0],
      appearanceVariants: Array.isArray(template.appearanceVariants) ? template.appearanceVariants.slice(0, 3) : [0, 0, 0],
      drops: Array.isArray(template.drops) ? template.drops.map((drop) => ({ ...drop })) : [],
      name: template.name || `Map ${mapId} Enemy ${template.typeId}`,
    });
  }

  return enemies;
}

module.exports = {
  SYNTHETIC_ENCOUNTER_POSITIONS,
  randomIntInclusive,
  pickWeightedEncounterTemplate,
  buildSyntheticEncounterEnemies,
};
