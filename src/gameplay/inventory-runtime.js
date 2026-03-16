'use strict';

const {
  DEFAULT_FLAGS,
  GAME_ITEM_CMD,
  GAME_ITEM_CONTAINER_CMD,
} = require('../config');
const {
  buildInventoryContainerBulkSyncPacket,
  buildItemAddPacket,
  buildItemRemovePacket,
} = require('../protocol/gameplay-packets');
const {
  BAG_CONTAINER_TYPE,
  bagHasTemplateId,
  consumeItemFromBag,
  getItemDefinition,
  grantItemToBag,
} = require('../inventory');

function sendItemAdd(session, templateId, slot, quantity = 1, instanceId = 0) {
  const definition = getItemDefinition(templateId);
  session.writePacket(
    buildItemAddPacket({
      containerType: BAG_CONTAINER_TYPE,
      slot,
      templateId,
      instanceId,
      stateCode: 0,
      bindState: 0,
      quantity,
      extraValue: 0,
      clientTemplateFamily: definition?.clientTemplateFamily ?? null,
      attributePairs: [],
    }),
    DEFAULT_FLAGS,
    `Sending item add cmd=0x${GAME_ITEM_CMD.toString(16)} templateId=${templateId} slot=${slot} qty=${quantity} instanceId=${instanceId}${definition ? ` name=${definition.name}` : ''}`
  );
}

function sendInventoryFullSync(session) {
  const bagItems = Array.isArray(session.bagItems)
    ? session.bagItems.map((item) => ({
        ...item,
        clientTemplateFamily: getItemDefinition(item.templateId)?.clientTemplateFamily ?? null,
      }))
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
}

function applyInventoryQuestEvent(session, event, options = {}) {
  const suppressPackets = options.suppressPackets === true;
  const suppressDialogues = options.suppressDialogues === true;

  if (event.type === 'item-granted') {
    if (bagHasTemplateId(session, event.templateId)) {
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
      sendItemAdd(
        session,
        grantResult.item.templateId,
        grantResult.item.slot,
        grantResult.item.quantity,
        grantResult.item.instanceId
      );
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
      if (consumeResult.removed) {
        sendItemRemove(session, consumeResult.item.instanceId);
      } else {
        sendItemAdd(
          session,
          consumeResult.item.templateId,
          consumeResult.item.slot,
          consumeResult.item.quantity,
          consumeResult.item.instanceId
        );
      }
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
  sendInventoryFullSync,
  sendItemAdd,
  sendItemRemove,
  syncInventoryStateToClient,
};
