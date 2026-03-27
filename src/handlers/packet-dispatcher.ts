import { parsePositionUpdate, parsePingToken, parseServerRunRequest } from '../protocol/inbound-packets.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { handleSceneInteractionRequest } from '../scenes/map-interactions.js';
import { notifyAutoMapRotationPosition } from '../scenes/map-rotation.js';
import { maybeTriggerFieldCombat } from '../scenes/field-combat.js';
import { handleNpcInteractionRequest } from './npc-interaction-handler.js';
import { handleQuestAbandonRequest, handleQuestPacket } from './quest-handler.js';
import { handleRolePacket } from './login-handler.js';
import { handleCombatPacket } from './combat-handler.js';
import { handleGatheringRequest } from './gathering-handler.js';
import { tryHandleClientMaxVitalsSyncPacket, tryHandleEquipmentStatePacket, tryHandleFightResultItemActionProbe, tryHandleItemUsePacket, tryHandleAttributeAllocationPacket } from './player-state-handler.js';
import { tryHandlePetActionPacket } from './pet-handler.js';
import { resolveTownCheckpoint } from '../gameplay/session-flows.js';
import { handleNpcShopServiceRequest } from '../gameplay/shop-runtime.js';
import { syncWorldPresence } from '../world-state.js';

import { PING_CMD, GAME_GATHER_REQUEST_CMD, GAME_POSITION_QUERY_CMD, GAME_SERVER_RUN_CMD, ROLE_CMD, GAME_QUEST_CMD, GAME_FIGHT_ACTION_CMD, GAME_FIGHT_CLIENT_CMD, GAME_FIGHT_MISC_CMD, GAME_FIGHT_RESULT_CMD, GAME_FIGHT_STATE_CMD, GAME_FIGHT_STREAM_CMD, GAME_FIGHT_TURN_CMD, } from '../config.js';
import type { GameSession } from '../types.js';

const TRIGGER_TRACE_PATH = resolve(process.cwd(), 'data/runtime/trigger-trace.jsonl');
const SKILL_PACKET_TRACE_PATH = resolve(process.cwd(), 'data/runtime/skill-packet-trace.jsonl');
const SKILL_UI_TRACE_COMMANDS = new Set([0x03f5, 0x0400, 0x040d, 0x0410]);
const GLADYS_TRACE_MAP_ID = 112;
const GLADYS_TRACE_BOUNDS = {
  minX: 0,
  maxX: 32,
  minY: 360,
  maxY: 400,
} as const;

function appendTriggerTrace(event: Record<string, unknown>): void {
  mkdirSync(dirname(TRIGGER_TRACE_PATH), { recursive: true });
  appendFileSync(TRIGGER_TRACE_PATH, `${JSON.stringify(event)}\n`, 'utf8');
}

function appendSkillPacketTrace(event: Record<string, unknown>): void {
  mkdirSync(dirname(SKILL_PACKET_TRACE_PATH), { recursive: true });
  appendFileSync(SKILL_PACKET_TRACE_PATH, `${JSON.stringify(event)}\n`, 'utf8');
}

function traceSkillUiPacket(
  session: GameSession,
  cmdWord: number,
  payload: Buffer,
  phase: 'pre-dispatch' | 'post-unhandled'
): void {
  if (!SKILL_UI_TRACE_COMMANDS.has(cmdWord)) {
    return;
  }

  const subcmd = payload.length >= 3 ? payload[2] : -1;
  appendSkillPacketTrace({
    kind: 'skill-ui-packet',
    phase,
    ts: new Date().toISOString(),
    sessionId: session.id,
    cmdWord,
    subcmd,
    len: payload.length,
    hex: payload.toString('hex'),
    mapId: session.currentMapId,
    x: session.currentX,
    y: session.currentY,
    skillState: session.skillState || null,
  });
}

function traceGladysInteractionWindow(
  session: GameSession,
  cmdWord: number,
  payload: Buffer,
  phase: 'pre-dispatch' | 'post-unhandled'
): void {
  if (session.currentMapId !== GLADYS_TRACE_MAP_ID) {
    return;
  }
  if (
    session.currentX < GLADYS_TRACE_BOUNDS.minX ||
    session.currentX > GLADYS_TRACE_BOUNDS.maxX ||
    session.currentY < GLADYS_TRACE_BOUNDS.minY ||
    session.currentY > GLADYS_TRACE_BOUNDS.maxY
  ) {
    return;
  }
  if (cmdWord === GAME_POSITION_QUERY_CMD) {
    return;
  }

  const subcmd = payload.length >= 3 ? payload[2] : -1;
  appendTriggerTrace({
    kind: 'gladys-trace',
    phase,
    ts: new Date().toISOString(),
    sessionId: session.id,
    cmdWord,
    subcmd,
    len: payload.length,
    hex: payload.toString('hex'),
    mapId: session.currentMapId,
    x: session.currentX,
    y: session.currentY,
  });
}

const PACKET_HANDLERS = new Map<number, (session: GameSession, payload: Buffer) => void>([
  [ROLE_CMD, handleRolePacket],
  [GAME_QUEST_CMD, handleQuestPacket],
  [GAME_GATHER_REQUEST_CMD, handleGatheringRequest],
]);

function dispatchGamePacket(
  session: GameSession,
  cmdWord: number,
  flags: number,
  payload: Buffer
): boolean {
  traceSkillUiPacket(session, cmdWord, payload, 'pre-dispatch');
  traceGladysInteractionWindow(session, cmdWord, payload, 'pre-dispatch');

  if ((flags & 0x04) !== 0 && payload.length >= 6) {
    if (cmdWord === PING_CMD) {
      const { token } = parsePingToken(payload);
      session.sendPong(token);
    } else {
      session.log(`Unhandled special cmd16=0x${cmdWord.toString(16)}`);
    }
    return true;
  }

  const handler = PACKET_HANDLERS.get(cmdWord);
  if (handler) {
    handler(session, payload);
    return true;
  }

  if (cmdWord === GAME_POSITION_QUERY_CMD && payload.length >= 8) {
    const position = parsePositionUpdate(payload);
    const previousMapId = session.currentMapId;
    const checkpoint = resolveTownCheckpoint({
      persistedCharacter: session.getPersistedCharacter?.() || null,
      currentMapId: position.mapId,
      currentX: position.x,
      currentY: position.y,
    });
    session.currentMapId = position.mapId;
    session.currentX = position.x;
    session.currentY = position.y;
    session.persistCurrentCharacter({
      mapId: position.mapId,
      x: position.x,
      y: position.y,
      lastTownMapId: checkpoint.mapId,
      lastTownX: checkpoint.x,
      lastTownY: checkpoint.y,
    });
    notifyAutoMapRotationPosition(session, position.mapId);
    if (session.pendingSceneNpcSpawnMapId === position.mapId) {
      session.sendMapNpcSpawns?.(position.mapId);
      session.syncQuestStateToClient?.({ mode: 'runtime' });
      session.pendingSceneNpcSpawnMapId = null;
    } else if (previousMapId !== position.mapId) {
      session.syncQuestStateToClient?.({ mode: 'runtime' });
    }
    if (session.pendingLoginQuestSyncMapId === position.mapId) {
      if (session.pendingLoginQuestSyncTimer) {
        clearTimeout(session.pendingLoginQuestSyncTimer);
        session.pendingLoginQuestSyncTimer = null;
      }
      session.syncQuestStateToClient?.({ mode: 'login' });
      session.pendingLoginQuestSyncMapId = null;
    }
    syncWorldPresence(
      session,
      previousMapId === position.mapId ? 'position-update' : `map-change:${previousMapId}->${position.mapId}`
    );
    session.log(`Position update map=${position.mapId} pos=${position.x},${position.y}`);
    appendTriggerTrace({
      kind: 'position',
      ts: new Date().toISOString(),
      sessionId: session.id,
      mapId: position.mapId,
      x: position.x,
      y: position.y,
    });
    maybeTriggerFieldCombat(session, position.mapId, position.x, position.y);
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
        const argsText = request.rawArgs.map((value: any) => `0x${value.toString(16)}`).join(',');
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

  if (cmdWord === GAME_FIGHT_RESULT_CMD && tryHandleEquipmentStatePacket(session, payload)) {
    return true;
  }

  if (cmdWord === GAME_FIGHT_RESULT_CMD && tryHandleFightResultItemActionProbe(session, payload)) {
    return true;
  }

  if (tryHandleItemUsePacket(session, cmdWord, payload)) {
    return true;
  }

  if (cmdWord === 0x03f5) {
    if (tryHandlePetActionPacket(session, payload)) {
      return true;
    }
  }

  if (cmdWord === 0x03ef && tryHandleClientMaxVitalsSyncPacket(session, payload)) {
    return true;
  }

  if (cmdWord === 0x03ef && tryHandleAttributeAllocationPacket(session, payload)) {
    return true;
  }

  if (cmdWord === 0x03ef) {
    const subcmd = payload.length >= 3 ? payload[2] : -1;
    appendSkillPacketTrace({
      kind: 'player-state-unhandled',
      ts: new Date().toISOString(),
      sessionId: session.id,
      cmdWord,
      subcmd,
      len: payload.length,
      hex: payload.toString('hex'),
      mapId: session.currentMapId,
      x: session.currentX,
      y: session.currentY,
      skillState: session.skillState || null,
    });
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
    handleCombatPacket(session, cmdWord, payload);
    return true;
  }

  traceSkillUiPacket(session, cmdWord, payload, 'post-unhandled');
  traceGladysInteractionWindow(session, cmdWord, payload, 'post-unhandled');

  return false;
}

export { dispatchGamePacket };
