'use strict';

const BAG_CONTAINER_TYPE = 1;
const DEFAULT_BAG_SIZE = 24;
const FIRST_BAG_SLOT = 1;

const ITEM_DEFINITIONS = Object.freeze([
  {
    templateId: 21098,
    name: 'Zodiac Recommendation Token',
    containerType: BAG_CONTAINER_TYPE,
    maxStack: 1,
    clientTemplateFamily: 0x74,
    clientEvidence:
      'Installed script.gcg task 1 info block uses macro_GetItemName(21098) and GetItem={21098,1} for Apollo\'s recommendation token.',
  },
  {
    templateId: 21116,
    name: 'Timber',
    containerType: BAG_CONTAINER_TYPE,
    maxStack: 1,
    clientTemplateFamily: 0x74,
    clientEvidence:
      'Installed script.gcg checks macro_GetItemCount(21116)==0 before showing "The wood is in your pack".',
  },
  {
    templateId: 21099,
    name: 'Spinning Token',
    containerType: BAG_CONTAINER_TYPE,
    maxStack: 1,
    clientTemplateFamily: 0x74,
    clientEvidence:
      'Installed script.gcg Spinning(I) block uses macro_GetItemName(21099) and tells the player to bring it from Blacksmith to Candy.',
  },
  {
    templateId: 21115,
    name: "Dragonfly's Sting",
    containerType: BAG_CONTAINER_TYPE,
    maxStack: 99,
    clientTemplateFamily: 0x74,
    clientEvidence:
      'Installed script.gcg Spinning(II) block requires 10x macro_GetItemName(21115) from Dragonfly and hand-in to Candy.',
  },
  {
    templateId: 20001,
    name: 'Medicine',
    containerType: BAG_CONTAINER_TYPE,
    maxStack: 99,
    clientTemplateFamily: 0x41,
    clientEvidence:
      'Installed script.gcg Back to Earth(II) reward block grants macro_GetItemName(20001) x5; matching server-family potion table row 20001.',
  },
  {
    templateId: 20004,
    name: 'Heal Grass',
    containerType: BAG_CONTAINER_TYPE,
    maxStack: 99,
    clientTemplateFamily: 0x41,
    clientEvidence:
      'Installed script.gcg Back to Earth(II) reward block grants macro_GetItemName(20004) x5; matching server-family potion table row 20004.',
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
        Number.isInteger(character?.inventory?.nextBagSlot) && character.inventory.nextBagSlot >= FIRST_BAG_SLOT
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
    // Older local saves used 0-based slots; remap them into the client-visible range.
    slot: Math.max(FIRST_BAG_SLOT, item.slot >>> 0),
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
      Number.isInteger(session.nextBagSlot) && session.nextBagSlot >= FIRST_BAG_SLOT
        ? session.nextBagSlot
        : FIRST_BAG_SLOT,
  };
}

function bagHasTemplateId(session, templateId) {
  return Array.isArray(session.bagItems)
    ? session.bagItems.some((item) => item.templateId === (templateId >>> 0))
    : false;
}

function getBagItemByTemplateId(session, templateId) {
  return Array.isArray(session.bagItems)
    ? session.bagItems.find((item) => item.templateId === (templateId >>> 0)) || null
    : null;
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
  let slot = Number.isInteger(session.nextBagSlot) && session.nextBagSlot >= FIRST_BAG_SLOT
    ? session.nextBagSlot
    : FIRST_BAG_SLOT;
  while (usedSlots.has(slot) && slot <= bagSize) {
    slot += 1;
  }
  if (slot > bagSize) {
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

function consumeItemFromBag(session, templateId, quantity = 1) {
  const bagItems = Array.isArray(session.bagItems) ? session.bagItems : [];
  const item = getBagItemByTemplateId(session, templateId);
  if (!item) {
    return {
      ok: false,
      reason: `Missing templateId=${templateId}`,
    };
  }

  const normalizedQuantity = Math.max(1, quantity | 0);
  if (item.quantity < normalizedQuantity) {
    return {
      ok: false,
      reason: `Insufficient quantity for templateId=${templateId}`,
    };
  }

  item.quantity -= normalizedQuantity;
  let removed = false;
  if (item.quantity <= 0) {
    const removedSlot = item.slot >>> 0;
    const index = bagItems.indexOf(item);
    if (index >= 0) {
      bagItems.splice(index, 1);
    }
    if (!Number.isInteger(session.nextBagSlot) || session.nextBagSlot > removedSlot) {
      session.nextBagSlot = removedSlot;
    }
    removed = true;
  }

  session.bagItems = bagItems.sort((left, right) => left.slot - right.slot);
  return {
    ok: true,
    item,
    removed,
  };
}

module.exports = {
  BAG_CONTAINER_TYPE,
  DEFAULT_BAG_SIZE,
  FIRST_BAG_SLOT,
  buildInventorySnapshot,
  bagHasTemplateId,
  consumeItemFromBag,
  getBagItemByTemplateId,
  getItemDefinition,
  grantItemToBag,
  normalizeInventoryState,
};
