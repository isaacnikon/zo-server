import type { CombatEnemyInstance, CombatState, GameSession } from '../types.js';
import { COMBAT_ENABLED, DEFAULT_FLAGS, FIGHT_CLIENT_ATTACK_SELECTION_SUBCMD, FIGHT_CLIENT_DEFEND_SUBCMD, FIGHT_CLIENT_FLEE_SUBCMD, FIGHT_CLIENT_ITEM_USE_SUBCMD, FIGHT_CLIENT_READY_SUBCMD, GAME_FIGHT_ACTION_CMD, GAME_FIGHT_CLIENT_CMD, GAME_FIGHT_STREAM_CMD, } from '../config.js';
import { parseCombatItemUse } from '../protocol/inbound-packets.js';
import { buildEncounterEnemies } from '../combat/encounter-builder.js';
import { buildEncounterPacket } from '../combat/packets.js';
import {
  appendSkillPacketTrace,
  buildAllyPlayerEntry,
  buildPlayerEntry,
  type CombatPartySlot,
  createIdleCombatState,
  describeEncounterEnemies,
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
  resolveEnemyCounterattack,
  resolveVictory,
  sendIntroSequence,
  tryAdvanceSharedCombatRoundOnReady,
  transitionToCommandPhase,
} from '../combat/combat-resolution.js';

type CombatAction = Record<string, any>;
type SendCombatEncounterOptions = {
  enemies?: CombatEnemyInstance[] | null;
  allies?: GameSession[] | null;
};

export { createIdleCombatState } from '../combat/combat-formulas.js';
export { disposeCombatTimers, handleSharedCombatParticipantDisposed } from '../combat/combat-resolution.js';

export function handleCombatPacket(session: GameSession, cmdWord: number, payload: Buffer): void {
  if (!session.combatState?.active) {
    session.log(`Ignoring combat packet with no active combat cmd=0x${cmdWord.toString(16)}`);
    return;
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
    resolveCombatItemUse(session, instanceId, targetEntityId, `cmd=0x${cmdWord.toString(16)} sub=0x${payload[2].toString(16)}`);
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

  if (session.combatState.pendingActionResolution) {
    const pending = session.combatState.pendingActionResolution;
    session.combatState.pendingActionResolution = null;
    session.combatState.awaitingClientReady = false;
    if (pending.reason === 'victory') {
      resolveVictory(session);
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

function cloneEncounterEnemies(enemies: CombatEnemyInstance[]): CombatEnemyInstance[] {
  return enemies.map((enemy) => ({
    ...enemy,
    appearanceTypes: Array.isArray(enemy?.appearanceTypes) ? [...enemy.appearanceTypes] : [],
    appearanceVariants: Array.isArray(enemy?.appearanceVariants) ? [...enemy.appearanceVariants] : [],
    drops: Array.isArray(enemy?.drops) ? enemy.drops.map((drop) => ({ ...drop })) : [],
  }));
}

function resolveSharedPartySlots(size: number): CombatPartySlot[] {
  switch (Math.max(1, Math.min(5, size | 0))) {
    case 1:
      return [{ row: 1, col: 2 }];
    case 2:
      return [{ row: 1, col: 1 }, { row: 1, col: 3 }];
    case 3:
      return [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }];
    case 4:
      return [{ row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 3 }, { row: 1, col: 4 }];
    default:
      return [{ row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 }];
  }
}

function resolveCombatPartyOrder(viewer: GameSession, allies: GameSession[] | null | undefined): GameSession[] {
  const normalized = [viewer, ...(Array.isArray(allies) ? allies : [])]
    .filter((candidate, index, values) =>
      Boolean(candidate) &&
      values.findIndex((entry) => (entry.id >>> 0) === (candidate.id >>> 0)) === index
    );
  const teamOrder = Array.isArray(viewer.teamMembers) ? viewer.teamMembers : [];
  return normalized.sort((left, right) => {
    const leftIndex = teamOrder.findIndex((runtimeId) => (runtimeId >>> 0) === (left.runtimeId >>> 0));
    const rightIndex = teamOrder.findIndex((runtimeId) => (runtimeId >>> 0) === (right.runtimeId >>> 0));
    const normalizedLeftIndex = leftIndex >= 0 ? leftIndex : (0x10000 + (left.runtimeId >>> 0));
    const normalizedRightIndex = rightIndex >= 0 ? rightIndex : (0x10000 + (right.runtimeId >>> 0));
    return normalizedLeftIndex - normalizedRightIndex;
  });
}

export function sendCombatEncounterProbe(
  session: GameSession,
  action: CombatAction,
  options: SendCombatEncounterOptions = {}
): void {
  if (!COMBAT_ENABLED) {
    session.log(`Ignoring encounter trigger while combat is disabled trigger=${action?.probeId || 'unknown'}`);
    return;
  }
  if (session.combatState?.active) {
    session.log(`Ignoring encounter trigger while combat is already active trigger=${session.combatState.triggerId}`);
    return;
  }

  const enemies = Array.isArray(options.enemies) && options.enemies.length > 0
    ? cloneEncounterEnemies(options.enemies as CombatEnemyInstance[])
    : buildEncounterEnemies(action, session.currentMapId) as CombatEnemyInstance[];
  if (enemies.length === 0) {
    session.log(`Skipping encounter probe with empty pool trigger=${action?.probeId || 'unknown'}`);
    return;
  }
  const partyOrder = resolveCombatPartyOrder(session, options.allies || []);
  const partySlots = resolveSharedPartySlots(partyOrder.length);
  const playerPartyIndex = Math.max(0, partyOrder.findIndex((member) => (member.id >>> 0) === (session.id >>> 0)));
  const player = buildPlayerEntry(session, partySlots[playerPartyIndex] || { row: 1, col: 2 });
  const allies = partyOrder
    .filter((member) => (member.id >>> 0) !== (session.id >>> 0))
    .map((ally) => {
      const allyPartyIndex = Math.max(0, partyOrder.findIndex((member) => (member.id >>> 0) === (ally.id >>> 0)));
      return buildAllyPlayerEntry(ally, partySlots[allyPartyIndex] || { row: 1, col: 2 });
    });

  session.combatState = {
    active: true,
    phase: 'intro',
    round: 0,
    triggerId: action.probeId || 'field-combat',
    encounterAction: action,
    enemies,
    awaitingClientReady: true,
    awaitingPlayerAction: false,
    startedAt: Date.now(),
    playerStartHealth: session.currentHealth,
    playerMaxHealthAtStart: session.maxHealth,
    totalEnemyMaxHp: enemies.reduce((sum: number, enemy: CombatEnemyInstance) => sum + Math.max(0, enemy?.maxHp || 0), 0),
    averageEnemyLevel:
      enemies.length > 0
        ? enemies.reduce((sum: number, enemy: CombatEnemyInstance) => sum + Math.max(1, enemy?.level || 1), 0) / enemies.length
        : 0,
    damageDealt: 0,
    damageTaken: 0,
    awaitingSkillResolution: false,
    skillResolutionStartedAt: 0,
    skillResolutionReason: null,
    skillResolutionPhase: null,
    pendingSkillOutcomes: null,
    pendingSkillContext: null,
    pendingEnemyTurnQueue: [],
    pendingPostKillCounterattack: false,
    enemyTurnReason: null,
    pendingActionResolution: null,
    playerStatus: {},
    enemyStatuses: {},
  };

  session.writePacket(
    buildEncounterPacket(player, enemies, allies),
    DEFAULT_FLAGS,
    `Sending combat encounter cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x65 trigger=${session.combatState.triggerId} allies=${allies.map((ally) => `${Number(ally.entityId) >>> 0}@${Number(ally.row) & 0xff},${Number(ally.col) & 0xff}`).join('|') || 'none'} enemies=${describeEncounterEnemies(enemies)}`
  );
  sendIntroSequence(session);
}

export function sendCombatExitProbe(session: GameSession, action: CombatAction): void {
  if (!session.combatState?.active) {
    return;
  }
  session.log(`Combat exit probe trigger=${action?.probeId || 'unknown'} current=${session.combatState.triggerId}`);
  clearCombatState(session, false);
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
