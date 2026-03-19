'use strict';
export {};

const assert = require('assert');
const fs = require('fs');
const path = require('path');
type UnknownRecord = Record<string, any>;
const REPO_ROOT = path.basename(path.resolve(__dirname, '..')) === 'dist'
  ? path.resolve(__dirname, '..', '..')
  : path.resolve(__dirname, '..');

const { buildDefeatRespawnState, resolveInnRestVitals } = require('../src/gameplay/session-flows');
const {
  bagHasTemplateQuantity,
  buildInventorySnapshot,
  consumeItemFromBag,
  getBagQuantityByTemplateId,
  grantItemToBag,
  normalizeInventoryState,
} = require('../src/inventory');
const { applyEffects } = require('../src/effects/effect-executor');
const { applyInventoryQuestEvent } = require('../src/gameplay/inventory-runtime');
const { applyQuestCompletionReward } = require('../src/gameplay/reward-runtime');
const {
  applyMonsterDefeat,
  applyServerRunEvent,
  buildQuestSyncState,
  getQuestDefinition,
  resolveQuestServerRunAuxiliaryActions,
} = require('../src/quest-engine');
const { applyQuestEvents } = require('../src/handlers/quest-handler');
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

function createInventoryEffectSession(overrides: UnknownRecord = {}) {
  return {
    bagItems: [],
    bagSize: 24,
    nextItemInstanceId: 1,
    nextBagSlot: 1,
    dialogues: [] as Array<{ title: string; message: string }>,
    packets: [] as Buffer[],
    persisted: 0,
    aptitudeSyncs: 0,
    sendGameDialogue(title: string, message: string) {
      this.dialogues.push({ title, message });
    },
    writePacket(payload: Buffer) {
      this.packets.push(payload);
    },
    persistCurrentCharacter() {
      this.persisted += 1;
    },
    sendSelfStateAptitudeSync() {
      this.aptitudeSyncs += 1;
    },
    ...overrides,
  };
}

function testGrantItemEffectSupportsQuestStyleOptions() {
  const session = createInventoryEffectSession();

  const first = applyEffects(session, [{
    kind: 'grant-item',
    templateId: 21116,
    quantity: 1,
    dialoguePrefix: 'Quest',
    itemName: 'Timber',
    idempotent: true,
  }], {
    suppressPersist: true,
  });

  const second = applyEffects(session, [{
    kind: 'grant-item',
    templateId: 21116,
    quantity: 1,
    dialoguePrefix: 'Quest',
    itemName: 'Timber',
    idempotent: true,
  }], {
    suppressPersist: true,
  });

  assert.strictEqual(first.inventoryDirty, true);
  assert.strictEqual(second.inventoryDirty, false);
  assert.strictEqual(getBagQuantityByTemplateId(session, 21116), 1);
  assert.deepStrictEqual(session.dialogues, [
    { title: 'Quest', message: 'Timber was added to your pack.' },
  ]);
}

function testApplyInventoryQuestEventUsesEffectExecutorBehavior() {
  const session = createInventoryEffectSession({
    bagItems: [{ instanceId: 1, templateId: 21116, quantity: 1, slot: 1 }],
    nextItemInstanceId: 2,
    nextBagSlot: 2,
  });

  const consumed = applyInventoryQuestEvent(session, {
    type: 'item-consumed',
    templateId: 21116,
    quantity: 1,
    itemName: 'Timber',
  });
  const missing = applyInventoryQuestEvent(session, {
    type: 'item-missing',
    templateId: 21116,
    quantity: 1,
    itemName: 'Timber',
  });

  assert.deepStrictEqual(consumed, { handled: true, dirty: true });
  assert.deepStrictEqual(missing, { handled: true, dirty: false });
  assert.strictEqual(getBagQuantityByTemplateId(session, 21116), 0);
  assert.deepStrictEqual(session.dialogues, [
    { title: 'Quest', message: 'Timber was handed over.' },
    { title: 'Quest', message: 'Timber is required to continue.' },
  ]);
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

function createQuestTestSession(overrides: UnknownRecord = {}) {
  return {
    activeQuests: [] as UnknownRecord[],
    completedQuests: [] as number[],
    bagItems: [] as UnknownRecord[],
    bagSize: 24,
    nextItemInstanceId: 1,
    nextBagSlot: 1,
    level: 99,
    experience: 0,
    statusPoints: 0,
    gold: 0,
    coins: 0,
    renown: 0,
    pets: [],
    hasAnnouncedQuestOverview: false,
    packets: [] as Array<{ message: string }>,
    dialogues: [] as Array<{ title: string; message: string }>,
    persisted: 0,
    aptitudeSyncs: 0,
    petSyncs: [] as string[],
    writePacket(_payload: Buffer, _flags?: number, message = '') {
      this.packets.push({ message });
    },
    log(_message: string) {},
    sendGameDialogue(title: string, message: string) {
      this.dialogues.push({ title, message });
    },
    persistCurrentCharacter() {
      this.persisted += 1;
    },
    sendSelfStateAptitudeSync() {
      this.aptitudeSyncs += 1;
    },
    sendPetStateSync(reason: string) {
      this.petSyncs.push(reason);
    },
    ...overrides,
  };
}

function currentQuestState(session: UnknownRecord) {
  return {
    activeQuests: session.activeQuests,
    completedQuests: session.completedQuests,
    level: session.level,
  };
}

function runQuestServerEvent(session: UnknownRecord, event: UnknownRecord, source = 'server-run') {
  const questEventInput = {
    ...event,
    inventory: session.bagItems,
  };
  const state = currentQuestState(session);
  const auxiliaryEvents = resolveQuestServerRunAuxiliaryActions(state, questEventInput);
  if (auxiliaryEvents.length > 0) {
    applyQuestEvents(session, auxiliaryEvents, `${source}-aux`);
  }
  const questEvents = applyServerRunEvent(state, questEventInput);
  if (questEvents.length > 0) {
    applyQuestEvents(session, questEvents, source);
  }
  return {
    auxiliaryEvents,
    questEvents,
  };
}

function runQuestMonsterDefeat(session: UnknownRecord, monsterId: number, count = 1) {
  const events = applyMonsterDefeat(currentQuestState(session), monsterId, count);
  if (events.length > 0) {
    applyQuestEvents(session, events, 'monster-defeat');
  }
  return events;
}

function assertQuestStep(session: UnknownRecord, taskId: number, expectedStepIndex: number, expectedStatus: number) {
  const quest = buildQuestSyncState(currentQuestState(session)).find((entry: UnknownRecord) => entry.taskId === taskId);
  assert.ok(quest, `Expected active quest ${taskId}`);
  assert.strictEqual(quest.stepIndex, expectedStepIndex);
  assert.strictEqual(quest.status, expectedStatus);
}

function acceptQuestByNpc(session: UnknownRecord, taskId: number) {
  const definition = getQuestDefinition(taskId);
  assert.ok(definition, `Missing quest definition ${taskId}`);
  const questData = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, 'data', 'quests', 'main-story.json'), 'utf8'));
  const sceneData = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, 'data', 'scenes', 'scenes.json'), 'utf8'));
  const quests = Array.isArray(questData?.quests) ? questData.quests : [];
  const liveQuest = quests.find((quest: UnknownRecord) => quest?.id === taskId) || null;
  let acceptMapId = 0;

  for (const [mapIdString, scene] of Object.entries(sceneData?.scenes || {})) {
    const mapId = Number.parseInt(mapIdString, 10);
    if (!Number.isInteger(mapId)) {
      continue;
    }
    const hasNpc = Array.isArray((scene as UnknownRecord)?.worldSpawns)
      && (scene as UnknownRecord).worldSpawns.some((spawn: UnknownRecord) => (
        Number.isInteger(spawn?.id) && spawn.id === definition.acceptNpcId
      ));
    if (hasNpc) {
      acceptMapId = mapId;
      break;
    }
  }

  runQuestServerEvent(session, {
    npcId: definition.acceptNpcId,
    subtype: definition.acceptSubtype,
    mapId: acceptMapId || liveQuest?.steps?.[0]?.mapId || definition.steps?.[0]?.mapId || 0,
  }, 'accept');
}

function testBackToEarthQuestFlow() {
  const session = createQuestTestSession();

  acceptQuestByNpc(session, 1);
  assert.strictEqual(getBagQuantityByTemplateId(session, 21098), 1);
  assertQuestStep(session, 1, 0, 1);

  runQuestServerEvent(session, {
    npcId: 3276,
    subtype: 2,
    mapId: 101,
  });
  assert.strictEqual(getBagQuantityByTemplateId(session, 21098), 0);
  assertQuestStep(session, 1, 1, 2);

  runQuestServerEvent(session, {
    subtype: 2,
    contextId: 11,
    scriptId: 10000,
    mapId: 101,
  });
  assert.strictEqual(getBagQuantityByTemplateId(session, 21116), 1);

  runQuestServerEvent(session, {
    npcId: 3276,
    subtype: 2,
    mapId: 101,
  });
  assert.strictEqual(getBagQuantityByTemplateId(session, 21116), 0);
  assert.ok(session.completedQuests.includes(1));
  assert.strictEqual(getBagQuantityByTemplateId(session, 20001), 5);
  assert.strictEqual(getBagQuantityByTemplateId(session, 20004), 5);
  assert.strictEqual(session.experience, 100);
  assert.strictEqual(session.coins, 100);
}

function testAcheloussTortoiseQuestFlow() {
  const session = createQuestTestSession({ level: 40 });

  acceptQuestByNpc(session, 408);
  assert.strictEqual(getBagQuantityByTemplateId(session, 21065), 1);

  runQuestServerEvent(session, {
    npcId: 3019,
    subtype: 2,
    mapId: 111,
  });
  assert.strictEqual(getBagQuantityByTemplateId(session, 21066), 1);
  assertQuestStep(session, 408, 1, 3);

  grantItemToBag(session, 21035, 1);
  runQuestServerEvent(session, {
    npcId: 3093,
    subtype: 2,
    mapId: 108,
  });
  assert.strictEqual(getBagQuantityByTemplateId(session, 21035), 0);
  assert.ok(session.completedQuests.includes(408));
  assert.strictEqual(session.gold, 2000);
  assert.strictEqual(session.coins, 2000);
  assert.strictEqual(session.experience, 40000);
  assert.strictEqual(getBagQuantityByTemplateId(session, 9018), 1);
}

function testRebelInHellQuestFlow() {
  const session = createQuestTestSession({ level: 40 });

  acceptQuestByNpc(session, 426);
  assert.strictEqual(getBagQuantityByTemplateId(session, 21076), 1);

  runQuestServerEvent(session, {
    npcId: 3263,
    subtype: 2,
    mapId: 158,
  });
  assert.strictEqual(getBagQuantityByTemplateId(session, 21076), 0);
  assert.strictEqual(getBagQuantityByTemplateId(session, 21074), 1);
  assertQuestStep(session, 426, 1, 2);

  runQuestServerEvent(session, {
    npcId: 3124,
    subtype: 2,
    mapId: 158,
  });
  assert.strictEqual(getBagQuantityByTemplateId(session, 21074), 0);
  assert.ok(session.completedQuests.includes(426));
  assert.strictEqual(session.experience, 28000);
}

function testElfinQuestFlow() {
  const session = createQuestTestSession({ level: 66 });

  acceptQuestByNpc(session, 467);
  assert.strictEqual(getBagQuantityByTemplateId(session, 21242), 1);

  runQuestServerEvent(session, {
    npcId: 3381,
    subtype: 2,
    mapId: 211,
  });
  assert.strictEqual(getBagQuantityByTemplateId(session, 21242), 0);
  assertQuestStep(session, 467, 1, 0);

  runQuestMonsterDefeat(session, 5282, 1);
  assert.ok(session.completedQuests.includes(467));
}

function testVultureFightQuestFlow() {
  const session = createQuestTestSession({ level: 74 });

  acceptQuestByNpc(session, 481);
  assert.strictEqual(getBagQuantityByTemplateId(session, 21252), 1);

  runQuestServerEvent(session, {
    npcId: 3439,
    subtype: 2,
    mapId: 245,
  });
  assert.strictEqual(getBagQuantityByTemplateId(session, 21252), 0);
  assertQuestStep(session, 481, 1, 0);

  runQuestMonsterDefeat(session, 5103, 1);
  assert.ok(session.completedQuests.includes(481));
}

function testMagicFlaskGrocerTurnInFlow() {
  const session = createQuestTestSession({ completedQuests: [51] });

  acceptQuestByNpc(session, 3);
  assert.strictEqual(getBagQuantityByTemplateId(session, 21118), 1);
  assertQuestStep(session, 3, 0, 1);

  runQuestServerEvent(session, {
    npcId: 3234,
    subtype: 0x08,
    scriptId: 3,
    mapId: 101,
  });

  assert.strictEqual(getBagQuantityByTemplateId(session, 21118), 0);
  assertQuestStep(session, 3, 1, 2);
}

function testTalkQuestNpcMapsMatchUniqueScenePlacements() {
  const questData = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, 'data', 'quests', 'main-story.json'), 'utf8'));
  const sceneData = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, 'data', 'scenes', 'scenes.json'), 'utf8'));
  const quests = Array.isArray(questData?.quests) ? questData.quests : [];
  const npcMaps = new Map<number, Set<number>>();

  for (const [mapIdString, scene] of Object.entries(sceneData?.scenes || {})) {
    const mapId = Number.parseInt(mapIdString, 10);
    if (!Number.isInteger(mapId)) {
      continue;
    }
    for (const spawn of Array.isArray((scene as UnknownRecord)?.worldSpawns) ? (scene as UnknownRecord).worldSpawns : []) {
      const npcId = Number.isInteger((spawn as UnknownRecord)?.id)
        ? (spawn as UnknownRecord).id
        : Number.isInteger((spawn as UnknownRecord)?.entityType)
          ? (spawn as UnknownRecord).entityType
          : null;
      if (!Number.isInteger(npcId)) {
        continue;
      }
      if (!npcMaps.has(npcId)) {
        npcMaps.set(npcId, new Set());
      }
      npcMaps.get(npcId)?.add(mapId);
    }
  }

  const mismatches = [];
  for (const quest of quests) {
    for (let stepIndex = 0; stepIndex < (quest.steps || []).length; stepIndex += 1) {
      const step = quest.steps[stepIndex];
      if (step?.type !== 'talk' || !Number.isInteger(step?.npcId) || !Number.isInteger(step?.mapId)) {
        continue;
      }
      const maps = [...(npcMaps.get(step.npcId) || [])];
      if (maps.length === 1 && maps[0] !== step.mapId) {
        mismatches.push(`${quest.id}:${stepIndex + 1} npc=${step.npcId} map=${step.mapId} expected=${maps[0]}`);
      }
    }
  }

  assert.deepStrictEqual(mismatches, []);
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
  testGrantItemEffectSupportsQuestStyleOptions();
  testApplyInventoryQuestEventUsesEffectExecutorBehavior();
  testQuestRewardInventoryAlwaysEndsWithFullSync();
  testBackToEarthQuestFlow();
  testAcheloussTortoiseQuestFlow();
  testRebelInHellQuestFlow();
  testElfinQuestFlow();
  testVultureFightQuestFlow();
  testMagicFlaskGrocerTurnInFlow();
  testTalkQuestNpcMapsMatchUniqueScenePlacements();
  console.log('refactor smoke ok');
}

main();
