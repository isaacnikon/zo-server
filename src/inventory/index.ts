export {
  BAG_CONTAINER_TYPE,
  DEFAULT_BAG_SIZE,
  FIRST_BAG_SLOT,
  getItemDefinition,
  isEquipmentDefinition,
  canEquipItem,
  getEquippedItems,
  getEquipmentCombatBonuses,
} from './data.js';

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
} from './data.js';

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
} from './bag.js';
