import type { UnknownRecord } from '../utils.js';

function writeAttributeValues(writer: UnknownRecord, item: UnknownRecord, count: number, startIndex = 0): void {
  const pairs = Array.isArray(item.attributePairs) ? item.attributePairs : [];
  for (let index = 0; index < count; index += 1) {
    const pair = pairs[startIndex + index];
    writer.writeUint16((pair?.value || 0) & 0xffff);
  }
}

function writeCommonItemFields(writer: UnknownRecord, item: UnknownRecord): void {
  writer.writeUint16((item.templateId ?? 0) & 0xffff);
  writer.writeInt32((item.tradeState ?? 0) | 0);
  writer.writeUint8((item.stateCode ?? 0) & 0xff);
  writer.writeUint8((item.bindState ?? 0) & 0xff);
  writer.writeUint16((item.quantity ?? 1) & 0xffff);
  writer.writeUint16((item.extraValue ?? 0) & 0xffff);
}

function serializeConsumableFamily(writer: UnknownRecord, _item: UnknownRecord): void {
  writer.writeUint8(0);
}

function serializeNoTrailingFieldsFamily(_writer: UnknownRecord, _item: UnknownRecord): void {
  // Some item families terminate immediately after the common fields.
}

function serializeLowRangeFamily(writer: UnknownRecord, item: UnknownRecord): void {
  writeAttributeValues(writer, item, 6);
  writer.writeUint8(0);
}

function serializeArmorFamily(writer: UnknownRecord, item: UnknownRecord): void {
  writeAttributeValues(writer, item, 2);
  if ((item.clientTemplateFamily ?? 0) === 0x27) {
    writeAttributeValues(writer, item, 4, 2);
  }
  writer.writeUint8(0);
}

function serializeMidRangeCountOnlyFamily(writer: UnknownRecord, _item: UnknownRecord): void {
  writer.writeUint8(0);
}

function serializeThreeWordFamily(writer: UnknownRecord, item: UnknownRecord): void {
  writeAttributeValues(writer, item, 3);
}

function serializeSingleWordFamily(writer: UnknownRecord, item: UnknownRecord): void {
  writeAttributeValues(writer, item, 1);
}

// Build the strategy map: family code → serializer function
const FAMILY_SERIALIZERS = new Map();
FAMILY_SERIALIZERS.set(0x41, serializeConsumableFamily);
for (let family = 0x01; family < 0x20; family += 1) {
  FAMILY_SERIALIZERS.set(family, serializeLowRangeFamily);
}
for (let family = 0x20; family < 0x40; family += 1) {
  FAMILY_SERIALIZERS.set(family, serializeArmorFamily);
}
for (let family = 0x43; family <= 0x70; family += 1) {
  FAMILY_SERIALIZERS.set(family, serializeMidRangeCountOnlyFamily);
}
[
  0x74, 0x76, 0x77, 0x7b, 0x7c, 0x7d, 0x84, 0x85, 0x87, 0x88, 0x89, 0x9f, 0xa2, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb1, 0xb2, 0xb3, 0xc9, 0xca,
  0xcb, 0xcc, 0xcd, 0xce, 0xcf, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9,
  0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe0, 0xe1,
].forEach((family) => {
  FAMILY_SERIALIZERS.set(family, serializeNoTrailingFieldsFamily);
});
[0x79, 0x7e, 0x80, 0x83].forEach((family) => {
  FAMILY_SERIALIZERS.set(family, serializeThreeWordFamily);
});
FAMILY_SERIALIZERS.set(0x7a, serializeSingleWordFamily);

export function writeClientItemInstancePayload(writer: UnknownRecord, item: UnknownRecord): void {
  writeCommonItemFields(writer, item);
  const family = item.clientTemplateFamily;
  if (family != null) {
    const serializer = FAMILY_SERIALIZERS.get(family);
    if (serializer) {
      serializer(writer, item);
      return;
    }
  }
  serializeNoTrailingFieldsFamily(writer, item);
}
