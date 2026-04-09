import { parsePositionUpdate, parsePingToken, parseServerRunRequest, parseTeamAction03FD, parseTeamAction03FE, parseTeamAction0442 } from '../protocol/inbound-packets.js';
import { handleQuestPacket } from './quest-handler.js';
import { handleRolePacket } from './login-handler.js';
import { handleCombatPacket } from './combat-handler.js';
import { handleGatheringRequest } from './gathering-handler.js';
import { tryHandleClientMaxVitalsSyncPacket, tryHandleEquipmentStatePacket, tryHandleFightResultItemActionProbe, tryHandleItemContainerPacket, tryHandleItemStackCombinePacket, tryHandleItemStackSplitPacket, tryHandleItemUsePacket, tryHandleAttributeAllocationPacket } from './player-state-handler.js';
import { tryHandlePetActionPacket } from './pet-handler.js';
import { handleServerRunRequest } from './server-run-handler.js';
import { tryHandleNpcServicePacket } from '../gameplay/npc-service-runtime.js';
import { handleNpcShopServiceRequest } from '../gameplay/shop-runtime.js';
import { tryHandleCraftRecipePacket } from '../gameplay/crafting-runtime.js';
import { tryHandleWarehouseItemMovePacket, tryHandleWarehousePasswordPacket } from '../gameplay/warehouse-runtime.js';
import {
  handleTeamActionPrimary,
  handleTeamActionSecondary,
  handleTeamFollowUpAction,
} from '../gameplay/team-runtime.js';
import { handleClientPositionUpdate } from '../gameplay/movement-runtime.js';
import {
  traceGameplayPacket,
  tracePositionUpdate,
  traceUnhandledPlayerStatePacket,
  traceWorldExitLifecycle,
} from '../observability/packet-tracing.js';
import {
  blockWorldEntryFor,
  getPairedSession,
  isLoginSession,
  isWorldSession,
} from '../session-role.js';

import { PING_CMD, GAME_GATHER_REQUEST_CMD, GAME_ITEM_CONTAINER_CMD, GAME_LOGOUT_REQUEST_CMD, GAME_POSITION_QUERY_CMD, GAME_SERVER_RUN_CMD, ROLE_CMD, GAME_QUEST_CMD, GAME_FIGHT_ACTION_CMD, GAME_FIGHT_CLIENT_CMD, GAME_FIGHT_MISC_CMD, GAME_FIGHT_RESULT_CMD, GAME_FIGHT_STATE_CMD, GAME_FIGHT_STREAM_CMD, GAME_FIGHT_TURN_CMD, GAME_TEAM_ACTION_PRIMARY_CMD, GAME_TEAM_ACTION_SECONDARY_CMD, GAME_TEAM_FOLLOWUP_CMD, } from '../config.js';
import type { GameSession } from '../types.js';

const ROLE_CMD_ALT = 0x4c04; // byte-swapped ROLE_CMD seen from some client states after delete
const WORLD_LOGOUT_REENTRY_DEBOUNCE_MS = 2_500;

const PACKET_HANDLERS = new Map<number, (session: GameSession, payload: Buffer) => Promise<void> | Promise<boolean> | void | boolean>([
  [ROLE_CMD, handleRolePacket],
  [ROLE_CMD_ALT, handleRolePacket],
  [GAME_QUEST_CMD, handleQuestPacket],
  [GAME_GATHER_REQUEST_CMD, handleGatheringRequest],
]);

async function dispatchParsedPacket<TParsed>(
  session: GameSession,
  payload: Buffer,
  parsePacket: (payload: Buffer) => TParsed | null,
  handlePacket: (session: GameSession, parsed: TParsed) => Promise<boolean> | boolean
): Promise<boolean> {
  const parsed = parsePacket(payload);
  if (!parsed) {
    return false;
  }
  return await handlePacket(session, parsed);
}

async function dispatchGamePacket(
  session: GameSession,
  cmdWord: number,
  flags: number,
  payload: Buffer
): Promise<boolean> {
  traceGameplayPacket(session, cmdWord, flags, payload, 'pre-dispatch');

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
    await handler(session, payload);
    return true;
  }

  if (cmdWord === GAME_POSITION_QUERY_CMD && payload.length >= 8) {
    const position = parsePositionUpdate(payload);
    await handleClientPositionUpdate(session, position);
    tracePositionUpdate(session, position);
    return true;
  }

  if (
    cmdWord === GAME_SERVER_RUN_CMD &&
    await dispatchParsedPacket(session, payload, parseServerRunRequest, handleServerRunRequest)
  ) {
    return true;
  }

  if (cmdWord === GAME_LOGOUT_REQUEST_CMD) {
    if (isWorldSession(session)) {
      traceWorldExitLifecycle(session, 'world-logout-request');
      const pairedSession = getPairedSession(session);
      if (pairedSession && isLoginSession(pairedSession)) {
        blockWorldEntryFor(
          pairedSession,
          WORLD_LOGOUT_REENTRY_DEBOUNCE_MS,
          `world-logout:S${session.id}`
        );
        traceWorldExitLifecycle(pairedSession, 'paired-login-world-logout', {
          worldSessionId: session.id >>> 0,
          holdReentryMs: WORLD_LOGOUT_REENTRY_DEBOUNCE_MS,
        });
        session.log(
          `Marked paired login session S${pairedSession.id} to debounce auto enter-game requests for ${WORLD_LOGOUT_REENTRY_DEBOUNCE_MS}ms`
        );
      }
      session.log('Received world logout request; closing world session');
      session.socket.destroy();
    }
    return true;
  }

  if (
    cmdWord === GAME_TEAM_ACTION_PRIMARY_CMD &&
    await dispatchParsedPacket(session, payload, parseTeamAction03FD, handleTeamActionPrimary)
  ) {
    return true;
  }

  if (
    cmdWord === GAME_TEAM_ACTION_SECONDARY_CMD &&
    await dispatchParsedPacket(session, payload, parseTeamAction03FE, handleTeamActionSecondary)
  ) {
    return true;
  }

  if (
    cmdWord === GAME_TEAM_FOLLOWUP_CMD &&
    await dispatchParsedPacket(session, payload, parseTeamAction0442, handleTeamFollowUpAction)
  ) {
    return true;
  }

  if (await handleNpcShopServiceRequest(session, payload)) {
    return true;
  }

  if (await tryHandleNpcServicePacket(session, payload)) {
    return true;
  }

  if (cmdWord === GAME_FIGHT_CLIENT_CMD && await tryHandleWarehousePasswordPacket(session, payload)) {
    return true;
  }

  if (cmdWord === GAME_FIGHT_RESULT_CMD && await tryHandleEquipmentStatePacket(session, payload)) {
    return true;
  }

  if (cmdWord === GAME_FIGHT_RESULT_CMD && await tryHandleWarehouseItemMovePacket(session, payload)) {
    return true;
  }

  if (cmdWord === GAME_FIGHT_RESULT_CMD && await tryHandleFightResultItemActionProbe(session, payload)) {
    return true;
  }

  if (cmdWord === GAME_ITEM_CONTAINER_CMD && await tryHandleItemContainerPacket(session, payload)) {
    return true;
  }

  if (await tryHandleItemUsePacket(session, cmdWord, payload)) {
    return true;
  }

  if (cmdWord === 0x0400 && await tryHandleItemStackSplitPacket(session, payload)) {
    return true;
  }

  if (cmdWord === 0x03ee && await tryHandleItemStackCombinePacket(session, payload)) {
    return true;
  }

  if (cmdWord === 0x0400 && await tryHandleCraftRecipePacket(session, payload)) {
    return true;
  }

  if (cmdWord === 0x03f5) {
    if (await tryHandlePetActionPacket(session, payload)) {
      return true;
    }
    if (session.combatState?.active) {
      handleCombatPacket(session, cmdWord, payload);
      return true;
    }
  }

  if (cmdWord === 0x03ef && await tryHandleClientMaxVitalsSyncPacket(session, payload)) {
    return true;
  }

  if (cmdWord === 0x03ef && await tryHandleAttributeAllocationPacket(session, payload)) {
    return true;
  }

  if (cmdWord === 0x03ef) {
    const subcmd = payload.length >= 3 ? payload[2] : -1;
    traceUnhandledPlayerStatePacket(session, cmdWord, payload);
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

  traceGameplayPacket(session, cmdWord, flags, payload, 'post-unhandled');

  return false;
}

export { dispatchGamePacket };
