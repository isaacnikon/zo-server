'use strict';
export {};

/**
 * Dispatch tables for combat resolution outcomes.
 *
 * Replaces nested if/else chains in handleSyntheticAttackSelection
 * and resolveSyntheticQueuedTurn with lookup-based dispatch.
 */

// --- Player attack result dispatch ---
type SessionLike = Record<string, any>;
type UnknownRecord = Record<string, any>;
type CombatDeps = Record<string, any>;
type AttackResultKind = 'noop' | 'invalid-target' | 'enemy-turn-queue' | 'victory';
type TurnResultKind =
  | 'missing-turn'
  | 'skipped'
  | 'defeat'
  | 'downed-awaiting-allies'
  | 'enemy-turn-continues'
  | 'enemy-turn-complete';

function handleAttackNoop(_session: SessionLike, _resolution: UnknownRecord) {
  // No action needed
}

function handleAttackInvalidTarget(session: SessionLike, _resolution: UnknownRecord, deps: CombatDeps) {
  deps.sendCombatTurnProbe(session, { probeId: 'attack-reprompt' }, 'attack-invalid-target');
}

function handleAttackEnemyTurnQueue(session: SessionLike, resolution: UnknownRecord, deps: CombatDeps) {
  session.awaitingCombatTurnHandshake = false;
  session.pendingCombatTurnProbe = null;
  deps.sendCombatCommandHide(session,
    { probeId: 'enemy-turn-queue', entityId: resolution.nextEnemyActor },
    'player-action-complete'
  );
  session.log(
    `Queued synthetic enemy turns count=${session.syntheticFight.turnQueue.length} after player action livingEnemies=${resolution.livingEnemies.length}`
  );
}

function handleAttackVictory(session: SessionLike, resolution: UnknownRecord, deps: CombatDeps) {
  session.log(`Synthetic enemy defeated enemy=${resolution.enemy.name} entity=${resolution.enemy.entityId}`);
  session.awaitingCombatTurnHandshake = false;
  session.pendingCombatTurnProbe = null;
  deps.sendSyntheticFightVictoryClose(session);
  deps.finishSyntheticFight(session, 'victory', resolution.message);
}

const ATTACK_RESULT_HANDLERS = {
  'noop': handleAttackNoop,
  'invalid-target': handleAttackInvalidTarget,
  'enemy-turn-queue': handleAttackEnemyTurnQueue,
  'victory': handleAttackVictory,
};

/**
 * Dispatch a player attack resolution to the appropriate handler.
 * Handles shared pre-work (playback, defeat tracking) before dispatch.
 */
function dispatchAttackResult(session: SessionLike, resolution: UnknownRecord, deps: CombatDeps): void {
  const handler = ATTACK_RESULT_HANDLERS[resolution.kind as AttackResultKind];
  if (handler) {
    handler(session, resolution, deps);
    return;
  }

  // Unknown resolution kind — log and ignore
  session.log(`Unknown attack resolution kind=${resolution.kind}`);
}

// --- Enemy turn resolution dispatch ---

function handleTurnMissing(session: SessionLike, action: UnknownRecord, _resolution: UnknownRecord, deps: CombatDeps) {
  deps.sendCombatCommandRefresh(session, action, 'enemy-turn-missing');
}

function handleTurnSkipped(session: SessionLike, action: UnknownRecord, _resolution: UnknownRecord, deps: CombatDeps) {
  if (session.syntheticFight?.turnQueue?.length === 0) {
    deps.sendCombatCommandRefresh(session, action, 'enemy-turn-skipped');
  }
}

function handleTurnDefeat(session: SessionLike, _action: UnknownRecord, resolution: UnknownRecord, deps: CombatDeps) {
  deps.sendSyntheticAttackMirrorUpdate(session, { actionMode: deps.FIGHT_RESULT_DEFEAT_SUBCMD });
  deps.finishSyntheticFight(session, 'defeat', `${session.charName} was defeated.`);
}

function handleTurnDownedAwaitingAllies(session: SessionLike, _action: UnknownRecord, resolution: UnknownRecord, deps: CombatDeps) {
  deps.sendSyntheticAttackMirrorUpdate(session, { actionMode: deps.FIGHT_RESULT_DEFEAT_SUBCMD });
  session.log(`Synthetic fighter downed entity=${resolution.player.entityId} awaiting ally outcome`);
}

function handleTurnEnemyContinues(session: SessionLike, action: UnknownRecord, resolution: UnknownRecord, deps: CombatDeps) {
  deps.sendCombatCommandHide(session,
    { ...action, entityId: resolution.nextEnemyActor },
    'enemy-turn-continues'
  );
}

function handleTurnComplete(session: SessionLike, action: UnknownRecord, _resolution: UnknownRecord, deps: CombatDeps) {
  deps.scheduleSyntheticCommandRefresh(session, action, 'enemy-turn-complete', 1500);
}

const TURN_RESULT_HANDLERS = {
  'missing-turn': handleTurnMissing,
  'skipped': handleTurnSkipped,
  'defeat': handleTurnDefeat,
  'downed-awaiting-allies': handleTurnDownedAwaitingAllies,
  'enemy-turn-continues': handleTurnEnemyContinues,
  'enemy-turn-complete': handleTurnComplete,
};

/**
 * Dispatch an enemy turn resolution to the appropriate handler.
 */
function dispatchTurnResult(session: SessionLike, action: UnknownRecord, resolution: UnknownRecord, deps: CombatDeps): void {
  const handler = TURN_RESULT_HANDLERS[resolution.kind as TurnResultKind];
  if (handler) {
    handler(session, action, resolution, deps);
    return;
  }
  session.log(`Unknown turn resolution kind=${resolution.kind}`);
}

module.exports = {
  ATTACK_RESULT_HANDLERS,
  TURN_RESULT_HANDLERS,
  dispatchAttackResult,
  dispatchTurnResult,
};
