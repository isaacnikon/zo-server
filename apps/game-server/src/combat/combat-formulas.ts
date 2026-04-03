import type { CombatEnemyInstance, CombatState, GameSession } from '../types.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getEquipmentCombatBonuses } from '../inventory/index.js';
import { resolveSkillManaCostFromDefinition } from '../gameplay/skill-definitions.js';
import { getSkillDefinition } from '../gameplay/skill-definitions.js';
import { resolveEffectiveSkillLevel } from '../gameplay/skill-runtime.js';
import { resolveRepoPath } from '../runtime-paths.js';


// --- Constants ---
export const CAPTURE_ELEMENT_CODE_MIN = 1;
export const CAPTURE_ELEMENT_CODE_MAX = 4;
export const FIGHT_CLIENT_SKILL_USE_SUBCMD = 0x04;
export const SKILL_PACKET_TRACE_PATH = resolveRepoPath('data', 'runtime', 'skill-packet-trace.jsonl');
export const ENERVATE_SKILL_ID = 1101;
export const BLEED_SKILL_ID = 1103;
export const BLOOD_DRAIN_SKILL_ID = 1402;
export const CONFUSE_SKILL_ID = 1203;
export const UTMOST_STRIKE_SKILL_ID = 1301;
export const SLAUGHTER_SKILL_ID = 1403;
export const DEFIANT_SKILL_ID = 3103;
export const SLOW_DOWN_SKILL_ID = 2401;
export const CONCEAL_SKILL_ID = 2303;
export const PUZZLE_SKILL_ID = 2202;
export const DEDICATE_SKILL_ID = 2301;
export const DISPEL_SKILL_ID = 3303;
export const SOUL_FIRE_SKILL_ID = 3202;
export const LIONS_ROAR_SKILL_ID = 3203;
export const PET_HEALING_SKILL_ID = 3101;
export const DIVINE_BLESS_SKILL_ID = 3301;
export const REVIVE_SKILL_ID = 3302;
export const HASTE_SKILL_ID = 3401;
export const STUN_SKILL_ID = 3402;
export const SACRIFICE_SKILL_ID = 3403;
export const COUNTERATTACK_SKILL_ID = 2203;
export const FIREBALL_SKILL_ID = 4101;
export const FROST_BOLT_SKILL_ID = 4102;
export const CURE_SKILL_ID = 4103;
export const REGENERATE_SKILL_ID = 4201;
export const CRASH_SKILL_ID = 4203;
export const SEAL_SKILL_ID = 4301;
export const HYPNOSIS_SKILL_ID = 4302;
export const BLIZZARD_SKILL_ID = 4402;
export const GOSPEL_SKILL_ID = 4403;
export const DEFIANT_DEFENSE_BONUS_BY_LEVEL = [20, 20, 20, 20, 20, 30, 32, 34, 36, 48, 75, 75];
export const ENERVATE_DAMAGE_SCALE_MIN_BY_LEVEL = [1.12, 1.122, 1.124, 1.126, 1.128, 1.13, 1.132, 1.134, 1.136, 1.138, 1.16, 1.2];
export const ENERVATE_DAMAGE_SCALE_MAX_BY_LEVEL = [1.13, 1.132, 1.134, 1.136, 1.138, 1.14, 1.142, 1.144, 1.146, 1.148, 1.18, 1.22];
export const FIREBALL_DAMAGE_SCALE_MIN_BY_LEVEL = [1.18, 1.2, 1.22, 1.24, 1.26, 1.28, 1.3, 1.32, 1.34, 1.36, 1.4, 1.46];
export const FIREBALL_DAMAGE_SCALE_MAX_BY_LEVEL = [1.28, 1.3, 1.32, 1.34, 1.36, 1.38, 1.4, 1.42, 1.44, 1.46, 1.52, 1.58];
export const BLIZZARD_DAMAGE_SCALE_MIN_BY_LEVEL = [1, 1, 1, 1, 1, 1.02, 1.02, 1.02, 1.02, 1.04, 1.06, 1.08];
export const BLIZZARD_DAMAGE_SCALE_MAX_BY_LEVEL = [1, 1, 1, 1, 1, 1.04, 1.04, 1.04, 1.04, 1.08, 1.12, 1.16];
export const SLAUGHTER_DAMAGE_SCALE_MIN_BY_LEVEL = [1.68, 1.69, 1.7, 1.71, 1.72, 1.73, 1.74, 1.75, 1.76, 1.78, 1.8, 1.83];
export const SLAUGHTER_DAMAGE_SCALE_MAX_BY_LEVEL = [1.74, 1.75, 1.76, 1.77, 1.78, 1.79, 1.8, 1.81, 1.82, 1.835, 1.85, 1.85];
export const FIREBALL_EXPLOSION_CHANCE = 0.1;
export const SLAUGHTER_CONCENTRATION_CHANCE = 0.1;
export const CURE_HEAL_SCALE_BY_LEVEL = [1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.55, 1.6, 1.68, 1.76];
export const MULTI_TARGET_ENTITY_SENTINEL = 0xffffffff;
export const MULTI_TARGET_SKILL_IDS = new Set<number>([]);
export const SKILL_PACKET_HYBRID_IMPACT_ENABLED = /^(1|true|yes)$/i.test(process.env.SKILL_PACKET_HYBRID_IMPACT_ENABLED || '');
export const SKILL_PACKET_PROBE_STAGE2_ENABLED = /^(1|true|yes)$/i.test(process.env.SKILL_PACKET_PROBE_STAGE2_ENABLED || '');
export const SKILL_PACKET_PROBE_STAGE2_FLAG = Number.isFinite(Number(process.env.SKILL_PACKET_PROBE_STAGE2_FLAG))
  ? Number(process.env.SKILL_PACKET_PROBE_STAGE2_FLAG)
  : 0;
export const SKILL_PACKET_PROBE_STAGE2_SPEC = String(process.env.SKILL_PACKET_PROBE_STAGE2_SPEC || '').trim();
export const SKILL_PACKET_PROBE_TARGET_ENTITY = String(process.env.SKILL_PACKET_PROBE_TARGET_ENTITY || '').trim();
export const SKILL_PACKET_PROBE_TARGET_ACTION = String(process.env.SKILL_PACKET_PROBE_TARGET_ACTION || '').trim();
export const SKILL_PACKET_PROBE_TARGET_VALUE = String(process.env.SKILL_PACKET_PROBE_TARGET_VALUE || '').trim();
export const ROUND_START_PROBE_ENABLED = /^(1|true|yes)$/i.test(process.env.ROUND_START_PROBE_ENABLED || '');
export const ROUND_START_PROBE_FIELD_B = String(process.env.ROUND_START_PROBE_FIELD_B || '').trim();
export const ROUND_START_PROBE_FIELD_C = String(process.env.ROUND_START_PROBE_FIELD_C || '').trim();
export const ROUND_START_PROBE_FIELD_D = String(process.env.ROUND_START_PROBE_FIELD_D || '').trim();
export const ROUND_START_PROBE_FIELD_E = String(process.env.ROUND_START_PROBE_FIELD_E || '').trim();
export const ROUND_START_PROBE_FIELD_A = String(process.env.ROUND_START_PROBE_FIELD_A || '').trim();
export const SLAUGHTER_PACKET_SKILL_ID_OVERRIDE = Number.isFinite(Number(process.env.SLAUGHTER_PACKET_SKILL_ID_OVERRIDE))
  ? (Number(process.env.SLAUGHTER_PACKET_SKILL_ID_OVERRIDE) >>> 0)
  : 0;
export const SLAUGHTER_PACKET_STAGE2_ENABLED = /^(1|true|yes)$/i.test(process.env.SLAUGHTER_PACKET_STAGE2_ENABLED || '');
export const SLAUGHTER_PACKET_STAGE2_FLAG = Number.isFinite(Number(process.env.SLAUGHTER_PACKET_STAGE2_FLAG))
  ? Number(process.env.SLAUGHTER_PACKET_STAGE2_FLAG)
  : 0;
export const SLAUGHTER_PACKET_STAGE2_SPEC = String(process.env.SLAUGHTER_PACKET_STAGE2_SPEC || '').trim();

// --- Types ---
export type SkillPacketProbeContext = {
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
export type SkillPacketProbeStage2Entry = {
  wordA: number;
  wordB: number;
  dwordC: number;
};
export type RoundStartProbeOptions = {
  fieldA?: number;
  fieldB?: number;
  fieldC?: number;
  fieldD?: number;
  fieldE?: number | null;
};
export type CombatPartySlot = {
  row: number;
  col: number;
};
export type EnemyTurnReason = 'normal' | 'post-kill';

// --- Functions ---

export function createIdleCombatState(): CombatState {
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
    skillResolutionPhase: null,
    pendingSkillOutcomes: null,
    pendingSkillContext: null,
    pendingCounterattack: null,
    pendingActionResolution: null,
    sharedActionSequenceToken: null,
    sharedRoundEntries: null,
    sharedRoundIndex: null,
    sharedAwaitingActionReady: false,
    sharedAwaitingReadySessionId: null,
    commandReadyFallbackToken: null,
    commandReadyFallbackRound: null,
    selectorToken: null,
    selectorTokenSource: null,
    playerStatus: {},
    enemyStatuses: {},
  };
}

export function rollCapturedMonsterElementCode(): number {
  const span = (CAPTURE_ELEMENT_CODE_MAX - CAPTURE_ELEMENT_CODE_MIN) + 1;
  return CAPTURE_ELEMENT_CODE_MIN + Math.floor(Math.random() * Math.max(1, span));
}

export function appendSkillPacketTrace(event: Record<string, unknown>): void {
  mkdirSync(dirname(SKILL_PACKET_TRACE_PATH), { recursive: true });
  appendFileSync(SKILL_PACKET_TRACE_PATH, `${JSON.stringify(event)}\n`, 'utf8');
}

export function resolveSkillPacketProbeToken(token: string, context: SkillPacketProbeContext): number {
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

export function resolveRoundStartProbeToken(
  token: string,
  context: { round: number; activeEntityId: number; selectorToken: number }
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
    case 'selector':
    case 'selectorToken':
      return context.selectorToken >>> 0;
    case 'one':
      return 1;
    case 'zero':
      return 0;
    default:
      return undefined;
  }
}

export function buildRoundStartProbeOptions(
  round: number,
  activeEntityId: number,
  selectorToken?: number | null
): RoundStartProbeOptions | null {
  if (!ROUND_START_PROBE_ENABLED) {
    return null;
  }
  const resolvedSelectorToken =
    Number.isFinite(selectorToken) && (selectorToken || 0) >= 0
      ? ((selectorToken as number) >>> 0)
      : 1;
  const context = {
    round: Math.max(1, round) & 0xffff,
    activeEntityId: activeEntityId >>> 0,
    selectorToken: resolvedSelectorToken,
  };
  const fieldA = resolveRoundStartProbeToken(ROUND_START_PROBE_FIELD_A, context);
  const fieldB = resolveRoundStartProbeToken(ROUND_START_PROBE_FIELD_B, context);
  const fieldC = resolveRoundStartProbeToken(ROUND_START_PROBE_FIELD_C, context);
  const fieldD = resolveRoundStartProbeToken(ROUND_START_PROBE_FIELD_D, context);
  const fieldE = resolveRoundStartProbeToken(ROUND_START_PROBE_FIELD_E, context);
  return {
    fieldA: fieldA === undefined ? context.round : fieldA,
    fieldB: fieldB === undefined ? context.selectorToken : fieldB,
    fieldC,
    fieldD,
    fieldE: fieldE === undefined ? undefined : fieldE,
  };
}

export function buildSkillPacketProbeStage2Entries(
  skillId: number,
  skillLevel: number,
  skillLevelIndex: number,
  casterEntityId: number,
  targets: Array<{ entityId: number; actionCode: number; value: number }>
): SkillPacketProbeStage2Entry[] {
  return buildSkillPacketProbeStage2EntriesForSpec(
    SKILL_PACKET_PROBE_STAGE2_SPEC,
    skillId,
    skillLevel,
    skillLevelIndex,
    casterEntityId,
    targets
  );
}

export function buildSkillPacketProbeStage2EntriesForSpec(
  spec: string,
  skillId: number,
  skillLevel: number,
  skillLevelIndex: number,
  casterEntityId: number,
  targets: Array<{ entityId: number; actionCode: number; value: number }>
): SkillPacketProbeStage2Entry[] {
  if (String(spec || '').trim().length === 0) {
    return [];
  }

  const sourceTargets = targets.length > 0 ? targets : [{ entityId: 0, actionCode: 0, value: 0 }];
  const entries: SkillPacketProbeStage2Entry[] = [];
  const specs = String(spec)
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

export function buildSkillPacketProbeTargets(
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

export function findFirstLivingEnemy(enemies: CombatEnemyInstance[] | null | undefined): CombatEnemyInstance | null {
  if (!Array.isArray(enemies)) {
    return null;
  }
  return enemies.find((enemy) => enemy && (enemy.hp || 0) > 0) || null;
}

export function resolveCaptureTargetEnemy(session: GameSession, targetEntityId: number): CombatEnemyInstance | null {
  const explicitTarget = findEnemyByEntityId(session.combatState?.enemies, targetEntityId >>> 0);
  if (explicitTarget && explicitTarget.hp > 0) {
    return explicitTarget;
  }
  const living = listLivingEnemies(session.combatState?.enemies);
  return living.length === 1 ? living[0] : null;
}

export function resolveSkillTargets(
  session: GameSession,
  skillId: number,
  targetEntityId: number,
  skillLevel = 1,
  options: {
    strictTargetLock?: boolean;
  } = {}
): CombatEnemyInstance[] {
  if ((skillId >>> 0) === CURE_SKILL_ID) {
    return [];
  }
  if ((skillId >>> 0) === FIREBALL_SKILL_ID) {
    const explicitTarget = findEnemyByEntityId(session.combatState?.enemies, targetEntityId >>> 0);
    if (options.strictTargetLock === true && (!explicitTarget || explicitTarget.hp <= 0)) {
      const fallbackTarget = pickRandomLivingEnemy(session.combatState?.enemies);
      return fallbackTarget ? resolveFireballTargets(session, fallbackTarget.entityId >>> 0) : [];
    }
    return resolveFireballTargets(session, targetEntityId);
  }
  if ((skillId >>> 0) === BLIZZARD_SKILL_ID) {
    const explicitTarget = findEnemyByEntityId(session.combatState?.enemies, targetEntityId >>> 0);
    if (options.strictTargetLock === true && (!explicitTarget || explicitTarget.hp <= 0)) {
      const fallbackTarget = pickRandomLivingEnemy(session.combatState?.enemies);
      return fallbackTarget ? resolveBlizzardTargets(session, fallbackTarget.entityId >>> 0, skillLevel) : [];
    }
    return resolveBlizzardTargets(session, targetEntityId, skillLevel);
  }
  if ((skillId >>> 0) === SLAUGHTER_SKILL_ID) {
    const explicitTarget = findEnemyByEntityId(session.combatState?.enemies, targetEntityId >>> 0);
    if (options.strictTargetLock === true && (!explicitTarget || explicitTarget.hp <= 0)) {
      const fallbackTarget = pickRandomLivingEnemy(session.combatState?.enemies);
      return fallbackTarget ? resolveSlaughterTargets(session, fallbackTarget.entityId >>> 0, skillLevel) : [];
    }
    return resolveSlaughterTargets(session, targetEntityId, skillLevel);
  }
  const living = listLivingEnemies(session.combatState?.enemies);
  if (living.length <= 0) {
    return [];
  }
  const definition = getSkillDefinition(skillId >>> 0);
  const hintedTargetCount = Math.max(1, Math.min(living.length, Number(definition?.maxTargetsHint || 1) || 1));
  if ((targetEntityId >>> 0) === MULTI_TARGET_ENTITY_SENTINEL || MULTI_TARGET_SKILL_IDS.has(skillId >>> 0)) {
    return living;
  }
  const explicitTarget = findEnemyByEntityId(session.combatState?.enemies, targetEntityId >>> 0);
  if (explicitTarget && explicitTarget.hp > 0) {
    if (hintedTargetCount > 1) {
      return resolveGenericHintedTargets(living, explicitTarget, hintedTargetCount, definition?.targetPatternHint || null);
    }
    return [explicitTarget];
  }
  if (options.strictTargetLock === true) {
    const fallbackTarget = pickRandomLivingEnemy(session.combatState?.enemies);
    if (!fallbackTarget) {
      return [];
    }
    if (hintedTargetCount > 1) {
      return resolveGenericHintedTargets(living, fallbackTarget, hintedTargetCount, definition?.targetPatternHint || null);
    }
    return [fallbackTarget];
  }
  return [];
}

function resolveGenericHintedTargets(
  living: CombatEnemyInstance[],
  primaryTarget: CombatEnemyInstance,
  targetCount: number,
  pattern: string | null
): CombatEnemyInstance[] {
  if (targetCount <= 1) {
    return [primaryTarget];
  }

  const remaining = living.filter((enemy) => enemy.entityId !== primaryTarget.entityId);
  if (pattern === 'all') {
    return [primaryTarget, ...remaining];
  }

  const sorted = remaining.sort((a, b) => {
    if (pattern === 'line') {
      const sameRowA = a.row === primaryTarget.row ? 0 : 1;
      const sameRowB = b.row === primaryTarget.row ? 0 : 1;
      if (sameRowA !== sameRowB) {
        return sameRowA - sameRowB;
      }
    }
    const distanceA = Math.abs((a.row || 0) - (primaryTarget.row || 0)) + Math.abs((a.col || 0) - (primaryTarget.col || 0));
    const distanceB = Math.abs((b.row || 0) - (primaryTarget.row || 0)) + Math.abs((b.col || 0) - (primaryTarget.col || 0));
    if (distanceA !== distanceB) {
      return distanceA - distanceB;
    }
    return (a.entityId >>> 0) - (b.entityId >>> 0);
  });

  return [primaryTarget, ...sorted.slice(0, Math.max(0, targetCount - 1))];
}

export function resolveFireballTargets(session: GameSession, targetEntityId: number): CombatEnemyInstance[] {
  const primaryTarget = findEnemyByEntityId(session.combatState?.enemies, targetEntityId >>> 0);
  if (!primaryTarget || primaryTarget.hp <= 0) {
    return [];
  }

  if (Math.random() >= FIREBALL_EXPLOSION_CHANCE) {
    return [primaryTarget];
  }

  const adjacentTargets = listLivingEnemies(session.combatState?.enemies)
    .filter((enemy) =>
      enemy.entityId !== primaryTarget.entityId &&
      enemy.row === primaryTarget.row &&
      Math.abs((enemy.col || 0) - (primaryTarget.col || 0)) === 1
    )
    .sort((a, b) => a.col - b.col);

  return [primaryTarget, ...adjacentTargets];
}

export function resolveBlizzardTargetCount(skillLevel: number): number {
  const normalizedLevel = Math.max(1, Math.min(12, skillLevel | 0));
  if (normalizedLevel <= 1) {
    return 1;
  }
  if (normalizedLevel <= 5) {
    return 2;
  }
  if (normalizedLevel <= 9) {
    return 3;
  }
  return 4;
}

export function resolveBlizzardTargets(
  session: GameSession,
  targetEntityId: number,
  skillLevel: number
): CombatEnemyInstance[] {
  const living = listLivingEnemies(session.combatState?.enemies);
  if (living.length <= 0) {
    return [];
  }

  const primaryTarget = findEnemyByEntityId(session.combatState?.enemies, targetEntityId >>> 0);
  if (!primaryTarget || primaryTarget.hp <= 0) {
    return [];
  }

  const targetCount = Math.max(1, Math.min(living.length, resolveBlizzardTargetCount(skillLevel)));
  if (targetCount <= 1) {
    return [primaryTarget];
  }

  return resolveGenericHintedTargets(living, primaryTarget, targetCount, 'multi');
}

export function resolveSlaughterTargetCount(skillLevel: number): number {
  const normalizedLevel = Math.max(1, Math.min(12, skillLevel | 0));
  if (normalizedLevel <= 1) {
    return 1;
  }
  if (normalizedLevel === 2) {
    return 2;
  }
  return 3;
}

export function resolveSlaughterTargets(
  session: GameSession,
  targetEntityId: number,
  skillLevel: number
): CombatEnemyInstance[] {
  const living = listLivingEnemies(session.combatState?.enemies);
  if (living.length <= 0) {
    return [];
  }

  const primaryTarget = findEnemyByEntityId(session.combatState?.enemies, targetEntityId >>> 0) || living[0];
  if (!primaryTarget || primaryTarget.hp <= 0) {
    return [];
  }

  const targetCount = Math.max(1, Math.min(living.length, resolveSlaughterTargetCount(skillLevel)));
  if (targetCount <= 1) {
    return [primaryTarget];
  }

  const additionalTargets = living
    .filter((enemy) => enemy.entityId !== primaryTarget.entityId)
    .sort((a, b) => {
      const distanceA = Math.abs((a.row || 0) - (primaryTarget.row || 0)) + Math.abs((a.col || 0) - (primaryTarget.col || 0));
      const distanceB = Math.abs((b.row || 0) - (primaryTarget.row || 0)) + Math.abs((b.col || 0) - (primaryTarget.col || 0));
      if (distanceA !== distanceB) {
        return distanceA - distanceB;
      }
      if ((a.row || 0) !== (b.row || 0)) {
        return (a.row || 0) - (b.row || 0);
      }
      if ((a.col || 0) !== (b.col || 0)) {
        return (a.col || 0) - (b.col || 0);
      }
      return (a.entityId >>> 0) - (b.entityId >>> 0);
    })
    .slice(0, Math.max(0, targetCount - 1));

  return [primaryTarget, ...additionalTargets];
}

export function isEnemyDying(enemy: CombatEnemyInstance | null | undefined): boolean {
  if (!enemy) {
    return false;
  }
  const maxHp = Math.max(1, enemy.maxHp || 1);
  return (enemy.hp || 0) <= Math.max(1, Math.floor(maxHp * 0.25));
}

export function findEnemyByEntityId(enemies: CombatEnemyInstance[] | null | undefined, entityId: number): CombatEnemyInstance | null {
  if (!Array.isArray(enemies)) {
    return null;
  }
  return enemies.find((enemy) => enemy && (enemy.entityId >>> 0) === (entityId >>> 0)) || null;
}

export function listLivingEnemies(enemies: CombatEnemyInstance[] | null | undefined): CombatEnemyInstance[] {
  if (!Array.isArray(enemies)) {
    return [];
  }
  return enemies.filter((enemy) => enemy && (enemy.hp || 0) > 0);
}

export function pickRandomLivingEnemy(enemies: CombatEnemyInstance[] | null | undefined): CombatEnemyInstance | null {
  const living = listLivingEnemies(enemies);
  if (living.length <= 0) {
    return null;
  }
  return living[Math.floor(Math.random() * living.length)] || null;
}

export function resolveSelectedEnemy(enemies: CombatEnemyInstance[] | null | undefined, selection: { targetA: number; targetB: number }): CombatEnemyInstance | null {
  if (!Array.isArray(enemies)) {
    return null;
  }
  const targeted = enemies.find(
    (enemy) => enemy && (enemy.hp || 0) > 0 && enemy.row === selection.targetA && enemy.col === selection.targetB
  );
  return targeted || findFirstLivingEnemy(enemies);
}

export function describeLivingEnemies(enemies: CombatEnemyInstance[] | null | undefined): string {
  if (!Array.isArray(enemies)) {
    return 'none';
  }
  return enemies
    .filter((enemy) => enemy && (enemy.hp || 0) > 0)
    .map((enemy) => `${enemy.entityId}[${enemy.row},${enemy.col}]=${enemy.hp}`)
    .join('|') || 'none';
}

export function describeEnemy(enemy: CombatEnemyInstance): string {
  return `${enemy.typeId}@${enemy.entityId}[${enemy.row},${enemy.col}]`;
}

export function describeEncounterEnemies(enemies: CombatEnemyInstance[]): string {
  return enemies.map((enemy) => `${describeEnemy(enemy)}hp=${enemy.hp}lvl=${enemy.level}`).join('|');
}

export function describeEnemyRoster(enemies: CombatEnemyInstance[] | null | undefined): string {
  if (!Array.isArray(enemies)) {
    return 'none';
  }
  return enemies
    .map((enemy) => `${enemy.entityId}[${enemy.row},${enemy.col}]type=${enemy.typeId}hp=${enemy.hp}/${enemy.maxHp}`)
    .join('|');
}

export function buildPlayerEntry(
  session: GameSession,
  slot: CombatPartySlot = { row: 1, col: 2 }
): Record<string, any> {
  return {
    side: 0xff,
    entityId: session.runtimeId >>> 0,
    typeId: (session.roleEntityType || session.entityType) & 0xffff,
    row: slot.row & 0xff,
    col: slot.col & 0xff,
    hp: Math.max(1, session.currentHealth || 1),
    mp: Math.max(0, session.currentMana || 0),
    aptitude: 0,
    level: Math.max(1, session.level || 1),
    appearanceTypes: [0, 0, 0],
    appearanceVariants: [0, 0, 0],
    name: session.charName || 'Hero',
  };
}

export function buildAllyPlayerEntry(
  session: GameSession,
  slotIndex: number | CombatPartySlot = 0
): Record<string, any> {
  const allySlots = [
    { row: 1, col: 1 },
    { row: 1, col: 3 },
    { row: 1, col: 0 },
    { row: 1, col: 4 },
  ];
  const slot = typeof slotIndex === 'number'
    ? (allySlots[Math.max(0, Math.min(allySlots.length - 1, slotIndex))] || allySlots[0])
    : slotIndex;

  return {
    side: 0xff,
    entityId: session.runtimeId >>> 0,
    typeId: (session.roleEntityType || session.entityType) & 0xffff,
    row: slot.row & 0xff,
    col: slot.col & 0xff,
    hp: Math.max(1, session.currentHealth || 1),
    mp: Math.max(0, session.currentMana || 0),
    aptitude: 0,
    level: Math.max(1, session.level || 1),
    appearanceTypes: [
      (session.roleEntityType || session.entityType || 0) & 0xffff,
      0,
      0,
    ],
    appearanceVariants: [0, 0, 0],
    name: session.charName || 'Hero',
  };
}

export function computePlayerDamage(session: GameSession, enemy: Record<string, any>): number {
  const attackRange = resolvePlayerAttackRange(session);
  const baseDamage = rollRangeDamage(attackRange.min, attackRange.max);
  const mitigation = resolveEnemyPhysicalMitigation(session, enemy);
  return Math.max(0, baseDamage - mitigation);
}

export function readExplicitCharacterAttackRange(session: GameSession): { min: number; max: number } | null {
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

export function resolvePlayerAttackRange(session: GameSession): { min: number; max: number } {
  const explicitRange = readExplicitCharacterAttackRange(session);
  let base = explicitRange?.min || 0;
  let peak = explicitRange?.max || 0;
  if (!explicitRange) {
    const stats = session.primaryAttributes || {};
    const equipment = getEquipmentCombatBonuses(session);
    const weaponMin = Math.max(0, equipment.attackMin || 0);
    const weaponMax = Math.max(weaponMin, equipment.attackMax || weaponMin);
    const strength = Math.max(0, stats.strength || 0);
    const dexterity = Math.max(0, stats.dexterity || 0);
    const level = Math.max(1, session.level || 1);
    // This range tracks the client-facing ATK panel more closely than per-hit combat roll math.
    base = weaponMin + (strength * 4) + level;
    const spread = Math.max(1, (weaponMax - weaponMin) + Math.floor(dexterity / 6));
    peak = base + spread;
  }
  const attackBonusPercent = Math.max(0, Math.min(120, session.combatState?.playerStatus?.lionsRoarAttackBonusPercent || 0));
  const defiantPenalty = Math.max(0, Math.min(90, session.combatState?.playerStatus?.defiantAttackPenaltyPercent || 0));
  const adjustedBase = Math.max(1, Math.round(base * (1 + (attackBonusPercent / 100)) * (1 - (defiantPenalty / 100))));
  const adjustedMin = adjustedBase;
  const adjustedMax = Math.max(adjustedMin, Math.round(peak * (1 + (attackBonusPercent / 100)) * (1 - (defiantPenalty / 100))));
  return { min: adjustedMin, max: adjustedMax };
}

export function rollRangeDamage(min: number, max: number): number {
  const normalizedMin = Math.max(1, Math.round(min || 1));
  const normalizedMax = Math.max(normalizedMin, Math.round(max || normalizedMin));
  return normalizedMin + Math.floor(Math.random() * Math.max(1, (normalizedMax - normalizedMin) + 1));
}

function resolveDerivedPlayerMagicAttackValues(session: GameSession): { min: number; max: number } {
  const stats = session.primaryAttributes || {};
  const equipment = getEquipmentCombatBonuses(session);
  const intelligence = Math.max(0, Number(stats.intelligence) || 0);
  const vitality = Math.max(0, Number(stats.vitality) || 0);
  const dexterity = Math.max(0, Number(stats.dexterity) || 0);
  const weaponMin = Math.max(0, Number(equipment.magicAttackMin) || 0);
  const weaponMax = Math.max(weaponMin, Number(equipment.magicAttackMax) || weaponMin);

  // MATK should remain attribute/equipment driven so spell damage stays aligned with the client tooltip basis.
  const base = weaponMin + (intelligence * 2) + (vitality * 2) + dexterity;
  const peak = weaponMax + (intelligence * 12) + (vitality * 5) + (dexterity * 2);
  return {
    min: Math.max(1, base),
    max: Math.max(1, peak),
  };
}

export function resolveDerivedPlayerCombatStats(session: GameSession): {
  defense: number;
  hit: number;
  dodge: number;
  attackPower: number;
  magicDefense: number;
  magicAttackMin: number;
  magicAttackMax: number;
} {
  const stats = session.primaryAttributes || {};
  const dexterity = Math.max(0, Number(stats.dexterity) || 0);
  const vitality = Math.max(0, Number(stats.vitality) || 0);
  const intelligence = Math.max(0, Number(stats.intelligence) || 0);

  // These coefficients were fit against the client panel snapshots for the current class/build.
  const lionsRoarDefenseBonus = Math.max(0, Math.min(120, session.combatState?.playerStatus?.lionsRoarDefenseBonusPercent || 0));
  const divineBlessMagicAttackBonus = Math.max(0, Math.min(120, session.combatState?.playerStatus?.divineBlessMagicAttackBonusPercent || 0));
  const divineBlessMagicDefenseBonus = Math.max(0, Math.min(120, session.combatState?.playerStatus?.divineBlessMagicDefenseBonusPercent || 0));
  const defenseBase = Math.max(1, Math.round((4325 / 3) + ((31 * dexterity) / 40) + ((19 * vitality) / 18) + ((3 * intelligence) / 20)));
  const defense = Math.max(1, Math.round(defenseBase * (1 + (lionsRoarDefenseBonus / 100))));
  const hit = Math.max(1, Math.round((940 / 3) + (dexterity / 4) - (vitality / 18) + ((3 * intelligence) / 20)));
  const dodge = Math.max(1, Math.round((2878 / 3) + ((27 * dexterity) / 40) + (vitality / 36) + ((9 * intelligence) / 20)));
  const attackPower = Math.max(1, Math.round((490 / 3) + ((21 * dexterity) / 40) + (vitality / 18) + ((3 * intelligence) / 20)));
  const magicDefenseBase = Math.max(1, Math.round(1212 + (dexterity / 4) + ((5 * vitality) / 12) + ((21 * intelligence) / 20)));
  const magicDefense = Math.max(1, Math.round(magicDefenseBase * (1 + (divineBlessMagicDefenseBonus / 100))));
  const magicAttackRange = resolveDerivedPlayerMagicAttackValues(session);
  const magicAttackMin = Math.max(1, Math.round(magicAttackRange.min * (1 + (divineBlessMagicAttackBonus / 100))));
  const magicAttackMax = Math.max(magicAttackMin, Math.round(magicAttackRange.max * (1 + (divineBlessMagicAttackBonus / 100))));

  return {
    defense,
    hit,
    dodge,
    attackPower,
    magicDefense,
    magicAttackMin,
    magicAttackMax,
  };
}

export function resolvePlayerArmorPenetration(session: GameSession): number {
  const derived = resolveDerivedPlayerCombatStats(session);
  return Math.max(0, Math.floor((derived.attackPower || 0) / 18));
}

export function resolveEnemyPhysicalMitigation(session: GameSession, enemy: Record<string, any>): number {
  const baseMitigation = Math.floor(((enemy.level || 1) * 2) + Math.max(0, enemy.aptitude || 0));
  const penetration = resolvePlayerArmorPenetration(session);
  return Math.max(0, baseMitigation - penetration);
}

export function resolveEnemyMagicMitigation(enemy: Record<string, any>): number {
  return Math.max(0, Math.floor((enemy.level || 1) + Math.max(0, enemy.aptitude || 0)));
}

export function resolvePlayerCounterattackChance(session: GameSession): number {
  const derived = resolveDerivedPlayerCombatStats(session);
  const baseChance = 5;
  const dodgeBonus = Math.floor((derived.dodge || 0) / 120);
  const hitBonus = Math.floor((derived.hit || 0) / 200);
  const attackPowerBonus = Math.floor((derived.attackPower || 0) / 80);
  const counterattackLevel = Math.max(0, resolveEffectiveSkillLevel(session, COUNTERATTACK_SKILL_ID));
  const skillBonus = counterattackLevel <= 0 ? 0 : (4 + (counterattackLevel * 3));
  return Math.max(0, Math.min(75, baseChance + dodgeBonus + hitBonus + attackPowerBonus + skillBonus));
}

export function computeEnemyDamage(session: GameSession, enemy: Record<string, any>): number {
  const derived = resolveDerivedPlayerCombatStats(session);
  const defenseBonusPercent = Math.max(0, Math.min(90, session.combatState?.playerStatus?.defiantDefenseBonusPercent || 0));
  const adjustedDefense = Math.round(Math.max(1, derived.defense || 1) * (1 + (defenseBonusPercent / 100)));
  const defenseMitigation = Math.max(0, Math.floor(adjustedDefense / 120));
  const baseMin = 18 + ((enemy.level || 1) * 4) + ((enemy.aptitude || 0) * 2);
  const baseMax = Math.max(baseMin, baseMin + 8 + Math.floor((enemy.level || 1) / 2));
  const enervatePenalty = Math.max(0, Math.min(90, session.combatState?.enemyStatuses?.[enemy?.entityId >>> 0]?.enervateAttackPenaltyPercent || 0));
  const adjustedMin = Math.max(1, Math.round(baseMin * (1 - (enervatePenalty / 100))));
  const adjustedMax = Math.max(adjustedMin, Math.round(baseMax * (1 - (enervatePenalty / 100))));
  const rolledBase = rollRangeDamage(adjustedMin, adjustedMax);
  return Math.max(1, rolledBase - defenseMitigation);
}

export function computeSkillDamage(session: GameSession, skillId: number, skillLevel: number, enemy: Record<string, any>): number {
  if ((skillId >>> 0) === ENERVATE_SKILL_ID) {
    const attackRange = resolvePlayerAttackRange(session);
    const attackMin = Math.max(1, attackRange.min || 0);
    const attackMax = Math.max(attackMin, attackRange.max || attackMin);
    const scaleMin = ENERVATE_DAMAGE_SCALE_MIN_BY_LEVEL[Math.max(0, skillLevel - 1)] || ENERVATE_DAMAGE_SCALE_MIN_BY_LEVEL[0];
    const scaleMax = ENERVATE_DAMAGE_SCALE_MAX_BY_LEVEL[Math.max(0, skillLevel - 1)] || ENERVATE_DAMAGE_SCALE_MAX_BY_LEVEL[0];
    const scaledMin = Math.max(1, Math.round(attackMin * scaleMin));
    const scaledMax = Math.max(scaledMin, Math.round(attackMax * scaleMax));
    const baseDamage = rollRangeDamage(scaledMin, scaledMax);
    const mitigation = resolveEnemyPhysicalMitigation(session, enemy);
    return Math.max(0, baseDamage - mitigation);
  }
  if ((skillId >>> 0) === FIREBALL_SKILL_ID) {
    const attackRange = resolvePlayerMagicAttackRange(session);
    const attackMin = Math.max(1, attackRange.min || 0);
    const attackMax = Math.max(attackMin, attackRange.max || attackMin);
    const scaleMin = FIREBALL_DAMAGE_SCALE_MIN_BY_LEVEL[Math.max(0, skillLevel - 1)] || FIREBALL_DAMAGE_SCALE_MIN_BY_LEVEL[0];
    const scaleMax = FIREBALL_DAMAGE_SCALE_MAX_BY_LEVEL[Math.max(0, skillLevel - 1)] || FIREBALL_DAMAGE_SCALE_MAX_BY_LEVEL[0];
    const scaledMin = Math.max(1, Math.round(attackMin * scaleMin));
    const scaledMax = Math.max(scaledMin, Math.round(attackMax * scaleMax));
    const baseDamage = rollRangeDamage(scaledMin, scaledMax);
    const mitigation = resolveEnemyMagicMitigation(enemy);
    return Math.max(0, baseDamage - mitigation);
  }
  if ((skillId >>> 0) === BLIZZARD_SKILL_ID) {
    const attackRange = resolvePlayerMagicAttackRange(session);
    const attackMin = Math.max(1, attackRange.min || 0);
    const attackMax = Math.max(attackMin, attackRange.max || attackMin);
    const scaleMin = BLIZZARD_DAMAGE_SCALE_MIN_BY_LEVEL[Math.max(0, skillLevel - 1)] || BLIZZARD_DAMAGE_SCALE_MIN_BY_LEVEL[0];
    const scaleMax = BLIZZARD_DAMAGE_SCALE_MAX_BY_LEVEL[Math.max(0, skillLevel - 1)] || BLIZZARD_DAMAGE_SCALE_MAX_BY_LEVEL[0];
    const scaledMin = Math.max(1, Math.round(attackMin * scaleMin));
    const scaledMax = Math.max(scaledMin, Math.round(attackMax * scaleMax));
    const baseDamage = rollRangeDamage(scaledMin, scaledMax);
    const mitigation = resolveEnemyMagicMitigation(enemy);
    return Math.max(0, baseDamage - mitigation);
  }
  if ((skillId >>> 0) === SLAUGHTER_SKILL_ID) {
    const attackRange = resolvePlayerAttackRange(session);
    const attackMin = Math.max(1, attackRange.min || 0);
    const attackMax = Math.max(attackMin, attackRange.max || attackMin);
    const scaleMin = SLAUGHTER_DAMAGE_SCALE_MIN_BY_LEVEL[Math.max(0, skillLevel - 1)] || SLAUGHTER_DAMAGE_SCALE_MIN_BY_LEVEL[0];
    const scaleMax = SLAUGHTER_DAMAGE_SCALE_MAX_BY_LEVEL[Math.max(0, skillLevel - 1)] || SLAUGHTER_DAMAGE_SCALE_MAX_BY_LEVEL[0];
    const scaledMin = Math.max(1, Math.round(attackMin * scaleMin));
    const scaledMax = Math.max(scaledMin, Math.round(attackMax * scaleMax));
    const baseDamage = rollRangeDamage(scaledMin, scaledMax);
    const mitigation = resolveEnemyPhysicalMitigation(session, enemy);
    return Math.max(0, baseDamage - mitigation);
  }
  return computePlayerDamage(session, enemy);
}

export function resolveSkillManaCost(skillId: number, skillLevel: number): number {
  return resolveSkillManaCostFromDefinition(skillId, skillLevel);
}

export function resolveSkillHealing(session: GameSession, skillId: number, skillLevel: number): number {
  if ((skillId >>> 0) === CURE_SKILL_ID) {
    const attackRange = resolvePlayerMagicAttackRange(session);
    const attackMin = Math.max(1, attackRange.min || 0);
    const scale = CURE_HEAL_SCALE_BY_LEVEL[Math.max(0, skillLevel - 1)] || CURE_HEAL_SCALE_BY_LEVEL[0];
    return Math.max(1, Math.round(attackMin * scale) + (session.level || 1) * 2);
  }
  return 0;
}

export function resolveDefiantDuration(skillLevel: number): number {
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

export function resolveEnervateDuration(skillLevel: number): number {
  return skillLevel >= 8 ? 3 : 2;
}

export function resolveEnervateAttackPenalty(skillLevel: number): number {
  return Math.min(40, 18 + ((Math.max(1, skillLevel) - 1) * 2));
}

export function resolvePuzzleManaCostReduction(skillLevel: number): number {
  const normalizedLevel = Math.max(1, Math.min(12, skillLevel | 0));
  return Math.min(45, 14 + (normalizedLevel * 2));
}

export function resolveBleedDuration(skillLevel: number): number {
  if (skillLevel >= 10) {
    return 4;
  }
  if (skillLevel >= 6) {
    return 3;
  }
  return 2;
}

export function resolveBleedDamagePerRound(session: GameSession, skillLevel: number): number {
  const attackRange = resolvePlayerAttackRange(session);
  const averageAttack = Math.max(1, Math.round((attackRange.min + attackRange.max) / 2));
  return Math.max(1, Math.round((averageAttack * 0.3) + (skillLevel * 6)));
}

export function resolveConcealDuration(skillLevel: number): number {
  if (skillLevel >= 11) {
    return 5;
  }
  if (skillLevel >= 6) {
    return 3;
  }
  return 2;
}

export function resolveLionRoarDuration(skillLevel: number): number {
  if (skillLevel >= 12) {
    return 3;
  }
  if (skillLevel >= 9) {
    return 2;
  }
  return 1;
}

export function resolveLionRoarAttackBonus(skillLevel: number): number {
  return Math.min(45, 10 + (Math.max(1, skillLevel) * 2));
}

export function resolveLionRoarDefenseBonus(skillLevel: number): number {
  return Math.min(55, 14 + (Math.max(1, skillLevel) * 2));
}

export function resolveDivineBlessDuration(skillLevel: number): number {
  if (skillLevel >= 12) {
    return 3;
  }
  if (skillLevel >= 9) {
    return 2;
  }
  return 1;
}

export function resolveDivineBlessMagicAttackBonus(skillLevel: number): number {
  return Math.min(50, 12 + (Math.max(1, skillLevel) * 2));
}

export function resolveDivineBlessMagicDefenseBonus(skillLevel: number): number {
  return Math.min(50, 10 + (Math.max(1, skillLevel) * 2));
}

export function resolveHasteDuration(skillLevel: number): number {
  return skillLevel >= 8 ? 2 : 1;
}

export function resolveRegenerateDuration(): number {
  return 3;
}

export function resolveRegenerateHealAmount(session: GameSession, skillLevel: number): number {
  const magicRange = resolvePlayerMagicAttackRange(session);
  return Math.max(1, Math.round((magicRange.min * 0.4) + (skillLevel * 8)));
}

export function resolveGospelDuration(): number {
  return 2;
}

export function resolveGospelHealAmount(session: GameSession, skillLevel: number): number {
  const magicRange = resolvePlayerMagicAttackRange(session);
  return Math.max(1, Math.round((magicRange.min * 0.55) + (skillLevel * 10)));
}

export function resolveBloodDrainHealAmount(skillLevel: number, appliedDamage: number): number {
  const drainScale = 0.45 + (Math.max(1, skillLevel) * 0.03);
  return Math.max(1, Math.round(appliedDamage * drainScale));
}

export function resolvePlayerMagicAttackRange(session: GameSession): { min: number; max: number } {
  const derived = resolveDerivedPlayerCombatStats(session);
  return {
    min: derived.magicAttackMin,
    max: derived.magicAttackMax,
  };
}

export function tickCombatStatuses(session: GameSession): void {
  const nextPlayerStatus: Record<string, any> = { ...(session.combatState?.playerStatus || {}) };
  if ((nextPlayerStatus.defiantRoundsRemaining || 0) > 0) {
    nextPlayerStatus.defiantRoundsRemaining = Math.max(0, (nextPlayerStatus.defiantRoundsRemaining || 0) - 1);
    if ((nextPlayerStatus.defiantRoundsRemaining || 0) <= 0) {
      delete nextPlayerStatus.defiantRoundsRemaining;
      delete nextPlayerStatus.defiantDefenseBonusPercent;
      delete nextPlayerStatus.defiantAttackPenaltyPercent;
    }
  }
  if ((nextPlayerStatus.lionsRoarRoundsRemaining || 0) > 0) {
    nextPlayerStatus.lionsRoarRoundsRemaining = Math.max(0, (nextPlayerStatus.lionsRoarRoundsRemaining || 0) - 1);
    if ((nextPlayerStatus.lionsRoarRoundsRemaining || 0) <= 0) {
      delete nextPlayerStatus.lionsRoarRoundsRemaining;
      delete nextPlayerStatus.lionsRoarAttackBonusPercent;
      delete nextPlayerStatus.lionsRoarDefenseBonusPercent;
    }
  }
  if ((nextPlayerStatus.divineBlessRoundsRemaining || 0) > 0) {
    nextPlayerStatus.divineBlessRoundsRemaining = Math.max(0, (nextPlayerStatus.divineBlessRoundsRemaining || 0) - 1);
    if ((nextPlayerStatus.divineBlessRoundsRemaining || 0) <= 0) {
      delete nextPlayerStatus.divineBlessRoundsRemaining;
      delete nextPlayerStatus.divineBlessMagicAttackBonusPercent;
      delete nextPlayerStatus.divineBlessMagicDefenseBonusPercent;
    }
  }
  if ((nextPlayerStatus.hasteRoundsRemaining || 0) > 0) {
    nextPlayerStatus.hasteRoundsRemaining = Math.max(0, (nextPlayerStatus.hasteRoundsRemaining || 0) - 1);
    if ((nextPlayerStatus.hasteRoundsRemaining || 0) <= 0) {
      delete nextPlayerStatus.hasteRoundsRemaining;
    }
  }
  if ((nextPlayerStatus.puzzleRoundsRemaining || 0) > 0) {
    nextPlayerStatus.puzzleRoundsRemaining = Math.max(0, (nextPlayerStatus.puzzleRoundsRemaining || 0) - 1);
    if ((nextPlayerStatus.puzzleRoundsRemaining || 0) <= 0) {
      delete nextPlayerStatus.puzzleRoundsRemaining;
      delete nextPlayerStatus.puzzleManaCostReductionPercent;
    }
  }
  if ((nextPlayerStatus.concealRoundsRemaining || 0) > 0) {
    nextPlayerStatus.concealRoundsRemaining = Math.max(0, (nextPlayerStatus.concealRoundsRemaining || 0) - 1);
    if ((nextPlayerStatus.concealRoundsRemaining || 0) <= 0) {
      delete nextPlayerStatus.concealRoundsRemaining;
    }
  }
  if ((nextPlayerStatus.regenerateRoundsRemaining || 0) > 0) {
    const healAmount = Math.max(0, Number(nextPlayerStatus.regenerateHealAmount) || 0);
    if (healAmount > 0) {
      const maxHealth = Math.max(1, Number(session.maxHealth) || 1);
      session.currentHealth = Math.max(0, Math.min(maxHealth, (session.currentHealth || 0) + healAmount));
    }
    nextPlayerStatus.regenerateRoundsRemaining = Math.max(0, (nextPlayerStatus.regenerateRoundsRemaining || 0) - 1);
    if ((nextPlayerStatus.regenerateRoundsRemaining || 0) <= 0) {
      delete nextPlayerStatus.regenerateRoundsRemaining;
      delete nextPlayerStatus.regenerateHealAmount;
    }
  }
  session.combatState.playerStatus = nextPlayerStatus;

  const nextEnemyStatuses: Record<number, Record<string, any>> = {};
  for (const [rawEntityId, status] of Object.entries(session.combatState?.enemyStatuses || {})) {
    const enemyEntityId = Number(rawEntityId) >>> 0;
    const enemy = Array.isArray(session.combatState?.enemies)
      ? session.combatState.enemies.find((entry) => (entry?.entityId >>> 0) === enemyEntityId)
      : null;
    const nextStatus: Record<string, any> = { ...(status || {}) };
    if ((nextStatus.bleedRoundsRemaining || 0) > 0 && enemy && (enemy.hp || 0) > 0) {
      const bleedDamage = Math.max(1, Number(nextStatus.bleedDamagePerRound) || 1);
      enemy.hp = Math.max(0, (enemy.hp || 0) - bleedDamage);
      nextStatus.bleedRoundsRemaining = Math.max(0, (nextStatus.bleedRoundsRemaining || 0) - 1);
      if ((nextStatus.bleedRoundsRemaining || 0) <= 0) {
        delete nextStatus.bleedRoundsRemaining;
        delete nextStatus.bleedDamagePerRound;
      }
    }
    if ((nextStatus.enervateRoundsRemaining || 0) > 0) {
      nextStatus.enervateRoundsRemaining = Math.max(0, (nextStatus.enervateRoundsRemaining || 0) - 1);
    }
    if ((nextStatus.actionDisabledRoundsRemaining || 0) > 0) {
      nextStatus.actionDisabledRoundsRemaining = Math.max(0, (nextStatus.actionDisabledRoundsRemaining || 0) - 1);
      if ((nextStatus.actionDisabledRoundsRemaining || 0) <= 0) {
        delete nextStatus.actionDisabledRoundsRemaining;
        delete nextStatus.actionDisabledReason;
      }
    }
    if (
      (nextStatus.enervateRoundsRemaining || 0) > 0 ||
      (nextStatus.actionDisabledRoundsRemaining || 0) > 0 ||
      (nextStatus.bleedRoundsRemaining || 0) > 0
    ) {
      nextEnemyStatuses[enemyEntityId] = nextStatus;
    }
  }
  session.combatState.enemyStatuses = nextEnemyStatuses;
}

export function dropResultPreview(enemies: Record<string, any>[]): { dropCount: number } {
  const dropCount = enemies.reduce((count, enemy) => {
    const drops = Array.isArray(enemy?.drops) ? enemy.drops : [];
    return count + drops.length;
  }, 0);
  return { dropCount };
}

export function deriveCombatResultRankCode(totalScore: number, maxScore: number): number {
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
