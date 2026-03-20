 'use strict';
 export {};

const { getRoleName, getRolePrimaryDrop } = require('../roleinfo');

type UnknownRecord = Record<string, any>;

const ENEMY_POSITION = { row: 0, col: 2 };

function chooseWeightedTemplate(pool: UnknownRecord[]): UnknownRecord | null {
  const entries = Array.isArray(pool)
    ? pool.filter((entry) => entry && Number.isInteger(entry.typeId) && Math.max(0, entry.weight || 0) > 0)
    : [];
  if (entries.length === 0) {
    return null;
  }

  const totalWeight = entries.reduce((sum, entry) => sum + Math.max(1, entry.weight || 1), 0);
  let roll = Math.floor(Math.random() * totalWeight);
  for (const entry of entries) {
    roll -= Math.max(1, entry.weight || 1);
    if (roll < 0) {
      return entry;
    }
  }

  return entries[entries.length - 1];
}

function randomIntInclusive(min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + Math.floor(Math.random() * ((high - low) + 1));
}

function buildEncounterEnemy(action: UnknownRecord | null | undefined, mapId: number): UnknownRecord {
  const profile = action?.encounterProfile || {};
  const template = chooseWeightedTemplate(profile.pool) || {
    typeId: 5001,
    logicalId: 1,
    levelMin: 1,
    levelMax: 1,
    hpBase: 40,
    hpPerLevel: 8,
    aptitude: 0,
    appearanceTypes: [0, 0, 0],
    appearanceVariants: [0, 0, 0],
    drops: [],
    name: null,
  };

  const level = randomIntInclusive(template.levelMin || 1, template.levelMax || template.levelMin || 1);
  const baseHp = Math.max(1, Number(template.hpBase) || 40);
  const hpPerLevel = Math.max(0, Number(template.hpPerLevel) || 0);
  const hp = baseHp + (Math.max(0, level - (template.levelMin || 1)) * hpPerLevel);
  const typeId = template.typeId & 0xffff;
  const drops = Array.isArray(template.drops) && template.drops.length > 0
    ? template.drops.map((drop: UnknownRecord) => ({ ...drop }))
    : (() => {
        const primaryDrop = getRolePrimaryDrop(typeId);
        return primaryDrop ? [primaryDrop] : [];
      })();

  return {
    side: 1,
    entityId: 0x700001,
    logicalId: Number.isInteger(template.logicalId) ? template.logicalId : typeId,
    typeId,
    row: ENEMY_POSITION.row,
    col: ENEMY_POSITION.col,
    hp,
    maxHp: hp,
    level,
    aptitude: Math.max(0, template.aptitude || 0),
    appearanceTypes: Array.isArray(template.appearanceTypes) ? template.appearanceTypes.slice(0, 3) : [0, 0, 0],
    appearanceVariants: Array.isArray(template.appearanceVariants) ? template.appearanceVariants.slice(0, 3) : [0, 0, 0],
    drops,
    name: template.name || getRoleName(typeId) || `Map ${mapId} Enemy ${typeId}`,
  };
}

module.exports = {
  ENEMY_POSITION,
  buildEncounterEnemy,
};
