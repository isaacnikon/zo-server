import type { GameSession } from '../types.js';

import { normalizePets } from '../pet-runtime.js';
import { CHARACTER_VITALS_BASELINE, recomputeSessionMaxVitals } from '../gameplay/session-flows.js';
import { initializeOnlineTracking, normalizeOnlineState } from '../gameplay/online-runtime.js';
import { normalizeRenownTaskDailyState } from '../gameplay/renown-task-runtime.js';
import { resolveRoleData } from './role-utils.js';
import { defaultFrogTeleporterUnlocks, hydrateFrogTeleporterUnlocks } from '../gameplay/frog-teleporter-service.js';
import { defaultBonusAttributes, numberOrDefault, normalizeBonusAttributes, normalizePrimaryAttributes, normalizeCharacterRecord, normalizeSkillState, } from './normalize.js';
import { normalizeQuestState } from '../quest-engine/index.js';
import { buildInventorySnapshot, normalizeInventoryState } from '../inventory/index.js';

type CharacterOverrides = Record<string, unknown>;

export function hydratePendingGameCharacter(session: GameSession, sharedState: Record<string, any>): void {
  const accountKey = typeof session.accountKey === 'string' ? session.accountKey.trim() : '';
  const pendingCharacter =
    accountKey && sharedState?.pendingGameCharacters instanceof Map
      ? sharedState.pendingGameCharacters.get(accountKey) || null
      : null;
  if (!session.isGame || !pendingCharacter) {
    return;
  }

  session.accountKey = typeof pendingCharacter.accountKey === 'string' ? pendingCharacter.accountKey : session.accountKey;
  session.charName = pendingCharacter.charName;
  session.runtimeId = numberOrDefault(pendingCharacter.runtimeId, pendingCharacter.entityType);
  session.entityType = pendingCharacter.entityType;
  session.roleEntityType = pendingCharacter.roleEntityType || session.entityType;
  session.roleData = resolveRoleData(pendingCharacter);
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
  session.onlineState = normalizeOnlineState(pendingCharacter.onlineState);
  session.primaryAttributes = normalizePrimaryAttributes(pendingCharacter.primaryAttributes);
  session.bonusAttributes = normalizeBonusAttributes(pendingCharacter.bonusAttributes);
  session.skillState = normalizeSkillState(pendingCharacter.skillState);
  session.statusPoints = numberOrDefault(pendingCharacter.statusPoints, 0);
  session.clientObservedMaxHealth = null;
  session.clientObservedMaxMana = null;
  recomputeSessionMaxVitals(session, {
    currentHealth: session.currentHealth,
    currentMana: session.currentMana,
    currentRage: session.currentRage,
  });
  const clampedHealth = Math.max(0, Math.min(session.currentHealth, session.maxHealth));
  const clampedMana = Math.max(0, Math.min(session.currentMana, session.maxMana));
  const clampedRage = Math.max(0, Math.min(session.currentRage, session.maxRage));
  const correctedVitals =
    clampedHealth !== session.currentHealth ||
    clampedMana !== session.currentMana ||
    clampedRage !== session.currentRage;
  session.currentHealth = clampedHealth;
  session.currentMana = clampedMana;
  session.currentRage = clampedRage;

  const questState = normalizeQuestState(pendingCharacter);
  session.activeQuests = questState.activeQuests;
  session.completedQuests = questState.completedQuests;
  session.renownTaskDailyState = normalizeRenownTaskDailyState(pendingCharacter.renownTaskDailyState);
  session.pets = normalizePets(pendingCharacter.pets);
  session.selectedPetRuntimeId =
    typeof pendingCharacter.selectedPetRuntimeId === 'number'
      ? pendingCharacter.selectedPetRuntimeId >>> 0
      : null;
  session.petSummoned = pendingCharacter.petSummoned === true;
  hydrateFrogTeleporterUnlocks(
    session,
    pendingCharacter.frogTeleporterUnlocks || defaultFrogTeleporterUnlocks()
  );

  const inventoryState = normalizeInventoryState(pendingCharacter);
  session.bagItems = inventoryState.inventory.bag;
  session.bagSize = inventoryState.inventory.bagSize;
  session.nextItemInstanceId = inventoryState.inventory.nextItemInstanceId;
  session.nextBagSlot = inventoryState.inventory.nextBagSlot;

  session.currentMapId = numberOrDefault(pendingCharacter.mapId, session.currentMapId);
  session.currentX = numberOrDefault(pendingCharacter.x, session.currentX);
  session.currentY = numberOrDefault(pendingCharacter.y, session.currentY);
  if (Number.isFinite(Number(pendingCharacter.attackMin)) && Number.isFinite(Number(pendingCharacter.attackMax))) {
    session.attackMin = Math.max(1, Number(pendingCharacter.attackMin) | 0);
    session.attackMax = Math.max(session.attackMin, Number(pendingCharacter.attackMax) | 0);
  }
  if (accountKey && sharedState?.pendingGameCharacters instanceof Map) {
    sharedState.pendingGameCharacters.delete(accountKey);
  }
  initializeOnlineTracking(session);
  if (correctedVitals) {
    session.persistCurrentCharacter({
      currentHealth: session.currentHealth,
      currentMana: session.currentMana,
      currentRage: session.currentRage,
      maxHealth: session.derivedMaxHealth || session.maxHealth,
      maxMana: session.derivedMaxMana || session.maxMana,
      maxRage: session.derivedMaxRage || session.maxRage,
    });
    session.log(
      `Clamped persisted vitals on login hp=${session.currentHealth}/${session.maxHealth} mp=${session.currentMana}/${session.maxMana}`
    );
  }
}

export function getPersistedCharacter(session: GameSession): Record<string, unknown> | null {
  const storageKey = session.accountName;
  const character = session.sharedState.characterStore?.get(storageKey) || null;
  if (!character) {
    return null;
  }
  return normalizeCharacterRecord(character);
}

export function saveCharacter(session: GameSession, character: Record<string, unknown>): void {
  const storageKey = session.accountName;
  if (!storageKey || !session.sharedState.characterStore) {
    return;
  }
  const normalized = normalizeCharacterRecord(character);
  session.sharedState.characterStore.set(storageKey, normalized);
  session.log(
    `Persisted character "${normalized.charName || normalized.roleName || 'Hero'}" for account "${session.accountName}" key="${storageKey}"`
  );
}

export function buildCharacterSnapshot(
  session: GameSession,
  overrides: CharacterOverrides = {}
): Record<string, unknown> {
  const persisted = getPersistedCharacter(session) || {};
  return {
    ...persisted,
    roleName: session.charName,
    roleData: session.roleData,
    runtimeId: session.runtimeId,
    entityType: session.entityType,
    roleEntityType: session.roleEntityType,
    selectedAptitude: session.selectedAptitude,
    level: session.level,
    experience: session.experience,
    currentHealth: session.currentHealth,
    currentMana: session.currentMana,
    currentRage: session.currentRage,
    maxHealth: session.derivedMaxHealth || session.maxHealth,
    maxMana: session.derivedMaxMana || session.maxMana,
    maxRage: session.derivedMaxRage || session.maxRage,
    gold: session.gold,
    bankGold: session.bankGold,
    boundGold: session.boundGold,
    coins: session.coins,
    renown: session.renown,
    onlineState: session.onlineState,
    primaryAttributes: session.primaryAttributes,
    bonusAttributes: session.bonusAttributes || defaultBonusAttributes(),
    skillState: session.skillState,
    statusPoints: session.statusPoints,
    activeQuests: session.activeQuests,
    completedQuests: session.completedQuests,
    renownTaskDailyState: session.renownTaskDailyState,
    pets: normalizePets(session.pets),
    selectedPetRuntimeId:
      typeof session.selectedPetRuntimeId === 'number' ? session.selectedPetRuntimeId >>> 0 : null,
    petSummoned: session.petSummoned === true,
    frogTeleporterUnlocks: session.frogTeleporterUnlocks || defaultFrogTeleporterUnlocks(),
    inventory: buildInventorySnapshot(session),
    mapId: session.currentMapId,
    x: session.currentX,
    y: session.currentY,
    ...overrides,
  };
}

export function persistCurrentCharacter(
  session: GameSession,
  overrides: CharacterOverrides = {}
): void {
  saveCharacter(session, buildCharacterSnapshot(session, overrides));
}
