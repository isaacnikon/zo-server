import {
  DEFAULT_MAX_VITALS,
  resolveCharacterDerivedMaxVitals,
  resolveCharacterMaxVitals as resolveEffectiveCharacterMaxVitals,
} from './max-vitals.js';
import { getMapDetails, getMapSummary } from '../map-data.js';
import { numberOrDefault, type UnknownRecord } from '../utils.js';
type Vitals = { health: number; mana: number; rage: number; companionHp?: number };
type Position = { mapId: number; x: number; y: number };

export const CHARACTER_VITALS_BASELINE = DEFAULT_MAX_VITALS;

export function resolveCharacterMaxVitals(currentVitals: UnknownRecord | null = null): Vitals {
  return resolveEffectiveCharacterMaxVitals(currentVitals);
}

export function resolveInnRestVitals(currentVitals: UnknownRecord | null | undefined): Vitals {
  const maxVitals = resolveCharacterMaxVitals(currentVitals);
  return {
    health: maxVitals.health,
    mana: maxVitals.mana,
    rage: maxVitals.rage,
  };
}

function isValidPosition(position: UnknownRecord | null | undefined): position is Position {
  return (
    typeof position?.mapId === 'number' &&
    Number.isFinite(position.mapId) &&
    typeof position?.x === 'number' &&
    Number.isFinite(position.x) &&
    typeof position?.y === 'number' &&
    Number.isFinite(position.y)
  );
}

function resolvePersistedTownRespawn(persistedCharacter: UnknownRecord | null | undefined): Position | null {
  const lastTown = {
    mapId: persistedCharacter?.lastTownMapId,
    x: persistedCharacter?.lastTownX,
    y: persistedCharacter?.lastTownY,
  };
  return isValidPosition(lastTown) ? lastTown : null;
}

function isTownCheckpointMap(mapId: number): boolean {
  const summary = getMapSummary(mapId);
  const mapName = typeof summary?.mapName === 'string' ? summary.mapName : '';
  const nodeKind = typeof summary?.worldMap?.nodeKind === 'string' ? summary.worldMap.nodeKind : '';
  if (nodeKind !== 'big' || !mapName) {
    return false;
  }

  return /\b(city|town|manor|state|hamlet|valley|xanadu)\b/i.test(mapName);
}

export function resolveTownCheckpoint({
  persistedCharacter,
  currentMapId,
  currentX,
  currentY,
}: UnknownRecord): Position {
  const currentPosition = {
    mapId: numberOrDefault(currentMapId, 0),
    x: numberOrDefault(currentX, 0),
    y: numberOrDefault(currentY, 0),
  };
  const home = getMapDetails(currentPosition.mapId)?.homeInfo;
  if (isValidPosition(home)) {
    if ((home.mapId >>> 0) === (currentPosition.mapId >>> 0)) {
      return currentPosition;
    }
    return {
      mapId: home.mapId >>> 0,
      x: home.x >>> 0,
      y: home.y >>> 0,
    };
  }
  if (isTownCheckpointMap(currentPosition.mapId)) {
    return currentPosition;
  }
  return resolvePersistedTownRespawn(persistedCharacter) || currentPosition;
}

export function resolveTownRespawn({
  persistedCharacter,
  currentMapId,
  currentX,
  currentY,
}: UnknownRecord): Position {
  return (
    resolvePersistedTownRespawn(persistedCharacter) ||
    resolveTownCheckpoint({ persistedCharacter, currentMapId, currentX, currentY })
  );
}

export function buildDefeatRespawnState({
  persistedCharacter,
  currentMapId,
  currentX,
  currentY,
  player,
  currentMana,
  currentRage,
}: UnknownRecord) {
  const respawn = resolveTownRespawn({
    persistedCharacter,
    currentMapId,
    currentX,
    currentY,
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

export function resolveCurrentPlayerVitals(session: UnknownRecord, player: UnknownRecord | null = null): Vitals {
  return {
    health: ((player?.hp || session.currentHealth) >>> 0) || 0,
    mana: ((player?.mp || session.currentMana) >>> 0) || 0,
    rage: ((player?.rage || session.currentRage) >>> 0) || 0,
  };
}

function defaultBonusAttributes() {
  return {
    intelligence: 0,
    vitality: 0,
    dexterity: 0,
    strength: 0,
  };
}

export function recomputeSessionMaxVitals(session: UnknownRecord, overrides: UnknownRecord | null = null): Vitals {
  const input = {
    roleEntityType: session?.roleEntityType,
    entityType: session?.entityType,
    selectedAptitude: session?.selectedAptitude,
    level: session?.level,
    primaryAttributes: session?.primaryAttributes,
    bonusAttributes: session?.bonusAttributes || defaultBonusAttributes(),
    currentHealth: session?.currentHealth,
    currentMana: session?.currentMana,
    currentRage: session?.currentRage,
    ...(overrides || {}),
  };
  const derivedMaxVitals = resolveCharacterDerivedMaxVitals(input);
  session.derivedMaxHealth = derivedMaxVitals.health;
  session.derivedMaxMana = derivedMaxVitals.mana;
  session.derivedMaxRage = derivedMaxVitals.rage;
  const clientObservedMaxHealth = Number.isInteger(session?.clientObservedMaxHealth)
    ? Math.max(1, session.clientObservedMaxHealth >>> 0)
    : 0;
  const clientObservedMaxMana = Number.isInteger(session?.clientObservedMaxMana)
    ? Math.max(0, session.clientObservedMaxMana >>> 0)
    : 0;
  session.maxHealth = Math.max(derivedMaxVitals.health, clientObservedMaxHealth);
  session.maxMana = Math.max(derivedMaxVitals.mana, clientObservedMaxMana);
  session.maxRage = derivedMaxVitals.rage;
  return {
    health: session.maxHealth,
    mana: session.maxMana,
    rage: session.maxRage,
  };
}

export function clampSessionVitalsToMax(session: UnknownRecord): boolean {
  const clampedHealth = Math.max(0, Math.min(Math.max(0, (session.currentHealth as number) || 0), (session.maxHealth as number) || 0));
  const clampedMana   = Math.max(0, Math.min(Math.max(0, (session.currentMana   as number) || 0), (session.maxMana   as number) || 0));
  const clampedRage   = Math.max(0, Math.min(Math.max(0, (session.currentRage   as number) || 0), (session.maxRage   as number) || 0));
  const changed =
    clampedHealth !== Math.max(0, (session.currentHealth as number) || 0) ||
    clampedMana   !== Math.max(0, (session.currentMana   as number) || 0) ||
    clampedRage   !== Math.max(0, (session.currentRage   as number) || 0);
  session.currentHealth = clampedHealth;
  session.currentMana   = clampedMana;
  session.currentRage   = clampedRage;
  return changed;
}
