'use strict';

function writeCommonItemFields(writer, item) {
  writer.writeUint16((item.templateId ?? 0) & 0xffff);
  writer.writeUint32((item.instanceId ?? 0) >>> 0);
  writer.writeUint8((item.stateCode ?? 0) & 0xff);
  writer.writeUint8((item.bindState ?? 0) & 0xff);
  writer.writeUint16((item.quantity ?? 1) & 0xffff);
  writer.writeUint16((item.extraValue ?? 0) & 0xffff);
}

function serializeConsumableFamily(writer, _item) {
  writer.writeUint8(0);
}

function serializeQuestItemFamily(_writer, _item) {
  // Family 0x74 returns before the count byte — no trailing bytes.
}

function serializeArmorFamily(writer, item) {
  const pairs = item.attributePairs || [];
  for (let index = 0; index < 2; index += 1) {
    const pair = pairs[index];
    writer.writeUint16((pair?.value || 0) & 0xffff);
  }
  if (item.clientTemplateFamily === 0x27) {
    for (let index = 2; index < 6; index += 1) {
      const pair = pairs[index];
      writer.writeUint16((pair?.value || 0) & 0xffff);
    }
  }
  writer.writeUint8(0);
}

function serializeDefaultFamily(writer, item) {
  const pairs = item.attributePairs || [];
  for (let index = 0; index < 6; index += 1) {
    const pair = pairs[index];
    writer.writeUint16((pair?.value || 0) & 0xffff);
  }
  writer.writeUint8(0);
}

// Build the strategy map: family code → serializer function
const FAMILY_SERIALIZERS = new Map();
FAMILY_SERIALIZERS.set(0x41, serializeConsumableFamily);
FAMILY_SERIALIZERS.set(0x74, serializeQuestItemFamily);
for (let family = 0x20; family < 0x40; family += 1) {
  FAMILY_SERIALIZERS.set(family, serializeArmorFamily);
}

function writeClientItemInstancePayload(writer, item) {
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

module.exports = {
  writeClientItemInstancePayload,
};
