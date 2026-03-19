'use strict';
export {};

const { MAP_ID, SPAWN_X, SPAWN_Y } = require('../config');
const { isTownScene } = require('../scene-runtime');
const { normalizeQuestState } = require('../quest-engine');
const { normalizeInventoryState } = require('../inventory');
const { normalizePets } = require('../pet-runtime');
const { CHARACTER_VITALS_BASELINE } = require('../gameplay/session-flows');
const { resolveCharacterMaxVitals } = require('../gameplay/max-vitals');
type UnknownRecord = Record<string, any>;
type PrimaryAttributes = {
  intelligence: number;
  vitality: number;
  dexterity: number;
  strength: number;
};

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function defaultPrimaryAttributes(): PrimaryAttributes {
  return {
    intelligence: 15,
    vitality: 15,
    dexterity: 15,
    strength: 15,
  };
}

function defaultBonusAttributes(): PrimaryAttributes {
  return {
    intelligence: 0,
    vitality: 0,
    dexterity: 0,
    strength: 0,
  };
}

function normalizePrimaryAttributes(primaryAttributes: UnknownRecord | null | undefined): PrimaryAttributes {
  const defaults = defaultPrimaryAttributes();
  return {
    intelligence:
      typeof primaryAttributes?.intelligence === 'number'
        ? primaryAttributes.intelligence
        : (typeof primaryAttributes?.ene === 'number' ? primaryAttributes.ene : defaults.intelligence),
    vitality:
      typeof primaryAttributes?.vitality === 'number'
        ? primaryAttributes.vitality
        : (typeof primaryAttributes?.con === 'number' ? primaryAttributes.con : defaults.vitality),
    dexterity:
      typeof primaryAttributes?.dexterity === 'number'
        ? primaryAttributes.dexterity
        : (typeof primaryAttributes?.dex === 'number' ? primaryAttributes.dex : defaults.dexterity),
    strength:
      typeof primaryAttributes?.strength === 'number'
        ? primaryAttributes.strength
        : (typeof primaryAttributes?.str === 'number' ? primaryAttributes.str : defaults.strength),
  };
}

function normalizeBonusAttributes(primaryAttributes: UnknownRecord | null | undefined): PrimaryAttributes {
  const defaults = defaultBonusAttributes();
  return {
    intelligence:
      typeof primaryAttributes?.intelligence === 'number'
        ? primaryAttributes.intelligence
        : (typeof primaryAttributes?.ene === 'number' ? primaryAttributes.ene : defaults.intelligence),
    vitality:
      typeof primaryAttributes?.vitality === 'number'
        ? primaryAttributes.vitality
        : (typeof primaryAttributes?.con === 'number' ? primaryAttributes.con : defaults.vitality),
    dexterity:
      typeof primaryAttributes?.dexterity === 'number'
        ? primaryAttributes.dexterity
        : (typeof primaryAttributes?.dex === 'number' ? primaryAttributes.dex : defaults.dexterity),
    strength:
      typeof primaryAttributes?.strength === 'number'
        ? primaryAttributes.strength
        : (typeof primaryAttributes?.str === 'number' ? primaryAttributes.str : defaults.strength),
  };
}

function normalizeCharacterRecord(character: UnknownRecord): UnknownRecord {
  const mapId = numberOrDefault(character.mapId, MAP_ID);
  const x = numberOrDefault(character.x, SPAWN_X);
  const y = numberOrDefault(character.y, SPAWN_Y);
  const lastTownMapId =
    typeof character.lastTownMapId === 'number'
      ? character.lastTownMapId
      : (isTownScene(mapId) ? mapId : undefined);
  const lastTownX =
    typeof character.lastTownX === 'number'
      ? character.lastTownX
      : (isTownScene(mapId) ? x : undefined);
  const lastTownY =
    typeof character.lastTownY === 'number'
      ? character.lastTownY
      : (isTownScene(mapId) ? y : undefined);
  const questState = normalizeQuestState(character);
  const inventoryState = normalizeInventoryState(character);
  const bonusAttributes = normalizeBonusAttributes(character.bonusAttributes);
  const maxVitals = resolveCharacterMaxVitals({
    selectedAptitude: numberOrDefault(character.selectedAptitude, 0),
    level: numberOrDefault(character.level, 1),
    primaryAttributes: normalizePrimaryAttributes(character.primaryAttributes),
    bonusAttributes,
    currentHealth: numberOrDefault(character.currentHealth, CHARACTER_VITALS_BASELINE.health),
    currentMana: numberOrDefault(character.currentMana, CHARACTER_VITALS_BASELINE.mana),
    currentRage: numberOrDefault(character.currentRage, 100),
    maxHealth: numberOrDefault(character.maxHealth, 0),
    maxMana: numberOrDefault(character.maxMana, 0),
    maxRage: numberOrDefault(character.maxRage, 0),
  });
  return {
    ...character,
    charName: character.charName || character.roleName || 'Hero',
    roleName: character.roleName || character.charName || 'Hero',
    mapId,
    x,
    y,
    level: numberOrDefault(character.level, 1),
    selectedAptitude: numberOrDefault(character.selectedAptitude, 0),
    experience: numberOrDefault(character.experience, 0),
    currentHealth: numberOrDefault(character.currentHealth, CHARACTER_VITALS_BASELINE.health),
    currentMana: numberOrDefault(character.currentMana, CHARACTER_VITALS_BASELINE.mana),
    currentRage: numberOrDefault(character.currentRage, 100),
    maxHealth: maxVitals.health,
    maxMana: maxVitals.mana,
    maxRage: maxVitals.rage,
    gold: numberOrDefault(character.gold, 0),
    bankGold: numberOrDefault(character.bankGold, 0),
    boundGold: numberOrDefault(character.boundGold, 0),
    coins: numberOrDefault(character.coins, 0),
    renown: numberOrDefault(character.renown, 0),
    statusPoints: numberOrDefault(character.statusPoints, 0),
    lastTownMapId,
    lastTownX,
    lastTownY,
    primaryAttributes: normalizePrimaryAttributes(character.primaryAttributes),
    bonusAttributes,
    activeQuests: questState.activeQuests,
    completedQuests: questState.completedQuests,
    pets: normalizePets(character.pets),
    selectedPetRuntimeId:
      typeof character.selectedPetRuntimeId === 'number'
        ? (character.selectedPetRuntimeId >>> 0)
        : null,
    petSummoned: character.petSummoned === true,
    inventory: inventoryState.inventory,
  };
}

module.exports = {
  numberOrDefault,
  defaultBonusAttributes,
  defaultPrimaryAttributes,
  normalizeBonusAttributes,
  normalizePrimaryAttributes,
  normalizeCharacterRecord,
};
