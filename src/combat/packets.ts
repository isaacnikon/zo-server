 'use strict';
 export {};

import { FIGHT_ACTIVE_STATE_SUBCMD, FIGHT_CONTROL_INIT_SUBCMD, FIGHT_CONTROL_RING_OPEN_SUBCMD, FIGHT_CONTROL_SHOW_SUBCMD, FIGHT_ENCOUNTER_PROBE_SUBCMD, FIGHT_ENTITY_FLAG_HIDE_SUBCMD, FIGHT_RESULT_DEFEAT_SUBCMD, FIGHT_RESULT_VICTORY_SUBCMD, FIGHT_STATE_MODE_SUBCMD, GAME_FIGHT_STREAM_CMD, GAME_FIGHT_TURN_CMD, } from '../config.js';
import { PacketWriter } from '../protocol.js';

const ABSENT_COMPANION_SENTINEL = 0xfffe7960;
const GAME_PLAYER_ACTION_STATE_CMD = 0x040d;

import type { UnknownRecord } from '../utils.js';
type TurnPromptRow = {
  commandId: number;
  levelIndex?: number;
  state?: number;
};
type SkillCastPlaybackTarget = {
  entityId: number;
  actionCode?: number;
  value?: number;
};
type SkillCastStage2Entry = {
  wordA: number;
  wordB: number;
  dwordC: number;
};
type SkillCastPlaybackOptions = {
  stage2Flag?: number | null;
  stage2Entries?: SkillCastStage2Entry[];
};
type RoundStartOptions = {
  fieldA?: number;
  fieldB?: number;
  fieldC?: number;
  fieldD?: number;
  fieldE?: number | null;
};

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

export function buildEncounterPacket(player: UnknownRecord, enemies: UnknownRecord[] | UnknownRecord): Buffer {
  const writer = new PacketWriter();
  const normalizedEnemies = Array.isArray(enemies) ? enemies : [enemies];
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_ENCOUNTER_PROBE_SUBCMD);
  writer.writeUint32(player.entityId >>> 0);
  writeEntry(writer, player, true);
  for (const enemy of normalizedEnemies) {
    writeEntry(writer, enemy, false);
  }
  return writer.payload();
}

export function buildRingOpenPacket(): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_CONTROL_RING_OPEN_SUBCMD);
  return writer.payload();
}

export function buildControlInitPacket(): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_CONTROL_INIT_SUBCMD);
  return writer.payload();
}

export function buildStateModePacket(): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_STATE_MODE_SUBCMD);
  writer.writeUint32(0xffffffff);
  writer.writeUint32(0);
  writer.writeUint32(0);
  return writer.payload();
}

export function buildActiveStatePacket(activeEntityId: number): Buffer {
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

export function buildEntityHidePacket(activeEntityId: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_ENTITY_FLAG_HIDE_SUBCMD);
  writer.writeUint32(activeEntityId >>> 0);
  return writer.payload();
}

export function buildControlShowPacket(activeEntityId: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_CONTROL_SHOW_SUBCMD);
  writer.writeUint32(activeEntityId >>> 0);
  return writer.payload();
}

export function buildRoundStartPacket(round: number, activeEntityId: number, options: RoundStartOptions = {}): Buffer {
  const writer = new PacketWriter();
  const fieldA = options.fieldA;
  const fieldB = options.fieldB;
  const fieldC = options.fieldC;
  const fieldD = options.fieldD;
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(0x06);
  if (
    fieldA === undefined &&
    fieldB === undefined &&
    fieldC === undefined &&
    fieldD === undefined &&
    options.fieldE === undefined
  ) {
    writer.writeUint16(Math.max(1, round) & 0xffff);
    writer.writeUint32(activeEntityId >>> 0);
    writer.writeUint16(0);
    writer.writeUint8(0x0c);
    return writer.payload();
  }
  writer.writeUint16((fieldA ?? Math.max(1, round)) & 0xffff);
  writer.writeUint32((fieldB ?? (activeEntityId >>> 0)) >>> 0);
  writer.writeUint16((fieldC ?? 0) & 0xffff);
  writer.writeUint8((fieldD ?? 0x0c) & 0xff);
  if ((fieldD ?? 0x0c) !== 0 && (fieldD ?? 0x0c) !== 0x0c) {
    writer.writeUint32((options.fieldE ?? 0) >>> 0);
  }
  return writer.payload();
}

export function buildTurnPromptPacket(rows: TurnPromptRow[] = []): Buffer {
  const writer = new PacketWriter();
  const normalizedRows = rows.length > 0
    ? rows
    : [{ commandId: 2101, levelIndex: 0, state: 0 }];
  writer.writeUint16(GAME_FIGHT_TURN_CMD);
  writer.writeUint8(0);
  writer.writeUint16(normalizedRows.length);
  for (const row of normalizedRows) {
    writer.writeUint16(row.commandId & 0xffff);
    writer.writeUint16((row.levelIndex || 0) & 0xffff);
    writer.writeUint16((row.state || 0) & 0xffff);
  }
  return writer.payload();
}

export function buildAttackPlaybackPacket(
  attackerEntityId: number,
  targetEntityId: number,
  resultCode: number,
  damage: number,
  options: {
    secondaryEntityId?: number;
    secondaryHitstate?: number;
    secondaryValue?: number;
  } = {}
): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_ACTIVE_STATE_SUBCMD);
  writer.writeUint32(attackerEntityId >>> 0);
  writer.writeUint32(targetEntityId >>> 0);
  writer.writeUint8(resultCode & 0xff);
  writer.writeUint32(damage >>> 0);
  writer.writeUint32((options.secondaryEntityId ?? 0xffffffff) >>> 0);
  writer.writeUint8((options.secondaryHitstate || 0) & 0xff);
  writer.writeUint32((options.secondaryValue || 0) >>> 0);
  return writer.payload();
}

export function buildSkillCastPlaybackPacket(
  casterEntityId: number,
  skillId: number,
  skillLevelIndex: number,
  targets: SkillCastPlaybackTarget[],
  options: SkillCastPlaybackOptions = {}
): Buffer {
  const writer = new PacketWriter();
  const normalizedTargets = Array.isArray(targets) ? targets : [];
  const normalizedStage2Entries = Array.isArray(options.stage2Entries) ? options.stage2Entries : [];
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(0x04);
  writer.writeUint32(casterEntityId >>> 0);
  writer.writeUint16(skillId & 0xffff);
  writer.writeUint8(skillLevelIndex & 0xff);
  for (const target of normalizedTargets) {
    writer.writeUint32((target?.entityId || 0) >>> 0);
    writer.writeUint8((target?.actionCode || 0) & 0xff);
    writer.writeUint32((target?.value || 0) >>> 0);
  }
  if (options.stage2Flag !== undefined && options.stage2Flag !== null) {
    writer.writeUint8(options.stage2Flag & 0xff);
    if ((options.stage2Flag & 0xff) === 0) {
      writer.writeUint16(normalizedStage2Entries.length & 0xffff);
      for (const entry of normalizedStage2Entries) {
        writer.writeUint16((entry?.wordA || 0) & 0xffff);
        writer.writeUint16((entry?.wordB || 0) & 0xffff);
        writer.writeUint32((entry?.dwordC || 0) >>> 0);
      }
    }
  }
  return writer.payload();
}

export function buildSlaughterCastPlaybackPacket(
  casterEntityId: number,
  skillId: number,
  skillLevelIndex: number,
  cleanupEffectIds: number[] = [],
  options: {
    leadingByte?: number;
  } = {}
): Buffer {
  const writer = new PacketWriter();
  const normalizedEffectIds = Array.isArray(cleanupEffectIds) ? cleanupEffectIds : [];
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(0x04);
  writer.writeUint32(casterEntityId >>> 0);
  writer.writeUint16(skillId & 0xffff);
  writer.writeUint8(skillLevelIndex & 0xff);
  writer.writeUint8((options.leadingByte || 0) & 0xff);
  for (const effectId of normalizedEffectIds) {
    if (!Number.isFinite(effectId) || (effectId | 0) <= 0) {
      continue;
    }
    writer.writeUint16(effectId & 0xffff);
  }
  writer.writeUint16(0);
  return writer.payload();
}

export function buildActionStateResetPacket(entityId: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_PLAYER_ACTION_STATE_CMD);
  writer.writeUint32(entityId >>> 0);
  writer.writeUint8(0x62);
  return writer.payload();
}

export function buildActionStateTableResetPacket(entityId: number, values: number[] = []): Buffer {
  const writer = new PacketWriter();
  const normalizedValues = Array.isArray(values) ? values.slice(0, 11) : [];
  while (normalizedValues.length < 11) {
    normalizedValues.push(0);
  }
  writer.writeUint16(GAME_PLAYER_ACTION_STATE_CMD);
  writer.writeUint32(entityId >>> 0);
  writer.writeUint8(0x63);
  for (const value of normalizedValues) {
    writer.writeUint16((value || 0) & 0xffff);
  }
  return writer.payload();
}

export function buildProtectPlaybackPacket(
  attackerEntityId: number,
  targetEntityId: number,
  reducedDamage: number,
  protectorEntityId: number,
  blockedDamage: number
): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(FIGHT_ACTIVE_STATE_SUBCMD);
  writer.writeUint32(attackerEntityId >>> 0);
  writer.writeUint32(targetEntityId >>> 0);
  writer.writeUint8(0x0e);
  writer.writeUint8(0);
  writer.writeUint8(1);
  writer.writeUint32(Math.max(0, reducedDamage) >>> 0);
  writer.writeUint32(protectorEntityId >>> 0);
  writer.writeUint8(1);
  writer.writeUint32(Math.max(0, blockedDamage) >>> 0);
  return writer.payload();
}

export function buildVitalsPacket(subcommand: number, health: number, mana: number, rage: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(subcommand & 0xff);
  writer.writeUint32(Math.max(1, health) >>> 0);
  writer.writeUint32(Math.max(0, mana) >>> 0);
  writer.writeUint32(Math.max(0, rage) >>> 0);
  writer.writeUint32(ABSENT_COMPANION_SENTINEL);
  return writer.payload();
}

export function buildVictoryPacket(
  health: number,
  mana: number,
  rage: number,
  rewards: {
    characterExperience?: number;
    petExperience?: number;
    coins?: number;
    petExperienceAuxiliary?: number;
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
  if ((rewards.petExperience || 0) > 0) {
    writer.writeUint32((rewards.petExperienceAuxiliary || 0) >>> 0);
  }
  for (const templateId of expandedItems) {
    writer.writeUint16(templateId & 0xffff);
  }
  return writer.payload();
}

export function buildVictoryPointsPacket(currentPoints: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(0x6c);
  writer.writeUint32(Math.max(0, currentPoints) >>> 0);
  return writer.payload();
}

export function buildVictoryRankPacket(rankCode: number): Buffer {
  const writer = new PacketWriter();
  writer.writeUint16(GAME_FIGHT_STREAM_CMD);
  writer.writeUint8(0x6d);
  writer.writeUint8(rankCode & 0xff);
  return writer.payload();
}

export function buildDefeatPacket(health: number, mana: number, rage: number): Buffer {
  return buildVitalsPacket(FIGHT_RESULT_DEFEAT_SUBCMD, health, mana, rage);
}
