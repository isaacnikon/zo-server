import type { GameSession } from '../types.js';

import { buildEncounterPoolForLocation } from '../roleinfo/index.js';
import { getMapEncounterLevelRange, getMapNpcs, getMapSummary } from '../map-data.js';


const FIELD_COMBAT_ENABLED = process.env.FIELD_COMBAT_ENABLED !== '0';
const FIELD_COMBAT_COOLDOWN_MS = Number.isFinite(Number(process.env.FIELD_COMBAT_COOLDOWN_MS))
  ? Math.max(0, Number(process.env.FIELD_COMBAT_COOLDOWN_MS))
  : 8000;
const FIELD_COMBAT_CHANCE_PERCENT = Number.isFinite(Number(process.env.FIELD_COMBAT_CHANCE_PERCENT))
  ? Math.max(0, Math.min(100, Number(process.env.FIELD_COMBAT_CHANCE_PERCENT)))
  : 12;

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

  session.fieldCombatCooldownUntil = now + FIELD_COMBAT_COOLDOWN_MS;
  session.log(
    `Triggering field combat map=${mapId} mapName="${mapName}" pos=${x},${y} chance=${FIELD_COMBAT_CHANCE_PERCENT}% levelRange=${encounterLevelRange ? `${encounterLevelRange.min}-${encounterLevelRange.max}` : 'default'} pool=${encounterPool.map((entry: Record<string, any>) => entry.typeId).join(',')}`
  );
  session.sendCombatEncounterProbe({
    probeId: `field:${mapId}:${x}:${y}`,
    encounterProfile: {
      minEnemies: 1,
      maxEnemies: 2,
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
