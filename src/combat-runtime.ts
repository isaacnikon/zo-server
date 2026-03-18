'use strict';
export {};

const {
  GAME_FIGHT_ACTION_CMD,
  GAME_FIGHT_CLIENT_CMD,
  GAME_FIGHT_MISC_CMD,
  GAME_FIGHT_RESULT_CMD,
  GAME_FIGHT_STATE_CMD,
  GAME_FIGHT_STREAM_CMD,
  GAME_FIGHT_TURN_CMD,
} = require('./config');
type CombatPacket = {
  kind: string;
  cmdWord: number;
  subcmd: number | null;
  detail16: number | null;
  detail32: number | null;
  payloadLength: number;
};
type CombatState = {
  lastInbound: CombatPacket | null;
  lastOutbound: CombatPacket | null;
  packetCount: number;
  inboundCount: number;
  outboundCount: number;
  inFight: boolean;
};

const COMBAT_COMMANDS = new Map([
  [GAME_FIGHT_STATE_CMD, 'fightState'],
  [GAME_FIGHT_ACTION_CMD, 'fightAction'],
  [GAME_FIGHT_CLIENT_CMD, 'fightClient'],
  [GAME_FIGHT_RESULT_CMD, 'fightResult'],
  [GAME_FIGHT_TURN_CMD, 'fightTurn'],
  [GAME_FIGHT_MISC_CMD, 'fightMisc'],
  [GAME_FIGHT_STREAM_CMD, 'fightStream'],
]);

function isCombatCommand(cmdWord: number): boolean {
  return COMBAT_COMMANDS.has(cmdWord);
}

function describeCombatCommand(cmdWord: number): string {
  return COMBAT_COMMANDS.get(cmdWord) || `combat-0x${cmdWord.toString(16)}`;
}

function parseCombatPacket(cmdWord: number, payload: Buffer): CombatPacket {
  const subcmd = payload.length >= 3 ? payload[2] : null;
  const detail16 = payload.length >= 5 ? payload.readUInt16LE(3) : null;
  const detail32 = payload.length >= 7 ? payload.readUInt32LE(3) : null;

  return {
    kind: describeCombatCommand(cmdWord),
    cmdWord,
    subcmd,
    detail16,
    detail32,
    payloadLength: payload.length,
  };
}

function inferCombatState(state: CombatState | null | undefined, packet: CombatPacket, direction: string) {
  const nextState = state || createCombatState();
  let stateChanged = false;

  if (packet.cmdWord === GAME_FIGHT_STREAM_CMD && packet.subcmd === 0x65 && !nextState.inFight) {
    nextState.inFight = true;
    stateChanged = true;
  }

  if (packet.cmdWord === GAME_FIGHT_RESULT_CMD && packet.subcmd === 0x58 && nextState.inFight) {
    nextState.inFight = false;
    stateChanged = true;
  }

  return {
    direction,
    inFight: nextState.inFight,
    stateChanged,
  };
}

function createCombatState(): CombatState {
  return {
    lastInbound: null,
    lastOutbound: null,
    packetCount: 0,
    inboundCount: 0,
    outboundCount: 0,
    inFight: false,
  };
}

function recordCombatPacket(state: CombatState | null | undefined, packet: CombatPacket, direction: string) {
  const nextState = state || createCombatState();
  nextState.packetCount += 1;

  if (direction === 'inbound') {
    nextState.lastInbound = packet;
    nextState.inboundCount += 1;
  } else {
    nextState.lastOutbound = packet;
    nextState.outboundCount += 1;
  }

  return {
    state: nextState,
    snapshot: inferCombatState(nextState, packet, direction),
  };
}

function recordInboundCombatPacket(state: CombatState | null | undefined, packet: CombatPacket) {
  return recordCombatPacket(state, packet, 'inbound');
}

function recordOutboundCombatPacket(state: CombatState | null | undefined, packet: CombatPacket) {
  return recordCombatPacket(state, packet, 'outbound');
}

module.exports = {
  COMBAT_COMMANDS,
  createCombatState,
  describeCombatCommand,
  isCombatCommand,
  parseCombatPacket,
  recordCombatPacket,
  recordInboundCombatPacket,
  recordOutboundCombatPacket,
};
