import type { GameSession } from '../types.js';

import { COMBAT_ENABLED } from '../config.js';
import {
  resolveDerivedPlayerCombatStats,
  resolveEnemyPhysicalMitigation,
  resolvePlayerAttackRange,
  resolvePlayerMagicAttackRange,
} from '../combat/combat-formulas.js';
import { buildEncounterPoolForLocation } from '../roleinfo/index.js';
import { getMapEncounterLevelRange, getMapNpcs, getMapSummary } from '../map-data.js';


const FIELD_COMBAT_ENABLED = COMBAT_ENABLED && process.env.FIELD_COMBAT_ENABLED !== '0';
const FIELD_COMBAT_COOLDOWN_MS = Number.isFinite(Number(process.env.FIELD_COMBAT_COOLDOWN_MS))
  ? Math.max(0, Number(process.env.FIELD_COMBAT_COOLDOWN_MS))
  : 8000;
const FIELD_COMBAT_CHANCE_PERCENT = Number.isFinite(Number(process.env.FIELD_COMBAT_CHANCE_PERCENT))
  ? Math.max(0, Math.min(100, Number(process.env.FIELD_COMBAT_CHANCE_PERCENT)))
  : 12;
const FIELD_COMBAT_MIN_ENEMIES = 1;
const FIELD_COMBAT_MAX_ENEMIES = 10;

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function averageRange(range: { min: number; max: number }): number {
  const min = Math.max(1, Number(range?.min) || 1);
  const max = Math.max(min, Number(range?.max) || min);
  return (min + max) / 2;
}

function summarizeEncounterPool(pool: Array<Record<string, any>>): { level: number; hp: number; aptitude: number } {
  let totalWeight = 0;
  let totalLevel = 0;
  let totalHp = 0;
  let totalAptitude = 0;

  for (const entry of pool) {
    const weight = Math.max(1, Number(entry?.weight) || 1);
    const levelMin = Math.max(1, Number(entry?.levelMin) || 1);
    const levelMax = Math.max(levelMin, Number(entry?.levelMax) || levelMin);
    const averageLevel = (levelMin + levelMax) / 2;
    const baseHp = Math.max(1, Number(entry?.hpBase) || 80);
    const hpPerLevel = Math.max(0, Number(entry?.hpPerLevel) || 0);
    const averageHp = baseHp + (Math.max(0, averageLevel - levelMin) * hpPerLevel);
    const aptitude = Math.max(0, Number(entry?.aptitude) || 0);

    totalWeight += weight;
    totalLevel += averageLevel * weight;
    totalHp += averageHp * weight;
    totalAptitude += aptitude * weight;
  }

  const safeWeight = Math.max(1, totalWeight);
  return {
    level: Math.max(1, Math.round(totalLevel / safeWeight)),
    hp: Math.max(1, Math.round(totalHp / safeWeight)),
    aptitude: Math.max(0, Math.round(totalAptitude / safeWeight)),
  };
}

function resolveFieldCombatEnemyCount(
  session: GameSession,
  encounterPool: Array<Record<string, any>>
): { enemyCount: number; summary: Record<string, number> } {
  const playerLevel = Math.max(1, Number(session.level) || 1);
  const levelBasedMaxEnemies = clampNumber((Math.floor(playerLevel / 10) + 1) * 3, FIELD_COMBAT_MIN_ENEMIES, FIELD_COMBAT_MAX_ENEMIES);
  const poolSummary = summarizeEncounterPool(encounterPool);
  const averageEnemyLevel = Math.max(1, poolSummary.level);
  const averageEnemyHp = Math.max(1, poolSummary.hp);
  const averageEnemyAptitude = Math.max(0, poolSummary.aptitude);
  const attackRange = resolvePlayerAttackRange(session);
  const magicAttackRange = resolvePlayerMagicAttackRange(session);
  const averagePhysicalDamage = Math.max(
    1,
    Math.round(
      averageRange(attackRange) - resolveEnemyPhysicalMitigation(session, {
        level: averageEnemyLevel,
        aptitude: averageEnemyAptitude,
      })
    )
  );
  const averageMagicDamage = Math.max(
    1,
    Math.round(averageRange(magicAttackRange) - averageEnemyLevel - averageEnemyAptitude)
  );
  // Use the stronger sustained lane so melee and caster builds both scale encounter size sensibly.
  const playerDamagePerRound = Math.max(averagePhysicalDamage, Math.round(averageMagicDamage * 0.85));
  const derived = resolveDerivedPlayerCombatStats(session);
  const defenseMitigation = Math.max(0, Math.floor(Math.max(1, derived.defense || 1) / 120));
  const enemyBaseMin = 18 + (averageEnemyLevel * 4) + (averageEnemyAptitude * 2);
  const enemyBaseMax = Math.max(enemyBaseMin, enemyBaseMin + 8 + Math.floor(averageEnemyLevel / 2));
  const enemyDamagePerRound = Math.max(1, Math.round(((enemyBaseMin + enemyBaseMax) / 2) - defenseMitigation));
  const currentHealth = Math.max(1, Number(session.currentHealth) || 1);
  const maxHealth = Math.max(currentHealth, Number(session.maxHealth) || currentHealth);
  const effectiveHealth = Math.max(1, Math.round((currentHealth * 0.8) + (maxHealth * 0.2)));
  const levelAdvantageFactor = clampNumber(1 + ((playerLevel - averageEnemyLevel) * 0.08), 0.55, 1.75);
  const combatCapacity =
    (effectiveHealth * playerDamagePerRound * levelAdvantageFactor * 0.9) /
    Math.max(1, enemyDamagePerRound * averageEnemyHp);
  // Solve N from: healthBudget >= enemyDamage * turnsToKillSingle * N(N + 1) / 2.
  const enemyCount = clampNumber(
    Math.floor((Math.sqrt(1 + (8 * Math.max(0.5, combatCapacity))) - 1) / 2),
    FIELD_COMBAT_MIN_ENEMIES,
    levelBasedMaxEnemies
  );

  return {
    enemyCount,
    summary: {
      playerLevel,
      levelBasedMaxEnemies,
      averageEnemyLevel,
      averageEnemyHp,
      averageEnemyAptitude,
      averagePhysicalDamage,
      averageMagicDamage,
      playerDamagePerRound,
      enemyDamagePerRound,
      effectiveHealth,
      levelAdvantageFactor,
      combatCapacity,
    },
  };
}

function mapHasFrogTeleporter(mapId: number): boolean {
  const npcs = getMapNpcs(mapId);
  return Array.isArray(npcs?.npcs) && npcs.npcs.some((npc: Record<string, any>) => {
    const name = String(npc?.name || '').trim().toLowerCase();
    return name.includes('frog teleportor') || name.includes('frog teleporter');
  });
}

function shouldEnableFieldCombatForMap(session: GameSession, mapId: number): boolean {
  if (!FIELD_COMBAT_ENABLED) {
    return false;
  }
  if (session.combatState?.active || session.defeatRespawnPending) {
    return false;
  }
  if (mapHasFrogTeleporter(mapId)) {
    return false;
  }
  return true;
}

function maybeTriggerFieldCombat(session: GameSession, mapId: number, x: number, y: number): boolean {
  if (!shouldEnableFieldCombatForMap(session, mapId)) {
    return false;
  }

  const now = Date.now();
  if ((session.fieldCombatCooldownUntil || 0) > now) {
    return false;
  }

  const summary = getMapSummary(mapId);
  const mapName = summary?.mapName || `Map ${mapId}`;
  const encounterLevelRange = getMapEncounterLevelRange(mapId);
  const encounterPool = buildEncounterPoolForLocation(mapName).map((entry: Record<string, any>) => ({
    ...entry,
    levelMin: encounterLevelRange?.min || entry.levelMin || 1,
    levelMax: encounterLevelRange?.max || entry.levelMax || entry.levelMin || 1,
  }));
  if (!Array.isArray(encounterPool) || encounterPool.length === 0) {
    return false;
  }

  const probeKey = `${mapId}:${x}:${y}`;
  if (session.lastFieldCombatProbeKey === probeKey) {
    return false;
  }
  session.lastFieldCombatProbeKey = probeKey;

  if (FIELD_COMBAT_CHANCE_PERCENT <= 0) {
    return false;
  }
  if ((Math.random() * 100) >= FIELD_COMBAT_CHANCE_PERCENT) {
    return false;
  }

  const encounterSizing = resolveFieldCombatEnemyCount(session, encounterPool);
  session.fieldCombatCooldownUntil = now + FIELD_COMBAT_COOLDOWN_MS;
  session.log(
    `Triggering field combat map=${mapId} mapName="${mapName}" pos=${x},${y} chance=${FIELD_COMBAT_CHANCE_PERCENT}% levelRange=${encounterLevelRange ? `${encounterLevelRange.min}-${encounterLevelRange.max}` : 'default'} pool=${encounterPool.map((entry: Record<string, any>) => entry.typeId).join(',')} targetEnemies=${encounterSizing.enemyCount} avgEnemyLevel=${encounterSizing.summary.averageEnemyLevel} avgEnemyHp=${encounterSizing.summary.averageEnemyHp} playerDpr=${encounterSizing.summary.playerDamagePerRound} enemyDpr=${encounterSizing.summary.enemyDamagePerRound} levelFactor=${encounterSizing.summary.levelAdvantageFactor.toFixed(2)} capacity=${encounterSizing.summary.combatCapacity.toFixed(2)}`
  );
  session.sendCombatEncounterProbe({
    probeId: `field:${mapId}:${x}:${y}`,
    encounterProfile: {
      minEnemies: encounterSizing.enemyCount,
      maxEnemies: encounterSizing.enemyCount,
      encounterChancePercent: FIELD_COMBAT_CHANCE_PERCENT,
      cooldownMs: FIELD_COMBAT_COOLDOWN_MS,
      locationName: mapName,
      pool: encounterPool,
    },
  });
  return true;
}

export {
  maybeTriggerFieldCombat,
};
