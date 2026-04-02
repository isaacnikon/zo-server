import type {
  AttackSelectionData,
  AttributeAllocationData,
  CreateRoleData,
  EquipmentStateData,
  ItemContainerActionData,
  ItemStackCombineRequestData,
  ItemStackSplitRequestData,
  PositionUpdate,
  QuestPacketData,
  ServerRunRequestData,
  TeamClientAction03FD,
  TeamClientAction03FE,
  TeamClientAction0442,
} from '../types.js';

import { PacketReader } from './packet-reader.js';

function parsePositionUpdate(payload: Buffer): PositionUpdate {
  const reader = new PacketReader(payload, 2);
  return {
    x: reader.readUint16(),
    y: reader.readUint16(),
    mapId: reader.readUint16(),
  };
}

function parseServerRunRequest(payload: Buffer): ServerRunRequestData | null {
  if (payload.length < 3) {
    return null;
  }

  const subcmd = payload[2] & 0xff;

  if (subcmd === 0x04 && payload.length >= 10) {
    return {
      subcmd,
      awardId: payload[3] & 0xff,
      npcId: payload.readUInt16LE(4),
      scriptId: payload.readUInt16LE(8),
      rawArgs: [
        payload[3] & 0xff,
        payload.readUInt16LE(4),
        payload.readUInt16LE(6),
        payload.readUInt16LE(8),
      ],
    };
  }

  if ((subcmd === 0x02 || subcmd === 0x03) && payload.length >= 9) {
    return {
      subcmd,
      npcId: payload.readUInt16LE(3),
      scriptId: payload.readUInt16LE(7),
      rawArgs: [
        payload.readUInt16LE(3),
        payload.readUInt16LE(5),
        payload.readUInt16LE(7),
      ],
    };
  }

  if (subcmd === 0x08 && payload.length >= 9) {
    return {
      subcmd,
      scriptId: payload.readUInt16LE(7),
      rawArgs: [
        payload.readUInt16LE(3),
        payload.readUInt16LE(5),
        payload.readUInt16LE(7),
      ],
    };
  }

  const rawArgs: number[] = [];
  for (let offset = 3; offset + 1 < payload.length; offset += 2) {
    rawArgs.push(payload.readUInt16LE(offset));
  }

  return { subcmd, rawArgs };
}

function parseCreateRole(payload: Buffer): CreateRoleData {
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

function parseQuestPacket(payload: Buffer): QuestPacketData {
  return {
    subcmd: payload[2],
    taskId: payload.readUInt16LE(3),
  };
}

function parseEquipmentState(payload: Buffer): EquipmentStateData | null {
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

function parseItemContainerAction(payload: Buffer): ItemContainerActionData | null {
  if (payload.length < 4) {
    return null;
  }

  const containerType = payload[2] & 0xff;
  const subcmd = payload[3] & 0xff;

  if (subcmd === 0x17 && payload.length >= 14) {
    return {
      containerType,
      subcmd,
      instanceId: payload.readUInt32LE(4),
      slotIndex: payload.readUInt16LE(8),
      column: payload.readUInt16LE(10),
      row: payload.readUInt16LE(12),
    };
  }

  if (subcmd === 0x14 && payload.length >= 10) {
    return {
      containerType,
      subcmd,
      instanceId: payload.readUInt32LE(4),
      quantity: payload.readUInt16LE(8),
    };
  }

  return {
    containerType,
    subcmd,
  };
}

function parseItemStackSplitRequest(payload: Buffer): ItemStackSplitRequestData | null {
  if (!Buffer.isBuffer(payload) || payload.length !== 10 || (payload.readUInt16LE(0) >>> 0) !== 0x0400) {
    return null;
  }
  if ((payload[2] & 0xff) !== 0x08) {
    return null;
  }
  return {
    subcmd: payload[2] & 0xff,
    mode: payload[3] & 0xff,
    instanceId: payload.readUInt32LE(4) >>> 0,
    quantity: payload.readUInt16LE(8) >>> 0,
  };
}

function parseItemStackCombineRequest(payload: Buffer): ItemStackCombineRequestData | null {
  if (!Buffer.isBuffer(payload) || payload.length !== 11 || (payload.readUInt16LE(0) >>> 0) !== 0x03ee) {
    return null;
  }
  if ((payload[2] & 0xff) !== 0x04) {
    return null;
  }
  return {
    subcmd: payload[2] & 0xff,
    sourceInstanceId: payload.readUInt32LE(3) >>> 0,
    targetInstanceId: payload.readUInt32LE(7) >>> 0,
  };
}

function parseAttributeAllocation(payload: Buffer): AttributeAllocationData | null {
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

function parseClientMaxVitalsSync(payload: Buffer): { maxHealth: number; maxMana: number } | null {
  if (payload.length !== 11 || payload[2] !== 0x2f) {
    return null;
  }
  return {
    maxHealth: payload.readUInt32LE(3),
    maxMana: payload.readUInt32LE(7),
  };
}

function parseAttackSelection(payload: Buffer): AttackSelectionData {
  return {
    attackMode: payload[3] & 0xff,
    targetA: payload[4] & 0xff,
    targetB: payload[5] & 0xff,
  };
}

function parseCombatItemUse(payload: Buffer): { instanceId: number; targetEntityId: number } {
  return {
    instanceId: payload.readUInt32LE(3),
    targetEntityId: payload.readUInt32LE(7),
  };
}

function parseCombatSelectorToken(payload: Buffer): { selectorToken: number } | null {
  if (payload.length < 7) {
    return null;
  }
  return {
    selectorToken: payload.readUInt32LE(3) >>> 0,
  };
}

function parseFightResultItemActionProbe(payload: Buffer): { subcmd: number; rawValue: number } | null {
  if (payload.length !== 7 || payload[2] !== 0x02) {
    return null;
  }
  return {
    subcmd: payload[2],
    rawValue: payload.readUInt32LE(3),
  };
}

function parseSharedItemUse(payload: Buffer): { instanceId: number } | null {
  if (payload.length !== 7 || payload[2] !== 0x03) {
    return null;
  }
  return {
    instanceId: payload.readUInt32LE(3),
  };
}

function parseTargetedItemUse(payload: Buffer): { instanceId: number; targetEntityId: number } | null {
  if (payload.length !== 11 || payload[2] !== 0x08) {
    return null;
  }
  return {
    instanceId: payload.readUInt32LE(3),
    targetEntityId: payload.readUInt32LE(7),
  };
}

function parsePingToken(payload: Buffer): { token: number } {
  return { token: payload.readUInt32LE(2) };
}

function parseLoginPacket(payload: Buffer): { username: string; accountKey: string } | null {
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
  if (!username) {
    return null;
  }

  const printableTokens: string[] = [];
  let cursor = 0;
  while (cursor < payload.length) {
    while (cursor < payload.length && !(payload[cursor] >= 0x20 && payload[cursor] < 0x7f)) {
      cursor += 1;
    }
    const start = cursor;
    while (cursor < payload.length && payload[cursor] >= 0x20 && payload[cursor] < 0x7f) {
      cursor += 1;
    }
    if (cursor - start >= 4) {
      printableTokens.push(payload.slice(start, cursor).toString('latin1').replace(/\0.*$/, ''));
    }
  }

  const dedupedTokens = printableTokens.filter((token, index) => token && printableTokens.indexOf(token) === index);
  const identityParts = dedupedTokens.length > 0 ? dedupedTokens.slice(0, 2) : [username];
  const accountKey = identityParts.join('|');
  return { username, accountKey };
}

function parseRoleSubcommand(payload: Buffer): { subcmd: number } {
  return { subcmd: payload[2] };
}

function parseTeamAction03FD(payload: Buffer): TeamClientAction03FD | null {
  if (payload.length < 3) {
    return null;
  }
  return {
    subcmd: payload[2] & 0xff,
  };
}

function parseTeamAction03FE(payload: Buffer): TeamClientAction03FE | null {
  if (payload.length < 3) {
    return null;
  }

  const reader = new PacketReader(payload, 2);
  const subcmd = reader.readUint8() & 0xff;
  const targetIds: number[] = [];

  while (reader.remaining() >= 4) {
    targetIds.push(reader.readUint32() >>> 0);
  }

  return {
    subcmd,
    targetIds,
  };
}

function parseTeamAction0442(payload: Buffer): TeamClientAction0442 | null {
  if (payload.length < 3) {
    return null;
  }

  const reader = new PacketReader(payload, 2);
  const subcmd = reader.readUint8() & 0xff;
  const targetIds: number[] = [];

  while (reader.remaining() >= 4) {
    targetIds.push(reader.readUint32() >>> 0);
  }

  return {
    subcmd,
    targetIds,
  };
}

export {
  parsePositionUpdate,
  parseServerRunRequest,
  parseCreateRole,
  parseQuestPacket,
  parseEquipmentState,
  parseItemContainerAction,
  parseItemStackCombineRequest,
  parseItemStackSplitRequest,
  parseAttributeAllocation,
  parseClientMaxVitalsSync,
  parseAttackSelection,
  parseCombatItemUse,
  parseCombatSelectorToken,
  parseFightResultItemActionProbe,
  parseSharedItemUse,
  parseTargetedItemUse,
  parsePingToken,
  parseLoginPacket,
  parseRoleSubcommand,
  parseTeamAction03FD,
  parseTeamAction03FE,
  parseTeamAction0442,
};
