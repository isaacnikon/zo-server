'use strict';

const BAG_CONTAINER_TYPE = 1;
const DEFAULT_BAG_SIZE = 24;

const ITEM_DEFINITIONS = Object.freeze([
  {
    templateId: 21116,
    name: 'Wood',
    containerType: BAG_CONTAINER_TYPE,
    maxStack: 1,
    clientEvidence:
      'Installed script.gcg checks macro_GetItemCount(21116)==0 before showing "The wood is in your pack".',
  },
]);

const ITEMS_BY_TEMPLATE_ID = new Map(
  ITEM_DEFINITIONS.map((definition) => [definition.templateId, definition])
);

function getItemDefinition(templateId) {
  return ITEMS_BY_TEMPLATE_ID.get(templateId) || null;
}

function normalizeInventoryState(character) {
  const bag = Array.isArray(character?.inventory?.bag)
    ? character.inventory.bag
        .map((item) => normalizeBagItem(item))
        .filter(Boolean)
        .sort((left, right) => left.slot - right.slot)
    : [];

  const computedNextSlot = bag.reduce((maxSlot, item) => Math.max(maxSlot, item.slot), -1) + 1;
  const computedNextInstanceId = bag.reduce(
    (maxId, item) => Math.max(maxId, item.instanceId),
    0
  ) + 1;

  return {
    inventory: {
      bag,
      bagSize:
        Number.isInteger(character?.inventory?.bagSize) && character.inventory.bagSize > 0
          ? character.inventory.bagSize
          : DEFAULT_BAG_SIZE,
      nextItemInstanceId:
        Number.isInteger(character?.inventory?.nextItemInstanceId) &&
        character.inventory.nextItemInstanceId > 0
          ? character.inventory.nextItemInstanceId
          : computedNextInstanceId,
      nextBagSlot:
        Number.isInteger(character?.inventory?.nextBagSlot) && character.inventory.nextBagSlot >= 0
          ? character.inventory.nextBagSlot
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
  return {
    instanceId: Number.isInteger(item.instanceId) && item.instanceId > 0 ? item.instanceId : 1,
    templateId: item.templateId >>> 0,
    quantity: Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 1,
    slot: item.slot >>> 0,
  };
}

function buildInventorySnapshot(session) {
  return {
    bag: Array.isArray(session.bagItems)
      ? session.bagItems.map((item) => ({
          instanceId: item.instanceId >>> 0,
          templateId: item.templateId >>> 0,
          quantity: item.quantity >>> 0,
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
      Number.isInteger(session.nextBagSlot) && session.nextBagSlot >= 0 ? session.nextBagSlot : 0,
  };
}

function bagHasTemplateId(session, templateId) {
  return Array.isArray(session.bagItems)
    ? session.bagItems.some((item) => item.templateId === (templateId >>> 0))
    : false;
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

  if (definition.maxStack > 1) {
    const existingItem = bagItems.find(
      (item) => item.templateId === definition.templateId && item.quantity < definition.maxStack
    );
    if (existingItem) {
      existingItem.quantity = Math.min(definition.maxStack, existingItem.quantity + normalizedQuantity);
      return {
        ok: true,
        definition,
        item: existingItem,
        merged: true,
      };
    }
  }

  const usedSlots = new Set(bagItems.map((item) => item.slot));
  let slot = Number.isInteger(session.nextBagSlot) ? session.nextBagSlot : 0;
  while (usedSlots.has(slot) && slot < bagSize) {
    slot += 1;
  }
  if (slot >= bagSize) {
    return {
      ok: false,
      reason: 'Bag is full',
    };
  }

  const instanceId =
    Number.isInteger(session.nextItemInstanceId) && session.nextItemInstanceId > 0
      ? session.nextItemInstanceId
      : 1;

  const item = {
    instanceId,
    templateId: definition.templateId,
    quantity: normalizedQuantity,
    slot,
  };
  bagItems.push(item);
  bagItems.sort((left, right) => left.slot - right.slot);
  session.bagItems = bagItems;
  session.nextItemInstanceId = instanceId + 1;
  session.nextBagSlot = slot + 1;

  return {
    ok: true,
    definition,
    item,
    merged: false,
  };
}

module.exports = {
  BAG_CONTAINER_TYPE,
  DEFAULT_BAG_SIZE,
  buildInventorySnapshot,
  bagHasTemplateId,
  getItemDefinition,
  grantItemToBag,
  normalizeInventoryState,
};
