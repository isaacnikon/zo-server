import * as fs from 'node:fs';
import * as path from 'node:path';
import { numberOrDefault } from '../utils.js';

type CharacterRecord = Record<string, unknown>;
type CharacterSelector = {
  slot?: number | null;
  characterId?: string | null;
};
type AccountSlotRecord = {
  slot: number;
  characterId: string;
  name: string;
  updatedAt: string;
};
type AccountRecord = {
  accountId: string;
  selectedCharacterId?: string | null;
  slots?: AccountSlotRecord[];
  characterId?: string;
  name?: string;
  updatedAt?: string;
};

export class CharacterStore {
  legacyFilePath: string;
  storeRoot: string;
  accountsRoot: string;
  charactersRoot: string;
  legacyData: Record<string, CharacterRecord>;
  cache: Map<string, CharacterRecord[]>;

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

  async list(accountId: string | null): Promise<CharacterRecord[]> {
    if (!accountId) {
      return [];
    }

    if (this.cache.has(accountId)) {
      return cloneJson(this.cache.get(accountId)!);
    }

    const accountRecord = this.readJsonFile(this.getAccountFilePath(accountId)) as AccountRecord | null;
    const selectedCharacterId =
      typeof accountRecord?.selectedCharacterId === 'string' && accountRecord.selectedCharacterId.length > 0
        ? accountRecord.selectedCharacterId
        : (typeof accountRecord?.characterId === 'string' && accountRecord.characterId.length > 0
          ? accountRecord.characterId
          : null);
    const records: CharacterRecord[] = [];

    if (Array.isArray(accountRecord?.slots)) {
      for (const slotRecord of accountRecord.slots) {
        if (!slotRecord || typeof slotRecord.characterId !== 'string' || slotRecord.characterId.length < 1) {
          continue;
        }
        const character = this.loadSplitCharacter(accountId, slotRecord.characterId, numberOrDefault(slotRecord.slot, 0));
        if (character) {
          records.push({
            ...character,
            selected: selectedCharacterId === slotRecord.characterId,
          });
        }
      }
    } else if (typeof accountRecord?.characterId === 'string' && accountRecord.characterId.length > 0) {
      const character = this.loadSplitCharacter(accountId, accountRecord.characterId, 0);
      if (character) {
        records.push({
          ...character,
          selected: selectedCharacterId === accountRecord.characterId || selectedCharacterId === null,
        });
      }
    }

    if (records.length < 1) {
      const legacyCharacter = this.legacyData[accountId] || null;
      if (legacyCharacter) {
        records.push({
          ...cloneJson(legacyCharacter),
          characterId: resolveCharacterId(accountId, legacyCharacter),
          slot: numberOrDefault((legacyCharacter as CharacterRecord).slot, 0),
          selected: true,
        });
      }
    }

    records.sort(compareCharactersBySlot);
    this.cache.set(accountId, records);
    return cloneJson(records);
  }

  async get(accountId: string | null, selector: CharacterSelector = {}): Promise<CharacterRecord | null> {
    const characters = await this.list(accountId);
    const character = resolveCharacterFromList(characters, selector);
    return character ? cloneJson(character) : null;
  }

  async set(accountId: string, character: CharacterRecord): Promise<void> {
    if (!accountId || !character || typeof character !== 'object') {
      return;
    }

    const existingCharacters = await this.list(accountId);
    const normalizedCharacter = cloneJson(character);
    const explicitCharacterId =
      typeof normalizedCharacter.characterId === 'string' && normalizedCharacter.characterId.length > 0
        ? normalizedCharacter.characterId
        : null;
    const characterId = resolveCharacterId(accountId, normalizedCharacter, explicitCharacterId);
    const existingCharacter = existingCharacters.find((entry) => entry.characterId === characterId) || null;
    const requestedSlot =
      typeof normalizedCharacter.slot === 'number' && Number.isFinite(normalizedCharacter.slot)
        ? Math.max(0, normalizedCharacter.slot | 0)
        : null;
    const slot =
      existingCharacter
        ? numberOrDefault(existingCharacter.slot, 0)
        : requestedSlot !== null
          ? requestedSlot
          : findFirstAvailableSlot(existingCharacters);
    const nextCharacter: CharacterRecord = {
      ...normalizedCharacter,
      characterId,
      slot,
      selected: true,
    };
    const nextCharacters = existingCharacters
      .filter((entry) => entry.characterId !== characterId && numberOrDefault(entry.slot, -1) !== slot)
      .concat(nextCharacter)
      .sort(compareCharactersBySlot);

    this.ensureDirectories(characterId);
    this.writeJsonFile(this.getAccountFilePath(accountId), buildAccountDocument(accountId, nextCharacters, characterId));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'profile.json'), buildProfileDocument(accountId, characterId, nextCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'vitals.json'), buildVitalsDocument(characterId, nextCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'attributes.json'), buildAttributesDocument(characterId, nextCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'skills.json'), buildSkillsDocument(characterId, nextCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'pets.json'), buildPetsDocument(characterId, nextCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'inventory-items.json'), buildInventoryItemsDocument(characterId, nextCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'inventory-state.json'), buildInventoryStateDocument(characterId, nextCharacter));

    this.cache.set(accountId, cloneJson(nextCharacters));
  }

  async select(accountId: string, selector: CharacterSelector = {}): Promise<CharacterRecord | null> {
    const characters = await this.list(accountId);
    const selectedCharacter = resolveCharacterFromList(characters, selector);
    if (!selectedCharacter || typeof selectedCharacter.characterId !== 'string') {
      return null;
    }

    const nextCharacters: CharacterRecord[] = characters
      .map((character) => ({
        ...character,
        selected: character.characterId === selectedCharacter.characterId,
      }))
      .sort(compareCharactersBySlot);
    this.writeJsonFile(
      this.getAccountFilePath(accountId),
      buildAccountDocument(accountId, nextCharacters, selectedCharacter.characterId)
    );
    this.cache.set(accountId, cloneJson(nextCharacters));
    return cloneJson(nextCharacters.find((character) => character.characterId === selectedCharacter.characterId) || null);
  }

  async delete(accountId: string, selector: CharacterSelector = {}): Promise<boolean> {
    const characters = await this.list(accountId);
    const targetCharacter = resolveCharacterFromList(characters, selector);
    if (!targetCharacter || typeof targetCharacter.characterId !== 'string') {
      return false;
    }

    const remainingCharacters = characters
      .filter((character) => character.characterId !== targetCharacter.characterId)
      .sort(compareCharactersBySlot);
    const previouslySelectedCharacter = characters.find((character) => character.selected === true) || null;
    const selectedCharacterId =
      previouslySelectedCharacter &&
      previouslySelectedCharacter.characterId !== targetCharacter.characterId &&
      typeof previouslySelectedCharacter.characterId === 'string'
        ? previouslySelectedCharacter.characterId
        : (
          remainingCharacters.length > 0 && typeof remainingCharacters[0]?.characterId === 'string'
            ? remainingCharacters[0].characterId as string
            : null
        );
    const nextCharacters: CharacterRecord[] = remainingCharacters
      .map((character) => ({
        ...character,
        selected: selectedCharacterId !== null && character.characterId === selectedCharacterId,
      }))
      .sort(compareCharactersBySlot);
    this.writeJsonFile(
      this.getAccountFilePath(accountId),
      buildAccountDocument(accountId, nextCharacters, selectedCharacterId)
    );
    fs.rmSync(this.getCharacterDirectoryPath(targetCharacter.characterId), { recursive: true, force: true });
    this.cache.set(accountId, cloneJson(nextCharacters));
    return true;
  }

  async existsName(
    roleName: string,
    options: { excludeCharacterId?: string | null } = {}
  ): Promise<boolean> {
    const normalizedName = roleName.trim().toLowerCase();
    if (normalizedName.length < 1) {
      return false;
    }
    const excludedCharacterId =
      typeof options.excludeCharacterId === 'string' && options.excludeCharacterId.length > 0
        ? options.excludeCharacterId
        : null;

    for (const legacyCharacter of Object.values(this.legacyData)) {
      const legacyName = String((legacyCharacter as CharacterRecord).charName || (legacyCharacter as CharacterRecord).roleName || '').trim().toLowerCase();
      if (legacyName.length < 1 || legacyName !== normalizedName) {
        continue;
      }
      const legacyCharacterId = resolveCharacterId('', legacyCharacter as CharacterRecord);
      if (!excludedCharacterId || legacyCharacterId !== excludedCharacterId) {
        return true;
      }
    }

    let characterIds: string[] = [];
    try {
      characterIds = fs.readdirSync(this.charactersRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return false;
      }
      throw err;
    }

    for (const characterId of characterIds) {
      if (excludedCharacterId && characterId === excludedCharacterId) {
        continue;
      }
      const profile = this.readJsonFile(this.getCharacterFilePath(characterId, 'profile.json')) as Record<string, unknown> | null;
      const candidateName = String(profile?.charName || profile?.name || '').trim().toLowerCase();
      if (candidateName === normalizedName) {
        return true;
      }
    }

    return false;
  }

  loadSplitCharacter(accountId: string, characterId: string, slot = 0): CharacterRecord | null {
    const profile = this.readJsonFile(this.getCharacterFilePath(characterId, 'profile.json')) as any;
    if (!profile) {
      return null;
    }

    const vitals = (this.readJsonFile(this.getCharacterFilePath(characterId, 'vitals.json')) || {}) as any;
    const attributes = (this.readJsonFile(this.getCharacterFilePath(characterId, 'attributes.json')) || {}) as any;
    const skills = (this.readJsonFile(this.getCharacterFilePath(characterId, 'skills.json')) || {}) as any;
    const pets = (this.readJsonFile(this.getCharacterFilePath(characterId, 'pets.json')) || {}) as any;
    const inventoryItems = (this.readJsonFile(this.getCharacterFilePath(characterId, 'inventory-items.json')) || {}) as any;
    const inventoryState = (this.readJsonFile(this.getCharacterFilePath(characterId, 'inventory-state.json')) || {}) as any;

    return {
      accountId,
      characterId,
      slot: numberOrDefault(profile.slot, slot),
      charName: profile.charName || profile.name || 'Hero',
      birthMonth: numberOrDefault(profile.birthMonth, 0),
      birthDay: numberOrDefault(profile.birthDay, 0),
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
      onlineState:
        profile.onlineState && typeof profile.onlineState === 'object'
          ? cloneJson(profile.onlineState)
          : undefined,
      renownTaskDailyState:
        profile.renownTaskDailyState && typeof profile.renownTaskDailyState === 'object'
          ? cloneJson(profile.renownTaskDailyState)
          : undefined,
      questStateV2:
        profile.questStateV2 && typeof profile.questStateV2 === 'object'
          ? cloneJson(profile.questStateV2)
          : undefined,
      statusPoints: profile.statusPoints,
      selectedPetRuntimeId: profile.selectedPetRuntimeId,
      petSummoned: profile.petSummoned,
      warehousePassword:
        typeof profile.warehousePassword === 'string' && profile.warehousePassword.length > 0
          ? profile.warehousePassword
          : undefined,
      frogTeleporterUnlocks:
        profile.frogTeleporterUnlocks && typeof profile.frogTeleporterUnlocks === 'object'
          ? cloneJson(profile.frogTeleporterUnlocks)
          : undefined,
      mapId: profile.mapId,
      x: profile.x,
      y: profile.y,
      lastTownMapId: profile.lastTownMapId,
      lastTownX: profile.lastTownX,
      lastTownY: profile.lastTownY,
      attackMin: numberOrNull(profile.attackMin),
      attackMax: numberOrNull(profile.attackMax),
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
      skillState: {
        learnedSkills: Array.isArray(skills.learnedSkills) ? skills.learnedSkills : [],
        hotbarSkillIds: Array.isArray(skills.hotbarSkillIds) ? skills.hotbarSkillIds : [],
      },
      pets: Array.isArray(pets.pets) ? pets.pets : [],
      inventory: {
        bag: Array.isArray(inventoryItems.items) ? inventoryItems.items : [],
        warehouse: Array.isArray(inventoryItems.warehouseItems) ? inventoryItems.warehouseItems : [],
        bagSize: inventoryState.bagSize,
        warehouseSize: inventoryState.warehouseSize,
        nextItemInstanceId: inventoryState.nextItemInstanceId,
        nextBagSlot: inventoryState.nextBagSlot,
        nextWarehouseSlot: inventoryState.nextWarehouseSlot,
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

  getCharacterDirectoryPath(characterId: string): string {
    return path.join(this.charactersRoot, sanitizePathSegment(characterId));
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
    slot: numberOrDefault(character.slot, 0),
    charName: character.charName || character.name || 'Hero',
    birthMonth: numberOrDefault(character.birthMonth, 0),
    birthDay: numberOrDefault(character.birthDay, 0),
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
    onlineState:
      character.onlineState && typeof character.onlineState === 'object'
        ? cloneJson(character.onlineState)
        : undefined,
    renownTaskDailyState:
      character.renownTaskDailyState && typeof character.renownTaskDailyState === 'object'
        ? cloneJson(character.renownTaskDailyState)
        : undefined,
    questStateV2:
      character.questStateV2 && typeof character.questStateV2 === 'object'
        ? cloneJson(character.questStateV2)
        : undefined,
    statusPoints: numberOrDefault(character.statusPoints, 0),
    selectedPetRuntimeId: numberOrNull(character.selectedPetRuntimeId),
    petSummoned: character.petSummoned === true,
    warehousePassword:
      typeof character.warehousePassword === 'string' && character.warehousePassword.length > 0
        ? character.warehousePassword
        : '000000',
    frogTeleporterUnlocks:
      character.frogTeleporterUnlocks && typeof character.frogTeleporterUnlocks === 'object'
        ? cloneJson(character.frogTeleporterUnlocks)
        : undefined,
    mapId: numberOrDefault(character.mapId, 0),
    x: numberOrDefault(character.x, 0),
    y: numberOrDefault(character.y, 0),
    lastTownMapId: numberOrNull(character.lastTownMapId),
    lastTownX: numberOrNull(character.lastTownX),
    lastTownY: numberOrNull(character.lastTownY),
    attackMin: numberOrNull(character.attackMin),
    attackMax: numberOrNull(character.attackMax),
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

function buildInventoryItemsDocument(characterId: string, character: any): Record<string, unknown> {
  const serializeItemList = (items: any[]): Array<Record<string, unknown>> =>
    Array.isArray(items)
      ? items.map((item: any) => ({
          instanceId: numberOrDefault(item.instanceId, 0),
          templateId: numberOrDefault(item.templateId, 0),
          quantity: numberOrDefault(item.quantity, 1),
          ...(Number.isInteger(item?.durability) ? { durability: item.durability } : {}),
          ...(Number.isInteger(item?.tradeState) ? { tradeState: item.tradeState | 0 } : {}),
          ...(Number.isInteger(item?.bindState) ? { bindState: item.bindState & 0xff } : {}),
          ...(Number.isInteger(item?.refineLevel) ? { refineLevel: item.refineLevel & 0xff } : {}),
          ...(Number.isInteger(item?.stateCode) ? { stateCode: item.stateCode & 0xff } : {}),
          ...(Number.isInteger(item?.extraValue) ? { extraValue: item.extraValue & 0xffff } : {}),
          ...(Number.isInteger(item?.enhancementGrowthId)
            ? { enhancementGrowthId: item.enhancementGrowthId & 0xffff }
            : {}),
          ...(Number.isInteger(item?.enhancementCurrentExp)
            ? { enhancementCurrentExp: item.enhancementCurrentExp & 0xffff }
            : {}),
          ...(Number.isInteger(item?.enhancementSoulPoints)
            ? { enhancementSoulPoints: item.enhancementSoulPoints & 0xffff }
            : {}),
          ...(Number.isInteger(item?.enhancementAptitudeGrowth)
            ? { enhancementAptitudeGrowth: item.enhancementAptitudeGrowth & 0xffff }
            : {}),
          ...(Number.isInteger(item?.enhancementUnknown13)
            ? { enhancementUnknown13: item.enhancementUnknown13 & 0xffff }
            : {}),
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
      : [];

  return {
    characterId,
    items: serializeItemList(character?.inventory?.bag),
    warehouseItems: serializeItemList(character?.inventory?.warehouse),
    updatedAt: new Date().toISOString(),
  };
}

function buildSkillsDocument(characterId: string, character: any): Record<string, unknown> {
  return {
    characterId,
    learnedSkills: Array.isArray(character?.skillState?.learnedSkills)
      ? character.skillState.learnedSkills
          .filter((entry: any) => Number.isInteger(entry?.skillId))
          .map((entry: any) => ({
            skillId: entry.skillId >>> 0,
            name: typeof entry.name === 'string' ? entry.name : `Skill ${entry.skillId >>> 0}`,
            ...(Number.isInteger(entry?.level) ? { level: entry.level >>> 0 } : {}),
            ...(Number.isInteger(entry?.proficiency) ? { proficiency: entry.proficiency >>> 0 } : {}),
            ...(Number.isInteger(entry?.sourceTemplateId) ? { sourceTemplateId: entry.sourceTemplateId >>> 0 } : {}),
            learnedAt: numberOrDefault(entry.learnedAt, Date.now()),
            ...(Number.isInteger(entry?.requiredLevel) ? { requiredLevel: entry.requiredLevel >>> 0 } : {}),
            ...(typeof entry?.requiredAttribute === 'string' ? { requiredAttribute: entry.requiredAttribute } : {}),
            ...(Number.isInteger(entry?.requiredAttributeValue)
              ? { requiredAttributeValue: entry.requiredAttributeValue >>> 0 }
              : {}),
            ...(Number.isInteger(entry?.hotbarSlot) ? { hotbarSlot: entry.hotbarSlot | 0 } : {}),
          }))
      : [],
    hotbarSkillIds: Array.isArray(character?.skillState?.hotbarSkillIds)
      ? character.skillState.hotbarSkillIds.map((skillId: unknown) => (
          Number.isInteger(skillId) ? ((skillId as number) >>> 0) : 0
        ))
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
    warehouseSize: numberOrDefault(character?.inventory?.warehouseSize, 30),
    nextItemInstanceId: numberOrDefault(character?.inventory?.nextItemInstanceId, 1),
    nextBagSlot: numberOrDefault(character?.inventory?.nextBagSlot, 0),
    nextWarehouseSlot: numberOrDefault(character?.inventory?.nextWarehouseSlot, 0),
    updatedAt: new Date().toISOString(),
  };
}

function buildAccountDocument(
  accountId: string,
  characters: CharacterRecord[],
  selectedCharacterId: string | null
): AccountRecord {
  const normalizedSelectedCharacterId =
    typeof selectedCharacterId === 'string' && selectedCharacterId.length > 0
      ? selectedCharacterId
      : null;
  return {
    accountId,
    selectedCharacterId: normalizedSelectedCharacterId,
    slots: characters
      .map((character) => ({
        slot: numberOrDefault(character.slot, 0),
        characterId: String(character.characterId || ''),
        name: String(character.charName || character.roleName || character.name || 'Hero'),
        updatedAt: new Date().toISOString(),
      }))
      .filter((slotRecord) => slotRecord.characterId.length > 0)
      .sort((left, right) => left.slot - right.slot),
    updatedAt: new Date().toISOString(),
  };
}

function resolveCharacterId(accountId: string, character: any, explicitCharacterId?: string | null): string {
  if (typeof explicitCharacterId === 'string' && explicitCharacterId.length > 0) {
    return sanitizePathSegment(explicitCharacterId);
  }
  if (typeof character?.characterId === 'string' && character.characterId.length > 0) {
    return sanitizePathSegment(character.characterId);
  }
  const baseName = typeof character?.charName === 'string' && character.charName.length > 0
    ? character.charName
    : accountId;
  return sanitizePathSegment(baseName);
}

function sanitizePathSegment(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function resolveCharacterFromList(
  characters: CharacterRecord[],
  selector: CharacterSelector
): CharacterRecord | null {
  const characterId =
    typeof selector.characterId === 'string' && selector.characterId.length > 0
      ? selector.characterId
      : null;
  if (characterId) {
    return characters.find((character) => character.characterId === characterId) || null;
  }

  if (typeof selector.slot === 'number' && Number.isFinite(selector.slot)) {
    const slot = selector.slot | 0;
    return characters.find((character) => numberOrDefault(character.slot, -1) === slot) || null;
  }

  return characters.find((character) => character.selected === true) || characters[0] || null;
}

function compareCharactersBySlot(left: CharacterRecord, right: CharacterRecord): number {
  return numberOrDefault(left.slot, 0) - numberOrDefault(right.slot, 0);
}

function findFirstAvailableSlot(characters: CharacterRecord[]): number {
  const occupiedSlots = new Set(
    characters
      .map((character) => numberOrDefault(character.slot, -1))
      .filter((slot) => slot >= 0)
  );
  let slot = 0;
  while (occupiedSlots.has(slot)) {
    slot += 1;
  }
  return slot;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
