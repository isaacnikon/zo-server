'use strict';

function resolvePlayerAttackSelection({
  syntheticFight,
  attackMode,
  targetA,
  targetB,
  charName,
  now = Date.now(),
  findSyntheticEnemyTarget,
  computeSyntheticDamage,
  initializeSyntheticEnemyTurnQueue,
}) {
  if (!syntheticFight) {
    return { kind: 'noop' };
  }

  const player = syntheticFight.fighters.find((fighter) => fighter.side === 0xff) || null;
  if (!player) {
    return { kind: 'noop' };
  }

  const requestedEnemy = findSyntheticEnemyTarget(syntheticFight, targetA, targetB);
  const fallbackEnemy = requestedEnemy || syntheticFight.enemies.find((candidate) => candidate.hp > 0) || null;
  const enemy = fallbackEnemy;
  const targetMatches = requestedEnemy !== null;
  const retargeted = requestedEnemy === null && fallbackEnemy !== null;

  syntheticFight.lastAction = {
    actorEntityId: player.entityId,
    attackMode,
    targetA,
    targetB,
    targetMatches,
    retargeted,
    targetEntityId: enemy?.entityId || 0,
    timestamp: now,
  };
  syntheticFight.phase = 'resolving';
  syntheticFight.awaitingPlayerAction = false;
  syntheticFight.suppressNextReadyRepeat = false;

  if (!targetMatches) {
    if (retargeted) {
      syntheticFight.lastAction.targetA = enemy.row;
      syntheticFight.lastAction.targetB = enemy.col;
    }
  }

  if (!enemy) {
    return {
      kind: 'invalid-target',
      player,
      enemy: null,
    };
  }

  const damage = Math.min(enemy.hp, computeSyntheticDamage(player, enemy));
  enemy.hp = Math.max(0, enemy.hp - damage);
  enemy.alive = enemy.hp > 0;
  player.lastActionAt = now;

  const livingEnemies = syntheticFight.enemies.filter((candidate) => candidate.hp > 0);

  if (livingEnemies.length > 0) {
    initializeSyntheticEnemyTurnQueue(syntheticFight, player.entityId);
    return {
      kind: 'enemy-turn-queue',
      player,
      enemy,
      damage,
      livingEnemies,
      retargeted,
      nextEnemyActor: syntheticFight.turnQueue[0]?.attackerEntityId || enemy.entityId,
    };
  }

  syntheticFight.phase = 'finished';
  syntheticFight.awaitingPlayerAction = false;

  return {
    kind: 'victory',
    player,
    enemy,
    damage,
    livingEnemies,
    retargeted,
    message: `${charName} defeats the enemy group.`,
  };
}

function resolveQueuedEnemyTurn({
  syntheticFight,
  now = Date.now(),
  selectSyntheticEnemyAttacker,
  computeSyntheticDamage,
  hasLivingSyntheticAllies,
}) {
  if (!syntheticFight?.turnQueue?.length) {
    return { kind: 'missing-turn' };
  }

  const player = syntheticFight.fighters.find((fighter) => fighter.side === 0xff) || null;
  const currentTurn = syntheticFight.turnQueue.shift();
  const attacker = syntheticFight.enemies.find(
    (enemy) => enemy.entityId === currentTurn.attackerEntityId && enemy.hp > 0
  ) || selectSyntheticEnemyAttacker(syntheticFight);

  if (!player || !attacker) {
    if (syntheticFight.turnQueue.length === 0) {
      syntheticFight.phase = 'command';
      syntheticFight.round += 1;
    }
    return {
      kind: 'skipped',
      player,
      attacker,
    };
  }

  syntheticFight.phase = 'resolving';
  syntheticFight.awaitingPlayerAction = false;
  syntheticFight.suppressNextReadyRepeat = false;

  const damage = Math.min(player.hp, computeSyntheticDamage(attacker, player));
  player.hp = Math.max(0, player.hp - damage);
  player.alive = player.hp > 0;
  player.downed = player.hp === 0;
  player.lastActionAt = now;

  syntheticFight.lastAction = {
    actorEntityId: attacker.entityId,
    attackMode: 1,
    targetA: player.row,
    targetB: player.col,
    targetMatches: true,
    targetEntityId: player.entityId,
    timestamp: now,
  };

  if (player.hp === 0) {
    if (hasLivingSyntheticAllies(syntheticFight, player)) {
      syntheticFight.phase = 'ally-turn';
      return {
        kind: 'downed-awaiting-allies',
        player,
        attacker,
        damage,
      };
    }

    return {
      kind: 'defeat',
      player,
      attacker,
      damage,
    };
  }

  if (syntheticFight.turnQueue.length > 0) {
    syntheticFight.phase = 'enemy-turn';
    return {
      kind: 'enemy-turn-continues',
      player,
      attacker,
      damage,
      nextEnemyActor: syntheticFight.turnQueue[0]?.attackerEntityId || attacker.entityId,
    };
  }

  syntheticFight.phase = 'command';
  syntheticFight.round += 1;
  return {
    kind: 'enemy-turn-complete',
    player,
    attacker,
    damage,
  };
}

function finalizeSyntheticFightState(syntheticFight, outcome) {
  if (!syntheticFight) {
    return { player: null };
  }

  const player = syntheticFight.fighters.find((fighter) => fighter.side === 0xff) || null;
  syntheticFight.phase = 'finished';
  syntheticFight.turnQueue = [];
  syntheticFight.awaitingPlayerAction = false;
  syntheticFight.suppressNextReadyRepeat = false;

  return {
    outcome,
    player,
  };
}

module.exports = {
  finalizeSyntheticFightState,
  resolvePlayerAttackSelection,
  resolveQueuedEnemyTurn,
};
