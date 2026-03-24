import { DEFAULT_MAX_VITALS, resolveCharacterMaxVitals as resolveDerivedCharacterMaxVitals } from './max-vitals.js';
import { numberOrDefault, type UnknownRecord } from '../utils.js';
type Vitals = { health: number; mana: number; rage: number; companionHp?: number };

export const CHARACTER_VITALS_BASELINE = DEFAULT_MAX_VITALS;

export function resolveCharacterMaxVitals(currentVitals: UnknownRecord | null = null): Vitals {
  return resolveDerivedCharacterMaxVitals(currentVitals);
}

export function resolveInnRestVitals(currentVitals: UnknownRecord | null | undefined): Vitals {
  const maxVitals = resolveCharacterMaxVitals(currentVitals);
  return {
    health: maxVitals.health,
    mana: maxVitals.mana,
    rage: maxVitals.rage,
  };
}

export function buildDefeatRespawnState({
  persistedCharacter,
  currentMapId,
  currentX,
  currentY,
  player,
  currentMana,
  currentRage,
  resolveTownRespawn,
}: UnknownRecord) {
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
    maxHealth: session?.maxHealth,
    maxMana: session?.maxMana,
    maxRage: session?.maxRage,
    ...(overrides || {}),
  };
  const maxVitals = resolveCharacterMaxVitals(input);
  session.maxHealth = maxVitals.health;
  session.maxMana = maxVitals.mana;
  session.maxRage = maxVitals.rage;
  return maxVitals;
}
