const { DEFAULT_FLAGS, GAME_ITEM_CMD, GAME_ITEM_CONTAINER_CMD } = require('../config');
const {
  buildInventoryContainerBulkSyncPacket,
  buildInventoryContainerQuantityPacket,
  buildItemAddPacket,
  buildItemRemovePacket,
} = require('../protocol/gameplay-packets');
const {
  BAG_CONTAINER_TYPE,
  getItemDefinition,
} = require('../inventory');
const { applyEffects } = require('../effects/effect-executor');

const EQUIPMENT_CONTAINER_TYPE = 0;

type UnknownRecord = Record<string, any>;
type SessionLike = Record<string, any>;

function sendItemAdd(
  session: SessionLike,
  templateId: number,
  slot: number,
  quantity = 1,
  durability: number | undefined = undefined,
  tradeState = 0,
  instanceId = 0
): void {
  const definition = getItemDefinition(templateId);
  const encodedQuantity = resolveClientItemQuantity(definition, quantity, durability);
  session.writePacket(
    buildItemAddPacket({
      containerType: BAG_CONTAINER_TYPE,
      slot,
      templateId,
      instanceId,
      tradeState,
      stateCode: 0,
      bindState: 0,
      quantity: encodedQuantity,
      extraValue: 0,
      clientTemplateFamily: definition?.clientTemplateFamily ?? null,
      attributePairs: Array.isArray(definition?.defaultAttributePairs) ? definition.defaultAttributePairs : [],
    }),
    DEFAULT_FLAGS,
    `Sending item add cmd=0x${GAME_ITEM_CMD.toString(16)} templateId=${templateId} slot=${slot} qty=${quantity} instanceId=${instanceId}${definition ? ` name=${definition.name}` : ''}`
  );
}

function sendInventoryFullSync(session: SessionLike): void {
  const bagItems = Array.isArray(session.bagItems)
    ? session.bagItems
        .filter((item: UnknownRecord) => item.equipped !== true)
        .map((item: UnknownRecord) => buildClientInventoryItem(item))
    : [];
  session.writePacket(
    buildInventoryContainerBulkSyncPacket({
      containerType: BAG_CONTAINER_TYPE,
      items: bagItems,
    }),
    DEFAULT_FLAGS,
    `Sending inventory full sync cmd=0x${GAME_ITEM_CONTAINER_CMD.toString(16)} container=${BAG_CONTAINER_TYPE} items=${bagItems.length}`
  );
}

function buildClientInventoryItem(item: UnknownRecord): UnknownRecord {
  const definition = getItemDefinition(item.templateId);
  const itemAttributePairs = Array.isArray(item.attributePairs)
    ? item.attributePairs
        .map((pair: UnknownRecord) => ({
          value: Number.isInteger(pair?.value) ? (pair.value & 0xffff) : 0,
        }))
        .filter((pair: UnknownRecord) => pair.value !== 0)
    : [];
  return {
    ...item,
    tradeState: Number.isInteger(item.tradeState) ? (item.tradeState | 0) : 0,
    stateCode: Number.isInteger(item.stateCode) ? (item.stateCode & 0xff) : 0,
    quantity: resolveClientItemQuantity(definition, item.quantity, item.durability),
    bindState: 0,
    extraValue: Number.isInteger(item.extraValue) ? (item.extraValue & 0xffff) : 0,
    clientTemplateFamily: definition?.clientTemplateFamily ?? null,
    attributePairs:
      itemAttributePairs.length > 0
        ? itemAttributePairs
        : Array.isArray(definition?.defaultAttributePairs)
          ? definition.defaultAttributePairs
          : [],
  };
}

function resolveClientItemQuantity(definition: UnknownRecord, quantity: number, durability?: number): number {
  const usesDurability = definition?.hasDurability === true;
  const normalizedDurability =
    typeof durability === 'number' && Number.isInteger(durability) ? durability : null;
  if (usesDurability && normalizedDurability !== null && normalizedDurability >= 0) {
    return normalizedDurability;
  }
  if (Number.isInteger(quantity) && (usesDurability ? quantity >= 0 : quantity > 0)) {
    return quantity;
  }
  if (Number.isInteger(definition?.defaultQuantity) && definition.defaultQuantity > 0) {
    return definition.defaultQuantity;
  }
  return usesDurability ? 0 : 1;
}

function sendEquipmentContainerSync(session: SessionLike): void {
  const equippedItems = (Array.isArray(session.bagItems) ? session.bagItems : [])
    .filter((item: UnknownRecord) => item.equipped === true)
    .map((item: UnknownRecord) => buildClientInventoryItem(item));

  session.writePacket(
    buildInventoryContainerBulkSyncPacket({
      containerType: EQUIPMENT_CONTAINER_TYPE,
      items: equippedItems,
    }),
    DEFAULT_FLAGS,
    `Sending equipment container sync cmd=0x${GAME_ITEM_CONTAINER_CMD.toString(16)} container=${EQUIPMENT_CONTAINER_TYPE} items=${equippedItems.length}`
  );
}

function sendItemQuantityUpdate(session: SessionLike, instanceId: number, quantity: number): void {
  session.writePacket(
    buildInventoryContainerQuantityPacket({
      containerType: BAG_CONTAINER_TYPE,
      instanceId,
      quantity,
    }),
    DEFAULT_FLAGS,
    `Sending item quantity update cmd=0x${GAME_ITEM_CONTAINER_CMD.toString(16)} container=${BAG_CONTAINER_TYPE} instanceId=${instanceId} qty=${quantity}`
  );
}

function sendItemRemove(session: SessionLike, instanceId: number, containerType = BAG_CONTAINER_TYPE): void {
  session.writePacket(
    buildItemRemovePacket({
      containerType,
      instanceId,
    }),
    DEFAULT_FLAGS,
    `Sending item remove cmd=0x${(GAME_ITEM_CMD + 1).toString(16)} container=${containerType} instanceId=${instanceId}`
  );
}

function syncInventoryStateToClient(session: SessionLike): void {
  sendInventoryFullSync(session);
  sendEquipmentContainerSync(session);
}

function sendGrantResultPackets(session: SessionLike, grantResult: UnknownRecord): void {
  for (const change of grantResult.changes || []) {
    if (change.merged) {
      sendItemQuantityUpdate(session, change.item.instanceId, change.item.quantity);
      continue;
    }
    sendItemAdd(
      session,
      change.item.templateId,
      change.item.slot,
      change.item.quantity,
      change.item.durability,
      Number.isInteger(change.item.tradeState) ? change.item.tradeState : 0,
      change.item.instanceId
    );
  }
}

function sendConsumeResultPackets(session: SessionLike, consumeResult: UnknownRecord): void {
  for (const change of consumeResult.changes || []) {
    if (change.removed) {
      sendItemRemove(
        session,
        change.item.instanceId,
        change.item?.equipped === true ? EQUIPMENT_CONTAINER_TYPE : BAG_CONTAINER_TYPE
      );
      continue;
    }
    sendItemQuantityUpdate(session, change.item.instanceId, change.item.quantity);
  }
}

function applyInventoryQuestEvent(
  session: SessionLike,
  event: UnknownRecord,
  options: UnknownRecord = {}
): UnknownRecord {
  const mappedEffect = mapInventoryQuestEventToEffect(event);
  if (mappedEffect) {
    const result = applyEffects(session, [mappedEffect], {
      suppressPackets: options.suppressPackets === true,
      suppressDialogues: options.suppressDialogues === true,
      suppressPersist: true,
      suppressStatSync: true,
    });
    return { handled: true, dirty: result.inventoryDirty === true };
  }

  return { handled: false, dirty: false };
}

function mapInventoryQuestEventToEffect(event: UnknownRecord): UnknownRecord | null {
  if (event.type === 'item-granted') {
    return {
      kind: 'grant-item',
      templateId: event.templateId,
      quantity: event.quantity,
      idempotent: true,
      dialoguePrefix: 'Quest',
      itemName: event.itemName,
      successMessage: `${event.itemName || 'Quest item'} was added to your pack.`,
    };
  }

  if (event.type === 'item-consumed') {
    return {
      kind: 'remove-item',
      templateId: event.templateId,
      quantity: event.quantity,
      dialoguePrefix: 'Quest',
      itemName: event.itemName,
      successMessage: `${event.itemName || 'Quest item'} was handed over.`,
      failureMessage: `${event.itemName || 'Quest item'} is required to continue.`,
    };
  }

  if (event.type === 'item-missing') {
    return {
      kind: 'item-missing',
      templateId: event.templateId,
      quantity: event.quantity,
      dialoguePrefix: 'Quest',
      itemName: event.itemName,
      failureMessage: `${event.itemName || 'Quest item'} is required to continue.`,
    };
  }

  return null;
}

export {
  applyInventoryQuestEvent,
  sendConsumeResultPackets,
  sendInventoryFullSync,
  sendItemAdd,
  sendItemRemove,
  sendItemQuantityUpdate,
  sendGrantResultPackets,
  sendEquipmentContainerSync,
  syncInventoryStateToClient,
};
