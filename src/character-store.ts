import * as fs from 'fs';
import * as path from 'path';

type CharacterRecord = Record<string, unknown>;

class CharacterStore {
  legacyFilePath: string;
  storeRoot: string;
  accountsRoot: string;
  charactersRoot: string;
  legacyData: Record<string, CharacterRecord>;
  cache: Map<string, CharacterRecord>;

  constructor(filePath: string) {
    this.legacyFilePath = path.resolve(filePath);
    this.storeRoot = path.resolve(path.dirname(this.legacyFilePath), 'data', 'save');
    this.accountsRoot = path.join(this.storeRoot, 'accounts');
    this.charactersRoot = path.join(this.storeRoot, 'characters');
    this.legacyData = this.loadLegacy();
    this.cache = new Map();
  }

  loadLegacy(): Record<string, CharacterRecord> {
    try {
      const raw = fs.readFileSync(this.legacyFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return {};
      }
      throw err;
    }
  }

  get(accountId: string | null): CharacterRecord | null {
    if (!accountId) {
      return null;
    }

    if (this.cache.has(accountId)) {
      return cloneJson(this.cache.get(accountId)!);
    }

    const accountRecord = this.readJsonFile(this.getAccountFilePath(accountId)) as any;
    if (accountRecord?.characterId) {
      const character = this.loadSplitCharacter(accountId, accountRecord.characterId);
      if (character) {
        this.cache.set(accountId, character);
        return cloneJson(character);
      }
    }

    const legacyCharacter = this.legacyData[accountId] || null;
    if (legacyCharacter) {
      this.cache.set(accountId, legacyCharacter);
      return cloneJson(legacyCharacter);
    }

    return null;
  }

  set(accountId: string, character: CharacterRecord): void {
    if (!accountId || !character || typeof character !== 'object') {
      return;
    }

    const normalizedCharacter = cloneJson(character);
    const characterId = resolveCharacterId(accountId, normalizedCharacter);

    this.ensureDirectories(characterId);
    this.writeJsonFile(this.getAccountFilePath(accountId), {
      accountId,
      characterId,
      name: (normalizedCharacter as any).charName || (normalizedCharacter as any).name || 'Hero',
      updatedAt: new Date().toISOString(),
    });

    this.writeJsonFile(this.getCharacterFilePath(characterId, 'profile.json'), buildProfileDocument(accountId, characterId, normalizedCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'vitals.json'), buildVitalsDocument(characterId, normalizedCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'attributes.json'), buildAttributesDocument(characterId, normalizedCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'active-quests.json'), buildActiveQuestsDocument(characterId, normalizedCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'completed-quests.json'), buildCompletedQuestsDocument(characterId, normalizedCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'pets.json'), buildPetsDocument(characterId, normalizedCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'inventory-items.json'), buildInventoryItemsDocument(characterId, normalizedCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'inventory-state.json'), buildInventoryStateDocument(characterId, normalizedCharacter));

    this.cache.set(accountId, normalizedCharacter);
  }

  loadSplitCharacter(accountId: string, characterId: string): CharacterRecord | null {
    const profile = this.readJsonFile(this.getCharacterFilePath(characterId, 'profile.json')) as any;
    if (!profile) {
      return null;
    }

    const vitals = (this.readJsonFile(this.getCharacterFilePath(characterId, 'vitals.json')) || {}) as any;
    const attributes = (this.readJsonFile(this.getCharacterFilePath(characterId, 'attributes.json')) || {}) as any;
    const activeQuests = (this.readJsonFile(this.getCharacterFilePath(characterId, 'active-quests.json')) || {}) as any;
    const completedQuests = (this.readJsonFile(this.getCharacterFilePath(characterId, 'completed-quests.json')) || {}) as any;
    const pets = (this.readJsonFile(this.getCharacterFilePath(characterId, 'pets.json')) || {}) as any;
    const inventoryItems = (this.readJsonFile(this.getCharacterFilePath(characterId, 'inventory-items.json')) || {}) as any;
    const inventoryState = (this.readJsonFile(this.getCharacterFilePath(characterId, 'inventory-state.json')) || {}) as any;

    return {
      accountId,
      charName: profile.charName || profile.name || 'Hero',
      entityType: profile.entityType,
      roleEntityType: profile.roleEntityType,
      roleData: profile.roleData,
      selectedAptitude: profile.selectedAptitude,
      level: profile.level,
      experience: profile.experience,
      currentHealth: vitals.currentHealth,
      currentMana: vitals.currentMana,
      currentRage: vitals.currentRage,
      maxHealth: vitals.maxHealth,
      maxMana: vitals.maxMana,
      maxRage: vitals.maxRage,
      gold: profile.gold,
      bankGold: profile.bankGold,
      boundGold: profile.boundGold,
      coins: profile.coins,
      renown: profile.renown,
      statusPoints: profile.statusPoints,
      selectedPetRuntimeId: profile.selectedPetRuntimeId,
      petSummoned: profile.petSummoned,
      mapId: profile.mapId,
      x: profile.x,
      y: profile.y,
      lastTownMapId: profile.lastTownMapId,
      lastTownX: profile.lastTownX,
      lastTownY: profile.lastTownY,
      primaryAttributes: {
        intelligence: attributes.intelligence,
        vitality: attributes.vitality,
        dexterity: attributes.dexterity,
        strength: attributes.strength,
      },
      bonusAttributes: {
        intelligence: numberOrDefault(attributes?.bonusAttributes?.intelligence, 0),
        vitality: numberOrDefault(attributes?.bonusAttributes?.vitality, 0),
        dexterity: numberOrDefault(attributes?.bonusAttributes?.dexterity, 0),
        strength: numberOrDefault(attributes?.bonusAttributes?.strength, 0),
      },
      activeQuests: Array.isArray(activeQuests.quests) ? activeQuests.quests : [],
      completedQuests: Array.isArray(completedQuests.taskIds) ? completedQuests.taskIds : [],
      pets: Array.isArray(pets.pets) ? pets.pets : [],
      inventory: {
        bag: Array.isArray(inventoryItems.items) ? inventoryItems.items : [],
        bagSize: inventoryState.bagSize,
        nextItemInstanceId: inventoryState.nextItemInstanceId,
        nextBagSlot: inventoryState.nextBagSlot,
      },
    };
  }

  ensureDirectories(characterId: string): void {
    fs.mkdirSync(this.accountsRoot, { recursive: true });
    fs.mkdirSync(path.join(this.charactersRoot, characterId), { recursive: true });
  }

  getAccountFilePath(accountId: string): string {
    return path.join(this.accountsRoot, `${sanitizePathSegment(accountId)}.json`);
  }

  getCharacterFilePath(characterId: string, fileName: string): string {
    return path.join(this.charactersRoot, sanitizePathSegment(characterId), fileName);
  }

  readJsonFile(filePath: string): unknown {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  writeJsonFile(filePath: string, value: unknown): void {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

function buildProfileDocument(accountId: string, characterId: string, character: any): Record<string, unknown> {
  return {
    accountId,
    characterId,
    charName: character.charName || character.name || 'Hero',
    entityType: numberOrDefault(character.entityType, 0),
    roleEntityType: numberOrDefault(character.roleEntityType, numberOrDefault(character.entityType, 0)),
    roleData: numberOrDefault(character.roleData, 0),
    selectedAptitude: numberOrDefault(character.selectedAptitude, 0),
    level: numberOrDefault(character.level, 1),
    experience: numberOrDefault(character.experience, 0),
    gold: numberOrDefault(character.gold, 0),
    bankGold: numberOrDefault(character.bankGold, 0),
    boundGold: numberOrDefault(character.boundGold, 0),
    coins: numberOrDefault(character.coins, 0),
    renown: numberOrDefault(character.renown, 0),
    statusPoints: numberOrDefault(character.statusPoints, 0),
    selectedPetRuntimeId: numberOrNull(character.selectedPetRuntimeId),
    petSummoned: character.petSummoned === true,
    mapId: numberOrDefault(character.mapId, 0),
    x: numberOrDefault(character.x, 0),
    y: numberOrDefault(character.y, 0),
    lastTownMapId: numberOrNull(character.lastTownMapId),
    lastTownX: numberOrNull(character.lastTownX),
    lastTownY: numberOrNull(character.lastTownY),
    updatedAt: new Date().toISOString(),
  };
}

function buildVitalsDocument(characterId: string, character: any): Record<string, unknown> {
  return {
    characterId,
    currentHealth: numberOrDefault(character.currentHealth, 0),
    currentMana: numberOrDefault(character.currentMana, 0),
    currentRage: numberOrDefault(character.currentRage, 0),
    maxHealth: numberOrDefault(character.maxHealth, 0),
    maxMana: numberOrDefault(character.maxMana, 0),
    maxRage: numberOrDefault(character.maxRage, 0),
    updatedAt: new Date().toISOString(),
  };
}

function buildAttributesDocument(characterId: string, character: any): Record<string, unknown> {
  return {
    characterId,
    intelligence: numberOrDefault(character?.primaryAttributes?.intelligence, 15),
    vitality: numberOrDefault(character?.primaryAttributes?.vitality, 15),
    dexterity: numberOrDefault(character?.primaryAttributes?.dexterity, 15),
    strength: numberOrDefault(character?.primaryAttributes?.strength, 15),
    bonusAttributes: {
      intelligence: numberOrDefault(character?.bonusAttributes?.intelligence, 0),
      vitality: numberOrDefault(character?.bonusAttributes?.vitality, 0),
      dexterity: numberOrDefault(character?.bonusAttributes?.dexterity, 0),
      strength: numberOrDefault(character?.bonusAttributes?.strength, 0),
    },
    updatedAt: new Date().toISOString(),
  };
}

function buildActiveQuestsDocument(characterId: string, character: any): Record<string, unknown> {
  return {
    characterId,
    quests: Array.isArray(character.activeQuests)
      ? character.activeQuests.map((quest: any) => ({
          id: numberOrDefault(quest.id, 0),
          stepIndex: numberOrDefault(quest.stepIndex, 0),
          status: numberOrDefault(quest.status, 0),
          progress: quest?.progress && typeof quest.progress === 'object' ? cloneJson(quest.progress) : {},
          acceptedAt: numberOrDefault(quest.acceptedAt, Date.now()),
        }))
      : [],
    updatedAt: new Date().toISOString(),
  };
}

function buildCompletedQuestsDocument(characterId: string, character: any): Record<string, unknown> {
  return {
    characterId,
    taskIds: Array.isArray(character.completedQuests)
      ? character.completedQuests.filter(Number.isInteger).map((taskId: number) => taskId >>> 0)
      : [],
    updatedAt: new Date().toISOString(),
  };
}

function buildInventoryItemsDocument(characterId: string, character: any): Record<string, unknown> {
  return {
    characterId,
    items: Array.isArray(character?.inventory?.bag)
        ? character.inventory.bag.map((item: any) => ({
          instanceId: numberOrDefault(item.instanceId, 0),
          templateId: numberOrDefault(item.templateId, 0),
          quantity: numberOrDefault(item.quantity, 1),
          ...(Number.isInteger(item?.durability) ? { durability: item.durability } : {}),
          ...(Number.isInteger(item?.tradeState) ? { tradeState: item.tradeState | 0 } : {}),
          ...(Number.isInteger(item?.bindState) ? { bindState: item.bindState & 0xff } : {}),
          ...(Number.isInteger(item?.stateCode) ? { stateCode: item.stateCode & 0xff } : {}),
          ...(Number.isInteger(item?.extraValue) ? { extraValue: item.extraValue & 0xffff } : {}),
          ...(Array.isArray(item?.attributePairs) && item.attributePairs.length > 0
            ? {
                attributePairs: item.attributePairs
                  .map((pair: any) => ({
                    value: Number.isInteger(pair?.value) ? (pair.value & 0xffff) : 0,
                  }))
                  .filter((pair: any) => pair.value !== 0),
              }
            : {}),
          equipped: item.equipped === true,
          slot: numberOrDefault(item.slot, 0),
        }))
      : [],
    updatedAt: new Date().toISOString(),
  };
}

function buildPetsDocument(characterId: string, character: any): Record<string, unknown> {
  return {
    characterId,
    pets: Array.isArray(character.pets)
      ? character.pets
          .filter((pet: any) => pet && typeof pet === 'object')
          .map((pet: any) => ({
            templateId: numberOrDefault(pet.templateId, 0),
            awardedAt: numberOrDefault(pet.awardedAt, Date.now()),
            runtimeId: numberOrDefault(pet.runtimeId, 0),
            name: typeof pet.name === 'string' ? pet.name : '',
            level: numberOrDefault(pet.level, 1),
            generation: numberOrDefault(pet.generation, 0),
            currentHealth: numberOrDefault(pet.currentHealth, 100),
            currentMana: numberOrDefault(pet.currentMana, 60),
            loyalty: numberOrDefault(pet.loyalty, 100),
            statPoints: numberOrDefault(pet.statPoints, 0),
            stateFlags: pet?.stateFlags && typeof pet.stateFlags === 'object'
              ? {
                  modeA: numberOrDefault(pet.stateFlags.modeA, 0),
                  modeB: numberOrDefault(pet.stateFlags.modeB, 0),
                  activeFlag: numberOrDefault(pet.stateFlags.activeFlag, 1),
                }
              : {
                  modeA: 0,
                  modeB: 0,
                  activeFlag: 1,
                },
            stats: pet?.stats && typeof pet.stats === 'object'
              ? {
                  strength: numberOrDefault(pet.stats.strength, 10),
                  dexterity: numberOrDefault(pet.stats.dexterity, 10),
                  vitality: numberOrDefault(pet.stats.vitality, 10),
                  intelligence: numberOrDefault(pet.stats.intelligence, 10),
                }
              : {
                  strength: 10,
                  dexterity: 10,
                  vitality: 10,
                  intelligence: 10,
                },
          }))
      : [],
    updatedAt: new Date().toISOString(),
  };
}

function buildInventoryStateDocument(characterId: string, character: any): Record<string, unknown> {
  return {
    characterId,
    bagSize: numberOrDefault(character?.inventory?.bagSize, 24),
    nextItemInstanceId: numberOrDefault(character?.inventory?.nextItemInstanceId, 1),
    nextBagSlot: numberOrDefault(character?.inventory?.nextBagSlot, 0),
    updatedAt: new Date().toISOString(),
  };
}

function resolveCharacterId(accountId: string, character: any): string {
  const baseName = typeof character?.charName === 'string' && character.charName.length > 0
    ? character.charName
    : accountId;
  return sanitizePathSegment(baseName);
}

function sanitizePathSegment(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  CharacterStore,
};
