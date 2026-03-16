'use strict';

const assert = require('assert');

const { buildDefeatRespawnState, resolveInnRestVitals } = require('../src/gameplay/session-flows');
const { parseServerRunRequest } = require('../src/interactions/server-run');
const {
  createSyntheticFightState,
  findSyntheticEnemyTarget,
  computeSyntheticDamage,
  initializeSyntheticEnemyTurnQueue,
} = require('../src/combat/synthetic-fight');
const {
  resolvePlayerAttackSelection,
  resolveQueuedEnemyTurn,
} = require('../src/combat/synthetic-fight-flow');

function testInnRestVitals() {
  const vitals = resolveInnRestVitals({ health: 12, mana: 40, rage: 1 });
  assert.deepStrictEqual(vitals, { health: 398, mana: 600, rage: 100 });
}

function testDefeatRespawnState() {
  const state = buildDefeatRespawnState({
    persistedCharacter: { lastTownMapId: 101, lastTownX: 70, lastTownY: 88 },
    currentMapId: 207,
    currentX: 10,
    currentY: 20,
    player: { maxHp: 300, mp: 55, rage: 12 },
    currentMana: 0,
    currentRage: 0,
    resolveTownRespawn: (character) => ({
      mapId: character.lastTownMapId,
      x: character.lastTownX,
      y: character.lastTownY,
    }),
  });

  assert.deepStrictEqual(state, {
    respawn: { mapId: 101, x: 70, y: 88 },
    vitals: { health: 1, mana: 55, rage: 12 },
  });
}

function testServerRunParsing() {
  const payload = Buffer.from([0xf1, 0x03, 0x02, 0x01, 0x34, 0x12, 0x7f, 0x89, 0x13]);
  const parsed = parseServerRunRequest(payload, {
    currentMapId: 101,
    currentX: 68,
    currentY: 87,
  });

  assert.strictEqual(parsed.kind, 'resolved');
  assert.strictEqual(parsed.subtype, 0x02);
  assert.strictEqual(parsed.mode, 0x01);
  assert.strictEqual(parsed.contextId, 0x1234);
  assert.strictEqual(parsed.extra, 0x7f);
  assert.strictEqual(parsed.scriptId, 0x1389);
  assert.strictEqual(parsed.mapId, 101);
}

function buildSyntheticFight() {
  return createSyntheticFightState({
    action: { probeId: 'smoke' },
    entityType: 0x3e9,
    roleEntityType: 0x3e9,
    currentHealth: 398,
    currentMana: 600,
    currentRage: 100,
    primaryAttributes: {
      intelligence: 15,
      vitality: 15,
      dexterity: 15,
      strength: 15,
    },
    level: 1,
    charName: 'Hero',
    turnProfile: { index: 0, profile: 'smoke', rows: [] },
    enemies: [
      {
        side: 1,
        entityId: 0x700001,
        logicalId: 1,
        typeId: 5015,
        row: 0,
        col: 2,
        hpLike: 120,
        mpLike: 0,
        aptitude: 0,
        levelLike: 15,
        appearanceTypes: [0, 0, 0],
        appearanceVariants: [0, 0, 0],
        name: 'Enemy A',
      },
    ],
  });
}

function testPlayerAttackResolution() {
  const syntheticFight = buildSyntheticFight();
  const resolution = resolvePlayerAttackSelection({
    syntheticFight,
    attackMode: 1,
    targetA: 0,
    targetB: 2,
    charName: 'Hero',
    now: 1234,
    findSyntheticEnemyTarget,
    computeSyntheticDamage: () => 999,
    initializeSyntheticEnemyTurnQueue,
  });

  assert.strictEqual(resolution.kind, 'victory');
  assert.strictEqual(resolution.enemy.hp, 0);
  assert.strictEqual(syntheticFight.phase, 'finished');
}

function testQueuedEnemyTurnResolution() {
  const syntheticFight = buildSyntheticFight();
  initializeSyntheticEnemyTurnQueue(syntheticFight, 0x3e9);

  const resolution = resolveQueuedEnemyTurn({
    syntheticFight,
    now: 5678,
    selectSyntheticEnemyAttacker: (fight) => fight.enemies[0],
    computeSyntheticDamage: () => 10,
    hasLivingSyntheticAllies: () => false,
  });

  assert.strictEqual(resolution.kind, 'enemy-turn-complete');
  assert.strictEqual(resolution.player.hp, 388);
  assert.strictEqual(syntheticFight.round, 2);
}

function main() {
  testInnRestVitals();
  testDefeatRespawnState();
  testServerRunParsing();
  testPlayerAttackResolution();
  testQueuedEnemyTurnResolution();
  console.log('refactor smoke ok');
}

main();
