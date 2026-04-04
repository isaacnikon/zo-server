import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { GAME_POSITION_QUERY_CMD, GAME_SERVER_RUN_CMD, PING_CMD } from '../config.js';
import { buildQuest2SyncState } from '../quest2/index.js';
import { resolveRepoPath } from '../runtime-paths.js';
import type { GameSession, PositionUpdate } from '../types.js';

const TRIGGER_TRACE_PATH = resolveRepoPath('data', 'runtime', 'trigger-trace.jsonl');
const SKILL_PACKET_TRACE_PATH = resolveRepoPath('data', 'runtime', 'skill-packet-trace.jsonl');
const OUTCAST_PACKET_TRACE_PATH = resolveRepoPath('data', 'runtime', 'outcast-packet-trace.jsonl');
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

type PacketTracePhase = 'pre-dispatch' | 'post-unhandled';
type ServerRunTraceRequest = {
  subcmd: number;
  rawArgs: number[];
  npcId?: number;
  scriptId?: number;
};
type TrackedQuestRecord = {
  questId: number;
  stepIndex: number;
  status: number;
} | null;

function appendTraceLine(path: string, event: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8');
}

function appendTriggerTrace(event: Record<string, unknown>): void {
  appendTraceLine(TRIGGER_TRACE_PATH, event);
}

function appendSkillPacketTrace(event: Record<string, unknown>): void {
  appendTraceLine(SKILL_PACKET_TRACE_PATH, event);
}

function appendOutcastPacketTrace(event: Record<string, unknown>): void {
  appendTraceLine(OUTCAST_PACKET_TRACE_PATH, event);
}

function findActiveQuestRecord(session: GameSession, taskId: number): TrackedQuestRecord {
  const syncState = buildQuest2SyncState(session.questStateV2);
  const quest = syncState.find((record) => (record.taskId >>> 0) === (taskId >>> 0)) || null;
  if (!quest) {
    return null;
  }
  return {
    questId: quest.taskId >>> 0,
    stepIndex: quest.stepIndex >>> 0,
    status: quest.status >>> 0,
  };
}

function chebyshevDistance(x: number, y: number, targetX: number, targetY: number): number {
  return Math.max(Math.abs((x | 0) - (targetX | 0)), Math.abs((y | 0) - (targetY | 0)));
}

function traceSkillUiPacket(
  session: GameSession,
  cmdWord: number,
  payload: Buffer,
  phase: PacketTracePhase
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
  phase: PacketTracePhase
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
  const renownQuestRecord = findActiveQuestRecord(session, 811);
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
    renownStepIndex: Number.isInteger(renownQuestRecord?.stepIndex)
      ? (Number(renownQuestRecord?.stepIndex) >>> 0)
      : -1,
    renownStatus: Number.isInteger(renownQuestRecord?.status)
      ? (Number(renownQuestRecord?.status) >>> 0)
      : -1,
  });
}

function traceGladysInteractionWindow(
  session: GameSession,
  cmdWord: number,
  payload: Buffer,
  phase: PacketTracePhase
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

function traceDisenchantingInteractionWindow(
  session: GameSession,
  cmdWord: number,
  payload: Buffer,
  phase: PacketTracePhase
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
    stepIndex: Number.isInteger(questRecord?.stepIndex) ? (Number(questRecord?.stepIndex) >>> 0) : -1,
    status: Number.isInteger(questRecord?.status) ? (Number(questRecord?.status) >>> 0) : -1,
    franklinDistance,
    bonnieDistance,
  });
}

export function traceGameplayPacket(
  session: GameSession,
  cmdWord: number,
  flags: number,
  payload: Buffer,
  phase: PacketTracePhase
): void {
  traceSkillUiPacket(session, cmdWord, payload, phase);
  traceOutcastInteractionWindow(session, cmdWord, flags, payload, phase);
  traceGladysInteractionWindow(session, cmdWord, payload, phase);
  traceDisenchantingInteractionWindow(session, cmdWord, payload, phase);
}

export function tracePositionUpdate(session: GameSession, position: PositionUpdate): void {
  appendTriggerTrace({
    kind: 'position',
    ts: new Date().toISOString(),
    sessionId: session.id,
    mapId: position.mapId >>> 0,
    x: position.x >>> 0,
    y: position.y >>> 0,
  });
}

export function traceServerRunRequest(
  session: GameSession,
  request: ServerRunTraceRequest
): void {
  appendTriggerTrace({
    kind: 'server-run',
    ts: new Date().toISOString(),
    sessionId: session.id,
    subcmd: request.subcmd >>> 0,
    rawArgs: request.rawArgs.map((value) => value >>> 0),
    npcId: typeof request.npcId === 'number' ? (request.npcId >>> 0) : null,
    scriptId: typeof request.scriptId === 'number' ? (request.scriptId >>> 0) : null,
    mapId: session.currentMapId >>> 0,
    x: session.currentX >>> 0,
    y: session.currentY >>> 0,
  });
}

export function traceUnhandledPlayerStatePacket(
  session: GameSession,
  cmdWord: number,
  payload: Buffer
): void {
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
}

export function buildDisenchantingServerRunLog(
  session: GameSession,
  request: ServerRunTraceRequest
): string | null {
  const questRecord = findActiveQuestRecord(session, DISENCHANTING_TRACE_TASK_ID);
  if (!questRecord || request.subcmd !== 0x1a) {
    return null;
  }

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
  const argsText = request.rawArgs.map((value) => `0x${value.toString(16)}`).join(',');

  return (
    `Disenchanting trace sub=0x1a args=[${argsText}] ` +
    `taskStep=${Number.isInteger(questRecord?.stepIndex) ? (Number(questRecord?.stepIndex) >>> 0) : -1} ` +
    `taskStatus=${Number.isInteger(questRecord?.status) ? (Number(questRecord?.status) >>> 0) : -1} ` +
    `franklinDist=${franklinDistance} bonnieDist=${bonnieDistance} ` +
    `map=${session.currentMapId} pos=${session.currentX},${session.currentY}`
  );
}
