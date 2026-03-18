'use strict';
export {};

const assert = require('assert');
type UnknownRecord = Record<string, any>;

const { buildDefeatRespawnState, resolveInnRestVitals } = require('../src/gameplay/session-flows');
const {
  bagHasTemplateQuantity,
  buildInventorySnapshot,
  consumeItemFromBag,
  getBagQuantityByTemplateId,
  grantItemToBag,
  normalizeInventoryState,
} = require('../src/inventory');
const { applyQuestCompletionReward } = require('../src/gameplay/reward-runtime');
const { parseServerRunRequest } = require('../src/interactions/server-run');
const {
  buildInventoryContainerBulkSyncPacket,
  buildInventoryContainerQuantityPacket,
} = require('../src/protocol/gameplay-packets');
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
  assert.deepStrictEqual(vitals, { health: 432, mana: 630, rage: 100 });
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
    resolveTownRespawn: (character: UnknownRecord) => ({
      mapId: character.lastTownMapId,
      x: character.lastTownX,
      y: character.lastTownY,
    }),
  });

  assert.deepStrictEqual(state, {
    respawn: { mapId: 101, x: 70, y: 88 },
    vitals: { health: 300, mana: 55, rage: 12 },
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
    currentHealth: 432,
    currentMana: 630,
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
    selectSyntheticEnemyAttacker: (fight: UnknownRecord) => fight.enemies[0],
    computeSyntheticDamage: () => 10,
    hasLivingSyntheticAllies: () => false,
  });

  assert.strictEqual(resolution.kind, 'enemy-turn-complete');
  assert.strictEqual(resolution.player.hp, 422);
  assert.strictEqual(syntheticFight.round, 2);
}

function testInventoryNormalizationRepairsCollisions() {
  const normalized = normalizeInventoryState({
    inventory: {
      bagSize: 2,
      nextItemInstanceId: 1,
      nextBagSlot: 1,
      bag: [
        { instanceId: 1, templateId: 23003, quantity: 501, slot: 0 },
        { instanceId: 1, templateId: 21116, quantity: 1, slot: 1 },
        { instanceId: 2, templateId: 23015, quantity: 1, slot: 7 },
      ],
    },
  });

  assert.deepStrictEqual(normalized.inventory.bag, [
    { instanceId: 1, templateId: 23003, quantity: 500, equipped: false, slot: 1 },
    { instanceId: 2, templateId: 23003, quantity: 1, equipped: false, slot: 2 },
    { instanceId: 3, templateId: 21116, quantity: 1, equipped: false, slot: 3 },
    { instanceId: 4, templateId: 23015, quantity: 1, equipped: false, slot: 7 },
  ]);
  assert.strictEqual(normalized.inventory.bagSize, 7);
  assert.strictEqual(normalized.inventory.nextItemInstanceId, 5);
  assert.strictEqual(normalized.inventory.nextBagSlot, 4);
}

function testInventoryGrantSplitsAcrossStacksAtomically() {
  const session = {
    bagItems: [{ instanceId: 10, templateId: 21115, quantity: 8, slot: 1 }],
    bagSize: 2,
    nextItemInstanceId: 11,
    nextBagSlot: 2,
  };

  const grantResult = grantItemToBag(session, 21115, 5);

  assert.strictEqual(grantResult.ok, true);
  assert.strictEqual(grantResult.changes.length, 2);
  assert.deepStrictEqual(session.bagItems, [
    { instanceId: 10, templateId: 21115, quantity: 10, slot: 1 },
    { instanceId: 11, templateId: 21115, quantity: 3, equipped: false, slot: 2 },
  ]);
  assert.strictEqual(session.nextItemInstanceId, 12);
  assert.strictEqual(session.nextBagSlot, 3);
}

function testInventoryGrantRejectsNonAtomicOverflow() {
  const session = {
    bagItems: [{ instanceId: 10, templateId: 21115, quantity: 8, slot: 1 }],
    bagSize: 1,
    nextItemInstanceId: 11,
    nextBagSlot: 1,
  };

  const grantResult = grantItemToBag(session, 21115, 5);

  assert.deepStrictEqual(grantResult, {
    ok: false,
    reason: 'Bag is full',
  });
  assert.deepStrictEqual(session.bagItems, [
    { instanceId: 10, templateId: 21115, quantity: 8, slot: 1 },
  ]);
}

function testInventoryConsumeAggregatesAcrossStacks() {
  const session = {
    bagItems: [
      { instanceId: 20, templateId: 21115, quantity: 3, slot: 1 },
      { instanceId: 21, templateId: 21115, quantity: 4, slot: 2 },
    ],
    bagSize: 24,
    nextBagSlot: 3,
  };

  assert.strictEqual(bagHasTemplateQuantity(session, 21115, 7), true);
  assert.strictEqual(getBagQuantityByTemplateId(session, 21115), 7);

  const consumeResult = consumeItemFromBag(session, 21115, 5);

  assert.strictEqual(consumeResult.ok, true);
  assert.strictEqual(consumeResult.changes.length, 2);
  assert.deepStrictEqual(session.bagItems, [
    { instanceId: 21, templateId: 21115, quantity: 2, slot: 2 },
  ]);
  assert.strictEqual(session.nextBagSlot, 1);
}

function testInventoryNormalizationSplitsClientCappedStacks() {
  const normalized = normalizeInventoryState({
    inventory: {
      bagSize: 2,
      nextItemInstanceId: 1,
      nextBagSlot: 1,
      bag: [
        { instanceId: 8, templateId: 21115, quantity: 18, slot: 5 },
      ],
    },
  });

  assert.deepStrictEqual(normalized.inventory.bag, [
    { instanceId: 8, templateId: 21115, quantity: 10, equipped: false, slot: 5 },
    { instanceId: 9, templateId: 21115, quantity: 8, equipped: false, slot: 1 },
  ]);
  assert.strictEqual(normalized.inventory.bagSize, 5);
  assert.strictEqual(normalized.inventory.nextItemInstanceId, 10);
  assert.strictEqual(normalized.inventory.nextBagSlot, 2);
}

function testInventoryQuantityPacketEncoding() {
  const packet = buildInventoryContainerQuantityPacket({
    containerType: 1,
    instanceId: 0x11223344,
    quantity: 37,
  });

  assert.strictEqual(packet.toString('hex'), 'f2030114443322112500');
}

function testInventoryBulkSyncOmitsTrailingCountFor074Family() {
  const packet = buildInventoryContainerBulkSyncPacket({
    containerType: 1,
    items: [
      { instanceId: 6, templateId: 23003, quantity: 17, clientTemplateFamily: 0x74 },
      { instanceId: 7, templateId: 23015, quantity: 25, clientTemplateFamily: 0x74 },
    ],
  });

  assert.strictEqual(
    packet.toString('hex'),
    'f2030100020006000000db590600000000001100000007000000e75907000000000019000000'
  );
}

function testInventorySnapshotCanonicalizesState() {
  const snapshot = buildInventorySnapshot({
    bagItems: [
      { instanceId: 2, templateId: 21116, quantity: 1, slot: 1 },
      { instanceId: 2, templateId: 21115, quantity: 18, slot: 1 },
    ],
    bagSize: 1,
    nextItemInstanceId: 1,
    nextBagSlot: 1,
  });

  assert.deepStrictEqual(snapshot, {
    bag: [
      { instanceId: 2, templateId: 21116, quantity: 1, equipped: false, slot: 1 },
      { instanceId: 3, templateId: 21115, quantity: 10, equipped: false, slot: 2 },
      { instanceId: 4, templateId: 21115, quantity: 8, equipped: false, slot: 3 },
    ],
    bagSize: 3,
    nextItemInstanceId: 5,
    nextBagSlot: 4,
  });
}

function testQuestRewardInventoryAlwaysEndsWithFullSync() {
  const packets: Array<{ hex: string; message: string }> = [];
  const session = {
    bagItems: [],
    bagSize: 24,
    nextItemInstanceId: 1,
    nextBagSlot: 1,
    level: 1,
    experience: 0,
    statusPoints: 0,
    gold: 0,
    coins: 0,
    renown: 0,
    writePacket(payload: Buffer, _flags: number, message: string) {
      packets.push({ hex: payload.toString('hex'), message });
    },
  };

  const result = applyQuestCompletionReward(session, {
    items: [{ templateId: 20001, quantity: 5 }],
  });

  assert.strictEqual(result.inventoryDirty, true);
  assert.ok(packets.length >= 2, `Expected at least 2 packets, got ${packets.length}`);
  assert.match(packets[0].message, /Sending item add/);
  const hasSyncPacket = packets.some((packet) => /Sending inventory full sync/.test(packet.message));
  assert.ok(hasSyncPacket, 'Expected at least one inventory full sync packet');
}

function main() {
  testInnRestVitals();
  testDefeatRespawnState();
  testServerRunParsing();
  testPlayerAttackResolution();
  testQueuedEnemyTurnResolution();
  testInventoryNormalizationRepairsCollisions();
  testInventoryGrantSplitsAcrossStacksAtomically();
  testInventoryGrantRejectsNonAtomicOverflow();
  testInventoryConsumeAggregatesAcrossStacks();
  testInventoryNormalizationSplitsClientCappedStacks();
  testInventoryQuantityPacketEncoding();
  testInventoryBulkSyncOmitsTrailingCountFor074Family();
  testInventorySnapshotCanonicalizesState();
  testQuestRewardInventoryAlwaysEndsWithFullSync();
  console.log('refactor smoke ok');
}

main();
