import fs from 'node:fs';
import path from 'node:path';

import { resolveRepoPath } from '../runtime-paths.js';

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
const EQUIPMENT_VALUE_TABLE_FILE = path.join(CLIENT_DERIVED_ROOT, 'equipment-values.json');

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
  itemSetId?: number | null;
  enhancementGrowthId?: number | null;
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
    const baseRestrictions =
      entry?.restrictions && typeof entry.restrictions === 'object' ? { ...entry.restrictions } : {};
    const restrictions = normalizeEquipmentRestrictions(baseRestrictions, entry, kind);
    const itemSetId = resolveEquipmentSetId(entry, kind);
    const enhancementGrowthId = resolveEquipmentEnhancementGrowthId(entry, kind);

    rows.push({
      templateId: entry.templateId,
      name: entry.name || `Item ${entry.templateId}`,
      containerType: BAG_CONTAINER_TYPE,
      maxStack: 1,
      clientTemplateFamily: entry.clientTemplateFamily,
      itemSetId: itemSetId > 0 ? itemSetId : null,
      enhancementGrowthId: enhancementGrowthId > 0 ? enhancementGrowthId : null,
      isQuestItem: isQuestItemEntry(entry),
      hasDurability: true,
      sellPrice: resolveClientSellPrice(entry, kind),
      defaultQuantity,
      defaultAttributePairs,
      equipSlotField: Number.isInteger(entry?.equipSlotField) ? entry.equipSlotField : null,
      restrictions,
      combatStats: entry?.combatStats && typeof entry.combatStats === 'object' ? entry.combatStats : undefined,
      iconPath: typeof entry.iconPath === 'string' ? entry.iconPath : '',
      clientEvidence:
        `Client-derived ${path.basename(filePath)} row ${entry.templateId} derives family and equipment instance defaults.`,
    });
  }

  return rows;
}

function normalizeEquipmentRestrictions(
  baseRestrictions: UnknownRecord,
  entry: UnknownRecord,
  kind: 'armor' | 'weapon'
): UnknownRecord | undefined {
  const normalized = { ...baseRestrictions };

  const templateLevel = positiveIntOrZero(entry?.templateLevelField);
  if (templateLevel > 0) {
    normalized.requiredLevel = templateLevel;
  }

  if (kind === 'armor' || kind === 'weapon') {
    const raw = Array.isArray(entry?.restrictionFields) ? entry.restrictionFields : [];
    const attributeOrder = ['strength', 'dexterity', 'vitality', 'intelligence'] as const;
    for (let index = 0; index < attributeOrder.length; index += 1) {
      const value = positiveIntOrZero(raw[7 + index]);
      if (value > 0) {
        normalized.requiredAttribute = attributeOrder[index];
        normalized.requiredAttributeValue = value;
        break;
      }
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
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

function resolveEquipmentSetId(entry: UnknownRecord, kind: 'armor' | 'weapon'): number {
  const combatFields = Array.isArray(entry?.combatFields) ? entry.combatFields : [];
  const candidateIndex = kind === 'weapon' ? 10 : 2;
  const candidate = Number.isInteger(combatFields[candidateIndex]) ? combatFields[candidateIndex] : 0;
  return candidate > 0 && candidate < 0x100 ? candidate : 0;
}

function resolveEquipmentEnhancementGrowthId(entry: UnknownRecord, kind: 'armor' | 'weapon'): number {
  const combatFields = Array.isArray(entry?.combatFields) ? entry.combatFields : [];
  const candidateIndex = kind === 'weapon' ? 11 : 5;
  const candidate = Number.isInteger(combatFields[candidateIndex]) ? combatFields[candidateIndex] : 0;
  return candidate > 0 && candidate < 0x100 ? candidate : 0;
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
  const payload = loadClientDerivedEntries(EQUIPMENT_VALUE_TABLE_FILE);
  return new Map(
    payload
      .filter((entry) => Number.isInteger(entry?.templateId) && Number.isInteger(entry?.clientValueField))
      .map((entry) => [entry.templateId, entry.clientValueField])
  );
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

  const requiredAttribute = typeof restrictions.requiredAttribute === 'string' ? restrictions.requiredAttribute : null;
  const requiredAttributeValue = positiveIntOrZero(restrictions.requiredAttributeValue);
  if (requiredAttribute && requiredAttributeValue > 0) {
    const currentValue = positiveIntOrZero(session?.primaryAttributes?.[requiredAttribute]);
    if (currentValue < requiredAttributeValue) {
      return { ok: false, reason: `Requires ${requiredAttribute} ${requiredAttributeValue}` };
    }
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
  getItemDefinition,
  isEquipmentDefinition,
  canEquipItem,
  getEquippedItems,
  getEquipmentCombatBonuses,
  positiveIntOrZero,
  numberOrDefault,
};

export type {
  UnknownRecord,
  AttributePair,
  ItemInstanceAttributePair,
  ItemDefinition,
  ItemInfoEntry,
  BagItem,
  InventoryState,
  InventorySessionLike,
  InventoryChange,
};
