'use strict';

const {
  ROLE_CMD,
  GAME_POSITION_QUERY_CMD,
  GAME_SERVER_RUN_CMD,
  GAME_QUEST_CMD,
  GAME_FIGHT_RESULT_CMD,
  GAME_FIGHT_CLIENT_CMD,
  GAME_ITEM_CONTAINER_CMD,
  GAME_ITEM_CMD,
} = require('../config');
const { isCombatCommand } = require('../combat-runtime');

/**
 * Build a dispatch table mapping command words to handler method names.
 * Returns a Map<number, string> where the value is the Session method name.
 */
function buildPacketDispatch() {
  return new Map([
    [ROLE_CMD,                  'handleRolePacket'],
    [GAME_POSITION_QUERY_CMD,  'handlePositionUpdate'],
    [GAME_SERVER_RUN_CMD,      'handleServerRunRequest'],
    [GAME_QUEST_CMD,           'handleQuestPacket'],
  ]);
}

/**
 * Route a game packet to the appropriate handler on the session.
 * Returns true if the packet was handled, false otherwise.
 */
function dispatchGamePacket(session, cmdWord, flags, payload) {
  // Special packets (flags bit 0x04 set)
  if ((flags & 0x04) !== 0 && payload.length >= 6) {
    session.handleSpecialPacket(cmdWord, payload);
    return true;
  }

  // Check primary dispatch table first
  const DISPATCH = buildPacketDispatch();
  const handlerName = DISPATCH.get(cmdWord);
  if (handlerName && typeof session[handlerName] === 'function') {
    session[handlerName](payload);
    return true;
  }

  // Equipment state (overloaded on GAME_FIGHT_RESULT_CMD)
  if (cmdWord === GAME_FIGHT_RESULT_CMD && session.tryHandleEquipmentStatePacket(payload)) {
    return true;
  }

  // Pet action
  if (cmdWord === 0x03f5 && session.tryHandlePetActionPacket(payload)) {
    return true;
  }

  // Attribute allocation
  if (cmdWord === 0x03ef && session.tryHandleAttributeAllocationPacket(payload)) {
    return true;
  }

  // Combat commands
  if (cmdWord === GAME_FIGHT_CLIENT_CMD || isCombatCommand(cmdWord)) {
    session.handleCombatPacket(cmdWord, payload);
    return true;
  }

  return false;
}

module.exports = {
  buildPacketDispatch,
  dispatchGamePacket,
};
