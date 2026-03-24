import type { CombatEnemyInstance, CombatState, GameSession } from '../types.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getEquipmentCombatBonuses } from '../inventory/index.js';


// --- Constants ---
export const CAPTURE_ELEMENT_CODE_MIN = 1;
export const CAPTURE_ELEMENT_CODE_MAX = 4;
export const FIGHT_CLIENT_SKILL_USE_SUBCMD = 0x04;
export const SKILL_PACKET_TRACE_PATH = resolve(process.cwd(), 'data/runtime/skill-packet-trace.jsonl');
export const ENERVATE_SKILL_ID = 1101;
export const SLAUGHTER_SKILL_ID = 1403;
export const DEFIANT_SKILL_ID = 3103;
export const FIREBALL_SKILL_ID = 4101;
export const CURE_SKILL_ID = 4103;
export const DEFIANT_MP_COST_BY_LEVEL = [50, 55, 65, 75, 90, 110, 110, 110, 200, 200, 250, 300];
export const DEFIANT_DEFENSE_BONUS_BY_LEVEL = [20, 20, 20, 20, 20, 30, 32, 34, 36, 48, 75, 75];
export const ENERVATE_MP_COST_BY_LEVEL = [40, 59, 80, 100, 120, 140, 140, 140, 200, 200, 250, 300];
export const ENERVATE_DAMAGE_SCALE_MIN_BY_LEVEL = [1.12, 1.122, 1.124, 1.126, 1.128, 1.13, 1.132, 1.134, 1.136, 1.138, 1.16, 1.2];
export const ENERVATE_DAMAGE_SCALE_MAX_BY_LEVEL = [1.13, 1.132, 1.134, 1.136, 1.138, 1.14, 1.142, 1.144, 1.146, 1.148, 1.18, 1.22];
export const FIREBALL_MP_COST_BY_LEVEL = [40, 55, 70, 85, 100, 120, 120, 120, 180, 180, 220, 260];
export const FIREBALL_DAMAGE_SCALE_MIN_BY_LEVEL = [1.18, 1.2, 1.22, 1.24, 1.26, 1.28, 1.3, 1.32, 1.34, 1.36, 1.4, 1.46];
export const FIREBALL_DAMAGE_SCALE_MAX_BY_LEVEL = [1.28, 1.3, 1.32, 1.34, 1.36, 1.38, 1.4, 1.42, 1.44, 1.46, 1.52, 1.58];
export const FIREBALL_EXPLOSION_CHANCE = 0.1;
export const SLAUGHTER_CONCENTRATION_CHANCE = 0.1;
export const CURE_MP_COST_BY_LEVEL = [35, 42, 50, 58, 66, 75, 75, 75, 110, 110, 140, 180];
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

export function buildRoundStartProbeOptions(round: number, activeEntityId: number): RoundStartProbeOptions | null {
  if (!ROUND_START_PROBE_ENABLED) {
    return null;
  }
  const context = {
    round: Math.max(1, round) & 0xffff,
    activeEntityId: activeEntityId >>> 0,
  };
  const fieldA = resolveRoundStartProbeToken(ROUND_START_PROBE_FIELD_A, context);
  const fieldB = resolveRoundStartProbeToken(ROUND_START_PROBE_FIELD_B, context);
  const fieldC = resolveRoundStartProbeToken(ROUND_START_PROBE_FIELD_C, context);
  const fieldD = resolveRoundStartProbeToken(ROUND_START_PROBE_FIELD_D, context);
  const fieldE = resolveRoundStartProbeToken(ROUND_START_PROBE_FIELD_E, context);
  return {
    fieldA: fieldA === undefined ? context.round : fieldA,
    fieldB,
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

export function resolveSkillTargets(session: GameSession, skillId: number, targetEntityId: number, skillLevel = 1): CombatEnemyInstance[] {
  if ((skillId >>> 0) === CURE_SKILL_ID) {
    return [];
  }
  if ((skillId >>> 0) === FIREBALL_SKILL_ID) {
    return resolveFireballTargets(session, targetEntityId);
  }
  if ((skillId >>> 0) === SLAUGHTER_SKILL_ID) {
    return resolveSlaughterTargets(session, targetEntityId, skillLevel);
  }
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

export function buildPlayerEntry(session: GameSession): Record<string, any> {
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

export function computePlayerDamage(session: GameSession, enemy: Record<string, any>): number {
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

export function computeEnemyDamage(session: GameSession, enemy: Record<string, any>): number {
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

export function computeSkillDamage(session: GameSession, skillId: number, skillLevel: number, enemy: Record<string, any>): number {
  if ((skillId >>> 0) === ENERVATE_SKILL_ID) {
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
  if ((skillId >>> 0) === FIREBALL_SKILL_ID) {
    const attackRange = resolvePlayerMagicAttackRange(session);
    const attackMin = Math.max(1, attackRange.min || 0);
    const attackMax = Math.max(attackMin, attackRange.max || attackMin);
    const scaleMin = FIREBALL_DAMAGE_SCALE_MIN_BY_LEVEL[Math.max(0, skillLevel - 1)] || FIREBALL_DAMAGE_SCALE_MIN_BY_LEVEL[0];
    const scaleMax = FIREBALL_DAMAGE_SCALE_MAX_BY_LEVEL[Math.max(0, skillLevel - 1)] || FIREBALL_DAMAGE_SCALE_MAX_BY_LEVEL[0];
    const scaledMin = Math.max(1, Math.round(attackMin * scaleMin));
    const scaledMax = Math.max(scaledMin, Math.round(attackMax * scaleMax));
    const baseDamage = scaledMin + Math.floor(Math.random() * Math.max(1, (scaledMax - scaledMin) + 1));
    const mitigation = Math.floor((enemy.level || 1) + Math.max(0, enemy.aptitude || 0));
    return Math.max(1, baseDamage - mitigation);
  }
  if ((skillId >>> 0) === SLAUGHTER_SKILL_ID) {
    const attackRange = resolvePlayerAttackRange(session);
    const attackMin = Math.max(1, attackRange.min || 0);
    const attackMax = Math.max(attackMin, attackRange.max || attackMin);
    const levelBonusMin = 58 + ((Math.max(1, skillLevel) - 1) * 9);
    const levelBonusMax = 70 + ((Math.max(1, skillLevel) - 1) * 26);
    const scaledMin = Math.max(1, attackMin + levelBonusMin);
    const scaledMax = Math.max(scaledMin, attackMax + levelBonusMax);
    const baseDamage = scaledMin + Math.floor(Math.random() * Math.max(1, (scaledMax - scaledMin) + 1));
    const mitigation = Math.floor(((enemy.level || 1) * 2) + Math.max(0, enemy.aptitude || 0));
    return Math.max(1, baseDamage - mitigation);
  }
  return computePlayerDamage(session, enemy);
}

export function resolveSkillManaCost(skillId: number, skillLevel: number): number {
  if ((skillId >>> 0) === DEFIANT_SKILL_ID) {
    return DEFIANT_MP_COST_BY_LEVEL[Math.max(0, skillLevel - 1)] || DEFIANT_MP_COST_BY_LEVEL[0];
  }
  if ((skillId >>> 0) === ENERVATE_SKILL_ID) {
    return ENERVATE_MP_COST_BY_LEVEL[Math.max(0, skillLevel - 1)] || ENERVATE_MP_COST_BY_LEVEL[0];
  }
  if ((skillId >>> 0) === FIREBALL_SKILL_ID) {
    return FIREBALL_MP_COST_BY_LEVEL[Math.max(0, skillLevel - 1)] || FIREBALL_MP_COST_BY_LEVEL[0];
  }
  if ((skillId >>> 0) === CURE_SKILL_ID) {
    return CURE_MP_COST_BY_LEVEL[Math.max(0, skillLevel - 1)] || CURE_MP_COST_BY_LEVEL[0];
  }
  return 0;
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

export function resolvePlayerMagicAttackRange(session: GameSession): { min: number; max: number } {
  const stats = session.primaryAttributes || {};
  const equipment = getEquipmentCombatBonuses(session);
  const weaponMin = Math.max(0, equipment.magicAttackMin || 0);
  const weaponMax = Math.max(weaponMin, equipment.magicAttackMax || weaponMin);
  const intelligence = Math.max(0, stats.intelligence || 0);
  const vitality = Math.max(0, stats.vitality || 0);
  const level = Math.max(1, session.level || 1);
  const base = weaponMin + (intelligence * 4) + level;
  const spread = Math.max(1, (weaponMax - weaponMin) + Math.floor(vitality / 8));
  return {
    min: Math.max(1, base),
    max: Math.max(1, base + spread),
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
