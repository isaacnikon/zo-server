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
  GAME_NPC_SHOP_CMD,
  GAME_QUEST_CMD,
  GAME_SCRIPT_EVENT_CMD,
  GAME_SELF_STATE_CMD,
  GAME_SERVER_RUN_CMD,
  SELF_STATE_APTITUDE_SUBCMD,
  SELF_STATE_VALUE_UPDATE_SUBCMD,
} = require('../config');
const { PacketWriter } = require('../protocol');
const { writeClientItemInstancePayload } = require('./item-serializer');

const ABSENT_COMPANION_SENTINEL = 0xfffe7960;

interface AttackPlaybackParams {
  attackerEntityId: number;
  targetEntityId: number;
  resultCode: number;
  damage: number;
}

interface AttackTarget {
  hp: number;
  row: number;
  col: number;
  entityId: number;
}

interface PlayerVitals {
  health: number;
  mana: number;
  rage: number;
}

interface AttackResultUpdateParams {
  actionMode: number;
  playerVitals: PlayerVitals;
  target: AttackTarget;
  damage: number;
  targetStateOverride?: number | null;
  includeEntityId?: boolean | null;
}

interface AttackMirrorUpdateParams {
  actionMode: number;
  playerVitals: PlayerVitals;
}

interface VictoryCloseParams {
  playerVitals: PlayerVitals;
}

interface PrimaryAttributes {
  strength: number;
  dexterity: number;
  vitality: number;
  intelligence: number;
}

interface AptitudeSyncParams {
  selectedAptitude: number;
  level: number;
  experience: number;
  bankGold: number;
  gold: number;
  boundGold: number;
  coins: number;
  renown: number;
  primaryAttributes: PrimaryAttributes;
  statusPoints: number;
  currentHealth: number;
  currentMana: number;
  currentRage: number;
  petCapacity?: number;
}

interface ValueUpdateParams {
  discriminator: number;
  value: number;
}

interface PetStateFlags {
  activeFlag?: number;
  modeA?: number;
  modeB?: number;
}

interface PetStats {
  strength?: number;
  dexterity?: number;
  vitality?: number;
  intelligence?: number;
}

interface PetData {
  runtimeId?: number;
  templateId?: number;
  name?: string;
  level?: number;
  generation?: number;
  currentHealth?: number;
  currentMana?: number;
  loyalty?: number;
  statPoints?: number;
  experience?: number;
  typeId?: number;
  rebirth?: number;
  petSerialId?: number;
  boothOfflineUntil?: number;
  boothOfflineExp?: number;
  stateFlags?: PetStateFlags;
  stats?: PetStats;
  baseStats?: PetStats;
  statCoefficients?: number[];
}

interface ItemInstance {
  templateId: number;
  instanceId: number;
  stateCode: number;
  bindState: number;
  quantity: number;
  extraValue: number;
  clientTemplateFamily: number | null;
  attributePairs: Array<{ key: number; value: number }>;
}

interface NpcShopCatalogItem {
  templateId: number;
  price: number;
}

function buildSyntheticAttackPlaybackPacket({ attackerEntityId, targetEntityId, resultCode, damage }: AttackPlaybackParams): Buffer {
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
}: AttackResultUpdateParams): Buffer {
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

function buildSyntheticAttackMirrorUpdatePacket({ actionMode, playerVitals }: AttackMirrorUpdateParams): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(actionMode & 0xff);
  writer.writeUint32(Math.max(1, playerVitals.health) >>> 0);
  writer.writeUint32(playerVitals.mana >>> 0);
  writer.writeUint32(playerVitals.rage >>> 0);
  writer.writeUint32(ABSENT_COMPANION_SENTINEL);
  return writer.payload();
}

function buildSyntheticFightVictoryClosePacket({ playerVitals }: VictoryCloseParams): Buffer {
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
  petCapacity = 0,
}: AptitudeSyncParams): Buffer {
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
  writer.writeUint16(primaryAttributes.strength & 0xffff);
  writer.writeUint16(primaryAttributes.dexterity & 0xffff);
  writer.writeUint16(primaryAttributes.vitality & 0xffff);
  writer.writeUint16(primaryAttributes.intelligence & 0xffff);
  writer.writeUint16(statusPoints & 0xffff);
  writer.writeUint8(petCapacity & 0xff);
  return writer.payload();
}

function buildServerRunScriptPacket(scriptId: number, subtype: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_SCRIPT_EVENT_CMD);
  writer.writeUint8(subtype & 0xff);
  writer.writeUint16(scriptId & 0xffff);
  return writer.payload();
}

function buildSelfStateValueUpdatePacket({ discriminator, value }: ValueUpdateParams): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_SELF_STATE_CMD);
  writer.writeUint8(SELF_STATE_VALUE_UPDATE_SUBCMD);
  writer.writeUint8(discriminator & 0xff);
  writer.writeUint32(value >>> 0);
  return writer.payload();
}

function buildPetSummonSyncPacket({ pet }: { pet: PetData }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(0x0a);
  writer.writeUint8(0x01);
  writer.writeUint8((pet.stateFlags?.activeFlag || 0) & 0xff);
  writer.writeUint32((pet.runtimeId || 0) >>> 0);
  writer.writeUint16((pet.templateId || 0) & 0xffff);
  writer.writeUint8((pet.stateFlags?.modeA || 0) & 0xff);
  writer.writeUint8((pet.stateFlags?.modeB || 0) & 0xff);
  writer.writeUint32((pet.currentMana || 0) >>> 0);
  writer.writeUint32((pet.currentHealth || 0) >>> 0);
  writer.writeUint8((pet.generation || 0) & 0xff);
  writer.writeUint16((pet.level || 1) & 0xffff);
  writer.writeString(`${pet.name || ''}\0`);
  return writer.payload();
}

function buildPetCreateSyncPacket({ pet }: { pet: PetData }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(0x0f);
  writer.writeUint8((pet.stateFlags?.activeFlag || 0) & 0xff);
  writer.writeUint32((pet.runtimeId || 0) >>> 0);
  writer.writeUint16((pet.templateId || 0) & 0xffff);
  writer.writeUint8((pet.stateFlags?.modeA || 0) & 0xff);
  writer.writeUint8((pet.stateFlags?.modeB || 0) & 0xff);
  writer.writeUint32((pet.currentMana || 0) >>> 0);
  writer.writeUint32((pet.currentHealth || 0) >>> 0);
  writer.writeUint8((pet.generation || 0) & 0xff);
  writer.writeUint16((pet.level || 1) & 0xffff);
  writer.writeString(`${pet.name || ''}\0`);
  return writer.payload();
}

function buildPetRosterSyncPacket({ pets }: { pets: PetData[] }): Buffer {
  const writer = new PacketWriter();
  const normalizedPets = Array.isArray(pets) ? pets : [];
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(0x7f);
  writer.writeUint16(normalizedPets.length & 0xffff);
  for (const pet of normalizedPets) {
    writer.writeUint32((pet.runtimeId || 0) >>> 0);
    writer.writeUint16((pet.templateId || 0) & 0xffff);
    writer.writeString(`${pet.name || ''}\0`);
  }
  return writer.payload();
}

function buildPetStatsSyncPacket({ pet }: { pet: PetData }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_SELF_STATE_CMD);
  writer.writeUint8(0x1f);
  writer.writeUint32((pet.runtimeId || 0) >>> 0);
  writer.writeUint16((pet.stats?.strength || 0) & 0xffff);
  writer.writeUint16((pet.stats?.dexterity || 0) & 0xffff);
  writer.writeUint16((pet.stats?.vitality || 0) & 0xffff);
  writer.writeUint16((pet.stats?.intelligence || 0) & 0xffff);
  writer.writeUint16((pet.statPoints || 0) & 0xffff);
  return writer.payload();
}

function buildPetTreeRegistrationPacket({ pet }: { pet: PetData }): Buffer {
  const writer = new PacketWriter();
  const statCoefficients = Array.isArray(pet.statCoefficients) && pet.statCoefficients.length === 9
    ? pet.statCoefficients
    : [10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000];
  const baseStats = [
    pet.baseStats?.strength ?? pet.stats?.strength ?? 10,
    pet.baseStats?.dexterity ?? pet.stats?.dexterity ?? 10,
    pet.baseStats?.vitality ?? pet.stats?.vitality ?? 10,
    pet.baseStats?.intelligence ?? pet.stats?.intelligence ?? 10,
  ];

  writer.writeUint16(0x03eb);
  writer.writeUint8(0x02);
  writer.writeUint32((pet.runtimeId || 0) >>> 0);
  writer.writeUint16((pet.templateId || 0) & 0xffff);
  writer.writeUint32((pet.petSerialId || pet.runtimeId || 0) >>> 0);
  writer.writeString(`${pet.name || ''}\0`);

  baseStats.forEach((value) => writer.writeUint16((value || 0) & 0xffff));

  statCoefficients.forEach((value) => {
    writer.writeUint16((value || 0) & 0xffff);
    writer.writeUint8(0);
  });

  writer.writeUint32((pet.boothOfflineUntil || 0) >>> 0);
  writer.writeUint32((pet.boothOfflineExp || 0) >>> 0);
  writer.writeUint16((pet.level || 1) & 0xffff);

  baseStats.forEach((value) => writer.writeUint16((value || 0) & 0xffff));

  writer.writeUint32((pet.experience || 0) >>> 0);
  writer.writeUint16((pet.statPoints || 0) & 0xffff);
  writer.writeUint16((pet.generation || 0) & 0xffff);
  writer.writeUint8((pet.typeId || 0) & 0xff);
  writer.writeUint16((pet.rebirth || 0) & 0xffff);
  writer.writeUint32((pet.currentHealth || 0) >>> 0);
  writer.writeUint32((pet.currentMana || 0) >>> 0);
  writer.writeUint8(0);

  writer.writeUint32(0);
  writer.writeUint32(0);
  writer.writeUint32(0);
  return writer.payload();
}

function buildPetPanelBindPacket({ ownerRuntimeId, pet }: { ownerRuntimeId: number; pet: PetData }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03ee);
  writer.writeUint8(0x51);
  writer.writeUint32((ownerRuntimeId || 0) >>> 0);
  writer.writeUint16((pet.templateId || 0) & 0xffff);
  writer.writeString(`${pet.name || ''}\0`);
  return writer.payload();
}

function buildPetPanelRebindPacket({ ownerRuntimeId }: { ownerRuntimeId: number }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03ee);
  writer.writeUint8(0x53);
  writer.writeUint32((ownerRuntimeId || 0) >>> 0);
  return writer.payload();
}

function buildPetPanelClearPacket({ ownerRuntimeId }: { ownerRuntimeId: number }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03ee);
  writer.writeUint8(0x58);
  writer.writeUint32((ownerRuntimeId || 0) >>> 0);
  return writer.payload();
}

function buildPetPanelNamePacket({ ownerRuntimeId, pet }: { ownerRuntimeId: number; pet: PetData }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03ee);
  writer.writeUint8(0x59);
  writer.writeUint32((ownerRuntimeId || 0) >>> 0);
  writer.writeString(`${pet.name || ''}\0`);
  return writer.payload();
}

function buildPetPanelPropertyPacket({ ownerRuntimeId, index, value }: { ownerRuntimeId: number; index: number; value: number }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03ee);
  writer.writeUint8(0x55);
  writer.writeUint32((ownerRuntimeId || 0) >>> 0);
  writer.writeUint8(index & 0xff);
  writer.writeUint16((value || 0) & 0xffff);
  return writer.payload();
}

function buildPetPanelModePacket({ ownerRuntimeId, enabled }: { ownerRuntimeId: number; enabled: boolean }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03ee);
  writer.writeUint8(enabled ? 0x56 : 0x57);
  writer.writeUint32((ownerRuntimeId || 0) >>> 0);
  return writer.payload();
}

function buildPetActiveSelectPacket({ runtimeId }: { runtimeId: number }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03f5);
  writer.writeUint32((runtimeId || 0) >>> 0);
  return writer.payload();
}

function buildQuestPacket(subtype: number, taskId: number, extraValue: number | null = null, extraType: 'u8' | 'u16' | 'u32' = 'u32'): Buffer {
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

function buildInventoryContainerBulkSyncPacket({
  containerType,
  items,
}: {
  containerType: number;
  items: ItemInstance[];
}): Buffer {
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
}: {
  containerType: number;
  instanceId: number;
  slotIndex: number;
  column: number;
  row: number;
}): Buffer {
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
}: {
  containerType: number;
  instanceId: number;
  quantity: number;
}): Buffer {
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
  tradeState = 0,
  stateCode = 0,
  bindState = 0,
  quantity = 1,
  extraValue = 0,
  attributePairs = [],
  clientTemplateFamily = null,
}: {
  containerType: number;
  templateId: number;
  instanceId?: number;
  tradeState?: number;
  stateCode?: number;
  bindState?: number;
  quantity?: number;
  extraValue?: number;
  attributePairs?: Array<{ key: number; value: number }>;
  clientTemplateFamily?: number | null;
}): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_ITEM_CMD);
  writer.writeUint8(containerType & 0xff);
  writer.writeUint32(instanceId >>> 0);
  writeClientItemInstancePayload(writer, {
    templateId,
    tradeState,
    stateCode,
    bindState,
    quantity,
    extraValue,
    clientTemplateFamily,
    attributePairs,
  });
  return writer.payload();
}

function buildItemRemovePacket({ containerType, instanceId }: { containerType: number; instanceId: number }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_ITEM_CMD + 1);
  writer.writeUint8(containerType & 0xff);
  writer.writeUint32(instanceId >>> 0);
  return writer.payload();
}

function buildEquipmentStatePacket({ instanceId, equipped }: { instanceId: number; equipped: boolean }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03ee);
  writer.writeUint8(0x01);
  writer.writeUint32(instanceId >>> 0);
  writer.writeUint8(equipped ? 1 : 0);
  writer.writeUint8(equipped ? 0 : 1);
  return writer.payload();
}

function buildServerRunMessagePacket(npcId: number, msgId: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_SERVER_RUN_CMD);
  writer.writeUint8(SERVER_RUN_MESSAGE_SUBCMD);
  writer.writeUint32(npcId >>> 0);
  writer.writeUint16(msgId & 0xffff);
  return writer.payload();
}

function buildNpcShopOpenPacket(items: NpcShopCatalogItem[]): Buffer {
  const writer = new PacketWriter();
  const normalizedItems = Array.isArray(items) ? items : [];
  writer.writeUint16(GAME_NPC_SHOP_CMD);
  writer.writeUint8(0x07);
  for (const item of normalizedItems) {
    writer.writeUint16((item.templateId || 0) & 0xffff);
    writer.writeUint32((item.price || 0) >>> 0);
  }
  return writer.payload();
}

function buildGameDialoguePacket({ speaker, message, subtype = GAME_DIALOG_MESSAGE_SUBCMD, flags = 0, extraText = null }: {
  speaker: string;
  message: string;
  subtype?: number;
  flags?: number;
  extraText?: string | null;
}): Buffer {
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
  buildNpcShopOpenPacket,
  buildEquipmentStatePacket,
  buildItemAddPacket,
  buildItemRemovePacket,
  buildQuestPacket,
  buildPetPanelBindPacket,
  buildPetActiveSelectPacket,
  buildPetPanelClearPacket,
  buildPetPanelRebindPacket,
  buildPetPanelModePacket,
  buildPetPanelNamePacket,
  buildPetPanelPropertyPacket,
  buildPetStatsSyncPacket,
  buildPetTreeRegistrationPacket,
  buildPetCreateSyncPacket,
  buildPetRosterSyncPacket,
  buildPetSummonSyncPacket,
  buildSelfStateAptitudeSyncPacket,
  buildSelfStateValueUpdatePacket,
  buildServerRunMessagePacket,
  buildServerRunScriptPacket,
  buildSyntheticAttackMirrorUpdatePacket,
  buildSyntheticAttackPlaybackPacket,
  buildSyntheticAttackResultUpdatePacket,
  buildSyntheticFightVictoryClosePacket,
};
