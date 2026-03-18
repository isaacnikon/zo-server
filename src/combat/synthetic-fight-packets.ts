'use strict';
export {};

const {
  FIGHT_ACTIVE_STATE_SUBCMD,
  FIGHT_CONTROL_INIT_SUBCMD,
  FIGHT_CONTROL_RING_OPEN_SUBCMD,
  FIGHT_CONTROL_SHOW_SUBCMD,
  FIGHT_ENCOUNTER_PROBE_SUBCMD,
  FIGHT_STATE_MODE_SUBCMD,
  GAME_FIGHT_STREAM_CMD,
  GAME_FIGHT_TURN_CMD,
} = require('../config');
const { PacketWriter } = require('../protocol');
type UnknownRecord = Record<string, any>;

function writeFightProbeEntry(writer: InstanceType<typeof PacketWriter>, entry: UnknownRecord): void {
  writer.writeUint8(entry.side & 0xff);
  writer.writeUint32(entry.entityId >>> 0);
  writer.writeUint16(entry.typeId & 0xffff);
  writer.writeUint8(entry.row & 0xff);
  writer.writeUint8(entry.col & 0xff);
  writer.writeUint32(entry.hpLike >>> 0);
  writer.writeUint32(entry.mpLike >>> 0);
  writer.writeUint8(entry.aptitude & 0xff);
  writer.writeUint16(entry.levelLike & 0xffff);

  if (!entry.extended) {
    return;
  }

  const appearanceTypes = Array.isArray(entry.appearanceTypes) ? entry.appearanceTypes : [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    writer.writeUint16((appearanceTypes[i] || 0) & 0xffff);
  }

  const appearanceVariants = Array.isArray(entry.appearanceVariants) ? entry.appearanceVariants : [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    writer.writeUint8((appearanceVariants[i] || 0) & 0xff);
  }

  writer.writeString(`${entry.name || 'Unknown'}\0`);
}

function buildCombatEncounterProbePacket({ activeEntityId, playerEntry, enemies }: UnknownRecord): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_ENCOUNTER_PROBE_SUBCMD);
  writer.writeUint32(activeEntityId >>> 0);
  writeFightProbeEntry(writer, playerEntry);
  for (const enemy of enemies) {
    writeFightProbeEntry(writer, enemy);
  }
  return writer.payload();
}

function buildFightControlInitProbePacket(): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_CONTROL_INIT_SUBCMD);
  return writer.payload();
}

function buildFightRingOpenProbePacket(): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_CONTROL_RING_OPEN_SUBCMD);
  return writer.payload();
}

function buildFightStateModeProbe64Packet(): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_STATE_MODE_SUBCMD);
  writer.writeUint32(0xffffffff);
  writer.writeUint32(0);
  writer.writeUint32(0);
  return writer.payload();
}

function buildFightActiveStateProbePacket(activeEntityId: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_ACTIVE_STATE_SUBCMD);
  writer.writeUint32(activeEntityId >>> 0);
  writer.writeUint8(FIGHT_CONTROL_RING_OPEN_SUBCMD);
  writer.writeUint32(0);
  writer.writeUint32(0);
  writer.writeUint32(0);
  writer.writeUint32(0);
  return writer.payload();
}

function buildFightEntityFlagProbePacket(activeEntityId: number, subcommand: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(subcommand & 0xff);
  writer.writeUint32(activeEntityId >>> 0);
  return writer.payload();
}

function buildFightControlShowProbePacket(activeEntityId: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_CONTROL_SHOW_SUBCMD);
  writer.writeUint32(activeEntityId >>> 0);
  return writer.payload();
}

function buildCombatTurnProbePacket(probeProfile: UnknownRecord): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_TURN_CMD);
  writer.writeUint8(0);
  writer.writeUint16(probeProfile.rows.length);
  for (const row of probeProfile.rows) {
    writer.writeUint16(row.fieldA & 0xffff);
    writer.writeUint16(row.fieldB & 0xffff);
    writer.writeUint16(row.fieldC & 0xffff);
  }
  return writer.payload();
}

module.exports = {
  buildCombatEncounterProbePacket,
  buildCombatTurnProbePacket,
  buildFightActiveStateProbePacket,
  buildFightControlInitProbePacket,
  buildFightControlShowProbePacket,
  buildFightEntityFlagProbePacket,
  buildFightRingOpenProbePacket,
  buildFightStateModeProbe64Packet,
};
