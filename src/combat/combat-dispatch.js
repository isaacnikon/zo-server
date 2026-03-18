'use strict';

/**
 * Dispatch tables for combat resolution outcomes.
 *
 * Replaces nested if/else chains in handleSyntheticAttackSelection
 * and resolveSyntheticQueuedTurn with lookup-based dispatch.
 */

// --- Player attack result dispatch ---

function handleAttackNoop(_session, _resolution) {
  // No action needed
}

function handleAttackInvalidTarget(session, _resolution, deps) {
  deps.sendCombatTurnProbe(session, { probeId: 'attack-reprompt' }, 'attack-invalid-target');
}

function handleAttackEnemyTurnQueue(session, resolution, deps) {
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

function handleAttackVictory(session, resolution, deps) {
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
function dispatchAttackResult(session, resolution, deps) {
  const handler = ATTACK_RESULT_HANDLERS[resolution.kind];
  if (handler) {
    handler(session, resolution, deps);
    return;
  }

  // Unknown resolution kind — log and ignore
  session.log(`Unknown attack resolution kind=${resolution.kind}`);
}

// --- Enemy turn resolution dispatch ---

function handleTurnMissing(session, action, _resolution, deps) {
  deps.sendCombatCommandRefresh(session, action, 'enemy-turn-missing');
}

function handleTurnSkipped(session, action, _resolution, deps) {
  if (session.syntheticFight?.turnQueue?.length === 0) {
    deps.sendCombatCommandRefresh(session, action, 'enemy-turn-skipped');
  }
}

function handleTurnDefeat(session, _action, resolution, deps) {
  deps.sendSyntheticAttackMirrorUpdate(session, { actionMode: deps.FIGHT_RESULT_DEFEAT_SUBCMD });
  deps.finishSyntheticFight(session, 'defeat', `${session.charName} was defeated.`);
}

function handleTurnDownedAwaitingAllies(session, _action, resolution, deps) {
  deps.sendSyntheticAttackMirrorUpdate(session, { actionMode: deps.FIGHT_RESULT_DEFEAT_SUBCMD });
  session.log(`Synthetic fighter downed entity=${resolution.player.entityId} awaiting ally outcome`);
}

function handleTurnEnemyContinues(session, action, resolution, deps) {
  deps.sendCombatCommandHide(session,
    { ...action, entityId: resolution.nextEnemyActor },
    'enemy-turn-continues'
  );
}

function handleTurnComplete(session, action, _resolution, deps) {
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
function dispatchTurnResult(session, action, resolution, deps) {
  const handler = TURN_RESULT_HANDLERS[resolution.kind];
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
