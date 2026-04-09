import type { GameSession } from '../types.js';

import { normalizePets } from '../gameplay/pet-runtime.js';
import { CHARACTER_VITALS_BASELINE, clampSessionVitalsToMax, recomputeSessionMaxVitals } from '../gameplay/session-flows.js';
import { initializeOnlineTracking, normalizeOnlineState } from '../gameplay/online-runtime.js';
import { normalizeRenownTaskDailyState } from '../gameplay/renown-task-runtime.js';
import { resolveRoleData } from './role-utils.js';
import { defaultFrogTeleporterUnlocks, hydrateFrogTeleporterUnlocks } from '../gameplay/frog-teleporter-service.js';
import { defaultBonusAttributes, numberOrDefault, normalizeBonusAttributes, normalizePrimaryAttributes, normalizeCharacterRecord, normalizeSkillState, } from './normalize.js';
import type { UnknownRecord } from '../utils.js';
import { buildInventorySnapshot, normalizeInventoryState } from '../inventory/index.js';
import {
  normalizeQuestState as normalizeQuestStateV2,
} from '../quest2/index.js';
import { removeWorldPresence } from '../world-state.js';

type CharacterOverrides = Record<string, unknown>;
type PersistedCharacterSelector = {
  slot?: number | null;
  characterId?: string | null;
};
type CharacterStoreHandle = {
  list(accountId: string | null): Promise<Record<string, unknown>[]>;
  get(accountId: string | null, selector?: PersistedCharacterSelector): Promise<Record<string, unknown> | null>;
  set(accountId: string, character: Record<string, unknown>): Promise<void>;
  select(accountId: string, selector?: PersistedCharacterSelector): Promise<Record<string, unknown> | null>;
  delete(accountId: string, selector?: PersistedCharacterSelector): Promise<boolean>;
  existsName(
    roleName: string,
    options?: { excludeCharacterId?: string | null }
  ): Promise<boolean>;
};

function getCharacterStore(session: GameSession): CharacterStoreHandle | null {
  const candidate = session.sharedState?.characterStore;
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  return candidate as CharacterStoreHandle;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function normalizePersistedCharacterList(characters: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return characters
    .map((character) => normalizeCharacterRecord(character))
    .sort((left, right) => numberOrDefault(left.slot, 0) - numberOrDefault(right.slot, 0));
}

function normalizeKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveCharacterId(character: Record<string, unknown> | null | undefined): string {
  return typeof character?.characterId === 'string' ? character.characterId.trim() : '';
}

function resolveCharacterName(character: Record<string, unknown> | null | undefined): string {
  return String(character?.charName || character?.roleName || '').trim().toLowerCase();
}

function resolveCharacterSlot(character: Record<string, unknown> | null | undefined): number | null {
  const slot = Number(character?.slot);
  return Number.isFinite(slot) ? (slot | 0) : null;
}

function samePersistedCharacter(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown> | null | undefined
): boolean {
  const leftCharacterId = resolveCharacterId(left);
  const rightCharacterId = resolveCharacterId(right);
  if (leftCharacterId && rightCharacterId) {
    return leftCharacterId === rightCharacterId;
  }

  const leftSlot = resolveCharacterSlot(left);
  const rightSlot = resolveCharacterSlot(right);
  if (leftSlot !== null && rightSlot !== null) {
    return leftSlot === rightSlot;
  }

  const leftName = resolveCharacterName(left);
  const rightName = resolveCharacterName(right);
  return leftName.length > 0 && leftName === rightName;
}

function getDeletedCharacterIds(sharedState: Record<string, any>): Set<string> {
  if (!(sharedState?.deletedCharacterIds instanceof Set)) {
    sharedState.deletedCharacterIds = new Set<string>();
  }
  return sharedState.deletedCharacterIds as Set<string>;
}

function findLiveSessionsForCharacter(
  session: GameSession,
  targetCharacter: Record<string, unknown>
): GameSession[] {
  const sessionsById =
    session.sharedState?.sessionsById instanceof Map
      ? session.sharedState.sessionsById as Map<number, GameSession>
      : null;
  if (!sessionsById) {
    return [];
  }

  const normalizedAccountName = normalizeKey(session.accountName);
  const matches: GameSession[] = [];
  for (const candidate of sessionsById.values()) {
    if (!candidate || candidate.state !== 'LOGGED_IN' || candidate.isGame !== true) {
      continue;
    }
    if (normalizeKey(candidate.accountName) !== normalizedAccountName) {
      continue;
    }
    const candidateCharacter = candidate.getPersistedCharacter() || { charName: candidate.charName };
    if (!samePersistedCharacter(candidateCharacter, targetCharacter)) {
      continue;
    }
    matches.push(candidate);
  }
  return matches;
}

function disconnectDuplicateLiveCharacterSessions(
  session: GameSession,
  targetCharacter: Record<string, unknown>
): void {
  const duplicates = findLiveSessionsForCharacter(session, targetCharacter)
    .filter((candidate) => (candidate.id >>> 0) !== (session.id >>> 0))
    .sort((left, right) => (right.id >>> 0) - (left.id >>> 0));

  for (const candidate of duplicates) {
    candidate.log(
      `Replacing duplicate live character session with session=${session.id >>> 0}`
    );
    removeWorldPresence(candidate, 'replaced-duplicate-character-session');
    if (!candidate.socket.destroyed) {
      candidate.socket.destroy();
    }
  }
}

function clearPendingDeletedCharacter(
  session: GameSession,
  targetCharacter: Record<string, unknown>
): void {
  const pendingGameCharacters =
    session.sharedState?.pendingGameCharacters instanceof Map
      ? session.sharedState.pendingGameCharacters as Map<string, Record<string, unknown>>
      : null;
  if (!pendingGameCharacters) {
    return;
  }

  const normalizedAccountName = normalizeKey(session.accountName);
  const normalizedAccountKey = normalizeKey(session.accountKey);
  for (const [accountKey, pendingCharacter] of pendingGameCharacters.entries()) {
    const pendingAccountName = normalizeKey(pendingCharacter?.accountName);
    const pendingAccountKey = normalizeKey(pendingCharacter?.accountKey || accountKey);
    if (
      pendingAccountName !== normalizedAccountName &&
      pendingAccountKey !== normalizedAccountKey
    ) {
      continue;
    }
    if (!samePersistedCharacter(pendingCharacter, targetCharacter)) {
      continue;
    }
    pendingGameCharacters.delete(accountKey);
  }
}

export function hydratePendingGameCharacter(session: GameSession, sharedState: Record<string, any>): void {
  const accountKey = typeof session.accountKey === 'string' ? session.accountKey.trim() : '';
  const pendingCharacter =
    accountKey && sharedState?.pendingGameCharacters instanceof Map
      ? sharedState.pendingGameCharacters.get(accountKey) || null
      : null;
  if (!session.isGame || !pendingCharacter) {
    return;
  }

  session.persistedCharacter = normalizeCharacterRecord(pendingCharacter);

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
  const correctedVitals = clampSessionVitalsToMax(session);

  session.questStateV2 = normalizeQuestStateV2(
    pendingCharacter?.questStateV2 && typeof pendingCharacter.questStateV2 === 'object'
      ? pendingCharacter.questStateV2 as Record<string, unknown>
      : {}
  );
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
  session.warehouseItems = inventoryState.inventory.warehouse;
  session.warehouseSize = inventoryState.inventory.warehouseSize;
  session.nextItemInstanceId = inventoryState.inventory.nextItemInstanceId;
  session.nextBagSlot = inventoryState.inventory.nextBagSlot;
  session.nextWarehouseSlot = inventoryState.inventory.nextWarehouseSlot;
  session.warehousePassword =
    typeof pendingCharacter.warehousePassword === 'string' && pendingCharacter.warehousePassword.length > 0
      ? pendingCharacter.warehousePassword
      : '000000';
  session.warehouseUnlocked = false;

  session.currentMapId = numberOrDefault(pendingCharacter.mapId, session.currentMapId);
  session.currentX = numberOrDefault(pendingCharacter.x, session.currentX);
  session.currentY = numberOrDefault(pendingCharacter.y, session.currentY);
  if (Number.isFinite(Number(pendingCharacter.attackMin)) && Number.isFinite(Number(pendingCharacter.attackMax))) {
    session.attackMin = Math.max(1, Number(pendingCharacter.attackMin) | 0);
    session.attackMax = Math.max(session.attackMin, Number(pendingCharacter.attackMax) | 0);
  }
  disconnectDuplicateLiveCharacterSessions(session, pendingCharacter);
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

export async function loadPersistedCharacter(
  session: GameSession,
  options: { forceReload?: boolean } = {}
): Promise<Record<string, unknown> | null> {
  const storageKey = session.accountName;
  const characterStore = getCharacterStore(session);
  if (!storageKey || !characterStore) {
    session.persistedCharacter = null;
    return null;
  }
  if (options.forceReload !== true && session.persistedCharacter && typeof session.persistedCharacter === 'object') {
    return session.persistedCharacter;
  }
  const character = await characterStore.get(storageKey);
  if (!character) {
    session.persistedCharacter = null;
    return null;
  }
  session.persistedCharacter = normalizeCharacterRecord(character);
  return session.persistedCharacter;
}

export async function listPersistedCharacters(
  session: GameSession,
  options: { forceReload?: boolean } = {}
): Promise<Array<Record<string, unknown>>> {
  const storageKey = session.accountName;
  const characterStore = getCharacterStore(session);
  if (!storageKey || !characterStore) {
    return [];
  }

  const characters = await characterStore.list(storageKey);
  const normalizedCharacters = normalizePersistedCharacterList(characters);
  if (options.forceReload === true) {
    const selectedCharacter = normalizedCharacters.find((character) => character.selected === true) || normalizedCharacters[0] || null;
    session.persistedCharacter = selectedCharacter ? cloneJson(selectedCharacter) : null;
  }
  return normalizedCharacters;
}

export async function selectPersistedCharacter(
  session: GameSession,
  selector: PersistedCharacterSelector = {}
): Promise<Record<string, unknown> | null> {
  const storageKey = session.accountName;
  const characterStore = getCharacterStore(session);
  if (!storageKey || !characterStore) {
    session.persistedCharacter = null;
    return null;
  }

  const character = await characterStore.select(storageKey, selector);
  if (!character) {
    return null;
  }
  session.persistedCharacter = normalizeCharacterRecord(character);
  return session.persistedCharacter;
}

export async function deletePersistedCharacter(
  session: GameSession,
  selector: PersistedCharacterSelector = {}
): Promise<boolean> {
  const storageKey = session.accountName;
  const characterStore = getCharacterStore(session);
  if (!storageKey || !characterStore) {
    session.persistedCharacter = null;
    return false;
  }

  const targetCharacter = await characterStore.get(storageKey, selector);
  if (!targetCharacter) {
    return false;
  }

  const normalizedTargetCharacter = normalizeCharacterRecord(targetCharacter);
  const targetCharacterId = resolveCharacterId(normalizedTargetCharacter);
  const liveSessions = findLiveSessionsForCharacter(session, normalizedTargetCharacter);
  if (targetCharacterId) {
    getDeletedCharacterIds(session.sharedState).add(targetCharacterId);
    for (const candidate of liveSessions) {
      candidate.persistenceBlockedCharacterId = targetCharacterId;
    }
  }

  const deleted = await characterStore.delete(storageKey, selector);
  if (!deleted) {
    if (targetCharacterId) {
      getDeletedCharacterIds(session.sharedState).delete(targetCharacterId);
      for (const candidate of liveSessions) {
        if (candidate.persistenceBlockedCharacterId === targetCharacterId) {
          candidate.persistenceBlockedCharacterId = null;
        }
      }
    }
    return false;
  }

  clearPendingDeletedCharacter(session, normalizedTargetCharacter);
  for (const candidate of liveSessions) {
    candidate.log(
      `Disconnecting live session for deleted character "${normalizedTargetCharacter.charName || normalizedTargetCharacter.roleName || 'Hero'}"`
    );
    if (!candidate.socket.destroyed) {
      candidate.socket.destroy();
    }
  }

  const remainingCharacters = await listPersistedCharacters(session, { forceReload: true });
  session.persistedCharacter = remainingCharacters.find((character) => character.selected === true) || remainingCharacters[0] || null;
  return true;
}

export async function persistedCharacterNameExists(
  session: GameSession,
  roleName: string,
  options: { excludeCharacterId?: string | null } = {}
): Promise<boolean> {
  const characterStore = getCharacterStore(session);
  if (!characterStore) {
    return false;
  }
  return characterStore.existsName(roleName, options);
}

export function getPersistedCharacter(session: GameSession): Record<string, unknown> | null {
  return session.persistedCharacter && typeof session.persistedCharacter === 'object'
    ? session.persistedCharacter
    : null;
}

export async function saveCharacter(session: GameSession, character: Record<string, unknown>): Promise<void> {
  const storageKey = session.accountName;
  const characterStore = getCharacterStore(session);
  if (!storageKey || !characterStore) {
    return;
  }

  const normalized = normalizeCharacterRecord(character);
  const characterId = resolveCharacterId(normalized);
  if (
    characterId &&
    session.isGame === true &&
    session.persistenceBlockedCharacterId === characterId
  ) {
    session.log(
      `Skipping persist for deleted live character "${normalized.charName || normalized.roleName || 'Hero'}" characterId="${characterId}"`
    );
    return;
  }
  if (
    characterId &&
    session.isGame === true &&
    getDeletedCharacterIds(session.sharedState).has(characterId)
  ) {
    session.log(
      `Skipping persist for deleted character "${normalized.charName || normalized.roleName || 'Hero'}" characterId="${characterId}"`
    );
    return;
  }
  if (characterId && session.isGame !== true) {
    getDeletedCharacterIds(session.sharedState).delete(characterId);
  }

  session.persistedCharacter = normalized;
  await characterStore.set(storageKey, normalized);
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
    questStateV2: session.questStateV2,
    renownTaskDailyState: session.renownTaskDailyState,
    pets: normalizePets(session.pets),
    selectedPetRuntimeId:
      typeof session.selectedPetRuntimeId === 'number' ? session.selectedPetRuntimeId >>> 0 : null,
    petSummoned: session.petSummoned === true,
    frogTeleporterUnlocks: session.frogTeleporterUnlocks || defaultFrogTeleporterUnlocks(),
    inventory: buildInventorySnapshot(session),
    warehousePassword:
      typeof session.warehousePassword === 'string' && session.warehousePassword.length > 0
        ? session.warehousePassword
        : '000000',
    mapId: session.currentMapId,
    x: session.currentX,
    y: session.currentY,
    ...overrides,
  };
}

export async function persistCurrentCharacter(
  session: GameSession,
  overrides: CharacterOverrides = {}
): Promise<void> {
  await saveCharacter(session, buildCharacterSnapshot(session, overrides));
}

export function ensureQuestStateReady(session: GameSession): void {
  const persisted = session.getPersistedCharacter();
  if (!persisted) {
    return;
  }

  session.questStateV2 = normalizeQuestStateV2(
    persisted?.questStateV2 && typeof persisted.questStateV2 === 'object'
      ? persisted.questStateV2 as UnknownRecord
      : {}
  );
  session.pets = normalizePets(persisted.pets);
  session.selectedPetRuntimeId =
    typeof persisted.selectedPetRuntimeId === 'number'
      ? persisted.selectedPetRuntimeId >>> 0
      : null;
  session.petSummoned = persisted.petSummoned === true;
  const inventoryState = normalizeInventoryState(persisted);
  session.bagItems = inventoryState.inventory.bag;
  session.bagSize = inventoryState.inventory.bagSize;
  session.nextItemInstanceId = inventoryState.inventory.nextItemInstanceId;
  session.nextBagSlot = inventoryState.inventory.nextBagSlot;
}
