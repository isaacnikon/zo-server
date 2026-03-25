import type { CombatEnemyInstance, CombatState, GameSession } from '../types.js';
import { DEFAULT_FLAGS, FIGHT_ACTIVE_STATE_SUBCMD, FIGHT_CONTROL_RING_OPEN_SUBCMD, GAME_FIGHT_ACTION_CMD, GAME_FIGHT_STREAM_CMD } from '../config.js';
import { parseAttackSelection, parseCombatItemUse } from '../protocol/inbound-packets.js';
import { buildActionStateResetPacket, buildActionStateTableResetPacket, buildAttackPlaybackPacket, buildControlInitPacket, buildControlShowPacket, buildDefeatPacket, buildEntityHidePacket, buildRingOpenPacket, buildRoundStartPacket, buildStateModePacket, buildVictoryPacket, buildVictoryPointsPacket, buildVictoryRankPacket, buildVitalsPacket, buildActiveStatePacket } from './packets.js';
import { grantCombatDrops } from '../gameplay/combat-drop-runtime.js';
import { sendInventoryFullSync } from '../gameplay/inventory-runtime.js';
import { consumeUsableItemByInstanceId } from '../gameplay/item-use-runtime.js';
import { sendSkillStateSync } from '../gameplay/skill-runtime.js';
import { applyEffects } from '../effects/effect-executor.js';
import { buildDefeatRespawnState } from '../gameplay/session-flows.js';
import { sendSelfStateVitalsUpdate } from '../gameplay/stat-sync.js';
import { getCapturePetTemplateId } from '../roleinfo/index.js';
import { getBagItemByReference, getItemDefinition } from '../inventory/index.js';
import { buildPetCreateSyncPacket, buildPetSummonSyncPacket } from '../protocol/gameplay-packets.js';
import { getActivePet } from '../pet-runtime.js';
import {
  appendSkillPacketTrace,
  buildPlayerEntry,
  buildRoundStartProbeOptions,
  buildSkillPacketProbeTargets,
  buildSkillPacketProbeStage2Entries,
  computeEnemyDamage,
  computePlayerDamage,
  deriveCombatResultRankCode,
  describeEnemy,
  describeEncounterEnemies,
  describeEnemyRoster,
  describeLivingEnemies,
  dropResultPreview,
  findEnemyByEntityId,
  findFirstLivingEnemy,
  isEnemyDying,
  listLivingEnemies,
  resolveCaptureTargetEnemy,
  resolveSelectedEnemy,
  rollCapturedMonsterElementCode,
  SLAUGHTER_SKILL_ID,
  SKILL_PACKET_HYBRID_IMPACT_ENABLED,
  tickCombatStatuses,
} from './combat-formulas.js';
import { createIdleCombatState } from './combat-formulas.js';

type CombatAction = Record<string, any>;
type EnemyTurnReason = 'normal' | 'post-kill';
const DELAYED_SKILL_COMPLETION_TIMEOUT_MS = 1200;

function sendCombatActionStateReset(session: GameSession, reason: string): void {
  session.writePacket(
    buildActionStateResetPacket(session.entityType >>> 0),
    DEFAULT_FLAGS,
    `Sending combat action-state reset cmd=0x040d entity=${session.entityType} reason=${reason}`
  );
  session.writePacket(
    buildActionStateTableResetPacket(session.entityType >>> 0),
    DEFAULT_FLAGS,
    `Sending combat action-state table reset cmd=0x040d entity=${session.entityType} reason=${reason} entries=11`
  );
}

function getCombatPet(session: GameSession): Record<string, any> | null {
  return getActivePet(session.pets, session.selectedPetRuntimeId, session.petSummoned === true);
}

function getCombatCompanionHp(session: GameSession): number | undefined {
  const pet = getCombatPet(session);
  if (!pet) {
    return undefined;
  }
  return Math.max(0, pet.currentHealth || 0) >>> 0;
}

function sendCombatPetIntroSync(session: GameSession, reason: string): void {
  const pet = getCombatPet(session);
  if (!pet) {
    return;
  }

  session.writePacket(
    buildPetCreateSyncPacket({ pet }),
    DEFAULT_FLAGS,
    `Sending combat pet create cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x0f reason=${reason} runtimeId=${pet.runtimeId} owner=${session.entityType}`
  );
  session.writePacket(
    buildPetSummonSyncPacket({
      ownerRuntimeId: session.entityType >>> 0,
      pet,
    }),
    DEFAULT_FLAGS,
    `Sending combat pet summon cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x0a reason=${reason} runtimeId=${pet.runtimeId} owner=${session.entityType}`
  );
}

function sendCombatPetVitalsSync(session: GameSession, reason: string): void {
  const pet = getCombatPet(session);
  if (!pet) {
    return;
  }

  session.writePacket(
    buildPetSummonSyncPacket({
      ownerRuntimeId: session.entityType >>> 0,
      pet,
    }),
    DEFAULT_FLAGS,
    `Sending combat pet vitals cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x0a reason=${reason} runtimeId=${pet.runtimeId} hp=${pet.currentHealth} mp=${pet.currentMana}`
  );
}

// --- Intro / Command prompt ---

export function sendIntroSequence(session: GameSession): void {
  const entityId = session.entityType >>> 0;
  sendCombatPetIntroSync(session, `intro trigger=${session.combatState.triggerId}`);
  sendCombatActionStateReset(session, `intro trigger=${session.combatState.triggerId}`);
  session.writePacket(buildRingOpenPacket(), DEFAULT_FLAGS, `Sending combat ring-open trigger=${session.combatState.triggerId}`);
  session.writePacket(buildStateModePacket(), DEFAULT_FLAGS, `Sending combat mode trigger=${session.combatState.triggerId}`);
  session.writePacket(buildControlInitPacket(), DEFAULT_FLAGS, `Sending combat control init trigger=${session.combatState.triggerId}`);
  session.writePacket(buildActiveStatePacket(entityId), DEFAULT_FLAGS, `Sending combat active state trigger=${session.combatState.triggerId} active=${entityId}`);
  session.writePacket(buildEntityHidePacket(entityId), DEFAULT_FLAGS, `Sending combat entity hide trigger=${session.combatState.triggerId} active=${entityId}`);
  session.writePacket(buildControlShowPacket(entityId), DEFAULT_FLAGS, `Sending combat control show trigger=${session.combatState.triggerId} active=${entityId}`);
}

export function sendCommandPrompt(session: GameSession, reason: string): void {
  const entityId = session.entityType >>> 0;
  const roundStartProbeOptions = buildRoundStartProbeOptions(session.combatState.round, entityId);
  const roundStartPacket = buildRoundStartPacket(session.combatState.round, entityId, roundStartProbeOptions || {});
  sendCombatActionStateReset(session, `command reason=${reason}`);
  sendSkillStateSync(session, `combat-command-${reason}`);
  session.writePacket(buildRingOpenPacket(), DEFAULT_FLAGS, `Sending combat ring-open refresh reason=${reason}`);
  session.writePacket(
    roundStartPacket,
    DEFAULT_FLAGS,
    `Sending combat round start reason=${reason} round=${session.combatState.round} active=${entityId}` +
    `${roundStartProbeOptions ? ` probe=${JSON.stringify(roundStartProbeOptions)}` : ''}` +
    ` hex=${roundStartPacket.toString('hex')}`
  );
  appendSkillPacketTrace({
    kind: 'round-start-outbound',
    ts: new Date().toISOString(),
    sessionId: session.id,
    round: session.combatState.round,
    activeEntityId: entityId >>> 0,
    probeEnabled: roundStartProbeOptions !== null,
    probe: roundStartProbeOptions,
    packetHex: roundStartPacket.toString('hex'),
  });
  session.writePacket(buildControlShowPacket(entityId), DEFAULT_FLAGS, `Sending combat control refresh reason=${reason} active=${entityId}`);
}

export function transitionToCommandPhase(session: GameSession, reason: string): void {
  session.combatState.awaitingClientReady = false;
  session.combatState.awaitingPlayerAction = true;
  session.combatState.phase = 'command';
  session.combatState.round = Math.max(1, (session.combatState.round || 0) + 1);
  sendCommandPrompt(session, reason);
}

export function resendCombatCommandPrompt(session: GameSession, reason: string): void {
  if (!session.combatState?.active) {
    return;
  }
  session.combatState.awaitingPlayerAction = true;
  session.combatState.phase = 'command';
  sendCommandPrompt(session, reason);
}

// --- Attack handling ---

export function handleAttackSelection(session: GameSession, payload: Buffer): void {
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

// --- Item use ---

export function resolveCombatItemUse(
  session: GameSession,
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
  sendCombatItemPlayback(session, (useResult.targetEntityId || session.entityType) >>> 0, useResult.gained || {});
  if (useResult.targetKind === 'pet') {
    sendCombatPetVitalsSync(session, 'combat-item-use');
  }
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
  session: GameSession,
  targetEntityId: number,
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
      targetEntityId >>> 0,
      FIGHT_ACTIVE_STATE_SUBCMD,
      primaryAmount
    ),
    DEFAULT_FLAGS,
    `Sending combat item playback active=${session.entityType} target=${targetEntityId} restored=${primaryAmount}`
  );
}

export function resolveCombatCaptureItemUse(
  session: GameSession,
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

// --- Enemy turns ---

export function resolveEnemyCounterattack(session: GameSession, reason: EnemyTurnReason): void {
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

export function processNextEnemyTurnAttack(session: GameSession, reason: EnemyTurnReason): void {
  const queue = Array.isArray(session.combatState?.pendingEnemyTurnQueue)
    ? session.combatState.pendingEnemyTurnQueue
    : [];
  if (queue.length === 0) {
    finishEnemyTurn(session, reason);
    return;
  }

  const enemyEntityId = queue.shift()!;
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

export function finishEnemyTurn(session: GameSession, reason: EnemyTurnReason): void {
  session.combatState.pendingEnemyTurnQueue = [];
  session.combatState.enemyTurnReason = null;
  tickCombatStatuses(session);

  session.writePacket(
    buildVitalsPacket(
      FIGHT_CONTROL_RING_OPEN_SUBCMD,
      session.currentHealth,
      session.currentMana,
      session.currentRage,
      getCombatCompanionHp(session)
    ),
    DEFAULT_FLAGS,
    `Sending combat vitals refresh hp=${session.currentHealth} mp=${session.currentMana} rage=${session.currentRage}`
  );
  transitionToCommandPhase(session, `enemy-counterattack-${reason} remaining=${describeLivingEnemies(session.combatState.enemies)}`);
}

// --- Victory / Defeat ---

export function resolveVictory(session: GameSession): void {
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
      companionHp: getCombatCompanionHp(session),
      coins: combatRewards.coins,
      items: dropResult.granted,
    }),
    DEFAULT_FLAGS,
    `Sending combat victory enemies=${defeatedEnemies.map((enemy: Record<string, any>) => `${enemy.typeId}@${enemy.entityId}`).join('|') || 'none'} exp=${combatRewards.characterExperience} petExp=0 coins=${combatRewards.coins} score=${combatRewards.totalScore}/${combatRewards.maxScore} drops=${dropResult.granted.length}`
  );
  session.log(`Combat victory trigger=${session.combatState.triggerId} enemies=${defeatedEnemies.map((enemy: Record<string, any>) => `${enemy.typeId}@${enemy.entityId}`).join('|') || 'none'} exp=${combatRewards.characterExperience} petExp=0 coins=${combatRewards.coins} score=${combatRewards.totalScore}/${combatRewards.maxScore} drops=${dropResult.granted.map((drop: Record<string, any>) => `${drop.templateId}x${drop.quantity}`).join(',') || 'none'}`);
  clearCombatState(session, true);
}

export function buildCombatVictoryRewards(
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

export function resolveDefeat(session: GameSession): void {
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
    buildDefeatPacket(1, state.vitals.mana, state.vitals.rage, getCombatCompanionHp(session)),
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

export function grantCombatDropsForEnemies(session: GameSession, enemies: Record<string, any>[]): Record<string, any> {
  return enemies.reduce((acc, enemy) => {
    const next = grantCombatDrops(session, enemy);
    acc.granted.push(...(next.granted || []));
    acc.inventoryDirty = acc.inventoryDirty || !!next.inventoryDirty;
    return acc;
  }, { granted: [] as Record<string, any>[], inventoryDirty: false });
}

export function clearCombatState(session: GameSession, persist = false): void {
  disposeCombatTimers(session);
  if (session.socket && !session.socket.destroyed) {
    sendCombatActionStateReset(session, 'combat-clear');
  }
  session.combatState = createIdleCombatState();
  if (persist) {
    session.persistCurrentCharacter();
  }
  if (typeof session.scheduleEquipmentReplay === 'function') {
    session.scheduleEquipmentReplay(100);
  }
  if (typeof session.schedulePetReplay === 'function' && session.petSummoned) {
    session.schedulePetReplay(100);
  }
}

export function disposeCombatTimers(session: GameSession): void {
  if (session.combatDefeatTimer) {
    clearTimeout(session.combatDefeatTimer);
    session.combatDefeatTimer = null;
  }
  if (session.combatSkillResolutionTimer) {
    clearTimeout(session.combatSkillResolutionTimer);
    session.combatSkillResolutionTimer = null;
  }
}

// --- Skill resolution finalization ---

export function finalizeSkillResolutionAndEnemyTurn(session: GameSession, source: string): void {
  if (!session.combatState?.active) {
    return;
  }
  const pendingOutcomes = Array.isArray(session.combatState.pendingSkillOutcomes)
    ? session.combatState.pendingSkillOutcomes
    : [];
  session.combatState.pendingSkillOutcomes = null;
  session.combatState.awaitingSkillResolution = false;
  const startedAt = session.combatState.skillResolutionStartedAt || 0;
  const elapsed = startedAt > 0 ? Math.max(0, Date.now() - startedAt) : 0;
  session.combatState.skillResolutionStartedAt = 0;
  session.combatState.skillResolutionReason = null;
  session.combatState.skillResolutionPhase = null;
  if (session.combatSkillResolutionTimer) {
    clearTimeout(session.combatSkillResolutionTimer);
    session.combatSkillResolutionTimer = null;
  }
  sendSelfStateVitalsUpdate(session, {
    health: Math.max(0, session.currentHealth || 0),
    mana: Math.max(0, session.currentMana || 0),
    rage: Math.max(0, session.currentRage || 0),
  });
  session.log(
    `Skill resolution complete source=${source} elapsedMs=${elapsed} pendingSkillCount=${pendingOutcomes.length}`
  );

  const shouldSendSkillImpactPlayback = SKILL_PACKET_HYBRID_IMPACT_ENABLED;

  if (shouldSendSkillImpactPlayback) {
    for (const pendingOutcome of pendingOutcomes) {
      if (!pendingOutcome?.targetEntityId || !pendingOutcome?.playerDamage) {
        continue;
      }
      const resultCode = pendingOutcome.targetDied ? 3 : 1;
      const impactPacket = buildAttackPlaybackPacket(
        session.entityType >>> 0,
        pendingOutcome.targetEntityId >>> 0,
        resultCode,
        Math.max(1, pendingOutcome.playerDamage || 1)
      );
      appendSkillPacketTrace({
        kind: 'skill-impact-outbound',
        ts: new Date().toISOString(),
        sessionId: session.id,
        source,
        attackerEntityId: session.entityType >>> 0,
        targetEntityId: pendingOutcome.targetEntityId >>> 0,
        resultCode,
        damage: Math.max(1, pendingOutcome.playerDamage || 1),
        packetHex: impactPacket.toString('hex'),
      });
      session.writePacket(
        impactPacket,
        DEFAULT_FLAGS,
        `Sending hybrid combat skill impact attacker=${session.entityType} target=${pendingOutcome.targetEntityId} result=${resultCode} damage=${Math.max(1, pendingOutcome.playerDamage || 1)} source=${source}`
      );
    }
  }

  let killedAny = false;
  const killedEntities: number[] = [];
  for (const pendingOutcome of pendingOutcomes) {
    if (!pendingOutcome?.targetDied) {
      continue;
    }
    const targetEnemy = findEnemyByEntityId(session.combatState.enemies, pendingOutcome.targetEntityId >>> 0);
    if (!targetEnemy) {
      continue;
    }
    killedAny = true;
    killedEntities.push(targetEnemy.entityId >>> 0);
    session.writePacket(
      buildEntityHidePacket(targetEnemy.entityId >>> 0),
      DEFAULT_FLAGS,
      `Sending combat enemy hide entity=${targetEnemy.entityId} reason=skill`
    );
  }
  if (killedEntities.length > 0) {
    session.log(
      `Combat skill kill-resolution source=${source} hidden=${killedEntities.join(',')} rosterAfter=${describeEnemyRoster(session.combatState?.enemies)}`
    );
  }

  if (!findFirstLivingEnemy(session.combatState.enemies)) {
    resolveVictory(session);
    return;
  }

  resolveEnemyCounterattack(session, killedAny ? 'post-kill' : 'normal');
}

export function advanceSkillResolutionEvent(session: GameSession, source: string): void {
  if (!session.combatState?.active || !session.combatState.awaitingSkillResolution) {
    return;
  }
  const pendingOutcomes = Array.isArray(session.combatState.pendingSkillOutcomes)
    ? session.combatState.pendingSkillOutcomes
    : [];
  const phase = session.combatState.skillResolutionPhase || 'await-cast-ready';
  if (
    session.combatState.skillResolutionReason === 'skill-post-resolution-delayed-cast' &&
    phase === 'await-cast-ready' &&
    pendingOutcomes.length > 0
  ) {
    sendSelfStateVitalsUpdate(session, {
      health: Math.max(0, session.currentHealth || 0),
      mana: Math.max(0, session.currentMana || 0),
      rage: Math.max(0, session.currentRage || 0),
    });
    session.combatState.skillResolutionPhase = 'await-impact-ready';
    session.combatState.skillResolutionReason = 'skill-impact-playback';
    if (session.combatSkillResolutionTimer) {
      clearTimeout(session.combatSkillResolutionTimer);
      session.combatSkillResolutionTimer = null;
    }
    session.combatSkillResolutionTimer = setTimeout(() => {
      session.combatSkillResolutionTimer = null;
      if (!session.combatState?.active || !session.combatState.awaitingSkillResolution) {
        return;
      }
      if (session.combatState.skillResolutionPhase !== 'await-impact-ready') {
        return;
      }
      session.log(
        `Delayed skill completion timeout reached; finalizing skill resolution timeoutMs=${DELAYED_SKILL_COMPLETION_TIMEOUT_MS}`
      );
      finalizeSkillResolutionAndEnemyTurn(session, 'delayed-skill-timeout');
    }, DELAYED_SKILL_COMPLETION_TIMEOUT_MS);
    session.log(
      `Skill resolution advanced source=${source} phase=await-impact-ready mode=delayed-cast pendingSkillCount=${pendingOutcomes.length} timeoutMs=${DELAYED_SKILL_COMPLETION_TIMEOUT_MS}`
    );
    return;
  }
  finalizeSkillResolutionAndEnemyTurn(session, source);
}
