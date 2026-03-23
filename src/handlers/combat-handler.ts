import type { CombatEnemyInstance, CombatState, GameSession } from '../types';

const {
  DEFAULT_FLAGS,
  FIGHT_ACTIVE_STATE_SUBCMD,
  FIGHT_CLIENT_ATTACK_SELECTION_SUBCMD,
  FIGHT_CLIENT_ITEM_USE_SUBCMD,
  FIGHT_CLIENT_READY_SUBCMD,
  FIGHT_CONTROL_RING_OPEN_SUBCMD,
  GAME_FIGHT_ACTION_CMD,
  GAME_FIGHT_CLIENT_CMD,
  GAME_FIGHT_STREAM_CMD,
} = require('../config');
const { parseAttackSelection, parseCombatItemUse } = require('../protocol/inbound-packets');
const { buildEncounterEnemies } = require('../combat/encounter-builder');
const {
  buildActiveStatePacket,
  buildAttackPlaybackPacket,
  buildControlInitPacket,
  buildControlShowPacket,
  buildRoundStartPacket,
  buildDefeatPacket,
  buildEncounterPacket,
  buildEntityHidePacket,
  buildRingOpenPacket,
  buildStateModePacket,
  buildTurnPromptPacket,
  buildVictoryPacket,
  buildVictoryPointsPacket,
  buildVictoryRankPacket,
  buildVitalsPacket,
} = require('../combat/packets');
const { grantCombatDrops } = require('../gameplay/combat-drop-runtime');
const { sendInventoryFullSync } = require('../gameplay/inventory-runtime');
const { consumeUsableItemByInstanceId } = require('../gameplay/item-use-runtime');
const { applyEffects } = require('../effects/effect-executor');
const { buildDefeatRespawnState } = require('../gameplay/session-flows');
const { sendSelfStateVitalsUpdate } = require('../gameplay/stat-sync');
const { getCapturePetTemplateId } = require('../roleinfo');
const { getBagItemByReference, getEquipmentCombatBonuses, getItemDefinition } = require('../inventory');

type SessionLike = GameSession & Record<string, any>;
type CombatAction = Record<string, any>;
type EnemyTurnReason = 'normal' | 'post-kill';
const CAPTURE_ELEMENT_CODE_MIN = 1;
const CAPTURE_ELEMENT_CODE_MAX = 4;

function createIdleCombatState(): CombatState {
  return {
    active: false,
    phase: 'idle',
    round: 0,
    triggerId: null,
    encounterAction: null,
    enemies: [] as CombatEnemyInstance[],
    pendingEnemyTurnQueue: [],
    pendingPostKillCounterattack: false,
    enemyTurnReason: null,
    awaitingClientReady: false,
    awaitingPlayerAction: false,
    startedAt: 0,
    playerStartHealth: 0,
    playerMaxHealthAtStart: 0,
    totalEnemyMaxHp: 0,
    averageEnemyLevel: 0,
    damageDealt: 0,
    damageTaken: 0,
  };
}

function rollCapturedMonsterElementCode(): number {
  const span = (CAPTURE_ELEMENT_CODE_MAX - CAPTURE_ELEMENT_CODE_MIN) + 1;
  return CAPTURE_ELEMENT_CODE_MIN + Math.floor(Math.random() * Math.max(1, span));
}

function handleCombatPacket(session: SessionLike, cmdWord: number, payload: Buffer): void {
  if (!session.combatState?.active) {
    session.log(`Ignoring combat packet with no active combat cmd=0x${cmdWord.toString(16)}`);
    return;
  }

  if (isClientReadyPacket(cmdWord, payload)) {
    if (tryHandleCombatReady(session)) {
      return;
    }
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
    payload.length >= 11 &&
    payload[2] === FIGHT_CLIENT_ITEM_USE_SUBCMD
  ) {
    const { instanceId, targetEntityId } = parseCombatItemUse(payload);
    resolveCombatItemUse(session, instanceId, targetEntityId, `cmd=0x${cmdWord.toString(16)} sub=0x${payload[2].toString(16)}`);
    return;
  }

  if (cmdWord === GAME_FIGHT_CLIENT_CMD) {
    session.log(describeUnhandledCombatClientPacket(session, payload));
    return;
  }

  session.log(
    `Unhandled combat packet cmd=0x${cmdWord.toString(16)} len=${payload.length} phase=${session.combatState.phase || 'unknown'} awaitingPlayerAction=${session.combatState.awaitingPlayerAction === true ? 1 : 0} hex=${payload.toString('hex')}`
  );
}

function isClientReadyPacket(cmdWord: number, payload: Buffer): boolean {
  return cmdWord === GAME_FIGHT_ACTION_CMD && payload.length >= 3 && payload[2] === FIGHT_CLIENT_READY_SUBCMD;
}

function tryHandleCombatReady(session: SessionLike): boolean {
  if (session.combatState.awaitingClientReady) {
    transitionToCommandPhase(session, 'client-ready');
    return true;
  }

  if (session.combatState.phase === 'enemy-turn') {
    processNextEnemyTurnAttack(session, session.combatState.enemyTurnReason || 'normal');
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

function sendCombatEncounterProbe(session: SessionLike, action: CombatAction): void {
  if (session.combatState?.active) {
    session.log(`Ignoring encounter trigger while combat is already active trigger=${session.combatState.triggerId}`);
    return;
  }

  const enemies = buildEncounterEnemies(action, session.currentMapId);
  if (enemies.length === 0) {
    session.log(`Skipping encounter probe with empty pool trigger=${action?.probeId || 'unknown'}`);
    return;
  }
  const player = buildPlayerEntry(session);

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
  };

  session.writePacket(
    buildEncounterPacket(player, enemies),
    DEFAULT_FLAGS,
    `Sending combat encounter cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x65 trigger=${session.combatState.triggerId} enemies=${describeEncounterEnemies(enemies)}`
  );
  sendIntroSequence(session);
}

function sendCombatExitProbe(session: SessionLike, action: CombatAction): void {
  if (!session.combatState?.active) {
    return;
  }
  session.log(`Combat exit probe trigger=${action?.probeId || 'unknown'} current=${session.combatState.triggerId}`);
  clearCombatState(session, false);
}

function disposeCombatTimers(session: SessionLike): void {
  if (session.combatDefeatTimer) {
    clearTimeout(session.combatDefeatTimer);
    session.combatDefeatTimer = null;
  }
}

function sendIntroSequence(session: SessionLike): void {
  const entityId = session.entityType >>> 0;
  session.writePacket(buildRingOpenPacket(), DEFAULT_FLAGS, `Sending combat ring-open trigger=${session.combatState.triggerId}`);
  session.writePacket(buildStateModePacket(), DEFAULT_FLAGS, `Sending combat mode trigger=${session.combatState.triggerId}`);
  session.writePacket(buildControlInitPacket(), DEFAULT_FLAGS, `Sending combat control init trigger=${session.combatState.triggerId}`);
  session.writePacket(buildActiveStatePacket(entityId), DEFAULT_FLAGS, `Sending combat active state trigger=${session.combatState.triggerId} active=${entityId}`);
  session.writePacket(buildEntityHidePacket(entityId), DEFAULT_FLAGS, `Sending combat entity hide trigger=${session.combatState.triggerId} active=${entityId}`);
  session.writePacket(buildControlShowPacket(entityId), DEFAULT_FLAGS, `Sending combat control show trigger=${session.combatState.triggerId} active=${entityId}`);
}

function sendCommandPrompt(session: SessionLike, reason: string): void {
  const entityId = session.entityType >>> 0;
  session.writePacket(buildRingOpenPacket(), DEFAULT_FLAGS, `Sending combat ring-open refresh reason=${reason}`);
  session.writePacket(
    buildRoundStartPacket(session.combatState.round, entityId),
    DEFAULT_FLAGS,
    `Sending combat round start reason=${reason} round=${session.combatState.round} active=${entityId}`
  );
  session.writePacket(buildControlShowPacket(entityId), DEFAULT_FLAGS, `Sending combat control refresh reason=${reason} active=${entityId}`);
  session.writePacket(
    buildTurnPromptPacket(),
    DEFAULT_FLAGS,
    `Sending combat turn prompt reason=${reason} round=${session.combatState.round}`
  );
}

function transitionToCommandPhase(session: SessionLike, reason: string): void {
  session.combatState.awaitingClientReady = false;
  session.combatState.awaitingPlayerAction = true;
  session.combatState.phase = 'command';
  session.combatState.round = Math.max(1, (session.combatState.round || 0) + 1);
  sendCommandPrompt(session, reason);
}

function handleAttackSelection(session: SessionLike, payload: Buffer): void {
  if (!session.combatState?.active || !session.combatState.awaitingPlayerAction) {
    session.log(`Ignoring attack selection without command prompt active=${session.combatState?.active ? 1 : 0}`);
    return;
  }

  const selection = parseAttackSelection(payload);
  const enemy = resolveSelectedEnemy(session.combatState.enemies, selection);
  if (!enemy || enemy.hp <= 0) {
    session.log('Ignoring attack selection because combat enemy is missing');
    return;
  }

  session.combatState.awaitingPlayerAction = false;
  session.combatState.phase = 'resolved';
  session.log(`Combat attack selected mode=${selection.attackMode} target=${selection.targetA},${selection.targetB} enemy=${describeEnemy(enemy)} living=${describeLivingEnemies(session.combatState.enemies)}`);

  const playerDamage = computePlayerDamage(session, enemy);
  const appliedPlayerDamage = Math.max(0, Math.min(enemy.hp, playerDamage));
  enemy.hp = Math.max(0, enemy.hp - playerDamage);
  session.combatState.damageDealt = Math.max(0, (session.combatState.damageDealt || 0) + appliedPlayerDamage);
  session.writePacket(
    buildAttackPlaybackPacket(
      session.entityType >>> 0,
      enemy.entityId >>> 0,
      enemy.hp === 0 ? FIGHT_ACTIVE_STATE_SUBCMD : FIGHT_CONTROL_RING_OPEN_SUBCMD,
      playerDamage
    ),
    DEFAULT_FLAGS,
    `Sending combat attack playback attacker=${session.entityType} target=${enemy.entityId} damage=${playerDamage} enemyHp=${enemy.hp}`
  );

  if (enemy.hp <= 0) {
    session.writePacket(
      buildEntityHidePacket(enemy.entityId >>> 0),
      DEFAULT_FLAGS,
      `Sending combat enemy hide entity=${enemy.entityId}`
    );
    session.log(`Combat enemy defeated entity=${enemy.entityId} remaining=${describeLivingEnemies(session.combatState.enemies)}`);
    if (findFirstLivingEnemy(session.combatState.enemies)) {
      session.combatState.pendingPostKillCounterattack = true;
      session.combatState.phase = 'resolved';
      session.combatState.awaitingPlayerAction = false;
      return;
    }
    resolveVictory(session);
    return;
  }

  resolveEnemyCounterattack(session, 'normal');
}

function handleCombatItemUse(session: SessionLike, payload: Buffer): void {
  const { instanceId, targetEntityId } = parseCombatItemUse(payload);
  resolveCombatItemUse(session, instanceId, targetEntityId, `cmd=0x${GAME_FIGHT_ACTION_CMD.toString(16)} sub=0x${payload[2].toString(16)}`);
}

function resolveCombatItemUse(
  session: SessionLike,
  instanceId: number,
  targetEntityId: number,
  sourceLabel: string
): void {
  if (!session.combatState?.active || !session.combatState.awaitingPlayerAction) {
    session.log(`Ignoring combat item use without command prompt active=${session.combatState?.active ? 1 : 0}`);
    return;
  }

  const bagItem = getBagItemByReference(session, instanceId);
  const definition = getItemDefinition(bagItem?.templateId || 0);
  if (definition?.captureProfile && bagItem) {
    resolveCombatCaptureItemUse(session, bagItem, definition, targetEntityId, sourceLabel);
    return;
  }

  const useResult = consumeUsableItemByInstanceId(session, instanceId, {
    targetEntityId,
    suppressVitalSync: true,
    suppressPersist: true,
  });
  if (!useResult.ok) {
    session.log(
      `Combat item use rejected source=${sourceLabel} instanceId=${instanceId} targetEntityId=${targetEntityId} reason=${useResult.reason}`
    );
    resendCombatCommandPrompt(session, 'item-use-rejected');
    return;
  }

  session.combatState.awaitingPlayerAction = false;
  session.combatState.phase = 'resolved';
  sendCombatItemPlayback(session, useResult.gained || {});
  sendSelfStateVitalsUpdate(session, {
    health: Math.max(0, session.currentHealth || 0),
    mana: Math.max(0, session.currentMana || 0),
    rage: Math.max(0, session.currentRage || 0),
  });
  session.log(
    `Combat item use ok source=${sourceLabel} instanceId=${instanceId} targetEntityId=${targetEntityId} templateId=${useResult.item?.templateId || 0} restored=${useResult.gained?.health || 0}/${useResult.gained?.mana || 0}/${useResult.gained?.rage || 0} hp/mp/rage=${session.currentHealth}/${session.currentMana}/${session.currentRage}`
  );
  resolveEnemyCounterattack(session, 'normal');
}

function sendCombatItemPlayback(
  session: SessionLike,
  gained: { health?: number; mana?: number; rage?: number }
): void {
  const primaryAmount = Math.max(
    0,
    Number(gained?.health || 0),
    Number(gained?.mana || 0),
    Number(gained?.rage || 0)
  ) >>> 0;

  if (primaryAmount <= 0) {
    return;
  }

  session.writePacket(
    buildAttackPlaybackPacket(
      session.entityType >>> 0,
      session.entityType >>> 0,
      FIGHT_ACTIVE_STATE_SUBCMD,
      primaryAmount
    ),
    DEFAULT_FLAGS,
    `Sending combat item playback active=${session.entityType} restored=${primaryAmount}`
  );
}

function resolveCombatCaptureItemUse(
  session: SessionLike,
  bagItem: Record<string, any>,
  definition: Record<string, any>,
  targetEntityId: number,
  sourceLabel: string
): void {
  const profile = definition?.captureProfile || {};
  const targetEnemy = resolveCaptureTargetEnemy(session, targetEntityId);
  if (!targetEnemy) {
    session.log(
      `Combat capture rejected source=${sourceLabel} instanceId=${bagItem.instanceId} targetEntityId=${targetEntityId} reason=no-target`
    );
    if (typeof session.sendGameDialogue === 'function') {
      session.sendGameDialogue('Combat', `${definition?.name || 'Mob Flask'} could not find a target.`);
    }
    resendCombatCommandPrompt(session, 'capture-rejected-no-target');
    return;
  }

  if ((targetEnemy.level || 0) > (profile.maxTargetLevel || 0)) {
    session.log(
      `Combat capture rejected source=${sourceLabel} instanceId=${bagItem.instanceId} targetEntityId=${targetEnemy.entityId} reason=level-cap targetLevel=${targetEnemy.level} max=${profile.maxTargetLevel}`
    );
    if (typeof session.sendGameDialogue === 'function') {
      session.sendGameDialogue('Combat', `${targetEnemy.name || 'Target'} is too strong for ${definition?.name || 'this flask'}.`);
    }
    resendCombatCommandPrompt(session, 'capture-rejected-level');
    return;
  }

  if (profile.requiresDying === true && !isEnemyDying(targetEnemy)) {
    session.log(
      `Combat capture rejected source=${sourceLabel} instanceId=${bagItem.instanceId} targetEntityId=${targetEnemy.entityId} reason=not-dying hp=${targetEnemy.hp}/${targetEnemy.maxHp}`
    );
    if (typeof session.sendGameDialogue === 'function') {
      session.sendGameDialogue('Combat', `${targetEnemy.name || 'Target'} must be weakened before capture.`);
    }
    resendCombatCommandPrompt(session, 'capture-rejected-not-dying');
    return;
  }

  const petTemplateId = getCapturePetTemplateId(targetEnemy.typeId >>> 0);
  if (!petTemplateId) {
    session.log(
      `Combat capture rejected source=${sourceLabel} instanceId=${bagItem.instanceId} targetEntityId=${targetEnemy.entityId} reason=no-pet-template enemyType=${targetEnemy.typeId}`
    );
    if (typeof session.sendGameDialogue === 'function') {
      session.sendGameDialogue('Combat', `${targetEnemy.name || 'Target'} cannot be captured yet.`);
    }
    resendCombatCommandPrompt(session, 'capture-rejected-no-map');
    return;
  }

  const flaskAttributePairs = Array.isArray(bagItem.attributePairs) ? bagItem.attributePairs : [];
  const occupiedMonsterId = Number.isInteger(flaskAttributePairs[0]?.value)
    ? (flaskAttributePairs[0].value & 0xffff)
    : (bagItem.extraValue || 0);
  if ((bagItem.stateCode || 0) !== 0 || occupiedMonsterId !== 0) {
    session.log(
      `Combat capture rejected source=${sourceLabel} instanceId=${bagItem.instanceId} targetEntityId=${targetEnemy.entityId} reason=flask-not-empty state=${bagItem.stateCode || 0} extra=${bagItem.extraValue || 0} ext0=${occupiedMonsterId}`
    );
    if (typeof session.sendGameDialogue === 'function') {
      session.sendGameDialogue('Combat', `${definition?.name || 'Mob Flask'} is already occupied.`);
    }
    resendCombatCommandPrompt(session, 'capture-rejected-occupied');
    return;
  }

  const capturedMonsterLevel = Math.max(1, targetEnemy.level || 1) >>> 0;
  const capturedMonsterElementCode = rollCapturedMonsterElementCode() >>> 0;
  bagItem.stateCode = 1;
  bagItem.extraValue = targetEnemy.typeId >>> 0;
  bagItem.attributePairs = [
    { value: targetEnemy.typeId >>> 0 },
    { value: capturedMonsterLevel },
    { value: capturedMonsterElementCode },
  ];
  sendInventoryFullSync(session);

  targetEnemy.hp = 0;
  session.combatState.awaitingPlayerAction = false;
  session.combatState.phase = 'resolved';
  session.writePacket(
    buildEntityHidePacket(targetEnemy.entityId >>> 0),
    DEFAULT_FLAGS,
    `Sending combat enemy hide entity=${targetEnemy.entityId} reason=capture`
  );
  session.log(
    `Combat capture ok source=${sourceLabel} instanceId=${bagItem.instanceId} targetEntityId=${targetEnemy.entityId} enemyType=${targetEnemy.typeId} enemyName=${targetEnemy.name || 'unknown'} petTemplateId=${petTemplateId} capturedLevel=${capturedMonsterLevel} capturedElement=${capturedMonsterElementCode} flaskState=${bagItem.stateCode || 0} flaskExtra=${bagItem.extraValue || 0} ext=${JSON.stringify(bagItem.attributePairs || [])}`
  );
  if (typeof session.sendGameDialogue === 'function') {
    session.sendGameDialogue('Combat', `Monster ${targetEnemy.name || 'Unknown'} was captured!`);
  }

  if (!findFirstLivingEnemy(session.combatState.enemies)) {
    session.persistCurrentCharacter();
    resolveVictory(session);
    return;
  }

  session.persistCurrentCharacter();
  resolveEnemyCounterattack(session, 'normal');
}

function describeUnhandledCombatClientPacket(session: SessionLike, payload: Buffer): string {
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

function resendCombatCommandPrompt(session: SessionLike, reason: string): void {
  if (!session.combatState?.active) {
    return;
  }
  session.combatState.awaitingPlayerAction = true;
  session.combatState.phase = 'command';
  sendCommandPrompt(session, reason);
}

function resolveEnemyCounterattack(session: SessionLike, reason: EnemyTurnReason): void {
  const enemies = listLivingEnemies(session.combatState.enemies);
  if (enemies.length === 0) {
    resolveVictory(session);
    return;
  }

  session.combatState.phase = 'enemy-turn';
  session.combatState.awaitingPlayerAction = false;
  session.combatState.enemyTurnReason = reason;
  session.combatState.pendingEnemyTurnQueue = enemies.map((enemy) => enemy.entityId >>> 0);
  processNextEnemyTurnAttack(session, reason);
}

function processNextEnemyTurnAttack(session: SessionLike, reason: EnemyTurnReason): void {
  const queue = Array.isArray(session.combatState?.pendingEnemyTurnQueue)
    ? session.combatState.pendingEnemyTurnQueue
    : [];
  if (queue.length === 0) {
    finishEnemyTurn(session, reason);
    return;
  }

  const enemyEntityId = queue.shift();
  const enemy = findEnemyByEntityId(session.combatState.enemies, enemyEntityId);
  if (!enemy || enemy.hp <= 0) {
    processNextEnemyTurnAttack(session, reason);
    return;
  }

  const enemyDamage = computeEnemyDamage(session, enemy);
  const appliedEnemyDamage = Math.max(0, Math.min(session.currentHealth, enemyDamage));
  session.currentHealth = Math.max(0, session.currentHealth - enemyDamage);
  session.combatState.damageTaken = Math.max(0, (session.combatState.damageTaken || 0) + appliedEnemyDamage);
  session.writePacket(
    buildAttackPlaybackPacket(
      enemy.entityId >>> 0,
      session.entityType >>> 0,
      FIGHT_CONTROL_RING_OPEN_SUBCMD,
      enemyDamage
    ),
    DEFAULT_FLAGS,
    `Sending combat counterattack playback attacker=${enemy.entityId} target=${session.entityType} damage=${enemyDamage} playerHp=${session.currentHealth} remaining=${describeLivingEnemies(session.combatState.enemies)} reason=${reason}`
  );

  if (session.currentHealth <= 0) {
    resolveDefeat(session);
    return;
  }
}

function finishEnemyTurn(session: SessionLike, reason: EnemyTurnReason): void {
  session.combatState.pendingEnemyTurnQueue = [];
  session.combatState.enemyTurnReason = null;

  session.writePacket(
    buildVitalsPacket(FIGHT_CONTROL_RING_OPEN_SUBCMD, session.currentHealth, session.currentMana, session.currentRage),
    DEFAULT_FLAGS,
    `Sending combat vitals refresh hp=${session.currentHealth} mp=${session.currentMana} rage=${session.currentRage}`
  );
  transitionToCommandPhase(session, `enemy-counterattack-${reason} remaining=${describeLivingEnemies(session.combatState.enemies)}`);
}

function resolveVictory(session: SessionLike): void {
  const defeatedEnemies = Array.isArray(session.combatState?.enemies)
    ? session.combatState.enemies.filter((enemy: Record<string, any>) => (enemy.maxHp || 0) > 0)
    : [];
  for (const enemy of defeatedEnemies) {
    session.handleQuestMonsterDefeat(enemy.typeId, 1);
  }
  const combatRewards = buildCombatVictoryRewards(
    defeatedEnemies,
    dropResultPreview(defeatedEnemies),
    Math.max(1, session.combatState?.round || 1),
    {
      playerStartHealth: session.combatState?.playerStartHealth || session.currentHealth,
      playerMaxHealthAtStart: session.combatState?.playerMaxHealthAtStart || session.maxHealth,
      totalEnemyMaxHp: session.combatState?.totalEnemyMaxHp || 0,
      averageEnemyLevel: session.combatState?.averageEnemyLevel || 0,
      damageDealt: session.combatState?.damageDealt || 0,
      damageTaken: session.combatState?.damageTaken || 0,
    },
    session.level
  );
  applyEffects(
    session,
    [
      { kind: 'update-stat', stat: 'experience', delta: combatRewards.characterExperience },
      { kind: 'update-stat', stat: 'coins', delta: combatRewards.coins },
    ],
    {
      suppressDialogues: true,
      suppressPersist: true,
      suppressStatSync: true,
    }
  );
  const dropResult = grantCombatDropsForEnemies(session, defeatedEnemies);
  if (dropResult.inventoryDirty) {
    session.refreshQuestStateForItemTemplates(
      dropResult.granted.map((drop: Record<string, any>) => drop.templateId).filter(Number.isInteger)
    );
  }

  const rankCode = deriveCombatResultRankCode(combatRewards.totalScore, combatRewards.maxScore);

  session.writePacket(
    buildVictoryPointsPacket(combatRewards.totalScore),
    DEFAULT_FLAGS,
    `Sending combat victory points currentPoints=${combatRewards.totalScore}`
  );
  session.writePacket(
    buildVictoryRankPacket(rankCode),
    DEFAULT_FLAGS,
    `Sending combat victory rank rankCode=${rankCode} score=${combatRewards.totalScore}/${combatRewards.maxScore}`
  );

  session.writePacket(
    buildVictoryPacket(session.currentHealth, session.currentMana, session.currentRage, {
      characterExperience: combatRewards.characterExperience,
      petExperience: 0,
      coins: combatRewards.coins,
      items: dropResult.granted,
    }),
    DEFAULT_FLAGS,
    `Sending combat victory enemies=${defeatedEnemies.map((enemy: Record<string, any>) => `${enemy.typeId}@${enemy.entityId}`).join('|') || 'none'} exp=${combatRewards.characterExperience} petExp=0 coins=${combatRewards.coins} score=${combatRewards.totalScore}/${combatRewards.maxScore} drops=${dropResult.granted.length}`
  );
  session.log(`Combat victory trigger=${session.combatState.triggerId} enemies=${defeatedEnemies.map((enemy: Record<string, any>) => `${enemy.typeId}@${enemy.entityId}`).join('|') || 'none'} exp=${combatRewards.characterExperience} petExp=0 coins=${combatRewards.coins} score=${combatRewards.totalScore}/${combatRewards.maxScore} drops=${dropResult.granted.map((drop: Record<string, any>) => `${drop.templateId}x${drop.quantity}`).join(',') || 'none'}`);
  clearCombatState(session, dropResult.inventoryDirty);
}

function buildCombatVictoryRewards(
  enemies: Record<string, any>[],
  preview: { dropCount: number },
  roundCount: number,
  performance: {
    playerStartHealth: number;
    playerMaxHealthAtStart: number;
    totalEnemyMaxHp: number;
    averageEnemyLevel: number;
    damageDealt: number;
    damageTaken: number;
  },
  playerLevel: number
): { characterExperience: number; coins: number; totalScore: number; maxScore: number } {
  const enemyCount = Math.max(1, enemies.length);
  const totals = enemies.reduce((acc, enemy) => {
    const level = Math.max(1, enemy?.level || 1);
    const aptitude = Math.max(0, enemy?.aptitude || 0);
    acc.characterExperience += (level * 12) + 18 + aptitude;
    acc.coins += Math.max(1, level * 3);
    return acc;
  }, { characterExperience: 0, coins: 0 });
  const characterExperience = Math.max(1, totals.characterExperience);
  const coins = Math.max(1, totals.coins);
  const normalizedRoundCount = Math.max(1, roundCount);
  const playerStartHealth = Math.max(1, performance.playerStartHealth || 1);
  const playerMaxHealthAtStart = Math.max(playerStartHealth, performance.playerMaxHealthAtStart || playerStartHealth);
  const totalEnemyMaxHp = Math.max(1, performance.totalEnemyMaxHp || enemies.reduce((sum, enemy) => sum + Math.max(0, enemy?.maxHp || 0), 0));
  const damageDealt = Math.max(0, performance.damageDealt || totalEnemyMaxHp);
  const damageTaken = Math.max(0, performance.damageTaken || 0);
  const currentHealth = Math.max(0, playerStartHealth - damageTaken);
  const hpLost = Math.max(0, playerStartHealth - currentHealth);
  const averageEnemyLevel = Math.max(1, performance.averageEnemyLevel || 1);
  const expectedRoundBudget = Math.max(1, Math.ceil(enemyCount / 2));
  const roundScore = 250 * Math.min(1, expectedRoundBudget / normalizedRoundCount);
  const exchangeScore = 200 * (damageDealt / Math.max(1, damageDealt + damageTaken));
  const damageTakenBudget = Math.max(1, playerMaxHealthAtStart * expectedRoundBudget);
  const damageTakenScore = 150 * Math.max(0, 1 - (damageTaken / damageTakenBudget));
  const hpPreservationScore = 200 * Math.max(0, 1 - (hpLost / playerStartHealth));
  const challengeScore = 200 * Math.min(1, averageEnemyLevel / Math.max(1, playerLevel || 1));
  const rewardScore = 50 * Math.min(1, Math.max(0, preview.dropCount) / Math.max(1, enemyCount));
  const maxScore = 1000;
  const totalScore = Math.max(
    1,
    Math.floor(
      roundScore +
      exchangeScore +
      damageTakenScore +
      hpPreservationScore +
      challengeScore +
      rewardScore
    )
  );
  return {
    characterExperience,
    coins,
    totalScore,
    maxScore,
  };
}

function dropResultPreview(enemies: Record<string, any>[]): { dropCount: number } {
  const dropCount = enemies.reduce((count, enemy) => {
    const drops = Array.isArray(enemy?.drops) ? enemy.drops : [];
    return count + drops.length;
  }, 0);
  return { dropCount };
}

function deriveCombatResultRankCode(totalScore: number, maxScore: number): number {
  const safeMaxScore = Math.max(1, maxScore);
  const scorePercent = (totalScore / safeMaxScore) * 100;
  if (scorePercent >= 90) {
    return 4; // S
  }
  if (scorePercent >= 80) {
    return 0; // A
  }
  if (scorePercent >= 70) {
    return 1; // B
  }
  if (scorePercent >= 60) {
    return 2; // C
  }
  return 3; // D
}

function resolveDefeat(session: SessionLike): void {
  const persisted = session.getPersistedCharacter();
  const state = buildDefeatRespawnState({
    persistedCharacter: persisted,
    currentMapId: session.currentMapId,
    currentX: session.currentX,
    currentY: session.currentY,
    player: { maxHp: session.maxHealth, mp: session.currentMana, rage: session.currentRage },
    currentMana: session.currentMana,
    currentRage: session.currentRage,
    resolveTownRespawn: (character: Record<string, any>) => ({
      mapId: typeof character?.mapId === 'number' ? character.mapId : session.currentMapId,
      x: typeof character?.x === 'number' ? character.x : session.currentX,
      y: typeof character?.y === 'number' ? character.y : session.currentY,
    }),
  });

  session.writePacket(
    buildDefeatPacket(1, state.vitals.mana, state.vitals.rage),
    DEFAULT_FLAGS,
    `Sending combat defeat respawnMap=${state.respawn.mapId} pos=${state.respawn.x},${state.respawn.y}`
  );

  clearCombatState(session, false);
  session.defeatRespawnPending = true;
  session.combatDefeatTimer = setTimeout(() => {
    session.combatDefeatTimer = null;
    if (session.socket.destroyed) {
      return;
    }
    session.currentHealth = state.vitals.health;
    session.currentMana = state.vitals.mana;
    session.currentRage = state.vitals.rage;
    session.defeatRespawnPending = false;
    session.currentMapId = state.respawn.mapId;
    session.currentX = state.respawn.x;
    session.currentY = state.respawn.y;
    session.sendEnterGameOk({ syncMode: 'runtime' });
    session.persistCurrentCharacter({
      currentHealth: state.vitals.health,
      currentMana: state.vitals.mana,
      currentRage: state.vitals.rage,
      mapId: state.respawn.mapId,
      x: state.respawn.x,
      y: state.respawn.y,
    });
  }, 900);
}

function clearCombatState(session: SessionLike, persist = false): void {
  disposeCombatTimers(session);
  session.combatState = createIdleCombatState();
  if (persist) {
    session.persistCurrentCharacter();
  }
}

function findFirstLivingEnemy(enemies: CombatEnemyInstance[] | null | undefined): CombatEnemyInstance | null {
  if (!Array.isArray(enemies)) {
    return null;
  }
  return enemies.find((enemy) => enemy && (enemy.hp || 0) > 0) || null;
}

function resolveCaptureTargetEnemy(session: SessionLike, targetEntityId: number): CombatEnemyInstance | null {
  const explicitTarget = findEnemyByEntityId(session.combatState?.enemies, targetEntityId >>> 0);
  if (explicitTarget && explicitTarget.hp > 0) {
    return explicitTarget;
  }
  const living = listLivingEnemies(session.combatState?.enemies);
  return living.length === 1 ? living[0] : null;
}

function isEnemyDying(enemy: CombatEnemyInstance | null | undefined): boolean {
  if (!enemy) {
    return false;
  }
  const maxHp = Math.max(1, enemy.maxHp || 1);
  return (enemy.hp || 0) <= Math.max(1, Math.floor(maxHp * 0.25));
}

function findEnemyByEntityId(enemies: CombatEnemyInstance[] | null | undefined, entityId: number): CombatEnemyInstance | null {
  if (!Array.isArray(enemies)) {
    return null;
  }
  return enemies.find((enemy) => enemy && (enemy.entityId >>> 0) === (entityId >>> 0)) || null;
}

function listLivingEnemies(enemies: CombatEnemyInstance[] | null | undefined): CombatEnemyInstance[] {
  if (!Array.isArray(enemies)) {
    return [];
  }
  return enemies.filter((enemy) => enemy && (enemy.hp || 0) > 0);
}

function resolveSelectedEnemy(enemies: CombatEnemyInstance[] | null | undefined, selection: { targetA: number; targetB: number }): CombatEnemyInstance | null {
  if (!Array.isArray(enemies)) {
    return null;
  }
  const targeted = enemies.find(
    (enemy) => enemy && (enemy.hp || 0) > 0 && enemy.row === selection.targetA && enemy.col === selection.targetB
  );
  return targeted || findFirstLivingEnemy(enemies);
}

function describeLivingEnemies(enemies: CombatEnemyInstance[] | null | undefined): string {
  if (!Array.isArray(enemies)) {
    return 'none';
  }
  return enemies
    .filter((enemy) => enemy && (enemy.hp || 0) > 0)
    .map((enemy) => `${enemy.entityId}[${enemy.row},${enemy.col}]=${enemy.hp}`)
    .join('|') || 'none';
}

function grantCombatDropsForEnemies(session: SessionLike, enemies: Record<string, any>[]): Record<string, any> {
  return enemies.reduce((acc, enemy) => {
    const next = grantCombatDrops(session, enemy);
    acc.granted.push(...(next.granted || []));
    acc.inventoryDirty = acc.inventoryDirty || !!next.inventoryDirty;
    return acc;
  }, { granted: [], inventoryDirty: false });
}

function describeEnemy(enemy: CombatEnemyInstance): string {
  return `${enemy.typeId}@${enemy.entityId}[${enemy.row},${enemy.col}]`;
}

function describeEncounterEnemies(enemies: CombatEnemyInstance[]): string {
  return enemies.map((enemy) => `${describeEnemy(enemy)}hp=${enemy.hp}lvl=${enemy.level}`).join('|');
}

function buildPlayerEntry(session: SessionLike): Record<string, any> {
  return {
    side: 0xff,
    entityId: session.entityType >>> 0,
    typeId: (session.roleEntityType || session.entityType) & 0xffff,
    row: 1,
    col: 2,
    hp: Math.max(1, session.currentHealth || 1),
    mp: Math.max(0, session.currentMana || 0),
    aptitude: 0,
    level: Math.max(1, session.level || 1),
    appearanceTypes: [0, 0, 0],
    appearanceVariants: [0, 0, 0],
    name: session.charName || 'Hero',
  };
}

function computePlayerDamage(session: SessionLike, enemy: Record<string, any>): number {
  const stats = session.primaryAttributes || {};
  const equipment = getEquipmentCombatBonuses(session);
  const weaponMin = Math.max(0, equipment.attackMin || 0);
  const weaponMax = Math.max(weaponMin, equipment.attackMax || weaponMin);
  const base = 8 + ((stats.strength || 0) * 2) + (session.level || 1) + weaponMin;
  const spread = 6 + (stats.dexterity || 0) + Math.max(0, weaponMax - weaponMin);
  const mitigation = Math.floor(((enemy.level || 1) * 2) + (enemy.aptitude || 0));
  return Math.max(1, base + Math.floor(Math.random() * Math.max(1, spread)) - mitigation);
}

function computeEnemyDamage(session: SessionLike, enemy: Record<string, any>): number {
  const stats = session.primaryAttributes || {};
  const equipment = getEquipmentCombatBonuses(session);
  const defense = Math.floor(
    ((stats.vitality || 0) * 0.8) +
    ((stats.dexterity || 0) * 0.4) +
    (session.level || 1) +
    Math.max(0, equipment.defense || 0)
  );
  const base = 6 + ((enemy.level || 1) * 3) + (enemy.aptitude || 0);
  return Math.max(1, base + Math.floor(Math.random() * 5) - defense);
}

module.exports = {
  createIdleCombatState,
  disposeCombatTimers,
  handleCombatPacket,
  sendCombatEncounterProbe,
  sendCombatExitProbe,
};
