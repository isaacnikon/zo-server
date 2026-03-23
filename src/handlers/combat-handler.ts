import type { CombatEnemyInstance, CombatState, GameSession } from '../types';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

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
  buildActionStateResetPacket,
  buildActionStateTableResetPacket,
  buildAttackPlaybackPacket,
  buildControlInitPacket,
  buildControlShowPacket,
  buildRoundStartPacket,
  buildDefeatPacket,
  buildEncounterPacket,
  buildEntityHidePacket,
  buildRingOpenPacket,
  buildSkillCastPlaybackPacket,
  buildStateModePacket,
  buildVictoryPacket,
  buildVictoryPointsPacket,
  buildVictoryRankPacket,
  buildVitalsPacket,
} = require('../combat/packets');
const { grantCombatDrops } = require('../gameplay/combat-drop-runtime');
const { sendInventoryFullSync } = require('../gameplay/inventory-runtime');
const { consumeUsableItemByInstanceId } = require('../gameplay/item-use-runtime');
const { sendSkillStateSync } = require('../gameplay/skill-runtime');
const { applyEffects } = require('../effects/effect-executor');
const { buildDefeatRespawnState } = require('../gameplay/session-flows');
const { sendSelfStateVitalsUpdate } = require('../gameplay/stat-sync');
const { getCapturePetTemplateId } = require('../roleinfo');
const {
  describeCombatAppearanceProfile,
  getBagItemByReference,
  getCombatAppearanceProfile,
  getEquipmentCombatBonuses,
  getItemDefinition,
} = require('../inventory');

type SessionLike = GameSession & Record<string, any>;
type CombatAction = Record<string, any>;
type EnemyTurnReason = 'normal' | 'post-kill';
const CAPTURE_ELEMENT_CODE_MIN = 1;
const CAPTURE_ELEMENT_CODE_MAX = 4;
const FIGHT_CLIENT_SKILL_USE_SUBCMD = 0x04;
const SKILL_PACKET_TRACE_PATH = resolve(process.cwd(), 'data/runtime/skill-packet-trace.jsonl');
const DEFIANT_MP_COST_BY_LEVEL = [50, 55, 65, 75, 90, 110, 110, 110, 200, 200, 250, 300];
const DEFIANT_DEFENSE_BONUS_BY_LEVEL = [20, 20, 20, 20, 20, 30, 32, 34, 36, 48, 75, 75];
const ENERVATE_MP_COST_BY_LEVEL = [40, 59, 80, 100, 120, 140, 140, 140, 200, 200, 250, 300];
const ENERVATE_DAMAGE_SCALE_MIN_BY_LEVEL = [1.12, 1.122, 1.124, 1.126, 1.128, 1.13, 1.132, 1.134, 1.136, 1.138, 1.16, 1.2];
const ENERVATE_DAMAGE_SCALE_MAX_BY_LEVEL = [1.13, 1.132, 1.134, 1.136, 1.138, 1.14, 1.142, 1.144, 1.146, 1.148, 1.18, 1.22];
const MULTI_TARGET_ENTITY_SENTINEL = 0xffffffff;
const MULTI_TARGET_SKILL_IDS = new Set<number>([]);
const SKILL_PACKET_HYBRID_IMPACT_ENABLED = /^(1|true|yes)$/i.test(process.env.SKILL_PACKET_HYBRID_IMPACT_ENABLED || '');
const SKILL_PACKET_PROBE_STAGE2_ENABLED = /^(1|true|yes)$/i.test(process.env.SKILL_PACKET_PROBE_STAGE2_ENABLED || '');
const SKILL_PACKET_PROBE_STAGE2_FLAG = Number.isFinite(Number(process.env.SKILL_PACKET_PROBE_STAGE2_FLAG))
  ? Number(process.env.SKILL_PACKET_PROBE_STAGE2_FLAG)
  : 0;
const SKILL_PACKET_PROBE_STAGE2_SPEC = String(process.env.SKILL_PACKET_PROBE_STAGE2_SPEC || '').trim();
const SKILL_PACKET_PROBE_TARGET_ENTITY = String(process.env.SKILL_PACKET_PROBE_TARGET_ENTITY || '').trim();
const SKILL_PACKET_PROBE_TARGET_ACTION = String(process.env.SKILL_PACKET_PROBE_TARGET_ACTION || '').trim();
const SKILL_PACKET_PROBE_TARGET_VALUE = String(process.env.SKILL_PACKET_PROBE_TARGET_VALUE || '').trim();
const ROUND_START_PROBE_ENABLED = /^(1|true|yes)$/i.test(process.env.ROUND_START_PROBE_ENABLED || '');
const ROUND_START_PROBE_FIELD_B = String(process.env.ROUND_START_PROBE_FIELD_B || '').trim();
const ROUND_START_PROBE_FIELD_C = String(process.env.ROUND_START_PROBE_FIELD_C || '').trim();
const ROUND_START_PROBE_FIELD_D = String(process.env.ROUND_START_PROBE_FIELD_D || '').trim();
const ROUND_START_PROBE_FIELD_E = String(process.env.ROUND_START_PROBE_FIELD_E || '').trim();

type SkillPacketProbeContext = {
  casterEntityId: number;
  skillId: number;
  skillLevel: number;
  skillLevelIndex: number;
  targetCount: number;
  targetEntityId: number;
  targetEntityIdLow: number;
  targetEntityIdHigh: number;
  targetActionCode: number;
  targetValue: number;
};
type SkillPacketProbeStage2Entry = {
  wordA: number;
  wordB: number;
  dwordC: number;
};
type RoundStartProbeOptions = {
  fieldA?: number;
  fieldB?: number;
  fieldC?: number;
  fieldD?: number;
  fieldE?: number | null;
};

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
    awaitingSkillResolution: false,
    skillResolutionStartedAt: 0,
    skillResolutionReason: null,
    pendingSkillOutcomes: null,
    playerStatus: {},
    enemyStatuses: {},
  };
}

function rollCapturedMonsterElementCode(): number {
  const span = (CAPTURE_ELEMENT_CODE_MAX - CAPTURE_ELEMENT_CODE_MIN) + 1;
  return CAPTURE_ELEMENT_CODE_MIN + Math.floor(Math.random() * Math.max(1, span));
}

function appendSkillPacketTrace(event: Record<string, unknown>): void {
  mkdirSync(dirname(SKILL_PACKET_TRACE_PATH), { recursive: true });
  appendFileSync(SKILL_PACKET_TRACE_PATH, `${JSON.stringify(event)}\n`, 'utf8');
}

function resolveSkillPacketProbeToken(token: string, context: SkillPacketProbeContext): number {
  const normalizedToken = String(token || '').trim();
  if (/^0x[0-9a-f]+$/i.test(normalizedToken)) {
    return parseInt(normalizedToken, 16) >>> 0;
  }
  if (/^-?\d+$/.test(normalizedToken)) {
    return Number(normalizedToken) >>> 0;
  }
  switch (normalizedToken) {
    case 'skillId':
      return context.skillId >>> 0;
    case 'skillLevel':
      return context.skillLevel >>> 0;
    case 'skillLevelIndex':
      return context.skillLevelIndex >>> 0;
    case 'targetCount':
      return context.targetCount >>> 0;
    case 'targetId':
    case 'targetEntityId':
      return context.targetEntityId >>> 0;
    case 'targetIdLo':
    case 'targetEntityIdLow':
      return context.targetEntityIdLow >>> 0;
    case 'targetIdHi':
    case 'targetEntityIdHigh':
      return context.targetEntityIdHigh >>> 0;
    case 'targetAction':
    case 'targetActionCode':
      return context.targetActionCode >>> 0;
    case 'targetValue':
    case 'damage':
      return context.targetValue >>> 0;
    case 'casterId':
    case 'casterEntityId':
      return context.casterEntityId >>> 0;
    case 'one':
      return 1;
    case 'zero':
    default:
      return 0;
  }
}

function resolveRoundStartProbeToken(
  token: string,
  context: { round: number; activeEntityId: number }
): number | undefined {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) {
    return undefined;
  }
  if (/^0x[0-9a-f]+$/i.test(normalizedToken)) {
    return parseInt(normalizedToken, 16) >>> 0;
  }
  if (/^-?\d+$/.test(normalizedToken)) {
    return Number(normalizedToken) >>> 0;
  }
  switch (normalizedToken) {
    case 'round':
      return context.round & 0xffff;
    case 'active':
    case 'activeEntityId':
      return context.activeEntityId >>> 0;
    case 'one':
      return 1;
    case 'zero':
      return 0;
    default:
      return undefined;
  }
}

function buildRoundStartProbeOptions(round: number, activeEntityId: number): RoundStartProbeOptions | null {
  if (!ROUND_START_PROBE_ENABLED) {
    return null;
  }
  const context = {
    round: Math.max(1, round) & 0xffff,
    activeEntityId: activeEntityId >>> 0,
  };
  const fieldB = resolveRoundStartProbeToken(ROUND_START_PROBE_FIELD_B, context);
  const fieldC = resolveRoundStartProbeToken(ROUND_START_PROBE_FIELD_C, context);
  const fieldD = resolveRoundStartProbeToken(ROUND_START_PROBE_FIELD_D, context);
  const fieldE = resolveRoundStartProbeToken(ROUND_START_PROBE_FIELD_E, context);
  return {
    // The client renders the visible round banner directly from sub=0x06 fieldA.
    // Keep it locked to the real round counter even while probing the other fields.
    fieldA: context.round,
    fieldB,
    fieldC,
    fieldD,
    fieldE: fieldE === undefined ? undefined : fieldE,
  };
}

function buildSkillPacketProbeStage2Entries(
  skillId: number,
  skillLevel: number,
  skillLevelIndex: number,
  casterEntityId: number,
  targets: Array<{ entityId: number; actionCode: number; value: number }>
): SkillPacketProbeStage2Entry[] {
  const spec = SKILL_PACKET_PROBE_STAGE2_SPEC;
  if (!SKILL_PACKET_PROBE_STAGE2_ENABLED || spec.length === 0) {
    return [];
  }

  const sourceTargets = targets.length > 0 ? targets : [{ entityId: 0, actionCode: 0, value: 0 }];
  const entries: SkillPacketProbeStage2Entry[] = [];
  const specs = spec
    .split(';')
    .map((entrySpec) => entrySpec.trim())
    .filter((entrySpec) => entrySpec.length > 0);

  for (let index = 0; index < specs.length; index += 1) {
    const entrySpec = specs[index];
    const [tokenA = 'zero', tokenB = 'zero', tokenC = 'zero'] = entrySpec
      .split(',')
      .map((token) => token.trim());
    const sourceTarget = sourceTargets[Math.min(index, sourceTargets.length - 1)];
    const context: SkillPacketProbeContext = {
      casterEntityId: casterEntityId >>> 0,
      skillId: skillId >>> 0,
      skillLevel: skillLevel >>> 0,
      skillLevelIndex: skillLevelIndex >>> 0,
      targetCount: targets.length >>> 0,
      targetEntityId: sourceTarget.entityId >>> 0,
      targetEntityIdLow: sourceTarget.entityId & 0xffff,
      targetEntityIdHigh: (sourceTarget.entityId >>> 16) & 0xffff,
      targetActionCode: sourceTarget.actionCode & 0xff,
      targetValue: sourceTarget.value >>> 0,
    };
    entries.push({
      wordA: resolveSkillPacketProbeToken(tokenA, context) & 0xffff,
      wordB: resolveSkillPacketProbeToken(tokenB, context) & 0xffff,
      dwordC: resolveSkillPacketProbeToken(tokenC, context) >>> 0,
    });
  }

  return entries;
}

function buildSkillPacketProbeTargets(
  skillId: number,
  skillLevel: number,
  skillLevelIndex: number,
  casterEntityId: number,
  targets: Array<{ entityId: number; actionCode: number; value: number }>
): Array<{ entityId: number; actionCode: number; value: number }> {
  if (
    SKILL_PACKET_PROBE_TARGET_ENTITY.length === 0 &&
    SKILL_PACKET_PROBE_TARGET_ACTION.length === 0 &&
    SKILL_PACKET_PROBE_TARGET_VALUE.length === 0
  ) {
    return targets;
  }

  return targets.map((target) => {
    const context: SkillPacketProbeContext = {
      casterEntityId: casterEntityId >>> 0,
      skillId: skillId >>> 0,
      skillLevel: skillLevel >>> 0,
      skillLevelIndex: skillLevelIndex >>> 0,
      targetCount: targets.length >>> 0,
      targetEntityId: target.entityId >>> 0,
      targetEntityIdLow: (target.entityId >>> 0) & 0xffff,
      targetEntityIdHigh: ((target.entityId >>> 0) >>> 16) & 0xffff,
      targetActionCode: target.actionCode >>> 0,
      targetValue: target.value >>> 0,
    };
    return {
      entityId: (SKILL_PACKET_PROBE_TARGET_ENTITY.length > 0
        ? resolveSkillPacketProbeToken(SKILL_PACKET_PROBE_TARGET_ENTITY, context)
        : context.targetEntityId) >>> 0,
      actionCode: (SKILL_PACKET_PROBE_TARGET_ACTION.length > 0
        ? resolveSkillPacketProbeToken(SKILL_PACKET_PROBE_TARGET_ACTION, context)
        : context.targetActionCode) & 0xff,
      value: (SKILL_PACKET_PROBE_TARGET_VALUE.length > 0
        ? resolveSkillPacketProbeToken(SKILL_PACKET_PROBE_TARGET_VALUE, context)
        : context.targetValue) >>> 0,
    };
  });
}

function handleCombatPacket(session: SessionLike, cmdWord: number, payload: Buffer): void {
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

  if (
    cmdWord === GAME_FIGHT_ACTION_CMD &&
    payload.length >= 9 &&
    payload[2] === FIGHT_CLIENT_SKILL_USE_SUBCMD
  ) {
    handleCombatSkillUse(session, payload);
    return;
  }

  if (cmdWord === GAME_FIGHT_CLIENT_CMD) {
    appendSkillPacketTrace({
      kind: 'fight-client-unhandled',
      ts: new Date().toISOString(),
      sessionId: session.id,
      cmdWord,
      subcmd: payload.length >= 3 ? payload[2] : -1,
      len: payload.length,
      hex: payload.toString('hex'),
      phase: session.combatState?.phase || 'unknown',
      awaitingPlayerAction: session.combatState?.awaitingPlayerAction === true,
      learnedSkillIds: Array.isArray(session.skillState?.learnedSkills)
        ? session.skillState.learnedSkills.map((entry) => Number(entry?.skillId || 0))
        : [],
      hotbarSkillIds: Array.isArray(session.skillState?.hotbarSkillIds) ? session.skillState.hotbarSkillIds : [],
    });
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

function tryHandleCombatReady(session: SessionLike): boolean {
  if (session.combatState.awaitingClientReady) {
    transitionToCommandPhase(session, 'client-ready');
    return true;
  }

  if (session.combatState.phase === 'enemy-turn') {
    processNextEnemyTurnAttack(session, session.combatState.enemyTurnReason || 'normal');
    return true;
  }

  if (session.combatState.awaitingSkillResolution) {
    finalizeSkillResolutionAndEnemyTurn(session, 'client-ready-event');
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
    awaitingSkillResolution: false,
    skillResolutionStartedAt: 0,
    skillResolutionReason: null,
    pendingSkillOutcomes: null,
    playerStatus: {},
    enemyStatuses: {},
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
  if (session.combatSkillResolutionTimer) {
    clearTimeout(session.combatSkillResolutionTimer);
    session.combatSkillResolutionTimer = null;
  }
}

function sendIntroSequence(session: SessionLike): void {
  const entityId = session.entityType >>> 0;
  sendCombatActionStateReset(session, `intro trigger=${session.combatState.triggerId}`);
  session.writePacket(buildRingOpenPacket(), DEFAULT_FLAGS, `Sending combat ring-open trigger=${session.combatState.triggerId}`);
  session.writePacket(buildStateModePacket(), DEFAULT_FLAGS, `Sending combat mode trigger=${session.combatState.triggerId}`);
  session.writePacket(buildControlInitPacket(), DEFAULT_FLAGS, `Sending combat control init trigger=${session.combatState.triggerId}`);
  session.writePacket(buildActiveStatePacket(entityId), DEFAULT_FLAGS, `Sending combat active state trigger=${session.combatState.triggerId} active=${entityId}`);
  session.writePacket(buildEntityHidePacket(entityId), DEFAULT_FLAGS, `Sending combat entity hide trigger=${session.combatState.triggerId} active=${entityId}`);
  session.writePacket(buildControlShowPacket(entityId), DEFAULT_FLAGS, `Sending combat control show trigger=${session.combatState.triggerId} active=${entityId}`);
}

function sendCommandPrompt(session: SessionLike, reason: string): void {
  const entityId = session.entityType >>> 0;
  const roundStartProbeOptions = buildRoundStartProbeOptions(session.combatState.round, entityId);
  sendCombatActionStateReset(session, `command reason=${reason}`);
  sendSkillStateSync(session, `combat-command-${reason}`);
  session.writePacket(buildRingOpenPacket(), DEFAULT_FLAGS, `Sending combat ring-open refresh reason=${reason}`);
  session.writePacket(
    buildRoundStartPacket(session.combatState.round, entityId, roundStartProbeOptions || {}),
    DEFAULT_FLAGS,
    `Sending combat round start reason=${reason} round=${session.combatState.round} active=${entityId}` +
    `${roundStartProbeOptions ? ` probe=${JSON.stringify(roundStartProbeOptions)}` : ''}`
  );
  appendSkillPacketTrace({
    kind: 'round-start-outbound',
    ts: new Date().toISOString(),
    sessionId: session.id,
    round: session.combatState.round,
    activeEntityId: entityId >>> 0,
    probeEnabled: roundStartProbeOptions !== null,
    probe: roundStartProbeOptions,
  });
  session.writePacket(buildControlShowPacket(entityId), DEFAULT_FLAGS, `Sending combat control refresh reason=${reason} active=${entityId}`);
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

function handleCombatSkillUse(session: SessionLike, payload: Buffer): void {
  const skillId = payload.readUInt16LE(3) & 0xffff;
  const targetEntityId = payload.readUInt32LE(5) >>> 0;
  resolveCombatSkillUse(
    session,
    skillId,
    targetEntityId,
    `cmd=0x${GAME_FIGHT_ACTION_CMD.toString(16)} sub=0x${payload[2].toString(16)}`
  );
}

function resolveCombatSkillUse(
  session: SessionLike,
  skillId: number,
  targetEntityId: number,
  sourceLabel: string
): void {
  if (!session.combatState?.active || !session.combatState.awaitingPlayerAction) {
    session.log(`Ignoring combat skill use without command prompt active=${session.combatState?.active ? 1 : 0}`);
    return;
  }

  const learnedSkill = Array.isArray(session.skillState?.learnedSkills)
    ? session.skillState.learnedSkills.find((entry: Record<string, any>) => (Number(entry?.skillId || 0) >>> 0) === (skillId >>> 0))
    : null;
  if (!learnedSkill) {
    session.log(
      `Combat skill use rejected source=${sourceLabel} skillId=${skillId} targetEntityId=${targetEntityId} reason=not-learned`
    );
    resendCombatCommandPrompt(session, 'skill-rejected-not-learned');
    return;
  }

  const targetEnemies = resolveSkillTargets(session, skillId, targetEntityId);
  session.log(
    `Combat skill request source=${sourceLabel} skillId=${skillId} rawTargetEntityId=${targetEntityId >>> 0} ` +
    `resolvedTargets=${targetEnemies.map((enemy) => `${enemy.entityId}[${enemy.row},${enemy.col}]`).join('|') || 'none'} ` +
    `roster=${describeEnemyRoster(session.combatState?.enemies)}`
  );
  if (targetEnemies.length <= 0) {
    session.log(
      `Combat skill use rejected source=${sourceLabel} skillId=${skillId} targetEntityId=${targetEntityId} reason=missing-target`
    );
    resendCombatCommandPrompt(session, 'skill-rejected-missing-target');
    return;
  }
  const primaryTarget = targetEnemies[0];

  const skillLevel = Math.max(1, Math.min(12, Number(learnedSkill?.level || 1) || 1));
  const manaCost = resolveSkillManaCost(skillId, skillLevel);
  if ((session.currentMana || 0) < manaCost) {
    session.log(
      `Combat skill use rejected source=${sourceLabel} skillId=${skillId} targetEntityId=${targetEntityId} reason=insufficient-mana currentMana=${session.currentMana || 0} cost=${manaCost}`
    );
    resendCombatCommandPrompt(session, 'skill-rejected-mana');
    return;
  }

  session.combatState.awaitingPlayerAction = false;
  session.combatState.phase = 'resolved';
  session.currentMana = Math.max(0, (session.currentMana || 0) - manaCost);

  if ((skillId >>> 0) === 3103) {
    sendCombatSkillCastPlayback(session, skillId, skillLevel, [{
      entityId: primaryTarget.entityId >>> 0,
      actionCode: 0,
      value: 0,
    }]);
    const durationRounds = resolveDefiantDuration(skillLevel);
    const defenseBonusPercent = DEFIANT_DEFENSE_BONUS_BY_LEVEL[Math.max(0, skillLevel - 1)] || 20;
    session.combatState.playerStatus = {
      ...session.combatState.playerStatus,
      defiantRoundsRemaining: durationRounds,
      defiantDefenseBonusPercent: defenseBonusPercent,
      defiantAttackPenaltyPercent: 10,
    };
    session.log(
      `Combat skill use ok source=${sourceLabel} skillId=${skillId} targetEntityId=${primaryTarget.entityId} effect=defiant manaCost=${manaCost} rounds=${durationRounds} defenseBonus=${defenseBonusPercent}`
    );
    session.combatState.pendingSkillOutcomes = null;
    queuePostSkillEnemyResponse(session);
    return;
  }

  const castTargets: Array<{ entityId: number; actionCode: number; value: number }> = [];
  const pendingOutcomes: Array<{ skillId: number; targetEntityId: number; playerDamage: number; targetDied: boolean }> = [];
  let totalAppliedDamage = 0;
  for (const targetEnemy of targetEnemies) {
    const playerDamage = computeSkillDamage(session, skillId, skillLevel, targetEnemy);
    const appliedPlayerDamage = Math.max(0, Math.min(targetEnemy.hp, playerDamage));
    targetEnemy.hp = Math.max(0, targetEnemy.hp - playerDamage);
    const targetDied = targetEnemy.hp <= 0;
    totalAppliedDamage += appliedPlayerDamage;
    castTargets.push({
      entityId: targetEnemy.entityId >>> 0,
      actionCode: targetDied ? 3 : 1,
      value: Math.max(1, playerDamage || 1),
    });
    pendingOutcomes.push({
      skillId,
      targetEntityId: targetEnemy.entityId >>> 0,
      playerDamage: Math.max(1, playerDamage || 1),
      targetDied,
    });
    if ((skillId >>> 0) === 1101) {
      session.combatState.enemyStatuses[targetEnemy.entityId >>> 0] = {
        enervateRoundsRemaining: resolveEnervateDuration(skillLevel),
        enervateAttackPenaltyPercent: resolveEnervateAttackPenalty(skillLevel),
      };
    }
  }
  sendCombatSkillCastPlayback(session, skillId, skillLevel, castTargets);
  session.combatState.damageDealt = Math.max(0, (session.combatState.damageDealt || 0) + totalAppliedDamage);
  session.log(
    `Combat skill use ok source=${sourceLabel} skillId=${skillId} targetCount=${pendingOutcomes.length} manaCost=${manaCost} totalDamage=${totalAppliedDamage} remaining=${describeLivingEnemies(session.combatState.enemies)}`
  );
  session.combatState.pendingSkillOutcomes = pendingOutcomes;
  queuePostSkillEnemyResponse(session);
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

function queuePostSkillEnemyResponse(session: SessionLike): void {
  if (!session.combatState?.active) {
    return;
  }
  session.combatState.awaitingSkillResolution = true;
  session.combatState.skillResolutionStartedAt = Date.now();
  session.combatState.skillResolutionReason = 'skill-post-resolution';
  if (session.combatSkillResolutionTimer) {
    clearTimeout(session.combatSkillResolutionTimer);
    session.combatSkillResolutionTimer = null;
  }
  session.log('Waiting for skill resolution client-ready event before enemy response');
}

function finalizeSkillResolutionAndEnemyTurn(session: SessionLike, source: string): void {
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

  if (SKILL_PACKET_HYBRID_IMPACT_ENABLED) {
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

function sendCombatActionStateReset(session: SessionLike, reason: string): void {
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

function sendCombatSkillCastPlayback(
  session: SessionLike,
  skillId: number,
  skillLevel: number,
  targets: Array<{ entityId: number; actionCode: number; value: number }>
): void {
  const skillLevelIndex = Math.max(1, Math.min(12, skillLevel));
  const probedTargets = buildSkillPacketProbeTargets(
    skillId >>> 0,
    skillLevel >>> 0,
    skillLevelIndex,
    session.entityType >>> 0,
    targets
  );
  const stage2Entries = buildSkillPacketProbeStage2Entries(
    skillId >>> 0,
    skillLevel >>> 0,
    skillLevelIndex,
    session.entityType >>> 0,
    probedTargets
  );
  const packet = buildSkillCastPlaybackPacket(
    session.entityType >>> 0,
    skillId >>> 0,
    skillLevelIndex,
    probedTargets,
    SKILL_PACKET_PROBE_STAGE2_ENABLED
      ? {
          stage2Flag: SKILL_PACKET_PROBE_STAGE2_FLAG,
          stage2Entries,
        }
      : {}
  );
  appendSkillPacketTrace({
    kind: 'skill-cast-outbound',
    ts: new Date().toISOString(),
    sessionId: session.id,
    skillId: skillId >>> 0,
    skillLevel: skillLevel >>> 0,
    skillLevelIndex,
    stage2Enabled: SKILL_PACKET_PROBE_STAGE2_ENABLED,
    stage2Flag: SKILL_PACKET_PROBE_STAGE2_ENABLED ? (SKILL_PACKET_PROBE_STAGE2_FLAG & 0xff) : null,
    stage2Spec: SKILL_PACKET_PROBE_STAGE2_ENABLED ? SKILL_PACKET_PROBE_STAGE2_SPEC : '',
    targetProbe: {
      entity: SKILL_PACKET_PROBE_TARGET_ENTITY,
      action: SKILL_PACKET_PROBE_TARGET_ACTION,
      value: SKILL_PACKET_PROBE_TARGET_VALUE,
    },
    stage2Entries,
    targets: probedTargets,
    packetHex: packet.toString('hex'),
  });
  session.writePacket(
    packet,
    DEFAULT_FLAGS,
    `Sending combat skill cast attacker=${session.entityType} skillId=${skillId} levelIndex=${skillLevelIndex} targets=${probedTargets.map((target) => `${target.entityId}:${target.actionCode}:${target.value}`).join('|') || 'none'} stage2=${SKILL_PACKET_PROBE_STAGE2_ENABLED ? `${SKILL_PACKET_PROBE_STAGE2_FLAG}:${stage2Entries.map((entry) => `${entry.wordA}/${entry.wordB}/${entry.dwordC}`).join('|') || 'none'}` : 'off'}`
  );
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
  tickCombatStatuses(session);

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

function resolveSkillTargets(session: SessionLike, skillId: number, targetEntityId: number): CombatEnemyInstance[] {
  const living = listLivingEnemies(session.combatState?.enemies);
  if (living.length <= 0) {
    return [];
  }
  if ((targetEntityId >>> 0) === MULTI_TARGET_ENTITY_SENTINEL || MULTI_TARGET_SKILL_IDS.has(skillId >>> 0)) {
    return living;
  }
  const explicitTarget = findEnemyByEntityId(session.combatState?.enemies, targetEntityId >>> 0);
  if (explicitTarget && explicitTarget.hp > 0) {
    return [explicitTarget];
  }
  return [];
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

function describeEnemyRoster(enemies: CombatEnemyInstance[] | null | undefined): string {
  if (!Array.isArray(enemies)) {
    return 'none';
  }
  return enemies
    .map((enemy) => `${enemy.entityId}[${enemy.row},${enemy.col}]type=${enemy.typeId}hp=${enemy.hp}/${enemy.maxHp}`)
    .join('|');
}

function buildPlayerEntry(session: SessionLike): Record<string, any> {
  const appearance = getCombatAppearanceProfile(session);
  session.log(
    `Combat player appearance entry types=${appearance.appearanceTypes.join('/')} variants=${appearance.appearanceVariants.join('/')} ${describeCombatAppearanceProfile(session)}`
  );
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
    appearanceTypes: appearance.appearanceTypes,
    appearanceVariants: appearance.appearanceVariants,
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
  const defiantPenalty = Math.max(0, Math.min(90, session.combatState?.playerStatus?.defiantAttackPenaltyPercent || 0));
  const adjustedBase = Math.round(base * (1 - (defiantPenalty / 100)));
  return Math.max(1, adjustedBase + Math.floor(Math.random() * Math.max(1, spread)) - mitigation);
}

function readExplicitCharacterAttackRange(session: SessionLike): { min: number; max: number } | null {
  const candidates: Array<{ min: number; max: number }> = [];
  const hasDirect = session?.characterAttackMin != null && session?.characterAttackMax != null;
  const directMin = hasDirect ? Number(session?.characterAttackMin) : NaN;
  const directMax = hasDirect ? Number(session?.characterAttackMax) : NaN;
  if (Number.isFinite(directMin) && Number.isFinite(directMax) && directMin > 0 && directMax > 0) {
    candidates.push({ min: directMin, max: directMax });
  }
  const hasAlt = session?.attackMin != null && session?.attackMax != null;
  const altMin = hasAlt ? Number(session?.attackMin) : NaN;
  const altMax = hasAlt ? Number(session?.attackMax) : NaN;
  if (Number.isFinite(altMin) && Number.isFinite(altMax) && altMin > 0 && altMax > 0) {
    candidates.push({ min: altMin, max: altMax });
  }
  const persisted = session?.persistedCharacter && typeof session.persistedCharacter === 'object'
    ? session.persistedCharacter
    : {};
  const persistedAttackMin = (persisted as Record<string, unknown>)?.attackMin;
  const persistedAttackMax = (persisted as Record<string, unknown>)?.attackMax;
  const hasPersisted = persistedAttackMin != null && persistedAttackMax != null;
  const persistedMin = hasPersisted ? Number(persistedAttackMin) : NaN;
  const persistedMax = hasPersisted ? Number(persistedAttackMax) : NaN;
  if (Number.isFinite(persistedMin) && Number.isFinite(persistedMax) && persistedMin > 0 && persistedMax > 0) {
    candidates.push({ min: persistedMin, max: persistedMax });
  }
  for (const candidate of candidates) {
    const min = Math.max(1, Math.round(candidate.min));
    const max = Math.max(min, Math.round(candidate.max));
    if (max >= min) {
      return { min, max };
    }
  }
  return null;
}

function resolvePlayerAttackRange(session: SessionLike): { min: number; max: number } {
  const explicitRange = readExplicitCharacterAttackRange(session);
  if (explicitRange) {
    return explicitRange;
  }
  const stats = session.primaryAttributes || {};
  const equipment = getEquipmentCombatBonuses(session);
  const weaponMin = Math.max(0, equipment.attackMin || 0);
  const weaponMax = Math.max(weaponMin, equipment.attackMax || weaponMin);
  const strength = Math.max(0, stats.strength || 0);
  const dexterity = Math.max(0, stats.dexterity || 0);
  const level = Math.max(1, session.level || 1);
  // This range tracks the client-facing ATK panel more closely than per-hit combat roll math.
  const base = weaponMin + (strength * 4) + level;
  const spread = Math.max(1, (weaponMax - weaponMin) + Math.floor(dexterity / 6));
  const defiantPenalty = Math.max(0, Math.min(90, session.combatState?.playerStatus?.defiantAttackPenaltyPercent || 0));
  const adjustedBase = Math.max(1, Math.round(base * (1 - (defiantPenalty / 100))));
  const adjustedMin = adjustedBase;
  const adjustedMax = Math.max(adjustedMin, adjustedBase + spread);
  return { min: adjustedMin, max: adjustedMax };
}

function computeEnemyDamage(session: SessionLike, enemy: Record<string, any>): number {
  const stats = session.primaryAttributes || {};
  const equipment = getEquipmentCombatBonuses(session);
  const defenseBonusPercent = Math.max(0, Math.min(90, session.combatState?.playerStatus?.defiantDefenseBonusPercent || 0));
  const defense = Math.floor(
    ((stats.vitality || 0) * 0.8) +
    ((stats.dexterity || 0) * 0.4) +
    (session.level || 1) +
    Math.max(0, equipment.defense || 0)
  );
  const adjustedDefense = Math.round(defense * (1 + (defenseBonusPercent / 100)));
  const base = 6 + ((enemy.level || 1) * 3) + (enemy.aptitude || 0);
  const enervatePenalty = Math.max(0, Math.min(90, session.combatState?.enemyStatuses?.[enemy?.entityId >>> 0]?.enervateAttackPenaltyPercent || 0));
  const adjustedBase = Math.round(base * (1 - (enervatePenalty / 100)));
  return Math.max(1, adjustedBase + Math.floor(Math.random() * 5) - adjustedDefense);
}

function computeSkillDamage(session: SessionLike, skillId: number, skillLevel: number, enemy: Record<string, any>): number {
  if ((skillId >>> 0) === 1101) {
    const attackRange = resolvePlayerAttackRange(session);
    const attackMin = Math.max(1, attackRange.min || 0);
    const attackMax = Math.max(attackMin, attackRange.max || attackMin);
    const scaleMin = ENERVATE_DAMAGE_SCALE_MIN_BY_LEVEL[Math.max(0, skillLevel - 1)] || ENERVATE_DAMAGE_SCALE_MIN_BY_LEVEL[0];
    const scaleMax = ENERVATE_DAMAGE_SCALE_MAX_BY_LEVEL[Math.max(0, skillLevel - 1)] || ENERVATE_DAMAGE_SCALE_MAX_BY_LEVEL[0];
    const scaledMin = Math.max(1, Math.round(attackMin * scaleMin));
    const scaledMax = Math.max(scaledMin, Math.round(attackMax * scaleMax));
    const baseDamage = scaledMin + Math.floor(Math.random() * Math.max(1, (scaledMax - scaledMin) + 1));
    const mitigation = Math.floor(((enemy.level || 1) * 2) + (enemy.aptitude || 0));
    return Math.max(1, baseDamage - mitigation);
  }
  return computePlayerDamage(session, enemy);
}

function resolveSkillManaCost(skillId: number, skillLevel: number): number {
  if ((skillId >>> 0) === 3103) {
    return DEFIANT_MP_COST_BY_LEVEL[Math.max(0, skillLevel - 1)] || DEFIANT_MP_COST_BY_LEVEL[0];
  }
  if ((skillId >>> 0) === 1101) {
    return ENERVATE_MP_COST_BY_LEVEL[Math.max(0, skillLevel - 1)] || ENERVATE_MP_COST_BY_LEVEL[0];
  }
  return 0;
}

function resolveDefiantDuration(skillLevel: number): number {
  if (skillLevel >= 10) {
    return 6;
  }
  if (skillLevel >= 7) {
    return 5;
  }
  if (skillLevel >= 4) {
    return 4;
  }
  return 3;
}

function resolveEnervateDuration(skillLevel: number): number {
  return skillLevel >= 8 ? 3 : 2;
}

function resolveEnervateAttackPenalty(skillLevel: number): number {
  return Math.min(40, 18 + ((Math.max(1, skillLevel) - 1) * 2));
}

function tickCombatStatuses(session: SessionLike): void {
  const nextPlayerStatus: Record<string, any> = { ...(session.combatState?.playerStatus || {}) };
  if ((nextPlayerStatus.defiantRoundsRemaining || 0) > 0) {
    nextPlayerStatus.defiantRoundsRemaining = Math.max(0, (nextPlayerStatus.defiantRoundsRemaining || 0) - 1);
    if ((nextPlayerStatus.defiantRoundsRemaining || 0) <= 0) {
      delete nextPlayerStatus.defiantRoundsRemaining;
      delete nextPlayerStatus.defiantDefenseBonusPercent;
      delete nextPlayerStatus.defiantAttackPenaltyPercent;
    }
  }
  session.combatState.playerStatus = nextPlayerStatus;

  const nextEnemyStatuses: Record<number, Record<string, any>> = {};
  for (const [rawEntityId, status] of Object.entries(session.combatState?.enemyStatuses || {})) {
    const nextStatus: Record<string, any> = { ...(status || {}) };
    if ((nextStatus.enervateRoundsRemaining || 0) > 0) {
      nextStatus.enervateRoundsRemaining = Math.max(0, (nextStatus.enervateRoundsRemaining || 0) - 1);
    }
    if ((nextStatus.enervateRoundsRemaining || 0) > 0) {
      nextEnemyStatuses[Number(rawEntityId) >>> 0] = nextStatus;
    }
  }
  session.combatState.enemyStatuses = nextEnemyStatuses;
}

module.exports = {
  createIdleCombatState,
  disposeCombatTimers,
  handleCombatPacket,
  sendCombatEncounterProbe,
  sendCombatExitProbe,
};
