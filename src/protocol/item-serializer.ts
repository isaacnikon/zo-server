'use strict';

const { PacketWriter } = require('../protocol');

interface AttributePair {
  value?: number;
}

interface ItemInstance {
  templateId: number;
  instanceId?: number;
  stateCode?: number;
  bindState?: number;
  quantity?: number;
  extraValue?: number;
  clientTemplateFamily?: number | null;
  attributePairs?: AttributePair[];
}

type FamilySerializer = (writer: InstanceType<typeof PacketWriter>, item: ItemInstance) => void;

function writeCommonItemFields(writer: InstanceType<typeof PacketWriter>, item: ItemInstance): void {
  writer.writeUint16((item.templateId ?? 0) & 0xffff);
  writer.writeUint32((item.instanceId ?? 0) >>> 0);
  writer.writeUint8((item.stateCode ?? 0) & 0xff);
  writer.writeUint8((item.bindState ?? 0) & 0xff);
  writer.writeUint16((item.quantity ?? 1) & 0xffff);
  writer.writeUint16((item.extraValue ?? 0) & 0xffff);
}

function serializeConsumableFamily(_writer: InstanceType<typeof PacketWriter>, _item: ItemInstance): void {
  // Family 0x41 stops after common fields plus the embedded-entry count byte.
  _writer.writeUint8(0);
}

function serializeQuestItemFamily(_writer: InstanceType<typeof PacketWriter>, _item: ItemInstance): void {
  // Family 0x74 returns before the count byte is consumed — no trailing bytes.
}

function serializeArmorFamily(writer: InstanceType<typeof PacketWriter>, item: ItemInstance): void {
  const pairs = item.attributePairs ?? [];
  // Armor-style templates consume two trailing u16 fields + embedded-entry count byte.
  for (let index = 0; index < 2; index += 1) {
    const pair = pairs[index];
    writer.writeUint16((pair?.value || 0) & 0xffff);
  }
  // Sub-family 0x27 has 4 extra u16 attribute pairs.
  if (item.clientTemplateFamily === 0x27) {
    for (let index = 2; index < 6; index += 1) {
      const pair = pairs[index];
      writer.writeUint16((pair?.value || 0) & 0xffff);
    }
  }
  writer.writeUint8(0);
}

function serializeDefaultFamily(writer: InstanceType<typeof PacketWriter>, item: ItemInstance): void {
  // Fallback shape for families that consume six trailing u16 fields.
  const pairs = item.attributePairs ?? [];
  for (let index = 0; index < 6; index += 1) {
    const pair = pairs[index];
    writer.writeUint16((pair?.value || 0) & 0xffff);
  }
  writer.writeUint8(0);
}

// Build the strategy map
const FAMILY_SERIALIZERS = new Map<number, FamilySerializer>();

// 0x41 = consumable
FAMILY_SERIALIZERS.set(0x41, serializeConsumableFamily);

// 0x74 = quest item
FAMILY_SERIALIZERS.set(0x74, serializeQuestItemFamily);

// 0x20-0x3f = armor-style templates
for (let family = 0x20; family < 0x40; family += 1) {
  FAMILY_SERIALIZERS.set(family, serializeArmorFamily);
}

export function serializeItemInstance(writer: InstanceType<typeof PacketWriter>, item: ItemInstance): void {
  writeCommonItemFields(writer, item);
  const family = item.clientTemplateFamily;
  if (family != null) {
    const serializer = FAMILY_SERIALIZERS.get(family);
    if (serializer) {
      serializer(writer, item);
      return;
    }
  }
  serializeDefaultFamily(writer, item);
}

// Re-export the original function name for backward compatibility
export const writeClientItemInstancePayload = serializeItemInstance;

module.exports = {
  serializeItemInstance,
  writeClientItemInstancePayload,
};
