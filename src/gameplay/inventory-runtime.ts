import { DEFAULT_FLAGS, GAME_ITEM_CMD, GAME_ITEM_CONTAINER_CMD } from '../config.js';
import { buildInventoryContainerBulkSyncPacket, buildInventoryContainerQuantityPacket, buildItemAddPacket, buildItemRemovePacket, } from '../protocol/gameplay-packets.js';
import { BAG_CONTAINER_TYPE, getItemDefinition, isEquipmentDefinition, } from '../inventory/index.js';
import { applyEffects } from '../effects/effect-executor.js';

const EQUIPMENT_CONTAINER_TYPE = 0;

import type { GameSession } from '../types.js';
type UnknownRecord = Record<string, any>;

function sendItemAdd(
  session: GameSession,
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
      templateId,
      instanceId,
      tradeState,
      stateCode: 0,
      bindState: 0,
      quantity: encodedQuantity,
      extraValue: 0,
      clientTemplateFamily: definition?.clientTemplateFamily ?? null,
      attributePairs: Array.isArray(definition?.defaultAttributePairs) ? definition.defaultAttributePairs as Array<{ key: number; value: number }> : [],
    }),
    DEFAULT_FLAGS,
    `Sending item add cmd=0x${GAME_ITEM_CMD.toString(16)} templateId=${templateId} slot=${slot} qty=${quantity} instanceId=${instanceId}${definition ? ` name=${definition.name}` : ''}`
  );
}

function sendInventoryFullSync(session: GameSession): void {
  const bagItems = Array.isArray(session.bagItems)
    ? session.bagItems
        .filter((item: UnknownRecord) => item.equipped !== true)
        .map((item: UnknownRecord) => buildClientInventoryItem(item))
    : [];
  session.writePacket(
    buildInventoryContainerBulkSyncPacket({
      containerType: BAG_CONTAINER_TYPE,
      items: bagItems as any[],
    }),
    DEFAULT_FLAGS,
    `Sending inventory full sync cmd=0x${GAME_ITEM_CONTAINER_CMD.toString(16)} container=${BAG_CONTAINER_TYPE} items=${bagItems.length}`
  );
}

function buildClientInventoryItem(item: UnknownRecord): UnknownRecord {
  const definition = getItemDefinition(item.templateId);
  const payloadBindState =
    definition && isEquipmentDefinition(definition) && Number.isInteger(item.bindState)
      ? (item.bindState & 0xff)
      : 0;
  const itemAttributePairs = Array.isArray(item.attributePairs)
    ? item.attributePairs
        .map((pair: UnknownRecord) => ({
          value: Number.isInteger(pair?.value) ? (pair.value & 0xffff) : 0,
        }))
        .filter((pair: UnknownRecord) => pair.value !== 0)
    : [];
  const baseAttributePairs =
    itemAttributePairs.length > 0
      ? itemAttributePairs
      : Array.isArray(definition?.defaultAttributePairs)
        ? definition.defaultAttributePairs
        : [];
  const payloadStateCode = resolveEquipmentPayloadStateCode(definition, item, payloadBindState);
  const enhancementWords = buildEquipmentEnhancementWords(definition, payloadStateCode, payloadBindState, baseAttributePairs);
  return {
    ...item,
    tradeState: Number.isInteger(item.tradeState) ? (item.tradeState | 0) : 0,
    stateCode: payloadStateCode,
    quantity: resolveClientItemQuantity(definition, item.quantity, item.durability),
    bindState: payloadBindState,
    extraValue: Number.isInteger(item.extraValue) ? (item.extraValue & 0xffff) : 0,
    clientTemplateFamily: definition?.clientTemplateFamily ?? null,
    attributePairs: baseAttributePairs,
    enhancementWords,
  };
}

function resolveEquipmentPayloadStateCode(
  definition: UnknownRecord | null,
  item: UnknownRecord,
  payloadBindState: number
): number {
  const storedStateCode = Number.isInteger(item.stateCode) ? (item.stateCode & 0xff) : 0;
  if (
    definition &&
    isEquipmentDefinition(definition as any) &&
    payloadBindState > 0 &&
    Number.isInteger((definition as any).itemSetId) &&
    ((definition as any).itemSetId as number) > 0
  ) {
    return 6;
  }
  return storedStateCode;
}

function buildEquipmentEnhancementWords(
  definition: UnknownRecord | null,
  payloadStateCode: number,
  payloadBindState: number,
  attributePairs: Array<{ value: number }>
): number[] | undefined {
  if (
    !definition ||
    !isEquipmentDefinition(definition as any) ||
    payloadStateCode !== 6 ||
    payloadBindState <= 0
  ) {
    return undefined;
  }

  const words = new Array<number>(13).fill(0);
  words[0] = payloadBindState & 0xffff;
  words[1] = payloadStateCode & 0xffff;

  const family = Number.isInteger((definition as any).clientTemplateFamily)
    ? (((definition as any).clientTemplateFamily as number) & 0xff)
    : 0;
  if (family > 0 && family < 0x20) {
    for (let index = 0; index < 4; index += 1) {
      words[2 + index] = Number.isInteger(attributePairs[index]?.value) ? (attributePairs[index]!.value & 0xffff) : 0;
    }
  } else if (family >= 0x20 && family < 0x40) {
    words[6] = Number.isInteger(attributePairs[0]?.value) ? (attributePairs[0]!.value & 0xffff) : 0;
    words[7] = Number.isInteger(attributePairs[1]?.value) ? (attributePairs[1]!.value & 0xffff) : 0;
  }

  const enhancementGrowthId = Number.isInteger((definition as any).enhancementGrowthId)
    ? (((definition as any).enhancementGrowthId as number) & 0xffff)
    : 0;
  words[10] = enhancementGrowthId;
  return words;
}

function resolveClientItemQuantity(definition: UnknownRecord | null, quantity: number, durability?: number): number {
  const usesDurability = definition?.hasDurability === true;
  const normalizedDurability =
    typeof durability === 'number' && Number.isInteger(durability) ? durability : null;
  if (usesDurability && normalizedDurability !== null && normalizedDurability >= 0) {
    return normalizedDurability;
  }
  if (Number.isInteger(quantity) && (usesDurability ? quantity >= 0 : quantity > 0)) {
    return quantity;
  }
  if (Number.isInteger(definition?.defaultQuantity) && definition!.defaultQuantity > 0) {
    return definition!.defaultQuantity;
  }
  return usesDurability ? 0 : 1;
}

function sendEquipmentContainerSync(session: GameSession): void {
  const equippedItems = (Array.isArray(session.bagItems) ? session.bagItems : [])
    .filter((item: UnknownRecord) => item.equipped === true)
    .map((item: UnknownRecord) => buildClientInventoryItem(item));

  session.writePacket(
    buildInventoryContainerBulkSyncPacket({
      containerType: EQUIPMENT_CONTAINER_TYPE,
      items: equippedItems as any[],
    }),
    DEFAULT_FLAGS,
    `Sending equipment container sync cmd=0x${GAME_ITEM_CONTAINER_CMD.toString(16)} container=${EQUIPMENT_CONTAINER_TYPE} items=${equippedItems.length}`
  );
}

function sendItemQuantityUpdate(session: GameSession, instanceId: number, quantity: number): void {
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

function sendItemRemove(session: GameSession, instanceId: number, containerType = BAG_CONTAINER_TYPE): void {
  session.writePacket(
    buildItemRemovePacket({
      containerType,
      instanceId,
    }),
    DEFAULT_FLAGS,
    `Sending item remove cmd=0x${(GAME_ITEM_CMD + 1).toString(16)} container=${containerType} instanceId=${instanceId}`
  );
}

function syncInventoryStateToClient(session: GameSession): void {
  sendInventoryFullSync(session);
  sendEquipmentContainerSync(session);
}

function sendGrantResultPackets(session: GameSession, grantResult: UnknownRecord): void {
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

function sendConsumeResultPackets(session: GameSession, consumeResult: UnknownRecord): void {
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
  session: GameSession,
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
    const isIdempotent = event.reason !== 'defeat-collect';
    return {
      kind: 'grant-item',
      templateId: event.templateId,
      quantity: event.quantity,
      idempotent: isIdempotent,
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
