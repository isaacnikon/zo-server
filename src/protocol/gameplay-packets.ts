import { GAME_DIALOG_MESSAGE_SUBCMD, FIGHT_ACTIVE_STATE_SUBCMD, GAME_DIALOG_CMD, GAME_FIGHT_STREAM_CMD, GAME_FIGHT_TURN_CMD, GAME_GATHER_RESPONSE_CMD, GAME_ITEM_CONTAINER_CMD, ITEM_CONTAINER_POSITION_SUBCMD, GAME_ITEM_CMD, GAME_NPC_SHOP_CMD, GAME_QUEST_CMD, GAME_QUEST_TABLE_CMD, GAME_SCENE_ENTER_CMD, GAME_SCRIPT_EVENT_CMD, SCENE_ENTER_LOAD_SUBCMD, GAME_SELF_STATE_CMD, SELF_STATE_APTITUDE_SUBCMD, SELF_STATE_VALUE_UPDATE_SUBCMD, } from '../config.js';
import { PacketWriter } from '../protocol.js';
import { writeClientItemInstancePayload } from './item-serializer.js';

const ABSENT_COMPANION_SENTINEL = 0xfffe7960;

interface PlayerVitals {
  health: number;
  mana: number;
  rage: number;
  companionHp?: number;
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
  probeFieldA?: number;
  probeFieldB?: number;
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
  attributePairs: Array<{ value: number }>;
}

interface NpcShopCatalogItem {
  templateId: number;
  price: number;
}

interface SkillSyncEntry {
  skillId: number;
  level?: number;
  proficiency?: number;
}

interface QuestTableSyncEntry {
  taskId: number;
  step: number;
  extraA?: number;
  extraB?: number;
}

interface QuestTableHistoryEntry {
  taskId: number;
  state: number;
}

interface QuestAcceptStateParams {
  subtype?: number;
  taskId: number;
  currentStep: number;
  taskType: number;
  maxStep: number;
  overNpcId: number;
  targetNpcId: number;
  objectiveWords?: number[];
}

interface SceneSpawnRecord {
  id: number;
  entityType: number;
  x: number;
  y: number;
  dir: number;
  state: number;
}

export function buildSelfStateAptitudeSyncPacket({
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
  probeFieldA = 0,
  probeFieldB = 1,
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
  writer.writeUint16(probeFieldA & 0xffff);
  writer.writeUint16(probeFieldB & 0xffff);
  writer.writeUint16(primaryAttributes.strength & 0xffff);
  writer.writeUint16(primaryAttributes.dexterity & 0xffff);
  writer.writeUint16(primaryAttributes.vitality & 0xffff);
  writer.writeUint16(primaryAttributes.intelligence & 0xffff);
  writer.writeUint16(statusPoints & 0xffff);
  writer.writeUint8(petCapacity & 0xff);
  return writer.payload();
}

export function buildServerRunScriptPacket(scriptId: number, subtype: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_SCRIPT_EVENT_CMD);
  writer.writeUint8(subtype & 0xff);
  writer.writeUint16(scriptId & 0xffff);
  return writer.payload();
}

export function buildQuestTableSyncPacket({
  playerRuntimeId,
  subtype = 0x08,
  quests,
  history = [],
}: {
  playerRuntimeId: number;
  subtype?: number;
  quests: QuestTableSyncEntry[];
  history?: QuestTableHistoryEntry[];
}): Buffer {
  const writer = new PacketWriter();
  const normalizedQuests = Array.isArray(quests) ? quests.slice(0, 0x10) : [];
  const normalizedHistory = Array.isArray(history) ? history : [];

  writer.writeUint16(GAME_QUEST_TABLE_CMD);
  writer.writeUint8(subtype & 0xff);
  writer.writeUint32(playerRuntimeId >>> 0);
  writer.writeUint8(normalizedQuests.length & 0xff);

  for (const quest of normalizedQuests) {
    writer.writeUint16((quest?.taskId || 0) & 0xffff);
    writer.writeUint16((quest?.step || 0) & 0xffff);
    writer.writeUint16((quest?.extraA || 0) & 0xffff);
    writer.writeUint16((quest?.extraB || 0) & 0xffff);
  }

  writer.writeUint16(normalizedHistory.length & 0xffff);
  for (const entry of normalizedHistory) {
    writer.writeUint16((entry?.taskId || 0) & 0xffff);
    writer.writeUint8((entry?.state || 0) & 0xff);
  }

  return writer.payload();
}

export function buildQuestAcceptStatePacket({
  subtype = 0x03,
  taskId,
  currentStep,
  taskType,
  maxStep,
  overNpcId,
  targetNpcId,
  objectiveWords = [],
}: QuestAcceptStateParams): Buffer {
  const writer = new PacketWriter();
  const normalizedObjectiveWords = Array.isArray(objectiveWords)
    ? objectiveWords.slice(0, 10)
    : [];

  writer.writeUint16(GAME_QUEST_CMD);
  writer.writeUint8(subtype & 0xff);
  writer.writeUint16(taskId & 0xffff);
  writer.writeUint8(currentStep & 0xff);
  writer.writeUint8(taskType & 0xff);
  writer.writeUint8(maxStep & 0xff);
  writer.writeUint16(overNpcId & 0xffff);
  writer.writeUint16(targetNpcId & 0xffff);

  for (let index = 0; index < 10; index += 1) {
    writer.writeUint16((normalizedObjectiveWords[index] || 0) & 0xffff);
  }

  return writer.payload();
}

export function buildNpcShopOpenPacket({
  items,
}: {
  items: NpcShopCatalogItem[];
}): Buffer {
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

export function buildSceneEnterPacket(mapId: number, x: number, y: number, subtype = SCENE_ENTER_LOAD_SUBCMD): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_SCENE_ENTER_CMD);
  writer.writeUint8(subtype & 0xff);
  writer.writeUint16(mapId & 0xffff);
  writer.writeUint16(x & 0xffff);
  writer.writeUint16(y & 0xffff);
  return writer.payload();
}

export function buildSceneSpawnBatchPacket(spawns: SceneSpawnRecord[]): Buffer {
  const writer = new PacketWriter();
  const normalizedSpawns = Array.isArray(spawns) ? spawns : [];
  writer.writeUint16(0x03eb);
  writer.writeUint8(0x15);
  writer.writeUint16(normalizedSpawns.length & 0xffff);

  for (const spawn of normalizedSpawns) {
    writer.writeUint32((spawn.id || 0) >>> 0);
    writer.writeUint16((spawn.entityType || 0) & 0xffff);
    writer.writeUint16((spawn.x || 0) & 0xffff);
    writer.writeUint16((spawn.y || 0) & 0xffff);
    writer.writeUint16((spawn.dir || 0) & 0xffff);
    writer.writeUint16((spawn.state || 0) & 0xffff);
  }

  return writer.payload();
}

export function buildSelfStateValueUpdatePacket({ discriminator, value }: ValueUpdateParams): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_SELF_STATE_CMD);
  writer.writeUint8(SELF_STATE_VALUE_UPDATE_SUBCMD);
  writer.writeUint8(discriminator & 0xff);
  writer.writeUint32(value >>> 0);
  return writer.payload();
}

export function buildSkillStateSyncPacket({
  skills,
}: {
  skills: SkillSyncEntry[];
}): Buffer {
  const writer = new PacketWriter();
  const normalizedSkills = Array.isArray(skills) ? skills : [];
  writer.writeUint16(GAME_FIGHT_TURN_CMD);
  writer.writeUint8(0x00);
  writer.writeUint16(normalizedSkills.length & 0xffff);
  for (const skill of normalizedSkills) {
    writer.writeUint16((skill?.skillId || 0) & 0xffff);
    writer.writeUint16((skill?.level || 1) & 0xffff);
    writer.writeUint16((skill?.proficiency || 0) & 0xffff);
  }
  return writer.payload();
}

export function buildPetSummonSyncPacket({
  ownerRuntimeId,
  pet,
}: {
  ownerRuntimeId: number;
  pet: PetData;
}): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(0x0a);
  writer.writeUint32(ownerRuntimeId >>> 0);
  writer.writeUint8(0x01);
  writer.writeUint32((pet.currentHealth || 0) >>> 0);
  writer.writeUint32((pet.currentMana || 0) >>> 0);
  writer.writeUint32((pet.experience || 0) >>> 0);
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

export function buildPetCreateSyncPacket({ pet }: { pet: PetData }): Buffer {
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

export function buildPetPlacementSyncPacket({ pet }: { pet: PetData }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(0x0f);
  writer.writeUint32((pet.runtimeId || 0) >>> 0);
  writer.writeUint8((pet.stateFlags?.modeA || 0) & 0xff);
  writer.writeUint8((pet.stateFlags?.modeB || 0) & 0xff);
  return writer.payload();
}

export function buildPetRosterSyncPacket({ pets }: { pets: PetData[] }): Buffer {
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

export function buildPetStatsSyncPacket({ pet }: { pet: PetData }): Buffer {
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

export function buildPetTreeRegistrationPacket({ pet }: { pet: PetData }): Buffer {
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

export function buildPetPanelBindPacket({ ownerRuntimeId, pet }: { ownerRuntimeId: number; pet: PetData }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03ee);
  writer.writeUint8(0x51);
  writer.writeUint32((ownerRuntimeId || 0) >>> 0);
  writer.writeUint16((pet.templateId || 0) & 0xffff);
  writer.writeString(`${pet.name || ''}\0`);
  return writer.payload();
}

export function buildPetPanelRebindPacket({ ownerRuntimeId }: { ownerRuntimeId: number }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03ee);
  writer.writeUint8(0x53);
  writer.writeUint32((ownerRuntimeId || 0) >>> 0);
  return writer.payload();
}

export function buildPetPanelClearPacket({ ownerRuntimeId }: { ownerRuntimeId: number }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03ee);
  writer.writeUint8(0x58);
  writer.writeUint32((ownerRuntimeId || 0) >>> 0);
  return writer.payload();
}

export function buildPetPanelNamePacket({ ownerRuntimeId, pet }: { ownerRuntimeId: number; pet: PetData }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03ee);
  writer.writeUint8(0x59);
  writer.writeUint32((ownerRuntimeId || 0) >>> 0);
  writer.writeString(`${pet.name || ''}\0`);
  return writer.payload();
}

export function buildPetPanelPropertyPacket({ ownerRuntimeId, index, value }: { ownerRuntimeId: number; index: number; value: number }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03ee);
  writer.writeUint8(0x55);
  writer.writeUint32((ownerRuntimeId || 0) >>> 0);
  writer.writeUint8(index & 0xff);
  writer.writeUint16((value || 0) & 0xffff);
  return writer.payload();
}

export function buildPetPanelModePacket({ ownerRuntimeId, enabled }: { ownerRuntimeId: number; enabled: boolean }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03ee);
  writer.writeUint8(enabled ? 0x56 : 0x57);
  writer.writeUint32((ownerRuntimeId || 0) >>> 0);
  return writer.payload();
}

export function buildPetActiveSelectPacket({ runtimeId }: { runtimeId: number }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03f5);
  writer.writeUint8(0x51);
  writer.writeUint32((runtimeId || 0) >>> 0);
  return writer.payload();
}

export function buildQuestPacket(subtype: number, taskId: number, extraValue: number | null = null, extraType: 'u8' | 'u16' | 'u32' = 'u32'): Buffer {
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

export function buildInventoryContainerBulkSyncPacket({
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

export function buildInventoryContainerPositionPacket({
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

export function buildInventoryContainerQuantityPacket({
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

export function buildItemAddPacket({
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

export function buildItemRemovePacket({ containerType, instanceId }: { containerType: number; instanceId: number }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_ITEM_CMD + 1);
  writer.writeUint8(containerType & 0xff);
  writer.writeUint32(instanceId >>> 0);
  return writer.payload();
}

export function buildEquipmentStatePacket({ instanceId, equipped }: { instanceId: number; equipped: boolean }): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(0x03ee);
  writer.writeUint8(0x01);
  writer.writeUint32(instanceId >>> 0);
  writer.writeUint8(equipped ? 1 : 0);
  writer.writeUint8(equipped ? 0 : 1);
  return writer.payload();
}

export function buildGatherStartConfirmPacket(toolType: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_GATHER_RESPONSE_CMD);
  writer.writeUint8(0x0b);
  writer.writeUint16(toolType & 0xffff);
  return writer.payload();
}

export function buildGatherRewardPacket(flags: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_GATHER_RESPONSE_CMD);
  writer.writeUint8(0x0e);
  writer.writeUint8(flags & 0xff);
  return writer.payload();
}

export function buildGatherFailedPacket(): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_GATHER_RESPONSE_CMD);
  writer.writeUint8(0x0f);
  return writer.payload();
}

export function buildGameDialoguePacket({ speaker, message, subtype = GAME_DIALOG_MESSAGE_SUBCMD, flags = 0, extraText = null }: {
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
