import type { GameSession } from '../types';

const {
  ROLE_CMD,
  GAME_POSITION_QUERY_CMD,
  GAME_SERVER_RUN_CMD,
  GAME_QUEST_CMD,
  GAME_FIGHT_ACTION_CMD,
  GAME_FIGHT_CLIENT_CMD,
  GAME_FIGHT_MISC_CMD,
  GAME_FIGHT_RESULT_CMD,
  GAME_FIGHT_STATE_CMD,
  GAME_FIGHT_STREAM_CMD,
  GAME_FIGHT_TURN_CMD,
  GAME_ITEM_CONTAINER_CMD,
  GAME_ITEM_CMD,
  GAME_ITEM_SERVICE_CMD,
} = require('../config');

type SessionLike = GameSession & Record<string, any>;

function buildPacketDispatch(): Map<number, string> {
  return new Map([
    [ROLE_CMD, 'handleRolePacket'],
    [GAME_POSITION_QUERY_CMD, 'handlePositionUpdate'],
    [GAME_SERVER_RUN_CMD, 'handleServerRunRequest'],
    [GAME_ITEM_SERVICE_CMD, 'handleNpcShopServiceRequest'],
    [GAME_QUEST_CMD, 'handleQuestPacket'],
  ]);
}

function dispatchGamePacket(
  session: SessionLike,
  cmdWord: number,
  flags: number,
  payload: Buffer
): boolean {
  if ((flags & 0x04) !== 0 && payload.length >= 6) {
    session.handleSpecialPacket(cmdWord, payload);
    return true;
  }

  const dispatch = buildPacketDispatch();
  const handlerName = dispatch.get(cmdWord);
  if (handlerName && typeof session[handlerName] === 'function') {
    session[handlerName](payload);
    return true;
  }

  if (cmdWord === GAME_FIGHT_RESULT_CMD && session.tryHandleEquipmentStatePacket(payload)) {
    return true;
  }

  if (cmdWord === 0x03f5) {
    if (session.tryHandlePetActionPacket(payload)) {
      return true;
    }
  }

  if (cmdWord === 0x03ef && session.tryHandleAttributeAllocationPacket(payload)) {
    return true;
  }

  if (
    cmdWord === GAME_FIGHT_ACTION_CMD ||
    cmdWord === GAME_FIGHT_CLIENT_CMD ||
    cmdWord === GAME_FIGHT_STATE_CMD ||
    cmdWord === GAME_FIGHT_RESULT_CMD ||
    cmdWord === GAME_FIGHT_TURN_CMD ||
    cmdWord === GAME_FIGHT_STREAM_CMD ||
    cmdWord === GAME_FIGHT_MISC_CMD
  ) {
    session.handleCombatPacket(cmdWord, payload);
    return true;
  }

  return false;
}

export {
  buildPacketDispatch,
  dispatchGamePacket,
};
