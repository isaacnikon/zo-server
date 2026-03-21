import type { GameSession } from '../types';

const { normalizePets } = require('../pet-runtime');
const { CHARACTER_VITALS_BASELINE } = require('../gameplay/session-flows');
const { resolveCharacterMaxVitals } = require('../gameplay/max-vitals');
const {
  defaultBonusAttributes,
  numberOrDefault,
  normalizeBonusAttributes,
  normalizePrimaryAttributes,
  normalizeCharacterRecord,
} = require('./normalize');
const { normalizeQuestState } = require('../quest-engine');
const { buildInventorySnapshot, normalizeInventoryState } = require('../inventory');

type SessionLike = GameSession & Record<string, any>;
type CharacterOverrides = Record<string, unknown>;

export function hydratePendingGameCharacter(session: SessionLike, sharedState: Record<string, any>): void {
  const pendingCharacter = sharedState?.pendingGameCharacter;
  if (!session.isGame || !pendingCharacter) {
    return;
  }

  session.charName = pendingCharacter.charName;
  session.entityType = pendingCharacter.entityType;
  session.roleEntityType = pendingCharacter.roleEntityType || session.entityType;
  session.roleData = pendingCharacter.roleData || 0;
  session.selectedAptitude = numberOrDefault(pendingCharacter.selectedAptitude, 0);
  session.level = numberOrDefault(pendingCharacter.level, 1);
  session.experience = numberOrDefault(pendingCharacter.experience, 0);
  session.currentHealth = numberOrDefault(
    pendingCharacter.currentHealth,
    CHARACTER_VITALS_BASELINE.health
  );
  session.currentMana = numberOrDefault(
    pendingCharacter.currentMana,
    CHARACTER_VITALS_BASELINE.mana
  );
  session.currentRage = numberOrDefault(pendingCharacter.currentRage, 100);
  session.gold = numberOrDefault(pendingCharacter.gold, 0);
  session.bankGold = numberOrDefault(pendingCharacter.bankGold, 0);
  session.boundGold = numberOrDefault(pendingCharacter.boundGold, 0);
  session.coins = numberOrDefault(pendingCharacter.coins, 0);
  session.renown = numberOrDefault(pendingCharacter.renown, 0);
  session.primaryAttributes = normalizePrimaryAttributes(pendingCharacter.primaryAttributes);
  session.bonusAttributes = normalizeBonusAttributes(pendingCharacter.bonusAttributes);
  session.statusPoints = numberOrDefault(pendingCharacter.statusPoints, 0);
  const maxVitals = resolveCharacterMaxVitals({
    roleEntityType: session.roleEntityType,
    entityType: session.entityType,
    selectedAptitude: session.selectedAptitude,
    level: session.level,
    primaryAttributes: session.primaryAttributes,
    bonusAttributes: session.bonusAttributes,
    currentHealth: session.currentHealth,
    currentMana: session.currentMana,
    currentRage: session.currentRage,
    maxHealth: pendingCharacter.maxHealth,
    maxMana: pendingCharacter.maxMana,
    maxRage: pendingCharacter.maxRage,
  });
  session.maxHealth = maxVitals.health;
  session.maxMana = maxVitals.mana;
  session.maxRage = maxVitals.rage;

  const questState = normalizeQuestState(pendingCharacter);
  session.activeQuests = questState.activeQuests;
  session.completedQuests = questState.completedQuests;
  session.pets = normalizePets(pendingCharacter.pets);
  session.selectedPetRuntimeId =
    typeof pendingCharacter.selectedPetRuntimeId === 'number'
      ? pendingCharacter.selectedPetRuntimeId >>> 0
      : null;
  session.petSummoned = pendingCharacter.petSummoned === true;

  const inventoryState = normalizeInventoryState(pendingCharacter);
  session.bagItems = inventoryState.inventory.bag;
  session.bagSize = inventoryState.inventory.bagSize;
  session.nextItemInstanceId = inventoryState.inventory.nextItemInstanceId;
  session.nextBagSlot = inventoryState.inventory.nextBagSlot;

  session.currentMapId = numberOrDefault(pendingCharacter.mapId, session.currentMapId);
  session.currentX = numberOrDefault(pendingCharacter.x, session.currentX);
  session.currentY = numberOrDefault(pendingCharacter.y, session.currentY);
  sharedState.pendingGameCharacter = null;
}

export function getPersistedCharacter(session: SessionLike): Record<string, unknown> | null {
  const character = session.sharedState.characterStore?.get(session.accountName) || null;
  if (!character) {
    return null;
  }
  return normalizeCharacterRecord(character);
}

export function saveCharacter(session: SessionLike, character: Record<string, unknown>): void {
  if (!session.accountName || !session.sharedState.characterStore) {
    return;
  }
  const normalized = normalizeCharacterRecord(character);
  session.sharedState.characterStore.set(session.accountName, normalized);
  session.log(
    `Persisted character "${normalized.charName || normalized.roleName || 'Hero'}" for account "${session.accountName}"`
  );
}

export function buildCharacterSnapshot(
  session: SessionLike,
  overrides: CharacterOverrides = {}
): Record<string, unknown> {
  const persisted = getPersistedCharacter(session) || {};
  return {
    ...persisted,
    roleName: session.charName,
    roleData: session.roleData,
    entityType: session.entityType,
    roleEntityType: session.roleEntityType,
    selectedAptitude: session.selectedAptitude,
    level: session.level,
    experience: session.experience,
    currentHealth: session.currentHealth,
    currentMana: session.currentMana,
    currentRage: session.currentRage,
    maxHealth: session.maxHealth,
    maxMana: session.maxMana,
    maxRage: session.maxRage,
    gold: session.gold,
    bankGold: session.bankGold,
    boundGold: session.boundGold,
    coins: session.coins,
    renown: session.renown,
    primaryAttributes: session.primaryAttributes,
    bonusAttributes: session.bonusAttributes || defaultBonusAttributes(),
    statusPoints: session.statusPoints,
    activeQuests: session.activeQuests,
    completedQuests: session.completedQuests,
    pets: normalizePets(session.pets),
    selectedPetRuntimeId:
      typeof session.selectedPetRuntimeId === 'number' ? session.selectedPetRuntimeId >>> 0 : null,
    petSummoned: session.petSummoned === true,
    inventory: buildInventorySnapshot(session),
    mapId: session.currentMapId,
    x: session.currentX,
    y: session.currentY,
    ...overrides,
  };
}

export function persistCurrentCharacter(
  session: SessionLike,
  overrides: CharacterOverrides = {}
): void {
  saveCharacter(session, buildCharacterSnapshot(session, overrides));
}
