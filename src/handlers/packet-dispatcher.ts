import type { GameSession } from '../types';
import { parsePositionUpdate, parseServerRunRequest } from '../protocol/inbound-packets';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { handleSceneInteractionRequest } from '../scenes/map-interactions';
import { notifyAutoMapRotationPosition } from '../scenes/map-rotation';
import { maybeTriggerFieldCombat } from '../scenes/field-combat';
import { handleNpcInteractionRequest } from './npc-interaction-handler';
const { handleQuestAbandonRequest } = require('./quest-handler');
const { handleNpcShopServiceRequest } = require('../gameplay/shop-runtime');

const {
  GAME_POSITION_QUERY_CMD,
  GAME_SERVER_RUN_CMD,
  ROLE_CMD,
  GAME_QUEST_CMD,
  GAME_FIGHT_ACTION_CMD,
  GAME_FIGHT_CLIENT_CMD,
  GAME_FIGHT_MISC_CMD,
  GAME_FIGHT_RESULT_CMD,
  GAME_FIGHT_STATE_CMD,
  GAME_FIGHT_STREAM_CMD,
  GAME_FIGHT_TURN_CMD,
} = require('../config');

type SessionLike = GameSession & Record<string, any>;

const TRIGGER_TRACE_PATH = resolve(process.cwd(), 'data/runtime/trigger-trace.jsonl');

function appendTriggerTrace(event: Record<string, unknown>): void {
  mkdirSync(dirname(TRIGGER_TRACE_PATH), { recursive: true });
  appendFileSync(TRIGGER_TRACE_PATH, `${JSON.stringify(event)}\n`, 'utf8');
}

function buildPacketDispatch(): Map<number, string> {
  return new Map([
    [ROLE_CMD, 'handleRolePacket'],
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

  if (cmdWord === GAME_POSITION_QUERY_CMD && payload.length >= 8) {
    const position = parsePositionUpdate(payload);
    session.currentMapId = position.mapId;
    session.currentX = position.x;
    session.currentY = position.y;
    session.persistCurrentCharacter({
      mapId: position.mapId,
      x: position.x,
      y: position.y,
    });
    notifyAutoMapRotationPosition(session, position.mapId);
    if (session.pendingSceneNpcSpawnMapId === position.mapId) {
      session.sendMapNpcSpawns?.(position.mapId);
      session.pendingSceneNpcSpawnMapId = null;
    }
    maybeTriggerFieldCombat(session, position.mapId, position.x, position.y);
    session.log(`Position update map=${position.mapId} pos=${position.x},${position.y}`);
    appendTriggerTrace({
      kind: 'position',
      ts: new Date().toISOString(),
      sessionId: session.id,
      mapId: position.mapId,
      x: position.x,
      y: position.y,
    });
    return true;
  }

  if (cmdWord === GAME_SERVER_RUN_CMD) {
    const request = parseServerRunRequest(payload);
    if (request) {
      handleSceneInteractionRequest(session, request);
      handleNpcInteractionRequest(session, request);
      if (
        request.subcmd === 0x05 &&
        Array.isArray(request.rawArgs) &&
        Number.isInteger(request.rawArgs[0]) &&
        handleQuestAbandonRequest(session, request.rawArgs[0] >>> 0, 'server-run-abandon')
      ) {
        session.log(`Handled server-run quest abandon taskId=${request.rawArgs[0] >>> 0}`);
      }

      if (request.subcmd === 0x03 && typeof request.npcId === 'number' && typeof request.scriptId === 'number') {
        session.log(
          `Server-run request sub=0x${request.subcmd.toString(16)} npcId=${request.npcId} script=${request.scriptId} map=${session.currentMapId} pos=${session.currentX},${session.currentY}`
        );
      } else {
        const argsText = request.rawArgs.map((value) => `0x${value.toString(16)}`).join(',');
        session.log(
          `Server-run request sub=0x${request.subcmd.toString(16)} args=[${argsText}] map=${session.currentMapId} pos=${session.currentX},${session.currentY}`
        );
      }
      appendTriggerTrace({
        kind: 'server-run',
        ts: new Date().toISOString(),
        sessionId: session.id,
        subcmd: request.subcmd,
        rawArgs: request.rawArgs,
        npcId: request.npcId ?? null,
        scriptId: request.scriptId ?? null,
        mapId: session.currentMapId,
        x: session.currentX,
        y: session.currentY,
      });
      return true;
    }
  }

  if (handleNpcShopServiceRequest(session, payload)) {
    return true;
  }

  if (cmdWord === GAME_FIGHT_RESULT_CMD && session.tryHandleEquipmentStatePacket(payload)) {
    return true;
  }

  if (cmdWord === GAME_FIGHT_RESULT_CMD && session.tryHandleFightResultItemActionProbe(payload)) {
    return true;
  }

  if (session.tryHandleItemUsePacket(cmdWord, payload)) {
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

  if (cmdWord === 0x03ef) {
    const subcmd = payload.length >= 3 ? payload[2] : -1;
    session.log(
      `Unhandled player-state packet cmd=0x03ef sub=0x${subcmd.toString(16)} len=${payload.length} hex=${payload.toString('hex')}`
    );
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
