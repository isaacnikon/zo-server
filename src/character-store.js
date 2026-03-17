'use strict';

const fs = require('fs');
const path = require('path');

class CharacterStore {
  constructor(filePath) {
    this.legacyFilePath = path.resolve(filePath);
    this.storeRoot = path.resolve(path.dirname(this.legacyFilePath), 'data', 'save');
    this.accountsRoot = path.join(this.storeRoot, 'accounts');
    this.charactersRoot = path.join(this.storeRoot, 'characters');
    this.legacyData = this.loadLegacy();
    this.cache = new Map();
  }

  loadLegacy() {
    try {
      const raw = fs.readFileSync(this.legacyFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      if (err.code === 'ENOENT') {
        return {};
      }
      throw err;
    }
  }

  get(accountId) {
    if (!accountId) {
      return null;
    }

    if (this.cache.has(accountId)) {
      return cloneJson(this.cache.get(accountId));
    }

    const accountRecord = this.readJsonFile(this.getAccountFilePath(accountId));
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

  set(accountId, character) {
    if (!accountId || !character || typeof character !== 'object') {
      return;
    }

    const normalizedCharacter = cloneJson(character);
    const characterId = resolveCharacterId(accountId, normalizedCharacter);

    this.ensureDirectories(characterId);
    this.writeJsonFile(this.getAccountFilePath(accountId), {
      accountId,
      characterId,
      name: normalizedCharacter.charName || normalizedCharacter.name || 'Hero',
      updatedAt: new Date().toISOString(),
    });

    this.writeJsonFile(this.getCharacterFilePath(characterId, 'profile.json'), buildProfileDocument(accountId, characterId, normalizedCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'vitals.json'), buildVitalsDocument(characterId, normalizedCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'attributes.json'), buildAttributesDocument(characterId, normalizedCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'active-quests.json'), buildActiveQuestsDocument(characterId, normalizedCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'completed-quests.json'), buildCompletedQuestsDocument(characterId, normalizedCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'inventory-items.json'), buildInventoryItemsDocument(characterId, normalizedCharacter));
    this.writeJsonFile(this.getCharacterFilePath(characterId, 'inventory-state.json'), buildInventoryStateDocument(characterId, normalizedCharacter));

    this.cache.set(accountId, normalizedCharacter);
  }

  loadSplitCharacter(accountId, characterId) {
    const profile = this.readJsonFile(this.getCharacterFilePath(characterId, 'profile.json'));
    if (!profile) {
      return null;
    }

    const vitals = this.readJsonFile(this.getCharacterFilePath(characterId, 'vitals.json')) || {};
    const attributes = this.readJsonFile(this.getCharacterFilePath(characterId, 'attributes.json')) || {};
    const activeQuests = this.readJsonFile(this.getCharacterFilePath(characterId, 'active-quests.json')) || {};
    const completedQuests = this.readJsonFile(this.getCharacterFilePath(characterId, 'completed-quests.json')) || {};
    const inventoryItems = this.readJsonFile(this.getCharacterFilePath(characterId, 'inventory-items.json')) || {};
    const inventoryState = this.readJsonFile(this.getCharacterFilePath(characterId, 'inventory-state.json')) || {};

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
      gold: profile.gold,
      bankGold: profile.bankGold,
      boundGold: profile.boundGold,
      coins: profile.coins,
      renown: profile.renown,
      statusPoints: profile.statusPoints,
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
      activeQuests: Array.isArray(activeQuests.quests) ? activeQuests.quests : [],
      completedQuests: Array.isArray(completedQuests.taskIds) ? completedQuests.taskIds : [],
      inventory: {
        bag: Array.isArray(inventoryItems.items) ? inventoryItems.items : [],
        bagSize: inventoryState.bagSize,
        nextItemInstanceId: inventoryState.nextItemInstanceId,
        nextBagSlot: inventoryState.nextBagSlot,
      },
    };
  }

  ensureDirectories(characterId) {
    fs.mkdirSync(this.accountsRoot, { recursive: true });
    fs.mkdirSync(path.join(this.charactersRoot, characterId), { recursive: true });
  }

  getAccountFilePath(accountId) {
    return path.join(this.accountsRoot, `${sanitizePathSegment(accountId)}.json`);
  }

  getCharacterFilePath(characterId, fileName) {
    return path.join(this.charactersRoot, sanitizePathSegment(characterId), fileName);
  }

  readJsonFile(filePath) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  writeJsonFile(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

function buildProfileDocument(accountId, characterId, character) {
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
    mapId: numberOrDefault(character.mapId, 0),
    x: numberOrDefault(character.x, 0),
    y: numberOrDefault(character.y, 0),
    lastTownMapId: numberOrNull(character.lastTownMapId),
    lastTownX: numberOrNull(character.lastTownX),
    lastTownY: numberOrNull(character.lastTownY),
    updatedAt: new Date().toISOString(),
  };
}

function buildVitalsDocument(characterId, character) {
  return {
    characterId,
    currentHealth: numberOrDefault(character.currentHealth, 0),
    currentMana: numberOrDefault(character.currentMana, 0),
    currentRage: numberOrDefault(character.currentRage, 0),
    updatedAt: new Date().toISOString(),
  };
}

function buildAttributesDocument(characterId, character) {
  return {
    characterId,
    intelligence: numberOrDefault(character?.primaryAttributes?.intelligence, 15),
    vitality: numberOrDefault(character?.primaryAttributes?.vitality, 15),
    dexterity: numberOrDefault(character?.primaryAttributes?.dexterity, 15),
    strength: numberOrDefault(character?.primaryAttributes?.strength, 15),
    updatedAt: new Date().toISOString(),
  };
}

function buildActiveQuestsDocument(characterId, character) {
  return {
    characterId,
    quests: Array.isArray(character.activeQuests)
      ? character.activeQuests.map((quest) => ({
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

function buildCompletedQuestsDocument(characterId, character) {
  return {
    characterId,
    taskIds: Array.isArray(character.completedQuests)
      ? character.completedQuests.filter(Number.isInteger).map((taskId) => taskId >>> 0)
      : [],
    updatedAt: new Date().toISOString(),
  };
}

function buildInventoryItemsDocument(characterId, character) {
  return {
    characterId,
    items: Array.isArray(character?.inventory?.bag)
      ? character.inventory.bag.map((item) => ({
          instanceId: numberOrDefault(item.instanceId, 0),
          templateId: numberOrDefault(item.templateId, 0),
          quantity: numberOrDefault(item.quantity, 1),
          equipped: item.equipped === true,
          slot: numberOrDefault(item.slot, 0),
        }))
      : [],
    updatedAt: new Date().toISOString(),
  };
}

function buildInventoryStateDocument(characterId, character) {
  return {
    characterId,
    bagSize: numberOrDefault(character?.inventory?.bagSize, 24),
    nextItemInstanceId: numberOrDefault(character?.inventory?.nextItemInstanceId, 1),
    nextBagSlot: numberOrDefault(character?.inventory?.nextBagSlot, 0),
    updatedAt: new Date().toISOString(),
  };
}

function resolveCharacterId(accountId, character) {
  const baseName = typeof character?.charName === 'string' && character.charName.length > 0
    ? character.charName
    : accountId;
  return sanitizePathSegment(baseName);
}

function sanitizePathSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function numberOrDefault(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  CharacterStore,
};
