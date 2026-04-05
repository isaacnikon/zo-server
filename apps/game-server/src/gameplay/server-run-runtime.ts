import type { GameSession, ServerRunRequestData } from '../types.js';

import { handleSceneInteractionRequest } from '../scenes/map-interactions.js';
import { handleNpcInteractionRequest } from '../handlers/npc-interaction-handler.js';
import { handleQuestAbandonRequest } from '../handlers/quest-handler.js';
import {
  buildDisenchantingServerRunLog,
  traceServerRunRequest,
} from '../observability/packet-tracing.js';

export async function handleServerRunRequest(
  session: GameSession,
  request: ServerRunRequestData
): Promise<boolean> {
  handleSceneInteractionRequest(session, request);
  await handleNpcInteractionRequest(session, request);
  await handleQuestAbandonServerRun(session, request);
  logServerRunRequest(session, request);
  traceServerRunRequest(session, request);
  return true;
}

async function handleQuestAbandonServerRun(
  session: GameSession,
  request: ServerRunRequestData
): Promise<void> {
  if (
    request.subcmd !== 0x05 ||
    !Array.isArray(request.rawArgs) ||
    !Number.isInteger(request.rawArgs[0])
  ) {
    return;
  }

  const taskId = request.rawArgs[0] >>> 0;
  if (await handleQuestAbandonRequest(session, taskId, 'server-run-abandon')) {
    session.log(`Handled server-run quest abandon taskId=${taskId}`);
  }
}

function logServerRunRequest(
  session: GameSession,
  request: ServerRunRequestData
): void {
  if (
    request.subcmd === 0x03 &&
    typeof request.npcId === 'number' &&
    typeof request.scriptId === 'number'
  ) {
    session.log(
      `Server-run request sub=0x${request.subcmd.toString(16)} npcId=${request.npcId} script=${request.scriptId} map=${session.currentMapId} pos=${session.currentX},${session.currentY}`
    );
  } else {
    session.log(
      `Server-run request sub=0x${request.subcmd.toString(16)} args=[${formatServerRunArgs(request.rawArgs)}] map=${session.currentMapId} pos=${session.currentX},${session.currentY}`
    );
  }

  const disenchantingLog = buildDisenchantingServerRunLog(session, request);
  if (disenchantingLog) {
    session.log(disenchantingLog);
  }
}

function formatServerRunArgs(rawArgs: number[]): string {
  return rawArgs.map((value) => `0x${value.toString(16)}`).join(',');
}
