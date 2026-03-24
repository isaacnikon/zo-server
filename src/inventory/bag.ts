import {
  BAG_CONTAINER_TYPE,
  DEFAULT_BAG_SIZE,
  FIRST_BAG_SLOT,
  getItemDefinition,
  isEquipmentDefinition,
  positiveIntOrZero,
  numberOrDefault,
} from './data.js';

import type {
  UnknownRecord,
  ItemInstanceAttributePair,
  ItemDefinition,
  BagItem,
  InventoryState,
  InventorySessionLike,
  InventoryChange,
} from './data.js';

function normalizeInventoryState(character: UnknownRecord): InventoryState {
  const rawBag = Array.isArray(character?.inventory?.bag)
    ? character.inventory.bag
        .map((item: UnknownRecord) => normalizeBagItem(item))
        .filter((item: BagItem | null): item is BagItem => Boolean(item))
        .sort((left: BagItem, right: BagItem) => {
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
    rawBag.reduce((maxSlot: number, item: BagItem) => Math.max(maxSlot, item.slot), FIRST_BAG_SLOT - 1)
  );
  const bag = normalizeBagLayout(rawBag, bagSize);

  const computedNextSlot = Math.max(
    FIRST_BAG_SLOT,
    bag.reduce((maxSlot, item) => Math.max(maxSlot, item.slot), FIRST_BAG_SLOT - 1) + 1
  );
  const computedNextInstanceId = bag.reduce((maxId, item) => Math.max(maxId, item.instanceId), 0) + 1;

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

function normalizeBagItem(item: UnknownRecord): BagItem | null {
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
    quantity: isEquipmentDefinition(definition) ? 1 : normalizeStoredItemQuantity(definition, rawQuantity),
    durability: normalizeStoredItemDurability(definition, item.durability, rawQuantity),
    tradeState: normalizeStoredTradeState(item.tradeState, item.bindState),
    bindState: Number.isInteger(item.bindState) ? (item.bindState & 0xff) : 0,
    stateCode: Number.isInteger(item.stateCode) ? (item.stateCode & 0xff) : 0,
    extraValue: Number.isInteger(item.extraValue) ? (item.extraValue & 0xffff) : 0,
    attributePairs: normalizeInstanceAttributePairs(item.attributePairs),
    equipped: item.equipped === true,
    slot: Math.max(FIRST_BAG_SLOT, item.slot >>> 0),
  };
}

function buildInventorySnapshot(session: InventorySessionLike): InventoryState['inventory'] {
  const bagSize = typeof session.bagSize === 'number' && session.bagSize > 0 ? session.bagSize : DEFAULT_BAG_SIZE;
  const nextItemInstanceId =
    typeof session.nextItemInstanceId === 'number' && session.nextItemInstanceId > 0
      ? session.nextItemInstanceId
      : 1;
  const nextBagSlot =
    typeof session.nextBagSlot === 'number' && session.nextBagSlot >= FIRST_BAG_SLOT
      ? session.nextBagSlot
      : FIRST_BAG_SLOT;

  const snapshot = {
    bag: Array.isArray(session.bagItems)
      ? session.bagItems.map((item) => ({
          instanceId: item.instanceId >>> 0,
          templateId: item.templateId >>> 0,
          quantity: item.quantity >>> 0,
          durability:
            Number.isInteger(item.durability) && typeof item.durability === 'number'
              ? item.durability >>> 0
              : undefined,
          tradeState:
            Number.isInteger(item.tradeState) && typeof item.tradeState === 'number'
              ? (item.tradeState | 0)
              : normalizeStoredTradeState(undefined, item.bindState),
          bindState:
            Number.isInteger(item.bindState) && typeof item.bindState === 'number'
              ? (item.bindState & 0xff)
              : 0,
          stateCode:
            Number.isInteger(item.stateCode) && typeof item.stateCode === 'number'
              ? (item.stateCode & 0xff)
              : 0,
          extraValue:
            Number.isInteger(item.extraValue) && typeof item.extraValue === 'number'
              ? (item.extraValue & 0xffff)
              : 0,
          attributePairs: normalizeInstanceAttributePairs(item.attributePairs),
          equipped: item.equipped === true,
          slot: item.slot >>> 0,
        }))
      : [],
    bagSize,
    nextItemInstanceId,
    nextBagSlot,
  };
  return normalizeInventoryState({ inventory: snapshot }).inventory;
}

function normalizeInstanceAttributePairs(value: unknown): ItemInstanceAttributePair[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => ({
      value:
        Number.isInteger((entry as UnknownRecord)?.value) && typeof (entry as UnknownRecord)?.value === 'number'
          ? (((entry as UnknownRecord).value as number) & 0xffff)
          : 0,
    }))
    .filter((entry) => entry.value !== 0);
  return normalized.length > 0 ? normalized : undefined;
}

function bagHasTemplateId(session: InventorySessionLike, templateId: number): boolean {
  return getBagQuantityByTemplateId(session, templateId) > 0;
}

function getBagItemByTemplateId(session: InventorySessionLike, templateId: number): BagItem | null {
  return Array.isArray(session.bagItems)
    ? session.bagItems.find(
        (item) => item.equipped !== true && item.templateId === (templateId >>> 0)
      ) || null
    : null;
}

function getBagItemByInstanceId(session: InventorySessionLike, instanceId: number): BagItem | null {
  return Array.isArray(session.bagItems)
    ? session.bagItems.find(
        (item) => item.equipped !== true && (item.instanceId >>> 0) === (instanceId >>> 0)
      ) || null
    : null;
}

function getBagItemBySlot(session: InventorySessionLike, slot: number): BagItem | null {
  return Array.isArray(session.bagItems)
    ? session.bagItems.find(
        (item) => item.equipped !== true && (item.slot >>> 0) === (slot >>> 0)
      ) || null
    : null;
}

function getBagItemByReference(session: InventorySessionLike, reference: number): BagItem | null {
  return getBagItemByInstanceId(session, reference) || getBagItemBySlot(session, reference);
}

function getBagQuantityByTemplateId(session: InventorySessionLike, templateId: number): number {
  return Array.isArray(session.bagItems)
    ? session.bagItems.reduce(
        (total, item) => {
          if (item.equipped === true || item.templateId !== (templateId >>> 0)) {
            return total;
          }
          return total + logicalItemQuantity(item);
        },
        0
      )
    : 0;
}

function bagHasTemplateQuantity(session: InventorySessionLike, templateId: number, quantity = 1): boolean {
  return getBagQuantityByTemplateId(session, templateId) >= Math.max(1, quantity | 0);
}

function grantItemToBag(
  session: InventorySessionLike,
  templateId: number,
  quantity = 1,
  options: { bindState?: number; tradeState?: number } = {}
): UnknownRecord {
  const definition = getItemDefinition(templateId);
  if (!definition) {
    return {
      ok: false,
      reason: `Unknown templateId=${templateId}`,
    };
  }

  const normalizedQuantity = Math.max(1, quantity | 0);
  const normalizedBindState =
    Number.isInteger(options.bindState) && typeof options.bindState === 'number'
      ? (options.bindState & 0xff)
      : 0;
  const normalizedTradeState = normalizeStoredTradeState(options.tradeState, normalizedBindState);
  const bagItems = Array.isArray(session.bagItems) ? session.bagItems : [];
  const bagSize = typeof session.bagSize === 'number' && session.bagSize > 0 ? session.bagSize : DEFAULT_BAG_SIZE;
  const existingStacks = bagItems
    .filter(
      (item) =>
        item.equipped !== true &&
        item.templateId === definition.templateId &&
        normalizeStoredTradeState(item.tradeState, item.bindState) === normalizedTradeState &&
        (item.bindState ?? 0) === normalizedBindState &&
        item.quantity < definition.maxStack
    )
    .sort((left: BagItem, right: BagItem) => left.slot - right.slot);
  const availableStackSpace = existingStacks.reduce(
    (total, item) => total + Math.max(0, definition.maxStack - item.quantity),
    0
  );
  const freeSlotCount = Math.max(
    0,
    bagSize - new Set(bagItems.filter((item) => item.equipped !== true).map((item) => item.slot)).size
  );
  const totalCapacity = availableStackSpace + freeSlotCount * definition.maxStack;
  if (totalCapacity < normalizedQuantity) {
    return {
      ok: false,
      reason: 'Bag is full',
    };
  }

  const changes: InventoryChange[] = [];
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
    typeof session.nextItemInstanceId === 'number' && session.nextItemInstanceId > 0
      ? session.nextItemInstanceId
      : 1;
  let nextPreferredSlot =
    typeof session.nextBagSlot === 'number' && session.nextBagSlot >= FIRST_BAG_SLOT
      ? session.nextBagSlot
      : FIRST_BAG_SLOT;
  while (remainingQuantity > 0) {
    const slot = findNextAvailableSlot(bagItems, bagSize, nextPreferredSlot);
    const stackQuantity = Math.min(definition.maxStack, remainingQuantity);
    const item: BagItem = {
      instanceId: nextInstanceId,
      templateId: definition.templateId,
      quantity: isEquipmentDefinition(definition) ? 1 : initialStoredQuantityForGrant(definition, stackQuantity),
      durability: initialStoredItemDurabilityForGrant(definition),
      tradeState: normalizedTradeState,
      bindState: normalizedBindState,
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

  bagItems.sort((left: BagItem, right: BagItem) => left.slot - right.slot);
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

function consumeItemFromBag(session: InventorySessionLike, templateId: number, quantity = 1): UnknownRecord {
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
    .sort((left: BagItem, right: BagItem) => left.slot - right.slot);
  const changes: InventoryChange[] = [];
  const removedItems: BagItem[] = [];

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

  session.bagItems = bagItems.sort((left: BagItem, right: BagItem) => left.slot - right.slot);
  const bagSize = typeof session.bagSize === 'number' && session.bagSize > 0 ? session.bagSize : DEFAULT_BAG_SIZE;
  const nextBagSlot =
    typeof session.nextBagSlot === 'number' ? session.nextBagSlot : bagSize + 1;
  session.nextBagSlot = findNextAvailableSlot(
    session.bagItems,
    bagSize,
    removedItems.reduce(
      (lowestSlot, item) => Math.min(lowestSlot, item.slot >>> 0),
      nextBagSlot
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

function removeBagItemByInstanceId(session: InventorySessionLike, instanceId: number): UnknownRecord {
  const bagItems = Array.isArray(session.bagItems) ? session.bagItems : [];
  const targetIndex = bagItems.findIndex((item) => (item.instanceId >>> 0) === (instanceId >>> 0));
  if (targetIndex < 0) {
    return {
      ok: false,
      reason: `Unknown instanceId=${instanceId}`,
    };
  }

  const removedItem = bagItems[targetIndex];
  bagItems.splice(targetIndex, 1);
  session.bagItems = bagItems.sort((left: BagItem, right: BagItem) => left.slot - right.slot);
  const bagSize = typeof session.bagSize === 'number' && session.bagSize > 0 ? session.bagSize : DEFAULT_BAG_SIZE;
  const nextBagSlot = typeof session.nextBagSlot === 'number' ? session.nextBagSlot : bagSize + 1;
  session.nextBagSlot = findNextAvailableSlot(
    session.bagItems,
    bagSize,
    Math.min(nextBagSlot, removedItem.slot >>> 0)
  );
  return {
    ok: true,
    item: removedItem,
    removed: true,
    changes: [
      {
        item: removedItem,
        quantityRemoved: logicalItemQuantity(removedItem),
        removed: true,
      },
    ],
    removedItems: [removedItem],
  };
}

function consumeBagItemByInstanceId(session: InventorySessionLike, instanceId: number, quantity = 1): UnknownRecord {
  const bagItems = Array.isArray(session.bagItems) ? session.bagItems : [];
  const normalizedQuantity = Math.max(1, quantity | 0);
  const targetItem =
    bagItems.find((item) => item.equipped !== true && (item.instanceId >>> 0) === (instanceId >>> 0)) || null;
  if (!targetItem) {
    return {
      ok: false,
      reason: `Unknown instanceId=${instanceId}`,
    };
  }

  const definition = getItemDefinition(targetItem.templateId);
  const logicalQuantity = logicalItemQuantity(targetItem);
  if (!definition || logicalQuantity < normalizedQuantity) {
    return {
      ok: false,
      reason: `Insufficient quantity for instanceId=${instanceId}`,
    };
  }

  if (isEquipmentDefinition(definition) || definition.maxStack <= 1) {
    return removeBagItemByInstanceId(session, instanceId);
  }

  targetItem.quantity -= normalizedQuantity;
  const removed = targetItem.quantity <= 0;
  if (removed) {
    const targetIndex = bagItems.indexOf(targetItem);
    if (targetIndex >= 0) {
      bagItems.splice(targetIndex, 1);
    }
  }

  session.bagItems = bagItems.sort((left: BagItem, right: BagItem) => left.slot - right.slot);
  const bagSize = typeof session.bagSize === 'number' && session.bagSize > 0 ? session.bagSize : DEFAULT_BAG_SIZE;
  const nextBagSlot = typeof session.nextBagSlot === 'number' ? session.nextBagSlot : bagSize + 1;
  session.nextBagSlot = findNextAvailableSlot(
    session.bagItems,
    bagSize,
    removed ? Math.min(nextBagSlot, targetItem.slot >>> 0) : nextBagSlot
  );

  return {
    ok: true,
    item: targetItem,
    removed,
    changes: [
      {
        item: targetItem,
        quantityRemoved: normalizedQuantity,
        removed,
      },
    ],
    removedItems: removed ? [targetItem] : [],
  };
}

function normalizeBagLayout(items: BagItem[], bagSize: number): BagItem[] {
  const usedSlots = new Set<number>();
  const usedInstanceIds = new Set<number>();
  let nextInstanceId = 1;
  const bag: BagItem[] = [];

  for (const originalItem of items) {
    const definition = getItemDefinition(originalItem.templateId);
    if (!definition) {
      continue;
    }

    let remainingQuantity = logicalItemQuantity(originalItem);
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
      const quantity = isEquipment ? remainingQuantity : Math.min(definition.maxStack, remainingQuantity);
      bag.push({
        ...originalItem,
        instanceId,
        quantity,
        durability: normalizeStoredItemDurability(definition, originalItem.durability, originalItem.quantity),
        slot,
      });
      remainingQuantity = isEquipment ? 0 : remainingQuantity - quantity;
      preferredSlot = slot + 1;
      firstSplit = false;
    }
  }

  return bag;
}

function computeRequiredBagSlots(items: BagItem[]): number {
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

function findNextAvailableSlot(items: BagItem[], bagSize: number, startSlot = FIRST_BAG_SLOT): number {
  const usedSlots = new Set<number>(
    Array.isArray(items) ? items.filter((item) => item?.equipped !== true).map((item) => item.slot) : []
  );
  const preferredSlot = Math.max(FIRST_BAG_SLOT, startSlot | 0);
  const fromPreferred = findNextOpenSlot(usedSlots, bagSize, preferredSlot);
  if (fromPreferred !== null) {
    return fromPreferred;
  }
  return bagSize + 1;
}

function findNextOpenSlot(
  usedSlots: Set<number>,
  bagSize: number,
  startSlot = FIRST_BAG_SLOT
): number | null {
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

function initialStoredQuantityForGrant(definition: ItemDefinition, requestedQuantity: number): number {
  return Math.max(1, requestedQuantity | 0);
}

function normalizeStoredItemQuantity(definition: ItemDefinition, rawQuantity: number): number {
  if (!Number.isInteger(rawQuantity) || rawQuantity <= 0) {
    return 1;
  }
  return rawQuantity;
}

function initialStoredItemDurabilityForGrant(definition: ItemDefinition): number | undefined {
  if (!isEquipmentDefinition(definition)) {
    return undefined;
  }
  const defaultQuantity =
    typeof definition.defaultQuantity === 'number' ? definition.defaultQuantity : 0;
  return Number.isInteger(defaultQuantity) && defaultQuantity > 0 ? defaultQuantity : 0;
}

function normalizeStoredItemDurability(
  definition: ItemDefinition,
  rawDurability: unknown,
  legacyQuantity: number
): number | undefined {
  if (!isEquipmentDefinition(definition)) {
    return undefined;
  }
  const defaultDurability = initialStoredItemDurabilityForGrant(definition);
  if (Number.isInteger(rawDurability) && (rawDurability as number) >= 0) {
    if (typeof defaultDurability === 'number' && defaultDurability > 0 && (rawDurability as number) > defaultDurability) {
      return defaultDurability;
    }
    return rawDurability as number;
  }
  if (Number.isInteger(legacyQuantity) && legacyQuantity >= 0 && legacyQuantity > 1) {
    if (typeof defaultDurability === 'number' && defaultDurability > 0 && legacyQuantity > defaultDurability) {
      return defaultDurability;
    }
    return legacyQuantity;
  }
  if (typeof defaultDurability === 'number') {
    return defaultDurability;
  }
  if (Number.isInteger(legacyQuantity) && legacyQuantity >= 0) {
    return legacyQuantity;
  }
  return defaultDurability;
}

function normalizeStoredTradeState(rawTradeState: unknown, rawBindState: unknown): number {
  if (Number.isInteger(rawTradeState) && typeof rawTradeState === 'number') {
    return rawTradeState | 0;
  }
  return Number.isInteger(rawBindState) && typeof rawBindState === 'number' && ((rawBindState as number) & 0xff) > 0
    ? -2
    : 0;
}

function logicalItemQuantity(item: BagItem): number {
  const definition = getItemDefinition(item.templateId);
  if (definition && isEquipmentDefinition(definition)) {
    return 1;
  }
  return Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 1;
}

export {
  buildInventorySnapshot,
  bagHasTemplateId,
  bagHasTemplateQuantity,
  consumeItemFromBag,
  getBagItemByInstanceId,
  getBagItemBySlot,
  getBagItemByReference,
  getBagQuantityByTemplateId,
  getBagItemByTemplateId,
  grantItemToBag,
  normalizeInventoryState,
  consumeBagItemByInstanceId,
  removeBagItemByInstanceId,
};
