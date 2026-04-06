import type { CombatState, GameSession } from '../types.js';
import { FIGHT_CLIENT_ATTACK_SELECTION_SUBCMD, FIGHT_CLIENT_DEFEND_SUBCMD, FIGHT_CLIENT_FLEE_SUBCMD, FIGHT_CLIENT_ITEM_USE_SUBCMD, FIGHT_CLIENT_PROTECT_SUBCMD, FIGHT_CLIENT_READY_SUBCMD, FIGHT_CLIENT_SELECTOR_TOKEN_SUBCMD, GAME_FIGHT_ACTION_CMD, GAME_FIGHT_CLIENT_CMD, } from '../config.js';
import { parseCombatItemUse, parseCombatSelectorToken } from '../protocol/inbound-packets.js';
import {
  appendSkillPacketTrace,
  createIdleCombatState,
  FIGHT_CLIENT_SKILL_USE_SUBCMD,
} from '../combat/combat-formulas.js';
import { handleCombatSkillUse } from '../combat/skill-resolution.js';
import {
  clearCombatState,
  disposeCombatTimers,
  advanceSkillResolutionEvent,
  handleAttackSelection,
  processNextEnemyTurnAttack,
  resolveCombatDefend,
  resolveCombatFlee,
  resolveCombatItemUse,
  handleCombatSelectorToken,
  resolveEnemyCounterattack,
  resolveVictory,
  scheduleCommandPhaseAutoFallback,
  tryAdvanceSharedCombatRoundOnReady,
  transitionToCommandPhase,
} from '../combat/combat-resolution.js';

type CombatAction = Record<string, any>;

export { createIdleCombatState } from '../combat/combat-formulas.js';
export { disposeCombatTimers, handleSharedCombatParticipantDisposed } from '../combat/combat-resolution.js';

export function handleCombatPacket(session: GameSession, cmdWord: number, payload: Buffer): void {
  if (!session.combatState?.active) {
    session.log(`Ignoring combat packet with no active combat cmd=0x${cmdWord.toString(16)}`);
    return;
  }

  if (cmdWord === 0x03f5 && payload.length >= 7) {
    const subcmd = payload[2] & 0xff;
    const selectorToken = payload.readUInt32LE(3) >>> 0;
    appendSkillPacketTrace({
      kind: 'fight-skill-ui-packet',
      ts: new Date().toISOString(),
      sessionId: session.id,
      cmdWord,
      subcmd,
      len: payload.length,
      hex: payload.toString('hex'),
      phase: session.combatState.phase || 'unknown',
      awaitingPlayerAction: session.combatState.awaitingPlayerAction === true,
      selectorToken,
    });
    if (subcmd === 0x51 || subcmd === 0x56 || subcmd === 0x58) {
      handleCombatSelectorToken(
        session,
        selectorToken,
        `cmd=0x${cmdWord.toString(16)} sub=0x${subcmd.toString(16)}`
      );
      return;
    }
  }

  if (session.combatState.awaitingSkillResolution) {
    appendSkillPacketTrace({
      kind: 'skill-resolution-event',
      ts: new Date().toISOString(),
      sessionId: session.id,
      cmdWord,
      subcmd: payload.length >= 3 ? payload[2] : -1,
      len: payload.length,
      phase: session.combatState.phase || 'unknown',
      awaitingPlayerAction: session.combatState.awaitingPlayerAction === true,
      hex: payload.toString('hex'),
    });
  }

  if (isClientReadyPacket(cmdWord, payload)) {
    if (tryHandleCombatReady(session)) {
      return;
    }
  }

  if (isDelayedSkillImpactCompletionPacket(session, cmdWord, payload)) {
    appendSkillPacketTrace({
      kind: 'skill-resolution-event',
      ts: new Date().toISOString(),
      sessionId: session.id,
      cmdWord,
      subcmd: payload[2],
      len: payload.length,
      phase: session.combatState.phase || 'unknown',
      awaitingPlayerAction: session.combatState.awaitingPlayerAction === true,
      hex: payload.toString('hex'),
      completionMode: 'delayed-skill-impact-complete',
    });
    advanceSkillResolutionEvent(session, 'delayed-skill-impact-complete');
    return;
  }

  if (
    cmdWord === GAME_FIGHT_ACTION_CMD &&
    payload.length >= 6 &&
    payload[2] === FIGHT_CLIENT_ATTACK_SELECTION_SUBCMD
  ) {
    handleAttackSelection(session, payload);
    return;
  }

  if (
    cmdWord === GAME_FIGHT_ACTION_CMD &&
    payload.length >= 3 &&
    payload[2] === FIGHT_CLIENT_FLEE_SUBCMD
  ) {
    resolveCombatFlee(session, `cmd=0x${cmdWord.toString(16)} sub=0x${payload[2].toString(16)}`);
    return;
  }

  if (
    cmdWord === GAME_FIGHT_ACTION_CMD &&
    payload.length >= 11 &&
    payload[2] === FIGHT_CLIENT_ITEM_USE_SUBCMD
  ) {
    const { instanceId, targetEntityId } = parseCombatItemUse(payload);
    void resolveCombatItemUse(session, instanceId, targetEntityId, `cmd=0x${cmdWord.toString(16)} sub=0x${payload[2].toString(16)}`);
    return;
  }

  if (
    cmdWord === GAME_FIGHT_ACTION_CMD &&
    payload.length >= 9 &&
    payload[2] === FIGHT_CLIENT_SKILL_USE_SUBCMD
  ) {
    handleCombatSkillUse(session, payload);
    return;
  }

  if (
    cmdWord === GAME_FIGHT_ACTION_CMD &&
    payload.length >= 3 &&
    payload[2] === FIGHT_CLIENT_DEFEND_SUBCMD
  ) {
    resolveCombatDefend(session, `cmd=0x${cmdWord.toString(16)} sub=0x${payload[2].toString(16)}`);
    return;
  }

  if (
    cmdWord === GAME_FIGHT_ACTION_CMD &&
    payload.length >= 7 &&
    payload[2] === FIGHT_CLIENT_SELECTOR_TOKEN_SUBCMD
  ) {
    const parsed = parseCombatSelectorToken(payload);
    if (parsed) {
      handleCombatSelectorToken(
        session,
        parsed.selectorToken,
        `cmd=0x${cmdWord.toString(16)} sub=0x${payload[2].toString(16)}`
      );
      return;
    }
  }

  if (
    cmdWord === GAME_FIGHT_ACTION_CMD &&
    payload.length >= 7 &&
    payload[2] === FIGHT_CLIENT_PROTECT_SUBCMD
  ) {
    resolveCombatDefend(
      session,
      `cmd=0x${cmdWord.toString(16)} sub=0x${payload[2].toString(16)} protect-alias`
    );
    return;
  }

  if (cmdWord === GAME_FIGHT_CLIENT_CMD) {
    const subcmd = payload.length >= 3 ? payload[2] : -1;
    const decodedClientPacket = subcmd === 0x4f
      ? {
          byte3: payload.length >= 4 ? payload[3] & 0xff : -1,
          byte4: payload.length >= 5 ? payload[4] & 0xff : -1,
          byte5: payload.length >= 6 ? payload[5] & 0xff : -1,
          byte6: payload.length >= 7 ? payload[6] & 0xff : -1,
          u16At3: payload.length >= 5 ? payload.readUInt16LE(3) & 0xffff : 0,
          u16At5: payload.length >= 7 ? payload.readUInt16LE(5) & 0xffff : 0,
          u32At3: payload.length >= 7 ? payload.readUInt32LE(3) >>> 0 : 0,
        }
      : null;
    appendSkillPacketTrace({
      kind: 'fight-client-unhandled',
      ts: new Date().toISOString(),
      sessionId: session.id,
      cmdWord,
      subcmd,
      len: payload.length,
      hex: payload.toString('hex'),
      phase: session.combatState?.phase || 'unknown',
      awaitingPlayerAction: session.combatState?.awaitingPlayerAction === true,
      learnedSkillIds: Array.isArray(session.skillState?.learnedSkills)
        ? session.skillState.learnedSkills.map((entry: any) => Number(entry?.skillId || 0))
        : [],
      hotbarSkillIds: Array.isArray(session.skillState?.hotbarSkillIds) ? session.skillState.hotbarSkillIds : [],
      decoded: decodedClientPacket,
    });
    if (decodedClientPacket) {
      session.log(
        `Decoded combat client packet sub=0x4f phase=${session.combatState?.phase || 'unknown'} ` +
        `awaitingPlayerAction=${session.combatState?.awaitingPlayerAction === true ? 1 : 0} ` +
        `b3=${decodedClientPacket.byte3} b4=${decodedClientPacket.byte4} b5=${decodedClientPacket.byte5} b6=${decodedClientPacket.byte6} ` +
        `u16@3=${decodedClientPacket.u16At3} u16@5=${decodedClientPacket.u16At5} u32@3=${decodedClientPacket.u32At3}`
      );
    }
    session.log(describeUnhandledCombatClientPacket(session, payload));
    return;
  }

  if (cmdWord === GAME_FIGHT_ACTION_CMD && payload.length >= 3) {
    appendSkillPacketTrace({
      kind: 'fight-action-unhandled',
      ts: new Date().toISOString(),
      sessionId: session.id,
      cmdWord,
      subcmd: payload[2],
      len: payload.length,
      hex: payload.toString('hex'),
      phase: session.combatState?.phase || 'unknown',
      awaitingPlayerAction: session.combatState?.awaitingPlayerAction === true,
    });
  }

  session.log(
    `Unhandled combat packet cmd=0x${cmdWord.toString(16)} len=${payload.length} phase=${session.combatState.phase || 'unknown'} awaitingPlayerAction=${session.combatState.awaitingPlayerAction === true ? 1 : 0} hex=${payload.toString('hex')}`
  );
}

function isClientReadyPacket(cmdWord: number, payload: Buffer): boolean {
  return cmdWord === GAME_FIGHT_ACTION_CMD && payload.length >= 3 && payload[2] === FIGHT_CLIENT_READY_SUBCMD;
}

function tryHandleCombatReady(session: GameSession): boolean {
  if (tryAdvanceSharedCombatRoundOnReady(session)) {
    return true;
  }

  if (session.combatState.phase === 'command' && session.combatState.awaitingPlayerAction) {
    scheduleCommandPhaseAutoFallback(session, 'command-ready-packet');
    session.log(
      `Deferring command-phase ready packet as possible auto-action trigger round=${session.combatState.round}`
    );
    return true;
  }

  if (session.combatState.pendingActionResolution) {
    const pending = session.combatState.pendingActionResolution;
    session.combatState.pendingActionResolution = null;
    session.combatState.awaitingClientReady = false;
    if (pending.reason === 'victory') {
      void resolveVictory(session);
      return true;
    }
    resolveEnemyCounterattack(session, pending.reason);
    return true;
  }

  if (session.combatState.awaitingClientReady) {
    transitionToCommandPhase(session, 'client-ready');
    return true;
  }

  if (session.combatState.pendingCounterattack) {
    processNextEnemyTurnAttack(session, session.combatState.enemyTurnReason || 'normal');
    return true;
  }

  if (session.combatState.phase === 'enemy-turn') {
    processNextEnemyTurnAttack(session, session.combatState.enemyTurnReason || 'normal');
    return true;
  }

  if (session.combatState.awaitingSkillResolution) {
    advanceSkillResolutionEvent(session, 'client-ready-event');
    return true;
  }

  if (session.combatState.pendingPostKillCounterattack) {
    session.combatState.pendingPostKillCounterattack = false;
    session.combatState.awaitingPlayerAction = false;
    session.combatState.phase = 'resolved';
    resolveEnemyCounterattack(session, 'post-kill');
    return true;
  }

  return false;
}

function isDelayedSkillImpactCompletionPacket(session: GameSession, cmdWord: number, payload: Buffer): boolean {
  return (
    session.combatState?.awaitingSkillResolution === true &&
    session.combatState?.skillResolutionPhase === 'await-impact-ready' &&
    cmdWord === GAME_FIGHT_CLIENT_CMD &&
    payload.length >= 3 &&
    payload[2] === 0x4f
  );
}


export function sendCombatExitProbe(session: GameSession, action: CombatAction): void {
  if (!session.combatState?.active) {
    return;
  }
  session.log(`Combat exit probe trigger=${action?.probeId || 'unknown'} current=${session.combatState.triggerId}`);
  void clearCombatState(session, false);
}

function describeUnhandledCombatClientPacket(session: GameSession, payload: Buffer): string {
  const head = payload.length >= 3 ? payload[2] & 0xff : -1;
  const u32At3 = payload.length >= 7 ? payload.readUInt32LE(3) >>> 0 : 0;
  const u16At3 = payload.length >= 5 ? payload.readUInt16LE(3) & 0xffff : 0;
  const u16At5 = payload.length >= 7 ? payload.readUInt16LE(5) & 0xffff : 0;
  return (
    `Unhandled combat client packet cmd=0x${GAME_FIGHT_CLIENT_CMD.toString(16)} ` +
    `len=${payload.length} phase=${session.combatState.phase || 'unknown'} ` +
    `awaitingPlayerAction=${session.combatState.awaitingPlayerAction === true ? 1 : 0} ` +
    `head=0x${head.toString(16)} u16@3=${u16At3} u16@5=${u16At5} u32@3=${u32At3} hex=${payload.toString('hex')}`
  );
}
