'use strict';

import type {
  PositionUpdate,
  CreateRoleData,
  QuestPacketData,
  EquipmentStateData,
  AttributeAllocationData,
  AttackSelectionData,
} from '../types';

const { PacketReader } = require('./packet-reader');

// --- Inbound packet parsers ---
// Each function extracts typed fields from a raw payload buffer.
// Zero game logic — pure parsing only.

export function parsePositionUpdate(payload: Buffer): PositionUpdate {
  const reader = new PacketReader(payload, 2);
  return {
    x: reader.readUint16(),
    y: reader.readUint16(),
    mapId: reader.readUint16(),
  };
}

export function parseCreateRole(payload: Buffer): CreateRoleData {
  const templateIndex = payload[3];
  const nameLen = payload.readUInt16LE(4);
  const nameStart = 6;
  const nameEnd = Math.min(payload.length, nameStart + nameLen);
  const roleName = payload.slice(nameStart, nameEnd).toString('latin1').replace(/\0.*$/, '');
  const birthMonth = payload.length > nameEnd ? payload[nameEnd] : 0;
  const birthDay = payload.length > nameEnd + 1 ? payload[nameEnd + 1] : 0;
  const selectedAptitude = payload.length > nameEnd + 2 ? payload[nameEnd + 2] : 0;
  const extra1 = payload.length >= nameEnd + 5 ? payload.readUInt16LE(nameEnd + 3) : 0;
  const extra2 = payload.length >= nameEnd + 7 ? payload.readUInt16LE(nameEnd + 5) : 0;

  return { templateIndex, roleName, birthMonth, birthDay, selectedAptitude, extra1, extra2 };
}

export function parseQuestPacket(payload: Buffer): QuestPacketData {
  return {
    subcmd: payload[2],
    taskId: payload.readUInt16LE(3),
  };
}

export function parseEquipmentState(payload: Buffer): EquipmentStateData | null {
  if (payload.length !== 9 || payload[2] !== 0x01) {
    return null;
  }
  const instanceId = payload.readUInt32LE(3);
  const equipFlag = payload[7];
  const unequipFlag = payload[8];
  if (!((equipFlag === 1 && unequipFlag === 0) || (equipFlag === 0 && unequipFlag === 1))) {
    return null;
  }
  return { instanceId, equipFlag, unequipFlag };
}

export function parseAttributeAllocation(payload: Buffer): AttributeAllocationData | null {
  if (payload.length < 11 || payload[2] !== 0x1e) {
    return null;
  }
  return {
    strengthDelta: payload.readUInt16LE(3),
    dexterityDelta: payload.readUInt16LE(5),
    vitalityDelta: payload.readUInt16LE(7),
    intelligenceDelta: payload.readUInt16LE(9),
  };
}

export function parseAttackSelection(payload: Buffer): AttackSelectionData {
  return {
    attackMode: payload[3] & 0xff,
    targetA: payload[4] & 0xff,
    targetB: payload[5] & 0xff,
  };
}

export function parsePingToken(payload: Buffer): { token: number } {
  return { token: payload.readUInt32LE(2) };
}

export function parseLoginPacket(payload: Buffer): { username: string } | null {
  if (payload.length < 6) {
    return null;
  }
  const usernameLen = payload.readUInt16LE(2);
  const usernameStart = 4;
  const usernameEnd = usernameStart + usernameLen;
  if (usernameEnd > payload.length) {
    return null;
  }
  const username = payload.slice(usernameStart, usernameEnd).toString('latin1').replace(/\0.*$/, '');
  return username ? { username } : null;
}

export function parseRoleSubcommand(payload: Buffer): { subcmd: number } {
  return { subcmd: payload[2] };
}

module.exports = {
  parsePositionUpdate,
  parseCreateRole,
  parseQuestPacket,
  parseEquipmentState,
  parseAttributeAllocation,
  parseAttackSelection,
  parsePingToken,
  parseLoginPacket,
  parseRoleSubcommand,
};
