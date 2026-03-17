'use strict';

const {
  GAME_DIALOG_MESSAGE_SUBCMD,
  FIGHT_ACTIVE_STATE_SUBCMD,
  SERVER_RUN_MESSAGE_SUBCMD,
  GAME_DIALOG_CMD,
  GAME_FIGHT_STREAM_CMD,
  GAME_ITEM_CONTAINER_CMD,
  ITEM_CONTAINER_POSITION_SUBCMD,
  GAME_ITEM_CMD,
  GAME_QUEST_CMD,
  GAME_SCRIPT_EVENT_CMD,
  GAME_SELF_STATE_CMD,
  GAME_SERVER_RUN_CMD,
  SELF_STATE_APTITUDE_SUBCMD,
  SELF_STATE_VALUE_UPDATE_SUBCMD,
} = require('../config');
const { PacketWriter } = require('../protocol');

const ABSENT_COMPANION_SENTINEL = 0xfffe7960;

function buildSyntheticAttackPlaybackPacket({ attackerEntityId, targetEntityId, resultCode, damage }) {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_ACTIVE_STATE_SUBCMD);
  writer.writeUint32(attackerEntityId >>> 0);
  writer.writeUint32(targetEntityId >>> 0);
  writer.writeUint8(resultCode & 0xff);
  writer.writeUint32(damage >>> 0);
  return writer.payload();
}

function buildSyntheticAttackResultUpdatePacket({
  actionMode,
  playerVitals,
  target,
  damage,
  targetStateOverride = null,
  includeEntityId = null,
}) {
  const writer = new PacketWriter();
  const targetState = targetStateOverride === null ? (target.hp > 0 ? 0 : 1) : (targetStateOverride >>> 0);
  const encodedBoardSlot = (((target.row & 0xff) << 8) | (target.col & 0xff)) >>> 0;
  const shouldIncludeEntityId = includeEntityId === null ? targetState > 0 : includeEntityId;

  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(actionMode & 0xff);
  writer.writeUint32(Math.max(1, playerVitals.health) >>> 0);
  writer.writeUint32(playerVitals.mana >>> 0);
  writer.writeUint32(playerVitals.rage >>> 0);
  writer.writeUint32(ABSENT_COMPANION_SENTINEL);
  writer.writeUint32(encodedBoardSlot);
  writer.writeUint32(damage >>> 0);
  writer.writeUint32(targetState >>> 0);

  if (shouldIncludeEntityId) {
    writer.writeUint32(target.entityId >>> 0);
  }

  return writer.payload();
}

function buildSyntheticAttackMirrorUpdatePacket({ actionMode, playerVitals }) {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(actionMode & 0xff);
  writer.writeUint32(Math.max(1, playerVitals.health) >>> 0);
  writer.writeUint32(playerVitals.mana >>> 0);
  writer.writeUint32(playerVitals.rage >>> 0);
  writer.writeUint32(ABSENT_COMPANION_SENTINEL);
  return writer.payload();
}

function buildSyntheticFightVictoryClosePacket({ playerVitals }) {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(0x66);
  writer.writeUint32(Math.max(1, playerVitals.health) >>> 0);
  writer.writeUint32(playerVitals.mana >>> 0);
  writer.writeUint32(playerVitals.rage >>> 0);
  writer.writeUint32(ABSENT_COMPANION_SENTINEL);
  // Keep the result accumulators empty so the client can leave combat without
  // populating the Mission Report reward window.
  writer.writeUint32(0);
  writer.writeUint32(0);
  writer.writeUint32(0);
  writer.writeUint32(0);
  writer.writeUint16(0);
  return writer.payload();
}

function buildSelfStateAptitudeSyncPacket({
  selectedAptitude,
  level,
  experience,
  bankGold,
  gold,
  boundGold,
  coins,
  renown,
  primaryAttributes,
  statusPoints,
  currentHealth,
  currentMana,
  currentRage,
}) {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_SELF_STATE_CMD);
  writer.writeUint8(SELF_STATE_APTITUDE_SUBCMD);
  writer.writeUint8(selectedAptitude & 0xff);
  writer.writeUint32(currentHealth >>> 0);
  writer.writeUint32(currentMana >>> 0);
  writer.writeUint32(currentRage >>> 0);
  writer.writeUint8(level & 0xff);
  writer.writeUint32(experience >>> 0);
  writer.writeUint32(bankGold >>> 0);
  writer.writeUint32(gold >>> 0);
  writer.writeUint32(boundGold >>> 0);
  writer.writeUint32(coins >>> 0);
  writer.writeUint32(renown >>> 0);
  writer.writeUint16(0);
  writer.writeUint16(1);
  writer.writeUint16(primaryAttributes.intelligence & 0xffff);
  writer.writeUint16(primaryAttributes.vitality & 0xffff);
  writer.writeUint16(primaryAttributes.dexterity & 0xffff);
  writer.writeUint16(primaryAttributes.strength & 0xffff);
  writer.writeUint16(statusPoints & 0xffff);
  writer.writeUint8(0);
  return writer.payload();
}

function buildServerRunScriptPacket(scriptId, subtype) {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_SCRIPT_EVENT_CMD);
  writer.writeUint8(subtype & 0xff);
  writer.writeUint16(scriptId & 0xffff);
  return writer.payload();
}

function buildSelfStateValueUpdatePacket({ discriminator, value }) {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_SELF_STATE_CMD);
  writer.writeUint8(SELF_STATE_VALUE_UPDATE_SUBCMD);
  writer.writeUint8(discriminator & 0xff);
  writer.writeUint32(value >>> 0);
  return writer.payload();
}

function buildQuestPacket(subtype, taskId, extraValue = null, extraType = 'u32') {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_QUEST_CMD);
  writer.writeUint8(subtype & 0xff);
  writer.writeUint16(taskId & 0xffff);
  if (typeof extraValue === 'number') {
    if (extraType === 'u8') {
      writer.writeUint8(extraValue & 0xff);
    } else if (extraType === 'u16') {
      writer.writeUint16(extraValue & 0xffff);
    } else {
      writer.writeUint32(extraValue >>> 0);
    }
  }
  return writer.payload();
}

function writeClientItemInstancePayload(writer, {
  templateId,
  instanceId = 0,
  stateCode = 0,
  bindState = 0,
  quantity = 1,
  extraValue = 0,
  clientTemplateFamily = null,
  attributePairs = [],
}) {
  writer.writeUint16(templateId & 0xffff);
  writer.writeUint32(instanceId >>> 0);
  // The client's item counter reads the u16 field after these two bytes for
  // template family 0x74 quest items like 21098, so quantity must land there.
  writer.writeUint8(stateCode & 0xff);
  writer.writeUint8(bindState & 0xff);
  writer.writeUint16(quantity & 0xffff);
  writer.writeUint16(extraValue & 0xffff);

  // Family 0x41 stops here and immediately reads the embedded-entry count.
  // Family 0x74 returns before that count byte is consumed, so writing one
  // would shift the next record in 0x03f2 / 0x00.
  if (clientTemplateFamily === 0x41) {
    writer.writeUint8(0);
    return;
  }
  if (clientTemplateFamily === 0x74) {
    return;
  }
  if (clientTemplateFamily >= 0x20 && clientTemplateFamily < 0x40) {
    // Armor-style templates (for example is_armor rows 33/34 => 0x21/0x22)
    // consume two trailing u16 fields and then the embedded-entry count byte.
    for (let index = 0; index < 2; index += 1) {
      const pair = attributePairs[index];
      writer.writeUint16((pair?.value || 0) & 0xffff);
    }
    if (clientTemplateFamily === 0x27) {
      for (let index = 2; index < 6; index += 1) {
        const pair = attributePairs[index];
        writer.writeUint16((pair?.value || 0) & 0xffff);
      }
    }
    writer.writeUint8(0);
    return;
  }

  // Fallback shape for families that do consume the six trailing u16 fields.
  for (let index = 0; index < 6; index += 1) {
    const pair = attributePairs[index];
    writer.writeUint16((pair?.value || 0) & 0xffff);
  }
  writer.writeUint8(0);
}

function buildInventoryContainerBulkSyncPacket({
  containerType,
  items,
}) {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_ITEM_CONTAINER_CMD);
  writer.writeUint8(containerType & 0xff);
  writer.writeUint8(0x00);
  writer.writeUint16(items.length & 0xffff);

  for (const item of items) {
    writer.writeUint32((item.instanceId || 0) >>> 0);
    writeClientItemInstancePayload(writer, item);
  }

  return writer.payload();
}

function buildInventoryContainerPositionPacket({
  containerType,
  instanceId,
  slotIndex,
  column,
  row,
}) {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_ITEM_CONTAINER_CMD);
  writer.writeUint8(containerType & 0xff);
  writer.writeUint8(ITEM_CONTAINER_POSITION_SUBCMD & 0xff);
  writer.writeUint32(instanceId >>> 0);
  writer.writeUint16(slotIndex & 0xffff);
  writer.writeUint16(column & 0xffff);
  writer.writeUint16(row & 0xffff);
  return writer.payload();
}

function buildInventoryContainerQuantityPacket({
  containerType,
  instanceId,
  quantity,
}) {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_ITEM_CONTAINER_CMD);
  writer.writeUint8(containerType & 0xff);
  writer.writeUint8(0x14);
  writer.writeUint32(instanceId >>> 0);
  writer.writeUint16(quantity & 0xffff);
  return writer.payload();
}

function buildItemAddPacket({
  containerType,
  templateId,
  instanceId = 0,
  stateCode = 0,
  bindState = 0,
  quantity = 1,
  extraValue = 0,
  attributePairs = [],
  clientTemplateFamily = null,
}) {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_ITEM_CMD);
  writer.writeUint8(containerType & 0xff);
  writer.writeUint32(instanceId >>> 0);
  writeClientItemInstancePayload(writer, {
    templateId,
    instanceId,
    stateCode,
    bindState,
    quantity,
    extraValue,
    clientTemplateFamily,
    attributePairs,
  });
  return writer.payload();
}

function buildItemRemovePacket({ containerType, instanceId }) {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_ITEM_CMD + 1);
  writer.writeUint8(containerType & 0xff);
  writer.writeUint32(instanceId >>> 0);
  return writer.payload();
}

function buildServerRunMessagePacket(npcId, msgId) {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_SERVER_RUN_CMD);
  writer.writeUint8(SERVER_RUN_MESSAGE_SUBCMD);
  writer.writeUint32(npcId >>> 0);
  writer.writeUint16(msgId & 0xffff);
  return writer.payload();
}

function buildGameDialoguePacket({ speaker, message, subtype = GAME_DIALOG_MESSAGE_SUBCMD, flags = 0, extraText = null }) {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_DIALOG_CMD);
  writer.writeUint8(subtype & 0xff);
  writer.writeUint8(flags & 0xff);
  writer.writeString(`${speaker}\0`);
  if (subtype === 0x05) {
    writer.writeString(`${extraText || ''}\0`);
  }
  writer.writeString(`${message}\0`);
  writer.writeUint8(0);
  writer.writeUint8(0);
  return writer.payload();
}

module.exports = {
  buildInventoryContainerBulkSyncPacket,
  buildInventoryContainerQuantityPacket,
  buildInventoryContainerPositionPacket,
  buildGameDialoguePacket,
  buildItemAddPacket,
  buildItemRemovePacket,
  buildQuestPacket,
  buildSelfStateAptitudeSyncPacket,
  buildSelfStateValueUpdatePacket,
  buildServerRunMessagePacket,
  buildServerRunScriptPacket,
  buildSyntheticAttackMirrorUpdatePacket,
  buildSyntheticAttackPlaybackPacket,
  buildSyntheticAttackResultUpdatePacket,
  buildSyntheticFightVictoryClosePacket,
};
