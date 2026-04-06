 'use strict';
 export {};

import { getRoleName, getRolePrimaryDrop } from '../roleinfo/index.js';
import type { CombatEnemyInstance } from '../types.js';
import type { UnknownRecord } from '../utils.js';

export const FORCE_MULTI_ENEMY_ENCOUNTERS = process.env.FORCE_MULTI_ENEMY_ENCOUNTERS === '1';
export const ENEMY_POSITIONS = [
  { row: 0, col: 0 },
  { row: 0, col: 1 },
  { row: 0, col: 2 },
  { row: 0, col: 3 },
  { row: 0, col: 4 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
  { row: 1, col: 2 },
  { row: 1, col: 3 },
  { row: 1, col: 4 },
];
let nextCombatEnemyEntityId = 0x700001;

function shufflePositions<T>(values: T[]): T[] {
  const shuffled = values.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = current;
  }
  return shuffled;
}

function allocateCombatEnemyEntityId(): number {
  const entityId = nextCombatEnemyEntityId >>> 0;
  nextCombatEnemyEntityId = (nextCombatEnemyEntityId + 1) >>> 0;
  if (nextCombatEnemyEntityId < 0x700001 || nextCombatEnemyEntityId >= 0x7fffffff) {
    nextCombatEnemyEntityId = 0x700001;
  }
  return entityId;
}

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

function buildEnemyFromTemplate(template: UnknownRecord, mapId: number, position: { row: number; col: number }): UnknownRecord {
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
    entityId: allocateCombatEnemyEntityId(),
    logicalId: Number.isInteger(template.logicalId) ? template.logicalId : typeId,
    typeId,
    row: position.row,
    col: position.col,
    hp,
    maxHp: hp,
    level,
    aptitude: Math.max(0, template.aptitude || 0),
    attackPriority: Number.isFinite(Number(template.attackPriority))
      ? Math.max(0, Number(template.attackPriority))
      : (
        Number.isFinite(Number(template.attack_priority))
          ? Math.max(0, Number(template.attack_priority))
          : (
            Number.isFinite(Number(template.apPriority))
              ? Math.max(0, Number(template.apPriority))
              : (
                Number.isFinite(Number(template.ap))
                  ? Math.max(0, Number(template.ap))
                  : undefined
              )
          )
      ),
    appearanceTypes: Array.isArray(template.appearanceTypes) ? template.appearanceTypes.slice(0, 3) : [0, 0, 0],
    appearanceVariants: Array.isArray(template.appearanceVariants) ? template.appearanceVariants.slice(0, 3) : [0, 0, 0],
    drops,
    name: template.name || getRoleName(typeId) || `Map ${mapId} Enemy ${typeId}`,
  };
}

export function buildEncounterEnemies(action: UnknownRecord | null | undefined, mapId: number): UnknownRecord[] {
  const profile = action?.encounterProfile || {};
  const fixedEnemies = Array.isArray(profile.fixedEnemies)
    ? profile.fixedEnemies.filter(
        (entry: UnknownRecord) =>
          entry &&
          Number.isInteger(entry.typeId) &&
          Number.isInteger(entry.row) &&
          Number.isInteger(entry.col)
      )
    : [];
  if (fixedEnemies.length > 0) {
    return fixedEnemies
      .slice(0, ENEMY_POSITIONS.length)
      .map((template: UnknownRecord) =>
        buildEnemyFromTemplate(template, mapId, {
          row: template.row & 0xff,
          col: template.col & 0xff,
        })
      );
  }

  const pool = Array.isArray(profile.pool) ? profile.pool : [];
  if (pool.length === 0) {
    return [];
  }
  const minEnemies = Math.max(1, Number(profile.minEnemies) || 1);
  const maxEnemies = Math.max(minEnemies, Number(profile.maxEnemies) || minEnemies);
  const requestedCount = FORCE_MULTI_ENEMY_ENCOUNTERS && maxEnemies > 1
    ? maxEnemies
    : randomIntInclusive(minEnemies, maxEnemies);
  const enemyCount = Math.min(ENEMY_POSITIONS.length, Math.max(1, requestedCount));
  const enemies = [];
  const availablePositions = shufflePositions(ENEMY_POSITIONS).slice(0, enemyCount);

  for (let index = 0; index < enemyCount; index += 1) {
    const template = chooseWeightedTemplate(pool);
    const position = availablePositions[index] || ENEMY_POSITIONS[ENEMY_POSITIONS.length - 1];
    if (!template) {
      continue;
    }
    enemies.push(buildEnemyFromTemplate(template, mapId, position));
  }

  return enemies;
}

export function buildEncounterEnemy(action: UnknownRecord | null | undefined, mapId: number): UnknownRecord {
  return buildEncounterEnemies(action, mapId)[0];
}

export function cloneEncounterEnemies(enemies: CombatEnemyInstance[]): CombatEnemyInstance[] {
  return enemies.map((enemy) => ({
    ...enemy,
    appearanceTypes: Array.isArray(enemy?.appearanceTypes) ? [...enemy.appearanceTypes] : [],
    appearanceVariants: Array.isArray(enemy?.appearanceVariants) ? [...enemy.appearanceVariants] : [],
    drops: Array.isArray(enemy?.drops) ? enemy.drops.map((drop) => ({ ...drop })) : [],
  }));
}
