'use strict';

function getSyntheticPlayerFighter(syntheticFight) {
  if (!syntheticFight || !Array.isArray(syntheticFight.fighters)) {
    return null;
  }
  return syntheticFight.fighters.find((fighter) => fighter.side === 0xff) || null;
}

function findSyntheticEnemyTarget(syntheticFight, targetA, targetB) {
  if (!syntheticFight || !Array.isArray(syntheticFight.enemies)) {
    return null;
  }

  return syntheticFight.enemies.find((enemy) => {
    if (enemy.hp <= 0) {
      return false;
    }
    return targetA === enemy.row && targetB === enemy.col;
  }) || null;
}

function selectSyntheticEnemyAttacker(syntheticFight, preferredEnemy = null) {
  if (!syntheticFight || !Array.isArray(syntheticFight.enemies)) {
    return null;
  }
  if (preferredEnemy && preferredEnemy.hp > 0) {
    return preferredEnemy;
  }
  return syntheticFight.enemies.find((enemy) => enemy.hp > 0) || null;
}

function getSyntheticInitiative(fighter) {
  if (!fighter) {
    return 0;
  }
  if (fighter.side === 0xff) {
    return 100 + ((fighter.level || 0) * 2) + ((fighter.dexterity || 0) >> 1);
  }
  return 80 + ((fighter.level || 0) * 2) + ((fighter.dexterity || 0) >> 1) + ((fighter.logicalId || 0) % 3);
}

function initializeSyntheticEnemyTurnQueue(syntheticFight, targetEntityId) {
  if (!syntheticFight) {
    return;
  }
  const liveEnemies = syntheticFight.enemies.filter((enemy) => enemy.hp > 0);
  const ordered = liveEnemies
    .map((enemy) => ({
      attackerEntityId: enemy.entityId,
      targetEntityId,
      initiative: getSyntheticInitiative(enemy),
    }))
    .sort((left, right) => right.initiative - left.initiative || left.attackerEntityId - right.attackerEntityId);
  syntheticFight.turnQueue = ordered;
  syntheticFight.phase = ordered.length > 0 ? 'enemy-turn' : 'command';
}

function computeSyntheticDamage(attacker, defender) {
  if (!attacker || !defender) {
    return 1;
  }
  const minRoll = Math.max(1, attacker.damageMin || attacker.attackPower || 1);
  const maxRoll = Math.max(minRoll, attacker.damageMax || minRoll);
  const baseRoll = minRoll + Math.floor(Math.random() * ((maxRoll - minRoll) + 1));
  const armor = Math.max(0, defender.armorStat || defender.defensePower || 0);
  let damage = Math.floor((baseRoll * baseRoll) / Math.max(1, baseRoll + (armor * 2)));
  const levelDiff = (attacker.level || 0) - (defender.level || 0);

  if (Math.abs(levelDiff) > 5) {
    damage = Math.floor((damage * ((levelDiff * 4) + 100)) / 100);
  }

  return Math.max(1, damage);
}

function hasLivingSyntheticAllies(syntheticFight, fighter) {
  if (!syntheticFight || !fighter) {
    return false;
  }

  return syntheticFight.fighters.some((candidate) => {
    if (!candidate || candidate.entityId === fighter.entityId) {
      return false;
    }
    return candidate.side === fighter.side && candidate.hp > 0 && candidate.alive !== false;
  });
}

function createSyntheticFightState({
  action,
  entityType,
  roleEntityType,
  currentHealth,
  currentMana,
  currentRage,
  primaryAttributes,
  level,
  charName,
  enemies,
  turnProfile,
}) {
  const player = {
    side: 0xff,
    entityId: entityType >>> 0,
    logicalId: 0,
    typeId: (roleEntityType || entityType) & 0xffff,
    row: 1,
    col: 2,
    hp: currentHealth >>> 0,
    maxHp: currentHealth >>> 0,
    mp: currentMana >>> 0,
    maxMp: currentMana >>> 0,
    rage: currentRage >>> 0,
    intelligence: primaryAttributes.intelligence >>> 0,
    vitality: primaryAttributes.vitality >>> 0,
    dexterity: primaryAttributes.dexterity >>> 0,
    strength: primaryAttributes.strength >>> 0,
    accuracyStat: 20 + ((primaryAttributes.dexterity || 0) * 2) + ((level || 0) * 2),
    dodgeStat: 10 + (primaryAttributes.dexterity || 0) + (level || 0),
    armorStat: 8 + (primaryAttributes.vitality || 0) + ((primaryAttributes.dexterity || 0) >> 1) + (level || 0),
    damageMin: 8 + ((primaryAttributes.strength || 0) * 2) + (level || 0),
    damageMax: 14 + ((primaryAttributes.strength || 0) * 3) + (primaryAttributes.dexterity || 0) + ((level || 0) * 2),
    attackPower: 12 + ((primaryAttributes.strength || 0) * 2) + (primaryAttributes.dexterity || 0) + ((level || 0) * 3),
    defensePower: 8 + ((primaryAttributes.vitality || 0) * 2) + (primaryAttributes.dexterity || 0) + ((level || 0) * 2),
    aptitude: 0,
    level: level & 0xffff,
    appearanceTypes: [0, 0, 0],
    appearanceVariants: [0, 0, 0],
    alive: true,
    name: charName || 'Hero',
    templateFlags: 0,
    lastActionAt: 0,
    downed: false,
  };

  const enemyFighters = enemies.map((enemy) => ({
    side: enemy.side & 0xff,
    entityId: enemy.entityId >>> 0,
    logicalId: enemy.logicalId & 0xffff,
    typeId: enemy.typeId & 0xffff,
    row: enemy.row & 0xff,
    col: enemy.col & 0xff,
    hp: enemy.hpLike >>> 0,
    maxHp: enemy.hpLike >>> 0,
    mp: enemy.mpLike >>> 0,
    maxMp: enemy.mpLike >>> 0,
    rage: 0,
    intelligence: 8 + (enemy.levelLike & 0xffff),
    vitality: 10 + ((enemy.levelLike & 0xffff) >> 1),
    dexterity: 10 + ((enemy.levelLike & 0xffff) >> 1),
    strength: 12 + (enemy.levelLike & 0xffff),
    accuracyStat: 22 + ((enemy.levelLike & 0xffff) * 2) + ((enemy.logicalId & 0xffff) * 2),
    dodgeStat: 10 + (enemy.levelLike & 0xffff) + (enemy.logicalId & 0xffff),
    armorStat: 12 + ((enemy.levelLike & 0xffff) * 2) + (enemy.aptitude & 0xff),
    damageMin: 10 + ((enemy.levelLike & 0xffff) * 2) + (enemy.aptitude & 0xff),
    damageMax: 18 + ((enemy.levelLike & 0xffff) * 3) + ((enemy.logicalId & 0xffff) * 2) + (enemy.aptitude & 0xff),
    attackPower: 18 + ((enemy.levelLike & 0xffff) * 3) + ((enemy.logicalId & 0xffff) * 4) + (enemy.aptitude & 0xff),
    defensePower: 10 + ((enemy.levelLike & 0xffff) * 2) + ((enemy.logicalId & 0xffff) * 3),
    aptitude: enemy.aptitude & 0xff,
    level: enemy.levelLike & 0xffff,
    appearanceTypes: Array.isArray(enemy.appearanceTypes) ? enemy.appearanceTypes.slice(0, 3) : [0, 0, 0],
    appearanceVariants: Array.isArray(enemy.appearanceVariants) ? enemy.appearanceVariants.slice(0, 3) : [0, 0, 0],
    drops: Array.isArray(enemy.drops)
      ? enemy.drops.map((drop) => ({
          templateId: drop.templateId >>> 0,
          chance: Number.isFinite(drop.chance) ? drop.chance : 0,
          quantity: Math.max(1, drop.quantity | 0),
          source: typeof drop.source === 'string' ? drop.source : '',
        }))
      : [],
    alive: true,
    name: enemy.name,
    templateFlags: 0,
    lastActionAt: 0,
    downed: false,
  }));

  return {
    trigger: action.probeId,
    startedAt: Date.now(),
    round: 1,
    phase: 'command',
    activeEntityId: player.entityId,
    activeName: player.name,
    turnProfile,
    fighters: [player, ...enemyFighters],
    enemies: enemyFighters,
    lastAction: null,
    turnQueue: [],
    awaitingPlayerAction: false,
    suppressNextReadyRepeat: false,
  };
}

module.exports = {
  computeSyntheticDamage,
  createSyntheticFightState,
  findSyntheticEnemyTarget,
  getSyntheticInitiative,
  getSyntheticPlayerFighter,
  hasLivingSyntheticAllies,
  initializeSyntheticEnemyTurnQueue,
  selectSyntheticEnemyAttacker,
};
