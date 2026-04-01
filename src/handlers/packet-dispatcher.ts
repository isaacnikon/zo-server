import { parsePositionUpdate, parsePingToken, parseServerRunRequest, parseTeamAction03FD, parseTeamAction03FE, parseTeamAction0442 } from '../protocol/inbound-packets.js';
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
import { tryHandleNpcServicePacket } from '../gameplay/npc-service-runtime.js';
import { handleNpcShopServiceRequest } from '../gameplay/shop-runtime.js';
import { handleFrogTeleporterMapArrival, syncFrogTeleporterClientState } from '../gameplay/frog-teleporter-service.js';
import {
  handleTeamActionPrimary,
  handleTeamActionSecondary,
  handleTeamFollowUpAction,
  notifyTeamMemberPosition,
  rejectFollowerLocalMovement,
  shouldIgnoreClientPositionUpdateWhileFollowing,
  syncTeamFollowersToLeader,
} from '../gameplay/team-runtime.js';
import { syncWorldPresence } from '../world-state.js';

import { PING_CMD, GAME_GATHER_REQUEST_CMD, GAME_POSITION_QUERY_CMD, GAME_SERVER_RUN_CMD, ROLE_CMD, GAME_QUEST_CMD, GAME_FIGHT_ACTION_CMD, GAME_FIGHT_CLIENT_CMD, GAME_FIGHT_MISC_CMD, GAME_FIGHT_RESULT_CMD, GAME_FIGHT_STATE_CMD, GAME_FIGHT_STREAM_CMD, GAME_FIGHT_TURN_CMD, GAME_TEAM_ACTION_PRIMARY_CMD, GAME_TEAM_ACTION_SECONDARY_CMD, GAME_TEAM_FOLLOWUP_CMD, } from '../config.js';
import type { GameSession } from '../types.js';
import type { UnknownRecord } from '../utils.js';

const TRIGGER_TRACE_PATH = resolve(process.cwd(), 'data/runtime/trigger-trace.jsonl');
const SKILL_PACKET_TRACE_PATH = resolve(process.cwd(), 'data/runtime/skill-packet-trace.jsonl');
const OUTCAST_PACKET_TRACE_PATH = resolve(process.cwd(), 'data/runtime/outcast-packet-trace.jsonl');
const SKILL_UI_TRACE_COMMANDS = new Set([0x03f5, 0x0400, 0x040d, 0x0410]);
const GLADYS_TRACE_MAP_ID = 112;
const GLADYS_TRACE_BOUNDS = {
  minX: 0,
  maxX: 32,
  minY: 360,
  maxY: 400,
} as const;
const DISENCHANTING_TRACE_TASK_ID = 7;
const DISENCHANTING_TRACE_MAP_ID = 112;
const DISENCHANTING_FRANKLIN_POS = { x: 14, y: 200 } as const;
const DISENCHANTING_BONNIE_POS = { x: 22, y: 189 } as const;
const DISENCHANTING_TRACE_RADIUS = 16;
const OUTCAST_TRACE_MAP_ID = 128;
const OUTCAST_TRACE_BOUNDS = {
  minX: 40,
  maxX: 56,
  minY: 94,
  maxY: 110,
} as const;

function appendTriggerTrace(event: Record<string, unknown>): void {
  mkdirSync(dirname(TRIGGER_TRACE_PATH), { recursive: true });
  appendFileSync(TRIGGER_TRACE_PATH, `${JSON.stringify(event)}\n`, 'utf8');
}

function appendSkillPacketTrace(event: Record<string, unknown>): void {
  mkdirSync(dirname(SKILL_PACKET_TRACE_PATH), { recursive: true });
  appendFileSync(SKILL_PACKET_TRACE_PATH, `${JSON.stringify(event)}\n`, 'utf8');
}

function appendOutcastPacketTrace(event: Record<string, unknown>): void {
  mkdirSync(dirname(OUTCAST_PACKET_TRACE_PATH), { recursive: true });
  appendFileSync(OUTCAST_PACKET_TRACE_PATH, `${JSON.stringify(event)}\n`, 'utf8');
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

function traceOutcastInteractionWindow(
  session: GameSession,
  cmdWord: number,
  flags: number,
  payload: Buffer,
  phase: 'pre-dispatch' | 'post-unhandled'
): void {
  if (session.currentMapId !== OUTCAST_TRACE_MAP_ID) {
    return;
  }
  if (
    session.currentX < OUTCAST_TRACE_BOUNDS.minX ||
    session.currentX > OUTCAST_TRACE_BOUNDS.maxX ||
    session.currentY < OUTCAST_TRACE_BOUNDS.minY ||
    session.currentY > OUTCAST_TRACE_BOUNDS.maxY
  ) {
    return;
  }
  if (cmdWord === GAME_POSITION_QUERY_CMD || cmdWord === PING_CMD) {
    return;
  }

  const subcmd = payload.length >= 3 ? payload[2] : -1;
  const renownQuestRecord =
    Array.isArray(session.activeQuests)
      ? session.activeQuests.find((record) => Number.isInteger(record?.id) && (record.id >>> 0) === 811)
      : null;
  appendOutcastPacketTrace({
    kind: 'outcast-trace',
    phase,
    ts: new Date().toISOString(),
    sessionId: session.id,
    flags,
    cmdWord,
    subcmd,
    len: payload.length,
    hex: payload.toString('hex'),
    mapId: session.currentMapId,
    x: session.currentX,
    y: session.currentY,
    renownActive: Boolean(renownQuestRecord),
    renownStepIndex: Number.isInteger(renownQuestRecord?.stepIndex) ? (renownQuestRecord!.stepIndex >>> 0) : -1,
    renownStatus: Number.isInteger(renownQuestRecord?.status) ? (renownQuestRecord!.status >>> 0) : -1,
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

function findActiveQuestRecord(session: GameSession, taskId: number): UnknownRecord | null {
  if (!Array.isArray(session.activeQuests)) {
    return null;
  }
  return session.activeQuests.find((record) => Number.isInteger(record?.id) && (record.id >>> 0) === (taskId >>> 0)) || null;
}

function chebyshevDistance(x: number, y: number, targetX: number, targetY: number): number {
  return Math.max(Math.abs((x | 0) - (targetX | 0)), Math.abs((y | 0) - (targetY | 0)));
}

function traceDisenchantingInteractionWindow(
  session: GameSession,
  cmdWord: number,
  payload: Buffer,
  phase: 'pre-dispatch' | 'post-unhandled'
): void {
  const questRecord = findActiveQuestRecord(session, DISENCHANTING_TRACE_TASK_ID);
  if (!questRecord) {
    return;
  }
  if (cmdWord === GAME_POSITION_QUERY_CMD || cmdWord === PING_CMD) {
    return;
  }

  const subcmd = payload.length >= 3 ? payload[2] : -1;
  const franklinDistance = chebyshevDistance(
    session.currentX,
    session.currentY,
    DISENCHANTING_FRANKLIN_POS.x,
    DISENCHANTING_FRANKLIN_POS.y
  );
  const bonnieDistance = chebyshevDistance(
    session.currentX,
    session.currentY,
    DISENCHANTING_BONNIE_POS.x,
    DISENCHANTING_BONNIE_POS.y
  );
  const nearRelevantNpc =
    session.currentMapId === DISENCHANTING_TRACE_MAP_ID &&
    (franklinDistance <= DISENCHANTING_TRACE_RADIUS || bonnieDistance <= DISENCHANTING_TRACE_RADIUS);
  if (cmdWord !== GAME_SERVER_RUN_CMD && !nearRelevantNpc) {
    return;
  }

  appendTriggerTrace({
    kind: 'disenchanting-trace',
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
    taskId: DISENCHANTING_TRACE_TASK_ID,
    stepIndex: Number.isInteger(questRecord?.stepIndex) ? (questRecord.stepIndex as number) >>> 0 : -1,
    status: Number.isInteger(questRecord?.status) ? (questRecord.status as number) >>> 0 : -1,
    franklinDistance,
    bonnieDistance,
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
  traceOutcastInteractionWindow(session, cmdWord, flags, payload, 'pre-dispatch');
  traceGladysInteractionWindow(session, cmdWord, payload, 'pre-dispatch');
  traceDisenchantingInteractionWindow(session, cmdWord, payload, 'pre-dispatch');

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
    if (shouldIgnoreClientPositionUpdateWhileFollowing(session)) {
      rejectFollowerLocalMovement(session, position.mapId >>> 0, position.x >>> 0, position.y >>> 0);
      if (session.pendingSceneNpcSpawnMapId === (session.currentMapId >>> 0)) {
        session.sendMapNpcSpawns?.(session.currentMapId >>> 0);
        session.syncQuestStateToClient?.({ mode: 'runtime' });
        syncFrogTeleporterClientState(session, `team-follow-map:${session.currentMapId}`);
        session.pendingSceneNpcSpawnMapId = null;
      }
      if (session.pendingLoginQuestSyncMapId === (session.currentMapId >>> 0)) {
        if (session.pendingLoginQuestSyncTimer) {
          clearTimeout(session.pendingLoginQuestSyncTimer);
          session.pendingLoginQuestSyncTimer = null;
        }
        session.syncQuestStateToClient?.({ mode: 'login' });
        session.pendingLoginQuestSyncMapId = null;
      }
      session.log(
        `Ignoring follower-reported position map=${position.mapId} pos=${position.x},${position.y} authoritative=${session.currentMapId >>> 0},${session.currentX >>> 0},${session.currentY >>> 0}`
      );
      return true;
    }

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
    const frogTeleporterUnlocks = handleFrogTeleporterMapArrival(
      session,
      previousMapId >>> 0,
      position.mapId >>> 0
    );
    session.persistCurrentCharacter({
      mapId: position.mapId,
      x: position.x,
      y: position.y,
      lastTownMapId: checkpoint.mapId,
      lastTownX: checkpoint.x,
      lastTownY: checkpoint.y,
      ...(frogTeleporterUnlocks ? { frogTeleporterUnlocks } : {}),
    });
    notifyAutoMapRotationPosition(session, position.mapId);
    if (session.pendingSceneNpcSpawnMapId === position.mapId) {
      session.sendMapNpcSpawns?.(position.mapId);
      session.syncQuestStateToClient?.({ mode: 'runtime' });
      syncFrogTeleporterClientState(session, `map-change:${previousMapId}->${position.mapId}`);
      session.pendingSceneNpcSpawnMapId = null;
    } else if (previousMapId !== position.mapId) {
      session.syncQuestStateToClient?.({ mode: 'runtime' });
      syncFrogTeleporterClientState(session, `map-change:${previousMapId}->${position.mapId}`);
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
    const followedMembers = syncTeamFollowersToLeader(session);
    for (const follower of followedMembers) {
      syncWorldPresence(
        follower,
        previousMapId === position.mapId ? 'team-follow-position' : `team-follow-map:${previousMapId}->${position.mapId}`
      );
      notifyTeamMemberPosition(follower);
    }
    notifyTeamMemberPosition(session);
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
      const disenchantingQuestRecord = findActiveQuestRecord(session, DISENCHANTING_TRACE_TASK_ID);
      if (disenchantingQuestRecord && request.subcmd === 0x1a) {
        const franklinDistance = chebyshevDistance(
          session.currentX,
          session.currentY,
          DISENCHANTING_FRANKLIN_POS.x,
          DISENCHANTING_FRANKLIN_POS.y
        );
        const bonnieDistance = chebyshevDistance(
          session.currentX,
          session.currentY,
          DISENCHANTING_BONNIE_POS.x,
          DISENCHANTING_BONNIE_POS.y
        );
        const argsText = request.rawArgs.map((value: any) => `0x${value.toString(16)}`).join(',');
        session.log(
          `Disenchanting trace sub=0x1a args=[${argsText}] taskStep=${Number.isInteger(disenchantingQuestRecord?.stepIndex) ? ((disenchantingQuestRecord.stepIndex as number) >>> 0) : -1} taskStatus=${Number.isInteger(disenchantingQuestRecord?.status) ? ((disenchantingQuestRecord.status as number) >>> 0) : -1} franklinDist=${franklinDistance} bonnieDist=${bonnieDistance} map=${session.currentMapId} pos=${session.currentX},${session.currentY}`
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

  if (cmdWord === GAME_TEAM_ACTION_PRIMARY_CMD) {
    const action = parseTeamAction03FD(payload);
    if (action && handleTeamActionPrimary(session, action)) {
      return true;
    }
  }

  if (cmdWord === GAME_TEAM_ACTION_SECONDARY_CMD) {
    const action = parseTeamAction03FE(payload);
    if (action && handleTeamActionSecondary(session, action)) {
      return true;
    }
  }

  if (cmdWord === GAME_TEAM_FOLLOWUP_CMD) {
    const action = parseTeamAction0442(payload);
    if (action && handleTeamFollowUpAction(session, action)) {
      return true;
    }
  }

  if (handleNpcShopServiceRequest(session, payload)) {
    return true;
  }

  if (tryHandleNpcServicePacket(session, payload)) {
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
  traceOutcastInteractionWindow(session, cmdWord, flags, payload, 'post-unhandled');
  traceGladysInteractionWindow(session, cmdWord, payload, 'post-unhandled');
  traceDisenchantingInteractionWindow(session, cmdWord, payload, 'post-unhandled');

  return false;
}

export { dispatchGamePacket };
