'use strict';

const { DEFAULT_FLAGS, GAME_ITEM_CMD, GAME_ITEM_CONTAINER_CMD } = require('../config');
const {
  buildInventoryContainerBulkSyncPacket,
  buildInventoryContainerPositionPacket,
  buildInventoryContainerQuantityPacket,
  buildItemAddPacket,
  buildItemRemovePacket,
} = require('../protocol/gameplay-packets');
const {
  BAG_CONTAINER_TYPE,
  bagHasTemplateQuantity,
  consumeItemFromBag,
  getItemDefinition,
  grantItemToBag,
} = require('../inventory');
const EQUIPMENT_CONTAINER_TYPE = 0;

function sendItemAdd(session, templateId, slot, quantity = 1, instanceId = 0) {
  const definition = getItemDefinition(templateId);
  const encodedQuantity =
    Number.isInteger(definition?.defaultQuantity) && definition.defaultQuantity > 0
      ? definition.defaultQuantity
      : quantity;
  session.writePacket(
    buildItemAddPacket({
      containerType: BAG_CONTAINER_TYPE,
      slot,
      templateId,
      instanceId,
      stateCode: 0,
      bindState: 0,
      quantity: encodedQuantity,
      extraValue: 0,
      clientTemplateFamily: definition?.clientTemplateFamily ?? null,
      attributePairs: Array.isArray(definition?.defaultAttributePairs)
        ? definition.defaultAttributePairs
        : [],
    }),
    DEFAULT_FLAGS,
    `Sending item add cmd=0x${GAME_ITEM_CMD.toString(16)} templateId=${templateId} slot=${slot} qty=${quantity} instanceId=${instanceId}${definition ? ` name=${definition.name}` : ''}`
  );
}

function sendItemPositionUpdate(session, item) {
  const slotIndex = item.slot >>> 0;
  const gridIndex = Math.max(0, slotIndex - 1);
  const column = gridIndex % 5;
  const row = Math.floor(gridIndex / 5);

  session.writePacket(
    buildInventoryContainerPositionPacket({
      containerType: BAG_CONTAINER_TYPE,
      instanceId: item.instanceId >>> 0,
      slotIndex,
      column,
      row,
    }),
    DEFAULT_FLAGS,
    `Sending item position update cmd=0x${GAME_ITEM_CONTAINER_CMD.toString(16)} container=${BAG_CONTAINER_TYPE} instanceId=${item.instanceId} slot=${slotIndex} col=${column} row=${row}`
  );
}

function sendInventoryFullSync(session) {
  const bagItems = Array.isArray(session.bagItems)
    ? session.bagItems
        .filter((item) => item.equipped !== true)
        .map((item) => buildClientInventoryItem(session, item))
    : [];
  session.writePacket(
    buildInventoryContainerBulkSyncPacket({
      containerType: BAG_CONTAINER_TYPE,
      items: bagItems,
    }),
    DEFAULT_FLAGS,
    `Sending inventory full sync cmd=0x${GAME_ITEM_CONTAINER_CMD.toString(16)} container=${BAG_CONTAINER_TYPE} items=${bagItems.length}`
  );

  for (const item of bagItems) {
    sendItemPositionUpdate(session, item);
  }
}

function buildClientInventoryItem(session, item) {
  const definition = getItemDefinition(item.templateId);
  return {
    ...item,
    quantity:
      Number.isInteger(definition?.defaultQuantity) && definition.defaultQuantity > 0
        ? definition.defaultQuantity
        : item.quantity,
    clientTemplateFamily: definition?.clientTemplateFamily ?? null,
    attributePairs: Array.isArray(definition?.defaultAttributePairs)
      ? definition.defaultAttributePairs
      : [],
  };
}

function sendEquipmentContainerSync(session) {
  const equippedItems = (Array.isArray(session.bagItems) ? session.bagItems : [])
    .filter((item) => item.equipped === true)
    .map((item) => buildClientInventoryItem(session, item));

  session.writePacket(
    buildInventoryContainerBulkSyncPacket({
      containerType: EQUIPMENT_CONTAINER_TYPE,
      items: equippedItems,
    }),
    DEFAULT_FLAGS,
    `Sending equipment container sync cmd=0x${GAME_ITEM_CONTAINER_CMD.toString(16)} container=${EQUIPMENT_CONTAINER_TYPE} items=${equippedItems.length}`
  );
}

function sendItemQuantityUpdate(session, instanceId, quantity) {
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

function sendItemRemove(session, instanceId) {
  session.writePacket(
    buildItemRemovePacket({
      containerType: BAG_CONTAINER_TYPE,
      instanceId,
    }),
    DEFAULT_FLAGS,
    `Sending item remove cmd=0x${(GAME_ITEM_CMD + 1).toString(16)} instanceId=${instanceId}`
  );
}

function syncInventoryStateToClient(session) {
  sendInventoryFullSync(session);
  sendEquipmentContainerSync(session);
}

function sendGrantResultPackets(session, grantResult) {
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
      change.item.instanceId
    );
    sendItemPositionUpdate(session, change.item);
  }
}

function sendConsumeResultPackets(session, consumeResult) {
  for (const change of consumeResult.changes || []) {
    if (change.removed) {
      sendItemRemove(session, change.item.instanceId);
      continue;
    }
    sendItemQuantityUpdate(session, change.item.instanceId, change.item.quantity);
  }
}

function applyInventoryQuestEvent(session, event, options = {}) {
  const suppressPackets = options.suppressPackets === true;
  const suppressDialogues = options.suppressDialogues === true;

  if (event.type === 'item-granted') {
    if (bagHasTemplateQuantity(session, event.templateId, event.quantity)) {
      return { handled: true, dirty: false };
    }

    const grantResult = grantItemToBag(session, event.templateId, event.quantity);
    if (!grantResult.ok) {
      if (!suppressDialogues) {
        session.sendGameDialogue(
          'Quest',
          `${event.itemName || 'Quest item'} could not be added: ${grantResult.reason}.`
        );
      }
      return { handled: true, dirty: false };
    }

    if (!suppressPackets) {
      sendGrantResultPackets(session, grantResult);
      sendInventoryFullSync(session);
    }
    if (!suppressDialogues) {
      session.sendGameDialogue(
        'Quest',
        `${event.itemName || grantResult.definition.name} was added to your pack.`
      );
    }

    return { handled: true, dirty: true };
  }

  if (event.type === 'item-consumed') {
    const consumeResult = consumeItemFromBag(session, event.templateId, event.quantity);
    if (!consumeResult.ok) {
      if (!suppressDialogues) {
        session.sendGameDialogue(
          'Quest',
          `${event.itemName || 'Quest item'} is required to continue.`
        );
      }
      return { handled: true, dirty: false };
    }

    if (!suppressPackets) {
      sendConsumeResultPackets(session, consumeResult);
      sendInventoryFullSync(session);
    }
    if (!suppressDialogues) {
      session.sendGameDialogue(
        'Quest',
        `${event.itemName || 'Quest item'} was handed over.`
      );
    }

    return { handled: true, dirty: true };
  }

  if (event.type === 'item-missing') {
    if (!suppressDialogues) {
      session.sendGameDialogue(
        'Quest',
        `${event.itemName || 'Quest item'} is required to continue.`
      );
    }
    return { handled: true, dirty: false };
  }

  return { handled: false, dirty: false };
}

module.exports = {
  applyInventoryQuestEvent,
  sendConsumeResultPackets,
  sendInventoryFullSync,
  sendItemAdd,
  sendItemRemove,
  sendItemQuantityUpdate,
  sendItemPositionUpdate,
  sendGrantResultPackets,
  sendEquipmentContainerSync,
  syncInventoryStateToClient,
};
