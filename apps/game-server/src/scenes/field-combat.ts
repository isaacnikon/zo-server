import type { GameSession } from '../types.js';

import { COMBAT_ENABLED } from '../config.js';
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
const FIELD_COMBAT_MAX_ENEMIES = 5;
const FIELD_COMBAT_DISABLED_MAP_IDS = new Set<number>([
  207, // Cloud Hall
  209, // Peach Garden
]);

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
  if (FIELD_COMBAT_DISABLED_MAP_IDS.has(mapId >>> 0)) {
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

  const encounterSummary = summarizeEncounterPool(encounterPool);
  session.fieldCombatCooldownUntil = now + FIELD_COMBAT_COOLDOWN_MS;
  session.log(
    `Triggering field combat map=${mapId} mapName="${mapName}" pos=${x},${y} chance=${FIELD_COMBAT_CHANCE_PERCENT}% levelRange=${encounterLevelRange ? `${encounterLevelRange.min}-${encounterLevelRange.max}` : 'default'} pool=${encounterPool.map((entry: Record<string, any>) => entry.typeId).join(',')} enemyRange=${FIELD_COMBAT_MIN_ENEMIES}-${FIELD_COMBAT_MAX_ENEMIES} avgEnemyLevel=${encounterSummary.level} avgEnemyHp=${encounterSummary.hp} avgEnemyAptitude=${encounterSummary.aptitude}`
  );
  session.sendCombatEncounterProbe({
    probeId: `field:${mapId}:${x}:${y}`,
    encounterProfile: {
      minEnemies: FIELD_COMBAT_MIN_ENEMIES,
      maxEnemies: FIELD_COMBAT_MAX_ENEMIES,
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
