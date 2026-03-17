'use strict';

const fs = require('fs');
const path = require('path');

const BAG_CONTAINER_TYPE = 1;
const DEFAULT_BAG_SIZE = 24;
const FIRST_BAG_SLOT = 1;
const CLIENT_DERIVED_ROOT = path.resolve(__dirname, '..', 'data', 'client-derived');
const EQUIPMENT_TABLE_FILE = path.join(CLIENT_DERIVED_ROOT, 'equipment.json');
const WEAPON_TABLE_FILE = path.join(CLIENT_DERIVED_ROOT, 'weapons.json');
const GENERAL_ITEM_TABLE_FILE = path.join(CLIENT_DERIVED_ROOT, 'items.json');
const POTION_TABLE_FILE = path.join(CLIENT_DERIVED_ROOT, 'potions.json');
const STUFF_TABLE_FILE = path.join(CLIENT_DERIVED_ROOT, 'stuff.json');

const EQUIPMENT_NAME_OVERRIDES = Object.freeze({
  10001: 'Light Hood',
  11001: 'Fabric Garment',
  13001: 'Shoes',
  15001: 'Red String',
  16001: 'Gauze Garment',
  18001: 'Embroidered Shoes',
});

const ITEM_DEFINITIONS = Object.freeze([
  ...loadClientGeneralItemDefinitions(),
  ...loadClientPotionDefinitions(),
  ...loadClientStuffDefinitions(),
  ...loadEquipmentDefinitions(),
]);

const ITEMS_BY_TEMPLATE_ID = new Map(
  ITEM_DEFINITIONS.map((definition) => [definition.templateId, definition])
);

function getItemDefinition(templateId) {
  return ITEMS_BY_TEMPLATE_ID.get(templateId) || null;
}

function loadEquipmentDefinitions() {
  return [
    ...loadClientEquipmentDefinitions(EQUIPMENT_TABLE_FILE, 'armor'),
    ...loadClientEquipmentDefinitions(WEAPON_TABLE_FILE, 'weapon'),
  ];
}

function loadClientGeneralItemDefinitions() {
  return loadClientStackableDefinitions(GENERAL_ITEM_TABLE_FILE, 'is_general.txt');
}

function loadClientPotionDefinitions() {
  return loadClientStackableDefinitions(POTION_TABLE_FILE, 'is_potion.txt');
}

function loadClientStuffDefinitions() {
  const entries = loadClientDerivedEntries(STUFF_TABLE_FILE);
  return entries
    .filter((entry) => Number.isInteger(entry?.templateId))
    .map((entry) => ({
      templateId: entry.templateId,
      name:
        typeof entry.name === 'string' && entry.name.length > 0
          ? entry.name
          : `Item ${entry.templateId}`,
      containerType: BAG_CONTAINER_TYPE,
      maxStack: 1,
      clientTemplateFamily: null,
      iconPath: typeof entry.iconPath === 'string' ? entry.iconPath : '',
      clientEvidence:
        `Client-derived is_stuff.txt row ${entry.templateId} from ${path.basename(STUFF_TABLE_FILE)}.`,
    }));
}

function loadClientStackableDefinitions(filePath, sourceLabel) {
  const entries = loadClientDerivedEntries(filePath);
  return entries
    .filter((entry) => Number.isInteger(entry?.templateId) && Number.isInteger(entry?.clientTemplateFamily))
    .map((entry) => ({
      templateId: entry.templateId,
      name:
        typeof entry.name === 'string' && entry.name.length > 0
          ? entry.name
          : `Item ${entry.templateId}`,
      containerType: BAG_CONTAINER_TYPE,
      maxStack:
        Number.isInteger(entry.stackLimitField) && entry.stackLimitField > 0
          ? entry.stackLimitField
          : 1,
      clientTemplateFamily: entry.clientTemplateFamily,
      iconPath: typeof entry.iconPath === 'string' ? entry.iconPath : '',
      clientEvidence:
        `Client-derived ${sourceLabel} row ${entry.templateId} from ${path.basename(filePath)}.`,
    }));
}

function loadClientEquipmentDefinitions(filePath, kind) {
  const entries = loadClientDerivedEntries(filePath);
  const rows = [];
  for (const entry of entries) {
    if (!Number.isInteger(entry?.templateId) || !Number.isInteger(entry?.clientTemplateFamily)) {
      continue;
    }
    const durabilityBase = entry.baseDurabilityField;
    const defaultQuantity =
      Number.isInteger(durabilityBase) && durabilityBase > 0 ? durabilityBase * 300 : 0;
    const statCount = kind === 'armor' ? 2 : 6;
    const defaultAttributePairs = [];
    for (let index = 0; index < statCount; index += 1) {
      const value = Array.isArray(entry.combatFields) ? entry.combatFields[index] : null;
      defaultAttributePairs.push({ value: Number.isInteger(value) && value > 0 ? value : 0 });
    }

    rows.push({
      templateId: entry.templateId,
      name: EQUIPMENT_NAME_OVERRIDES[entry.templateId] || entry.name || `Item ${entry.templateId}`,
      containerType: BAG_CONTAINER_TYPE,
      maxStack: 1,
      clientTemplateFamily: entry.clientTemplateFamily,
      defaultQuantity,
      defaultAttributePairs,
      iconPath: typeof entry.iconPath === 'string' ? entry.iconPath : '',
      clientEvidence:
        `Client-derived ${path.basename(filePath)} row ${entry.templateId} derives family and equipment instance defaults.`,
    });
  }

  return rows;
}

function loadClientDerivedEntries(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return [];
  }
  return Array.isArray(parsed?.entries) ? parsed.entries : [];
}

function normalizeInventoryState(character) {
  const rawBag = Array.isArray(character?.inventory?.bag)
    ? character.inventory.bag
        .map((item) => normalizeBagItem(item))
        .filter(Boolean)
        .sort((left, right) => {
          if (left.slot !== right.slot) {
            return left.slot - right.slot;
          }
          return left.instanceId - right.instanceId;
        })
    : [];
  const requestedBagSize =
    Number.isInteger(character?.inventory?.bagSize) && character.inventory.bagSize > 0
      ? character.inventory.bagSize
      : DEFAULT_BAG_SIZE;
  const bagSize = Math.max(
    requestedBagSize,
    computeRequiredBagSlots(rawBag),
    rawBag.reduce((maxSlot, item) => Math.max(maxSlot, item.slot), FIRST_BAG_SLOT - 1)
  );
  const bag = normalizeBagLayout(rawBag, bagSize);

  const computedNextSlot = Math.max(
    FIRST_BAG_SLOT,
    bag.reduce((maxSlot, item) => Math.max(maxSlot, item.slot), FIRST_BAG_SLOT - 1) + 1
  );
  const computedNextInstanceId = bag.reduce(
    (maxId, item) => Math.max(maxId, item.instanceId),
    0
  ) + 1;

  return {
    inventory: {
      bag,
      bagSize,
      nextItemInstanceId:
        Number.isInteger(character?.inventory?.nextItemInstanceId) &&
        character.inventory.nextItemInstanceId >= computedNextInstanceId
          ? character.inventory.nextItemInstanceId
          : computedNextInstanceId,
      nextBagSlot:
        Number.isInteger(character?.inventory?.nextBagSlot) &&
        character.inventory.nextBagSlot >= FIRST_BAG_SLOT &&
        character.inventory.nextBagSlot <= bagSize + 1
          ? findNextAvailableSlot(bag, bagSize, character.inventory.nextBagSlot)
          : computedNextSlot,
    },
  };
}

function normalizeBagItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  if (!Number.isInteger(item.templateId) || !Number.isInteger(item.slot)) {
    return null;
  }
  const definition = getItemDefinition(item.templateId);
  if (!definition) {
    return null;
  }
  const rawQuantity = Number.isInteger(item.quantity)
    ? item.quantity
    : isEquipmentDefinition(definition)
      ? numberOrDefault(definition.defaultQuantity, 0)
      : 1;
  return {
    instanceId: Number.isInteger(item.instanceId) && item.instanceId > 0 ? item.instanceId : 1,
    templateId: item.templateId >>> 0,
    quantity: normalizeStoredItemQuantity(definition, rawQuantity),
    equipped: item.equipped === true,
    // Older local saves used 0-based slots; remap them into the client-visible range.
    slot: Math.max(FIRST_BAG_SLOT, item.slot >>> 0),
  };
}

function buildInventorySnapshot(session) {
  const snapshot = {
    bag: Array.isArray(session.bagItems)
        ? session.bagItems.map((item) => ({
          instanceId: item.instanceId >>> 0,
          templateId: item.templateId >>> 0,
          quantity: item.quantity >>> 0,
          equipped: item.equipped === true,
          slot: item.slot >>> 0,
        }))
      : [],
    bagSize:
      Number.isInteger(session.bagSize) && session.bagSize > 0 ? session.bagSize : DEFAULT_BAG_SIZE,
    nextItemInstanceId:
      Number.isInteger(session.nextItemInstanceId) && session.nextItemInstanceId > 0
        ? session.nextItemInstanceId
        : 1,
    nextBagSlot:
      Number.isInteger(session.nextBagSlot) && session.nextBagSlot >= FIRST_BAG_SLOT
        ? session.nextBagSlot
        : FIRST_BAG_SLOT,
  };
  return normalizeInventoryState({ inventory: snapshot }).inventory;
}

function bagHasTemplateId(session, templateId) {
  return getBagQuantityByTemplateId(session, templateId) > 0;
}

function getBagItemByTemplateId(session, templateId) {
  return Array.isArray(session.bagItems)
    ? session.bagItems.find((item) => item.equipped !== true && item.templateId === (templateId >>> 0)) || null
    : null;
}

function getBagQuantityByTemplateId(session, templateId) {
  return Array.isArray(session.bagItems)
    ? session.bagItems.reduce(
        (total, item) =>
          total +
          (item.equipped !== true && item.templateId === (templateId >>> 0) ? item.quantity >>> 0 : 0),
        0
      )
    : 0;
}

function bagHasTemplateQuantity(session, templateId, quantity = 1) {
  return getBagQuantityByTemplateId(session, templateId) >= Math.max(1, quantity | 0);
}

function grantItemToBag(session, templateId, quantity = 1) {
  const definition = getItemDefinition(templateId);
  if (!definition) {
    return {
      ok: false,
      reason: `Unknown templateId=${templateId}`,
    };
  }

  const normalizedQuantity = Math.max(1, quantity | 0);
  const bagItems = Array.isArray(session.bagItems) ? session.bagItems : [];
  const bagSize =
    Number.isInteger(session.bagSize) && session.bagSize > 0 ? session.bagSize : DEFAULT_BAG_SIZE;
  const existingStacks = bagItems
    .filter(
      (item) =>
        item.equipped !== true &&
        item.templateId === definition.templateId &&
        item.quantity < definition.maxStack
    )
    .sort((left, right) => left.slot - right.slot);
  const availableStackSpace = existingStacks.reduce(
    (total, item) => total + Math.max(0, definition.maxStack - item.quantity),
    0
  );
  const freeSlotCount = Math.max(
    0,
    bagSize - new Set(bagItems.filter((item) => item.equipped !== true).map((item) => item.slot)).size
  );
  const totalCapacity = availableStackSpace + (freeSlotCount * definition.maxStack);
  if (totalCapacity < normalizedQuantity) {
    return {
      ok: false,
      reason: 'Bag is full',
    };
  }

  const changes = [];
  let remainingQuantity = normalizedQuantity;

  for (const item of existingStacks) {
    if (remainingQuantity <= 0) {
      break;
    }
    const capacity = Math.max(0, definition.maxStack - item.quantity);
    if (capacity <= 0) {
      continue;
    }
    const quantityAdded = Math.min(capacity, remainingQuantity);
    item.quantity += quantityAdded;
    remainingQuantity -= quantityAdded;
    changes.push({
      item,
      quantityAdded,
      merged: true,
    });
  }

  let nextInstanceId =
    Number.isInteger(session.nextItemInstanceId) && session.nextItemInstanceId > 0
      ? session.nextItemInstanceId
      : 1;
  let nextPreferredSlot =
    Number.isInteger(session.nextBagSlot) && session.nextBagSlot >= FIRST_BAG_SLOT
      ? session.nextBagSlot
      : FIRST_BAG_SLOT;
  while (remainingQuantity > 0) {
    const slot = findNextAvailableSlot(bagItems, bagSize, nextPreferredSlot);
    const stackQuantity = Math.min(definition.maxStack, remainingQuantity);
    const item = {
      instanceId: nextInstanceId,
      templateId: definition.templateId,
      quantity: initialStoredQuantityForGrant(definition, stackQuantity),
      equipped: false,
      slot,
    };
    bagItems.push(item);
    changes.push({
      item,
      quantityAdded: stackQuantity,
      merged: false,
    });
    nextInstanceId += 1;
    nextPreferredSlot = slot + 1;
    remainingQuantity -= stackQuantity;
  }

  bagItems.sort((left, right) => left.slot - right.slot);
  session.bagItems = bagItems;
  session.nextItemInstanceId = nextInstanceId;
  session.nextBagSlot = findNextAvailableSlot(bagItems, bagSize, nextPreferredSlot);

  return {
    ok: true,
    definition,
    item: changes[changes.length - 1]?.item || null,
    merged: changes.every((change) => change.merged),
    changes,
    totalQuantityAdded: normalizedQuantity,
  };
}

function consumeItemFromBag(session, templateId, quantity = 1) {
  const bagItems = Array.isArray(session.bagItems) ? session.bagItems : [];
  const normalizedQuantity = Math.max(1, quantity | 0);
  if (!bagHasTemplateQuantity(session, templateId, normalizedQuantity)) {
    return {
      ok: false,
      reason: `Insufficient quantity for templateId=${templateId}`,
    };
  }

  let remainingQuantity = normalizedQuantity;
  const matchingItems = bagItems
    .filter((item) => item.equipped !== true && item.templateId === (templateId >>> 0))
    .sort((left, right) => left.slot - right.slot);
  const changes = [];
  const removedItems = [];

  for (const item of matchingItems) {
    if (remainingQuantity <= 0) {
      break;
    }
    const quantityRemoved = Math.min(item.quantity, remainingQuantity);
    item.quantity -= quantityRemoved;
    remainingQuantity -= quantityRemoved;
    if (item.quantity <= 0) {
      const index = bagItems.indexOf(item);
      if (index >= 0) {
        bagItems.splice(index, 1);
      }
      removedItems.push(item);
      changes.push({
        item,
        quantityRemoved,
        removed: true,
      });
    } else {
      changes.push({
        item,
        quantityRemoved,
        removed: false,
      });
    }
  }

  session.bagItems = bagItems.sort((left, right) => left.slot - right.slot);
  const bagSize =
    Number.isInteger(session.bagSize) && session.bagSize > 0 ? session.bagSize : DEFAULT_BAG_SIZE;
  session.nextBagSlot = findNextAvailableSlot(
    session.bagItems,
    bagSize,
    removedItems.reduce(
      (lowestSlot, item) => Math.min(lowestSlot, item.slot >>> 0),
      Number.isInteger(session.nextBagSlot) ? session.nextBagSlot : bagSize + 1
    )
  );
  return {
    ok: true,
    item: changes[changes.length - 1]?.item || null,
    removed: removedItems.length > 0,
    changes,
    removedItems,
  };
}

function normalizeBagLayout(items, bagSize) {
  const usedSlots = new Set();
  const usedInstanceIds = new Set();
  let nextInstanceId = 1;
  const bag = [];

  for (const originalItem of items) {
    if (!originalItem) {
      continue;
    }
    const definition = getItemDefinition(originalItem.templateId);
    if (!definition) {
      continue;
    }

    let remainingQuantity = Math.max(1, originalItem.quantity | 0);
    const isEquipment = isEquipmentDefinition(definition);
    let preferredSlot = originalItem.slot;
    let firstSplit = true;
    while (remainingQuantity > 0) {
      while (usedInstanceIds.has(nextInstanceId)) {
        nextInstanceId += 1;
      }
      const instanceId =
        firstSplit && originalItem.instanceId > 0 && !usedInstanceIds.has(originalItem.instanceId)
          ? originalItem.instanceId
          : nextInstanceId;
      usedInstanceIds.add(instanceId);
      nextInstanceId = Math.max(nextInstanceId, instanceId + 1);

      const slot = findNextOpenSlot(usedSlots, bagSize, preferredSlot);
      if (slot === null) {
        break;
      }
      usedSlots.add(slot);
      const quantity = isEquipment
        ? remainingQuantity
        : Math.min(definition.maxStack, remainingQuantity);
      bag.push({
        ...originalItem,
        instanceId,
        quantity,
        slot,
      });
      remainingQuantity = isEquipment ? 0 : remainingQuantity - quantity;
      preferredSlot = slot + 1;
      firstSplit = false;
    }
  }

  return bag;
}

function computeRequiredBagSlots(items) {
  if (!Array.isArray(items)) {
    return 0;
  }
  return items.reduce((total, item) => {
    const definition = getItemDefinition(item?.templateId);
    const quantity = Number.isInteger(item?.quantity) && item.quantity > 0 ? item.quantity : 1;
    if (!definition) {
      return total;
    }
    if (isEquipmentDefinition(definition)) {
      return total + 1;
    }
    return total + Math.max(1, Math.ceil(quantity / definition.maxStack));
  }, 0);
}

function findNextAvailableSlot(items, bagSize, startSlot = FIRST_BAG_SLOT) {
  const usedSlots = new Set(
    Array.isArray(items) ? items.filter((item) => item?.equipped !== true).map((item) => item.slot) : []
  );
  const preferredSlot = Math.max(FIRST_BAG_SLOT, startSlot | 0);
  const fromPreferred = findNextOpenSlot(usedSlots, bagSize, preferredSlot);
  if (fromPreferred !== null) {
    return fromPreferred;
  }
  return bagSize + 1;
}

function findNextOpenSlot(usedSlots, bagSize, startSlot = FIRST_BAG_SLOT) {
  const preferredSlot = Math.max(FIRST_BAG_SLOT, startSlot | 0);
  for (let slot = preferredSlot; slot <= bagSize; slot += 1) {
    if (!usedSlots.has(slot)) {
      return slot;
    }
  }
  for (let slot = FIRST_BAG_SLOT; slot < preferredSlot && slot <= bagSize; slot += 1) {
    if (!usedSlots.has(slot)) {
      return slot;
    }
  }
  return null;
}

function isEquipmentDefinition(definition) {
  return (
    Number.isInteger(definition?.clientTemplateFamily) &&
    definition.clientTemplateFamily >= 0x20 &&
    definition.clientTemplateFamily < 0x40
  );
}

function initialStoredQuantityForGrant(definition, requestedQuantity) {
  if (isEquipmentDefinition(definition)) {
    return Number.isInteger(definition.defaultQuantity) && definition.defaultQuantity > 0
      ? definition.defaultQuantity
      : Math.max(1, requestedQuantity | 0);
  }
  return Math.max(1, requestedQuantity | 0);
}

function normalizeStoredItemQuantity(definition, rawQuantity) {
  if (isEquipmentDefinition(definition)) {
    if (!Number.isInteger(rawQuantity) || rawQuantity < 0) {
      return Number.isInteger(definition?.defaultQuantity) && definition.defaultQuantity > 0
        ? definition.defaultQuantity
        : 0;
    }
    return rawQuantity;
  }
  if (
    !Number.isInteger(rawQuantity) ||
    rawQuantity <= 0
  ) {
    return 1;
  }
  return rawQuantity;
}

function numberOrDefault(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

module.exports = {
  BAG_CONTAINER_TYPE,
  DEFAULT_BAG_SIZE,
  FIRST_BAG_SLOT,
  buildInventorySnapshot,
  bagHasTemplateId,
  bagHasTemplateQuantity,
  consumeItemFromBag,
  getBagQuantityByTemplateId,
  getBagItemByTemplateId,
  getItemDefinition,
  grantItemToBag,
  normalizeInventoryState,
};
