import fs from 'fs';
import path from 'path';

const { resolveRepoPath } = require('./runtime-paths');

const BAG_CONTAINER_TYPE = 1;
const DEFAULT_BAG_SIZE = 24;
const FIRST_BAG_SLOT = 1;
const CLIENT_DERIVED_ROOT = resolveRepoPath('data', 'client-derived');
const EQUIPMENT_TABLE_FILE = path.join(CLIENT_DERIVED_ROOT, 'equipment.json');
const WEAPON_TABLE_FILE = path.join(CLIENT_DERIVED_ROOT, 'weapons.json');
const GENERAL_ITEM_TABLE_FILE = path.join(CLIENT_DERIVED_ROOT, 'items.json');
const POTION_TABLE_FILE = path.join(CLIENT_DERIVED_ROOT, 'potions.json');
const STUFF_TABLE_FILE = path.join(CLIENT_DERIVED_ROOT, 'stuff.json');
const ITEMINFO_TABLE_FILE = path.join(CLIENT_DERIVED_ROOT, 'iteminfo.json');
const RAW_ARMOR_TABLE_FILE = path.join(CLIENT_DERIVED_ROOT, 'raw', 'is_armor.txt');
const RAW_WEAPON_TABLE_FILE = path.join(CLIENT_DERIVED_ROOT, 'raw', 'is_weapon.txt');

type UnknownRecord = Record<string, any>;

interface AttributePair {
  value: number;
}

interface ItemInstanceAttributePair {
  value: number;
}

interface ItemDefinition {
  templateId: number;
  name: string;
  containerType: number;
  maxStack: number;
  clientTemplateFamily: number | null;
  isQuestItem?: boolean;
  captureProfile?: {
    maxTargetLevel: number;
    requiresDying: boolean;
  };
  consumableEffect?: {
    health: number;
    mana: number;
    rage: number;
  };
  hasDurability?: boolean;
  sellPrice?: number;
  defaultQuantity?: number;
  defaultAttributePairs?: AttributePair[];
  equipSlotField?: number | null;
  restrictions?: UnknownRecord;
  combatStats?: UnknownRecord;
  iconPath: string;
  clientEvidence: string;
}

interface ItemInfoEntry {
  field1?: number | null;
  field2?: number | null;
  field3?: number | null;
  field4?: number | null;
}

interface BagItem {
  instanceId: number;
  templateId: number;
  quantity: number;
  durability?: number;
  tradeState?: number;
  bindState?: number;
  stateCode?: number;
  extraValue?: number;
  attributePairs?: ItemInstanceAttributePair[];
  equipped: boolean;
  slot: number;
}

interface InventoryState {
  inventory: {
    bag: BagItem[];
    bagSize: number;
    nextItemInstanceId: number;
    nextBagSlot: number;
  };
}

interface InventorySessionLike {
  bagItems?: BagItem[];
  bagSize?: number;
  nextItemInstanceId?: number;
  nextBagSlot?: number;
}

interface InventoryChange {
  item: BagItem;
  quantityAdded?: number;
  quantityRemoved?: number;
  merged?: boolean;
  removed?: boolean;
}

const ITEMINFO_BY_TEMPLATE_ID = loadItemInfoMap();
const EQUIPMENT_VALUE_BY_TEMPLATE_ID = loadEquipmentValueMap();
const ITEM_DEFINITIONS: readonly ItemDefinition[] = Object.freeze([
  ...loadClientGeneralItemDefinitions(),
  ...loadClientPotionDefinitions(),
  ...loadClientStuffDefinitions(),
  ...loadEquipmentDefinitions(),
]);

const ITEMS_BY_TEMPLATE_ID = new Map<number, ItemDefinition>(
  ITEM_DEFINITIONS.map((definition) => [definition.templateId, definition])
);

function getItemDefinition(templateId: number): ItemDefinition | null {
  return ITEMS_BY_TEMPLATE_ID.get(templateId) || null;
}

function loadEquipmentDefinitions(): ItemDefinition[] {
  return [
    ...loadClientEquipmentDefinitions(EQUIPMENT_TABLE_FILE, 'armor'),
    ...loadClientEquipmentDefinitions(WEAPON_TABLE_FILE, 'weapon'),
  ];
}

function loadClientGeneralItemDefinitions(): ItemDefinition[] {
  return loadClientStackableDefinitions(GENERAL_ITEM_TABLE_FILE, 'is_general.txt');
}

function loadClientPotionDefinitions(): ItemDefinition[] {
  return loadClientStackableDefinitions(POTION_TABLE_FILE, 'is_potion.txt');
}

function loadClientStuffDefinitions(): ItemDefinition[] {
  const entries = loadClientDerivedEntries(STUFF_TABLE_FILE);
  return entries
    .filter((entry) => Number.isInteger(entry?.templateId))
    .map((entry) => ({
      templateId: entry.templateId,
      name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : `Item ${entry.templateId}`,
      containerType: BAG_CONTAINER_TYPE,
      maxStack: 1,
      clientTemplateFamily: null,
      isQuestItem: isQuestItemEntry(entry),
      sellPrice: resolveClientSellPrice(entry, 'stuff'),
      iconPath: typeof entry.iconPath === 'string' ? entry.iconPath : '',
      clientEvidence: `Client-derived is_stuff.txt row ${entry.templateId} from ${path.basename(STUFF_TABLE_FILE)}.`,
    }));
}

function loadClientStackableDefinitions(filePath: string, sourceLabel: string): ItemDefinition[] {
  const entries = loadClientDerivedEntries(filePath);
  return entries
    .filter((entry) => Number.isInteger(entry?.templateId) && Number.isInteger(entry?.clientTemplateFamily))
    .map((entry) => ({
      templateId: entry.templateId,
      name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : `Item ${entry.templateId}`,
      containerType: BAG_CONTAINER_TYPE,
      maxStack:
        Number.isInteger(entry.stackLimitField) && entry.stackLimitField > 0 ? entry.stackLimitField : 1,
      clientTemplateFamily: entry.clientTemplateFamily,
      isQuestItem: isQuestItemEntry(entry),
      captureProfile: resolveCaptureProfile(entry, sourceLabel),
      consumableEffect: resolveConsumableEffect(entry, sourceLabel),
      sellPrice: resolveClientSellPrice(entry, sourceLabel === 'is_potion.txt' ? 'potion' : 'general'),
      iconPath: typeof entry.iconPath === 'string' ? entry.iconPath : '',
      clientEvidence: `Client-derived ${sourceLabel} row ${entry.templateId} from ${path.basename(filePath)}.`,
    }));
}

function loadClientEquipmentDefinitions(filePath: string, kind: 'armor' | 'weapon'): ItemDefinition[] {
  const entries = loadClientDerivedEntries(filePath);
  const rows: ItemDefinition[] = [];
  for (const entry of entries) {
    if (!Number.isInteger(entry?.templateId) || !Number.isInteger(entry?.clientTemplateFamily)) {
      continue;
    }
    const durabilityBase = entry.baseDurabilityField;
    const defaultQuantity =
      Number.isInteger(durabilityBase) && durabilityBase > 0 ? durabilityBase * 300 : 0;
    const defaultAttributePairs = resolveEquipmentDefaultAttributePairs(entry, kind);

    rows.push({
      templateId: entry.templateId,
      name: entry.name || `Item ${entry.templateId}`,
      containerType: BAG_CONTAINER_TYPE,
      maxStack: 1,
      clientTemplateFamily: entry.clientTemplateFamily,
      isQuestItem: isQuestItemEntry(entry),
      hasDurability: true,
      sellPrice: resolveClientSellPrice(entry, kind),
      defaultQuantity,
      defaultAttributePairs,
      equipSlotField: Number.isInteger(entry?.equipSlotField) ? entry.equipSlotField : null,
      restrictions: entry?.restrictions && typeof entry.restrictions === 'object' ? entry.restrictions : undefined,
      combatStats: entry?.combatStats && typeof entry.combatStats === 'object' ? entry.combatStats : undefined,
      iconPath: typeof entry.iconPath === 'string' ? entry.iconPath : '',
      clientEvidence:
        `Client-derived ${path.basename(filePath)} row ${entry.templateId} derives family and equipment instance defaults.`,
    });
  }

  return rows;
}

function resolveEquipmentDefaultAttributePairs(entry: UnknownRecord, kind: 'armor' | 'weapon'): AttributePair[] {
  const instanceDefaults =
    entry?.defaultInstanceFields && typeof entry.defaultInstanceFields === 'object'
      ? entry.defaultInstanceFields
      : {};
  if (kind === 'armor') {
    return [
      { value: positiveIntOrZero(instanceDefaults.defense) },
      { value: positiveIntOrZero(instanceDefaults.magicDefense) },
    ];
  }
  return [
    { value: positiveIntOrZero(instanceDefaults.attackMin) },
    { value: positiveIntOrZero(instanceDefaults.attackMax) },
    { value: positiveIntOrZero(instanceDefaults.magicAttackMin) },
    { value: positiveIntOrZero(instanceDefaults.magicAttackMax) },
    { value: 0 },
    { value: 0 },
  ];
}

function loadClientDerivedEntries(filePath: string): UnknownRecord[] {
  let parsed: UnknownRecord;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as UnknownRecord;
  } catch (_err) {
    return [];
  }
  return Array.isArray(parsed?.entries) ? parsed.entries : [];
}

function isQuestItemEntry(entry: UnknownRecord): boolean {
  const tooltipMarkup = typeof entry?.tooltipMarkup === 'string' ? entry.tooltipMarkup : '';
  const description = typeof entry?.description === 'string' ? entry.description : '';
  return /quest item/i.test(`${tooltipMarkup} ${description}`);
}

function resolveConsumableEffect(
  entry: UnknownRecord,
  sourceLabel: string
): ItemDefinition['consumableEffect'] | undefined {
  if (sourceLabel !== 'is_potion.txt') {
    return undefined;
  }

  const effectFields =
    entry?.effectFieldsNamed && typeof entry.effectFieldsNamed === 'object'
      ? entry.effectFieldsNamed
      : {};
  const usageFields = Array.isArray(entry?.usageFields) ? entry.usageFields : [];
  const hasUsageHealth = usageFields.length > 3;
  const hasUsageMana = usageFields.length > 4;
  const hasUsageRage = usageFields.length > 5;
  const health = hasUsageHealth
    ? positiveIntOrZero(usageFields[3])
    : positiveIntOrZero(effectFields.health);
  const mana = hasUsageMana
    ? positiveIntOrZero(usageFields[4])
    : positiveIntOrZero(effectFields.mana);
  const rage = hasUsageRage
    ? positiveIntOrZero(usageFields[5])
    : positiveIntOrZero(effectFields.rage);
  if (health <= 0 && mana <= 0 && rage <= 0) {
    return undefined;
  }

  return { health, mana, rage };
}

function resolveCaptureProfile(
  entry: UnknownRecord,
  sourceLabel: string
): ItemDefinition['captureProfile'] | undefined {
  if (sourceLabel !== 'is_general.txt') {
    return undefined;
  }
  if ((entry?.clientTemplateFamily ?? 0) !== 131) {
    return undefined;
  }
  const templateId = Number.isInteger(entry?.templateId) ? entry.templateId : 0;
  if (templateId < 29000 || templateId > 29011) {
    return undefined;
  }
  const valueFields = Array.isArray(entry?.valueFields) ? entry.valueFields : [];
  const maxTargetLevel = positiveIntOrZero(valueFields[2]);
  if (maxTargetLevel <= 0) {
    return undefined;
  }
  const requiresDying = valueFields.length > 4 ? positiveIntOrZero(valueFields[4]) === 0 : false;
  return {
    maxTargetLevel,
    requiresDying,
  };
}

function loadItemInfoMap(): Map<number, ItemInfoEntry> {
  const entries = loadClientDerivedEntries(ITEMINFO_TABLE_FILE);
  return new Map(
    entries
      .filter((entry) => Number.isInteger(entry?.templateId))
      .map((entry) => [
        entry.templateId,
        {
          field1: Number.isInteger(entry?.field1) ? entry.field1 : null,
          field2: Number.isInteger(entry?.field2) ? entry.field2 : null,
          field3: Number.isInteger(entry?.field3) ? entry.field3 : null,
          field4: Number.isInteger(entry?.field4) ? entry.field4 : null,
        },
      ])
  );
}

function loadEquipmentValueMap(): Map<number, number> {
  const rows = [
    ...loadRawEquipmentValueRows(RAW_ARMOR_TABLE_FILE),
    ...loadRawEquipmentValueRows(RAW_WEAPON_TABLE_FILE),
  ];
  return new Map(rows);
}

function loadRawEquipmentValueRows(filePath: string): Array<[number, number]> {
  let rawText = '';
  try {
    rawText = fs.readFileSync(filePath, 'utf8');
  } catch (_err) {
    return [];
  }

  const rows: Array<[number, number]> = [];
  for (const line of rawText.split(/\r?\n/)) {
    const columns = splitCsvColumns(line);
    if (columns.length < 11) {
      continue;
    }
    const templateId = parseInt(columns[0] || '', 10);
    const baseValue = parseInt(columns[9] || '', 10);
    if (!Number.isInteger(templateId) || templateId <= 0) {
      continue;
    }
    if (!Number.isInteger(baseValue) || baseValue <= 0) {
      continue;
    }
    rows.push([templateId, baseValue]);
  }
  return rows;
}

function splitCsvColumns(line: string): string[] {
  if (typeof line !== 'string' || line.length === 0) {
    return [];
  }
  const columns: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      columns.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  columns.push(current);
  return columns;
}

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

function isEquipmentDefinition(definition: ItemDefinition): boolean {
  if (definition?.hasDurability === true) {
    return true;
  }
  return (
    Number.isInteger(definition?.clientTemplateFamily) &&
    (definition.clientTemplateFamily as number) >= 0x20 &&
    (definition.clientTemplateFamily as number) < 0x40
  );
}

function getEquippedItems(session: InventorySessionLike): BagItem[] {
  return Array.isArray(session.bagItems)
    ? session.bagItems.filter((item) => item?.equipped === true)
    : [];
}

function getEquipmentCombatBonuses(session: InventorySessionLike): UnknownRecord {
  return getEquippedItems(session).reduce((totals: UnknownRecord, item: BagItem) => {
    const definition = getItemDefinition(item.templateId);
    const stats = definition?.combatStats && typeof definition.combatStats === 'object'
      ? definition.combatStats
      : {};
    totals.attackMin += positiveIntOrZero(stats.attackMin);
    totals.attackMax += positiveIntOrZero(stats.attackMax);
    totals.magicAttackMin += positiveIntOrZero(stats.magicAttackMin);
    totals.magicAttackMax += positiveIntOrZero(stats.magicAttackMax);
    totals.defense += positiveIntOrZero(stats.defense);
    totals.magicDefense += positiveIntOrZero(stats.magicDefense);
    return totals;
  }, {
    attackMin: 0,
    attackMax: 0,
    magicAttackMin: 0,
    magicAttackMax: 0,
    defense: 0,
    magicDefense: 0,
  });
}

function canEquipItem(session: UnknownRecord, item: BagItem): UnknownRecord {
  const definition = getItemDefinition(item?.templateId);
  if (!definition || definition.hasDurability !== true) {
    return { ok: false, reason: 'Item is not equippable' };
  }

  const restrictions =
    definition.restrictions && typeof definition.restrictions === 'object'
      ? definition.restrictions
      : {};
  const requiredLevel = positiveIntOrZero(restrictions.requiredLevel);
  if (requiredLevel > 0 && Math.max(1, session?.level || 1) < requiredLevel) {
    return { ok: false, reason: `Requires level ${requiredLevel}` };
  }

  const requiredGenderCode = positiveIntOrZero(restrictions.genderCode);
  if (requiredGenderCode > 0) {
    const roleEntityType = (session?.roleEntityType || session?.entityType || 0) >>> 0;
    const isFemale = roleEntityType >= 1001 && roleEntityType <= 1024
      ? (roleEntityType & 1) === 0
      : (Math.max(0, roleEntityType - 1000) & 1) === 1;
    const genderCode = isFemale ? 2 : 1;
    if (genderCode !== requiredGenderCode) {
      return { ok: false, reason: requiredGenderCode === 2 ? 'Female only' : 'Male only' };
    }
  }

  return { ok: true };
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

function positiveIntOrZero(value: unknown): number {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : 0;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return Number.isInteger(value) ? (value as number) : fallback;
}

function resolveClientSellPrice(
  entry: UnknownRecord,
  category: 'general' | 'potion' | 'stuff' | 'armor' | 'weapon'
): number {
  const templateId = Number.isInteger(entry?.templateId) ? entry.templateId : 0;
  const itemInfo = ITEMINFO_BY_TEMPLATE_ID.get(templateId) || null;
  if (category === 'potion') {
    if (Array.isArray(entry?.effectFields) && Number.isInteger(entry.effectFields[4]) && entry.effectFields[4] > 0) {
      const divisor =
        Number.isInteger(entry?.stackLimitField) && entry.stackLimitField > 0 ? entry.stackLimitField : 1;
      return computeClientDisplayedSellPrice(entry.effectFields[4], divisor);
    }
  } else if (category === 'general') {
    if (itemInfo) {
      const infoPrice = resolveItemInfoSellPrice(itemInfo);
      if (infoPrice > 0) {
        return infoPrice;
      }
    }
    if (Array.isArray(entry?.valueFields)) {
      const valueFields = entry.valueFields.filter(
        (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0
      );
      if (valueFields.length > 0) {
        return computeClientDisplayedSellPrice(Math.max(...valueFields), 1);
      }
    }
  } else if (category === 'stuff') {
    if (itemInfo) {
      const infoPrice = resolveItemInfoSellPrice(itemInfo);
      if (infoPrice > 0) {
        return infoPrice;
      }
    }
    if (Array.isArray(entry?.groupFields)) {
      const groupFields = entry.groupFields.filter(
        (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0
      );
      if (groupFields.length > 0) {
        return computeClientDisplayedSellPrice(Math.max(...groupFields), 1);
      }
    }
  } else if (category === 'armor' || category === 'weapon') {
    const equipmentBaseValue = EQUIPMENT_VALUE_BY_TEMPLATE_ID.get(templateId) || 0;
    if (equipmentBaseValue > 0) {
      return computeClientDisplayedSellPrice(equipmentBaseValue, 1);
    }
    const templateLevel = Number.isInteger(entry?.templateLevelField) ? entry.templateLevelField : 0;
    if (templateLevel > 0) {
      return Math.max(1, templateLevel * 10);
    }
  }

  return 1;
}

function resolveItemInfoSellPrice(itemInfo: ItemInfoEntry): number {
  const baseValue = Number.isInteger(itemInfo.field1) ? (itemInfo.field1 as number) : 0;
  const fallbackDivisor = Number.isInteger(itemInfo.field2) ? (itemInfo.field2 as number) : 1;
  const ratioDivisor =
    Number.isInteger(itemInfo.field4) && (itemInfo.field4 as number) > 0 ? (itemInfo.field4 as number) : 0;
  if (baseValue > 0 && ratioDivisor > 0) {
    return Math.max(1, Math.floor(baseValue / ratioDivisor));
  }
  return computeClientDisplayedSellPrice(baseValue, fallbackDivisor);
}

function computeClientDisplayedSellPrice(baseValue: number, divisorValue: number): number {
  const normalizedBase = Number.isInteger(baseValue) ? Math.max(0, baseValue) : 0;
  const normalizedDivisor =
    Number.isInteger(divisorValue) && divisorValue > 0 ? divisorValue : 1;
  if (normalizedBase <= 0) {
    return 0;
  }
  return Math.max(1, Math.floor(normalizedBase / (normalizedDivisor * 4)));
}

export {
  BAG_CONTAINER_TYPE,
  DEFAULT_BAG_SIZE,
  FIRST_BAG_SLOT,
  buildInventorySnapshot,
  bagHasTemplateId,
  bagHasTemplateQuantity,
  consumeItemFromBag,
  getBagItemByInstanceId,
  getBagItemBySlot,
  getBagItemByReference,
  getBagQuantityByTemplateId,
  getBagItemByTemplateId,
  getItemDefinition,
  grantItemToBag,
  normalizeInventoryState,
  consumeBagItemByInstanceId,
  removeBagItemByInstanceId,
  canEquipItem,
  getEquippedItems,
  getEquipmentCombatBonuses,
};
