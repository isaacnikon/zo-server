 'use strict';
 export {};

const {
  FIGHT_ACTIVE_STATE_SUBCMD,
  FIGHT_CONTROL_INIT_SUBCMD,
  FIGHT_CONTROL_RING_OPEN_SUBCMD,
  FIGHT_CONTROL_SHOW_SUBCMD,
  FIGHT_ENCOUNTER_PROBE_SUBCMD,
  FIGHT_ENTITY_FLAG_HIDE_SUBCMD,
  FIGHT_RESULT_DEFEAT_SUBCMD,
  FIGHT_RESULT_VICTORY_SUBCMD,
  FIGHT_STATE_MODE_SUBCMD,
  GAME_FIGHT_STREAM_CMD,
  GAME_FIGHT_TURN_CMD,
} = require('../config');
const { PacketWriter } = require('../protocol');

const ABSENT_COMPANION_SENTINEL = 0xfffe7960;

type UnknownRecord = Record<string, any>;

function writeEntry(writer: InstanceType<typeof PacketWriter>, entry: UnknownRecord, extended = false): void {
  writer.writeUint8(entry.side & 0xff);
  writer.writeUint32(entry.entityId >>> 0);
  writer.writeUint16(entry.typeId & 0xffff);
  writer.writeUint8(entry.row & 0xff);
  writer.writeUint8(entry.col & 0xff);
  writer.writeUint32((entry.hp || entry.maxHp || 1) >>> 0);
  writer.writeUint32((entry.mp || 0) >>> 0);
  writer.writeUint8((entry.aptitude || 0) & 0xff);
  writer.writeUint16((entry.level || 1) & 0xffff);

  if (!extended) {
    return;
  }

  const appearanceTypes = Array.isArray(entry.appearanceTypes) ? entry.appearanceTypes : [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    writer.writeUint16((appearanceTypes[index] || 0) & 0xffff);
  }

  const appearanceVariants = Array.isArray(entry.appearanceVariants) ? entry.appearanceVariants : [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    writer.writeUint8((appearanceVariants[index] || 0) & 0xff);
  }

  writer.writeString(`${entry.name || 'Unknown'}\0`);
}

function buildEncounterPacket(player: UnknownRecord, enemy: UnknownRecord): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_ENCOUNTER_PROBE_SUBCMD);
  writer.writeUint32(player.entityId >>> 0);
  writeEntry(writer, player, true);
  writeEntry(writer, enemy, false);
  return writer.payload();
}

function buildRingOpenPacket(): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_CONTROL_RING_OPEN_SUBCMD);
  return writer.payload();
}

function buildControlInitPacket(): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_CONTROL_INIT_SUBCMD);
  return writer.payload();
}

function buildStateModePacket(): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_STATE_MODE_SUBCMD);
  writer.writeUint32(0xffffffff);
  writer.writeUint32(0);
  writer.writeUint32(0);
  return writer.payload();
}

function buildActiveStatePacket(activeEntityId: number): Buffer {
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

function buildEntityHidePacket(activeEntityId: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_ENTITY_FLAG_HIDE_SUBCMD);
  writer.writeUint32(activeEntityId >>> 0);
  return writer.payload();
}

function buildControlShowPacket(activeEntityId: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_CONTROL_SHOW_SUBCMD);
  writer.writeUint32(activeEntityId >>> 0);
  return writer.payload();
}

function buildTurnPromptPacket(): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_TURN_CMD);
  writer.writeUint8(0);
  writer.writeUint16(1);
  writer.writeUint16(0);
  writer.writeUint16(0);
  writer.writeUint16(0);
  return writer.payload();
}

function buildAttackPlaybackPacket(attackerEntityId: number, targetEntityId: number, resultCode: number, damage: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_ACTIVE_STATE_SUBCMD);
  writer.writeUint32(attackerEntityId >>> 0);
  writer.writeUint32(targetEntityId >>> 0);
  writer.writeUint8(resultCode & 0xff);
  writer.writeUint32(damage >>> 0);
  return writer.payload();
}

function buildVitalsPacket(subcommand: number, health: number, mana: number, rage: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(subcommand & 0xff);
  writer.writeUint32(Math.max(1, health) >>> 0);
  writer.writeUint32(Math.max(0, mana) >>> 0);
  writer.writeUint32(Math.max(0, rage) >>> 0);
  writer.writeUint32(ABSENT_COMPANION_SENTINEL);
  return writer.payload();
}

function buildVictoryPacket(
  health: number,
  mana: number,
  rage: number,
  rewards: {
    characterExperience?: number;
    petExperience?: number;
    coins?: number;
    auxiliaryValue?: number;
    items?: Array<{ templateId: number; quantity?: number }>;
  } = {}
): Buffer {
  const writer = new PacketWriter();
  const items = Array.isArray(rewards.items) ? rewards.items.filter((item) => Number.isInteger(item?.templateId)) : [];
  const expandedItems = [];
  for (const item of items) {
    const quantity = Math.max(1, item.quantity || 1);
    for (let index = 0; index < quantity; index += 1) {
      expandedItems.push(item.templateId >>> 0);
    }
  }
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_RESULT_VICTORY_SUBCMD);
  writer.writeUint32(Math.max(1, health) >>> 0);
  writer.writeUint32(Math.max(0, mana) >>> 0);
  writer.writeUint32(Math.max(0, rage) >>> 0);
  writer.writeUint32(ABSENT_COMPANION_SENTINEL);
  writer.writeUint32((rewards.characterExperience || 0) >>> 0);
  writer.writeUint32((rewards.coins || 0) >>> 0);
  writer.writeUint32((rewards.petExperience || 0) >>> 0);
  writer.writeUint32((rewards.auxiliaryValue || 0) >>> 0);
  for (const templateId of expandedItems) {
    writer.writeUint16(templateId & 0xffff);
  }
  return writer.payload();
}

function buildDefeatPacket(health: number, mana: number, rage: number): Buffer {
  return buildVitalsPacket(FIGHT_RESULT_DEFEAT_SUBCMD, health, mana, rage);
}

module.exports = {
  buildActiveStatePacket,
  buildAttackPlaybackPacket,
  buildControlInitPacket,
  buildControlShowPacket,
  buildDefeatPacket,
  buildEncounterPacket,
  buildEntityHidePacket,
  buildRingOpenPacket,
  buildStateModePacket,
  buildTurnPromptPacket,
  buildVictoryPacket,
  buildVitalsPacket,
};
