#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const saveRoot = path.join(projectRoot, 'data', 'save');
const accountId = '0000001';
const characterId = 'NeoE5F';

const updatedAt = new Date().toISOString();

const accountDoc = {
  accountId,
  characterId,
  name: characterId,
  updatedAt,
};

const profileDoc = {
  accountId,
  characterId,
  charName: characterId,
  entityType: 1021,
  roleEntityType: 1021,
  roleData: 0,
  selectedAptitude: 11,
  level: 2,
  experience: 77,
  gold: 66,
  bankGold: 0,
  boundGold: 0,
  coins: 100,
  renown: 0,
  statusPoints: 9,
  mapId: 101,
  x: 25,
  y: 184,
  lastTownMapId: 101,
  lastTownX: 25,
  lastTownY: 184,
  updatedAt,
};

const vitalsDoc = {
  characterId,
  currentHealth: 432,
  currentMana: 630,
  currentRage: 100,
  updatedAt,
};

const attributesDoc = {
  characterId,
  intelligence: 15,
  vitality: 15,
  dexterity: 15,
  strength: 15,
  updatedAt,
};

const activeQuestsDoc = {
  characterId,
  quests: [],
  updatedAt,
};

const completedQuestsDoc = {
  characterId,
  taskIds: [1],
  updatedAt,
};

const inventoryItemsDoc = {
  characterId,
  items: [
    {
      instanceId: 3,
      templateId: 20001,
      quantity: 5,
      slot: 1,
    },
    {
      instanceId: 4,
      templateId: 20004,
      quantity: 5,
      slot: 2,
    },
  ],
  updatedAt,
};

const inventoryStateDoc = {
  characterId,
  bagSize: 24,
  nextItemInstanceId: 5,
  nextBagSlot: 3,
  updatedAt,
};

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

writeJson(path.join(saveRoot, 'accounts', `${accountId}.json`), accountDoc);
writeJson(path.join(saveRoot, 'characters', characterId, 'profile.json'), profileDoc);
writeJson(path.join(saveRoot, 'characters', characterId, 'vitals.json'), vitalsDoc);
writeJson(path.join(saveRoot, 'characters', characterId, 'attributes.json'), attributesDoc);
writeJson(path.join(saveRoot, 'characters', characterId, 'active-quests.json'), activeQuestsDoc);
writeJson(path.join(saveRoot, 'characters', characterId, 'completed-quests.json'), completedQuestsDoc);
writeJson(path.join(saveRoot, 'characters', characterId, 'inventory-items.json'), inventoryItemsDoc);
writeJson(path.join(saveRoot, 'characters', characterId, 'inventory-state.json'), inventoryStateDoc);

process.stdout.write(`Reset character ${characterId} for account ${accountId}\n`);
