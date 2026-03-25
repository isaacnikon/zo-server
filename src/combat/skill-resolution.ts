import { DEFAULT_FLAGS, GAME_FIGHT_ACTION_CMD } from '../config.js';
import { buildSkillCastPlaybackPacket, buildNativeCastPlaybackPacket } from './packets.js';
import {
  resolveSkillTargets,
  SLAUGHTER_SKILL_ID,
  SLAUGHTER_CONCENTRATION_CHANCE,
  SLAUGHTER_PACKET_SKILL_ID_OVERRIDE,
  SLAUGHTER_PACKET_STAGE2_ENABLED,
  SLAUGHTER_PACKET_STAGE2_FLAG,
  SLAUGHTER_PACKET_STAGE2_SPEC,
  DEFIANT_SKILL_ID,
  ENERVATE_SKILL_ID,
  CURE_SKILL_ID,
  describeEnemyRoster,
  resolveSkillManaCost,
  resolveDefiantDuration,
  DEFIANT_DEFENSE_BONUS_BY_LEVEL,
  resolveSkillHealing,
  computeSkillDamage,
  resolveEnervateDuration,
  resolveEnervateAttackPenalty,
  describeLivingEnemies,
  buildSkillPacketProbeTargets,
  buildSkillPacketProbeStage2Entries,
  buildSkillPacketProbeStage2EntriesForSpec,
  appendSkillPacketTrace,
  SKILL_PACKET_PROBE_STAGE2_ENABLED,
  SKILL_PACKET_PROBE_STAGE2_FLAG,
  SKILL_PACKET_PROBE_STAGE2_SPEC,
  SKILL_PACKET_PROBE_TARGET_ENTITY,
  SKILL_PACKET_PROBE_TARGET_ACTION,
  SKILL_PACKET_PROBE_TARGET_VALUE,
  MULTI_TARGET_ENTITY_SENTINEL,
} from './combat-formulas.js';
import { finalizeSkillResolutionAndEnemyTurn, resendCombatCommandPrompt } from './combat-resolution.js';
import type { GameSession } from '../types.js';

interface SkillCastConfig {
  /** Effect IDs for a native prelude packet sent before the main cast. */
  preludeEffectIds?: number[];
  /** Effect IDs for a native main cast packet. Omit to use the probe packet path. */
  nativeEffectIds?: number[];
  /** Send a probe fallback after the native main cast for delayed-cast flow. */
  delayedCast?: boolean;
  /** Skill can be used without a valid enemy target. Defaults to true. */
  requiresTarget?: boolean;
  /** Probability of concentration mode — single-target damage amplified by target count. */
  concentrationChance?: number;
  /** Apply a per-target status effect after each hit. */
  applyTargetStatus?: (session: GameSession, targetEntityId: number, skillLevel: number) => void;
}

const SKILL_CAST_CONFIGS: Partial<Record<number, SkillCastConfig>> = {
  [ENERVATE_SKILL_ID]: {
    preludeEffectIds: [1001, 1002, 1004, 1003, 1005],
    applyTargetStatus: (session, targetEntityId, skillLevel) => {
      session.combatState.enemyStatuses[targetEntityId] = {
        enervateRoundsRemaining: resolveEnervateDuration(skillLevel),
        enervateAttackPenaltyPercent: resolveEnervateAttackPenalty(skillLevel),
      };
    },
  },
  [DEFIANT_SKILL_ID]: {
    preludeEffectIds: [1001, 1002, 1004, 1003, 1005],
  },
  [SLAUGHTER_SKILL_ID]: {
    nativeEffectIds: [1152, 1153],
    delayedCast: true,
    concentrationChance: SLAUGHTER_CONCENTRATION_CHANCE,
  },
  [CURE_SKILL_ID]: {
    requiresTarget: false,
  },
};

interface SkillEffectResult {
  castTargets: Array<{ entityId: number; actionCode: number; value: number }>;
  pendingOutcomes: Array<{ skillId: number; targetEntityId: number; playerDamage?: number; healAmount?: number; targetDied?: boolean }> | null;
  additionalDamageDealt: number;
  logSuffix: string;
}

function resolveDefiantEffect(session: GameSession, skillId: number, skillLevel: number, manaCost: number): SkillEffectResult {
  const durationRounds = resolveDefiantDuration(skillLevel);
  const defenseBonusPercent = DEFIANT_DEFENSE_BONUS_BY_LEVEL[Math.max(0, skillLevel - 1)] || 20;
  session.combatState.playerStatus = {
    ...session.combatState.playerStatus,
    defiantRoundsRemaining: durationRounds,
    defiantDefenseBonusPercent: defenseBonusPercent,
    defiantAttackPenaltyPercent: 10,
  };
  return {
    castTargets: [{ entityId: session.entityType >>> 0, actionCode: 1, value: 0 }],
    pendingOutcomes: null,
    additionalDamageDealt: 0,
    logSuffix: `effect=defiant manaCost=${manaCost} rounds=${durationRounds} defenseBonus=${defenseBonusPercent}`,
  };
}

function resolveCureEffect(session: GameSession, skillId: number, skillLevel: number, manaCost: number): SkillEffectResult {
  const healAmount = resolveSkillHealing(session, skillId, skillLevel);
  const previousHealth = Math.max(0, session.currentHealth || 0);
  const maxHealth = Math.max(previousHealth, session.maxHealth || previousHealth || 1);
  const appliedHeal = Math.max(0, Math.min(maxHealth - previousHealth, healAmount));
  session.currentHealth = Math.max(0, Math.min(maxHealth, previousHealth + healAmount));
  return {
    castTargets: [{ entityId: session.entityType >>> 0, actionCode: 1, value: Math.max(1, appliedHeal || healAmount || 1) }],
    pendingOutcomes: [{ skillId, targetEntityId: session.entityType >>> 0, healAmount: appliedHeal }],
    additionalDamageDealt: 0,
    logSuffix: `effect=cure manaCost=${manaCost} healed=${appliedHeal} hp=${session.currentHealth}/${maxHealth}`,
  };
}

function resolveDamageEffect(
  session: GameSession,
  skillId: number,
  skillLevel: number,
  targetEnemies: Array<{ entityId: number; hp: number; row: number; col: number }>,
  config: SkillCastConfig,
  manaCost: number
): SkillEffectResult {
  const primaryTarget = targetEnemies[0] || null;
  const concentrationActive = !!(config.concentrationChance) &&
    targetEnemies.length > 1 &&
    Math.random() < config.concentrationChance;
  const damageMultiplier = concentrationActive ? Math.max(1, targetEnemies.length) : 1;
  const effectiveTargets = concentrationActive && primaryTarget ? [primaryTarget] : targetEnemies;
  const castTargets: Array<{ entityId: number; actionCode: number; value: number }> = [];
  const pendingOutcomes: Array<{ skillId: number; targetEntityId: number; playerDamage: number; targetDied: boolean }> = [];
  let totalAppliedDamage = 0;
  for (const targetEnemy of effectiveTargets) {
    const baseDamage = computeSkillDamage(session, skillId, skillLevel, targetEnemy);
    const playerDamage = Math.max(1, baseDamage * damageMultiplier);
    const appliedPlayerDamage = Math.max(0, Math.min(targetEnemy.hp, playerDamage));
    targetEnemy.hp = Math.max(0, targetEnemy.hp - playerDamage);
    const targetDied = targetEnemy.hp <= 0;
    totalAppliedDamage += appliedPlayerDamage;
    castTargets.push({ entityId: targetEnemy.entityId >>> 0, actionCode: targetDied ? 3 : 1, value: Math.max(1, playerDamage || 1) });
    pendingOutcomes.push({ skillId, targetEntityId: targetEnemy.entityId >>> 0, playerDamage: Math.max(1, playerDamage || 1), targetDied });
    config.applyTargetStatus?.(session, targetEnemy.entityId >>> 0, skillLevel);
  }
  return {
    castTargets,
    pendingOutcomes,
    additionalDamageDealt: totalAppliedDamage,
    logSuffix: `targetCount=${pendingOutcomes.length} manaCost=${manaCost} totalDamage=${totalAppliedDamage} multiHit=${targetEnemies.length > 1 ? 1 : 0} concentrated=${concentrationActive ? 1 : 0} remaining=${describeLivingEnemies(session.combatState.enemies)}`,
  };
}

function resolveSkillEffect(
  session: GameSession,
  skillId: number,
  skillLevel: number,
  targetEnemies: Array<{ entityId: number; hp: number; row: number; col: number }>,
  config: SkillCastConfig,
  manaCost: number
): SkillEffectResult {
  const normalizedSkillId = skillId >>> 0;
  if (normalizedSkillId === DEFIANT_SKILL_ID) return resolveDefiantEffect(session, skillId, skillLevel, manaCost);
  if (normalizedSkillId === CURE_SKILL_ID) return resolveCureEffect(session, skillId, skillLevel, manaCost);
  return resolveDamageEffect(session, skillId, skillLevel, targetEnemies, config, manaCost);
}

export function handleCombatSkillUse(session: GameSession, payload: Buffer): void {
  const skillId = payload.readUInt16LE(3) & 0xffff;
  const targetEntityId = payload.readUInt32LE(5) >>> 0;
  resolveCombatSkillUse(
    session,
    skillId,
    targetEntityId,
    `cmd=0x${GAME_FIGHT_ACTION_CMD.toString(16)} sub=0x${payload[2].toString(16)}`
  );
}

export function resolveCombatSkillUse(
  session: GameSession,
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

  const skillLevel = Math.max(1, Math.min(12, Number(learnedSkill?.level || 1) || 1));
  const config = SKILL_CAST_CONFIGS[skillId >>> 0] ?? {};
  const targetEnemies = resolveSkillTargets(session, skillId, targetEntityId, skillLevel);
  session.log(
    `Combat skill request source=${sourceLabel} skillId=${skillId} rawTargetEntityId=${targetEntityId >>> 0} ` +
    `resolvedTargets=${targetEnemies.map((enemy) => `${enemy.entityId}[${enemy.row},${enemy.col}]`).join('|') || 'none'} ` +
    `multiTarget=${targetEnemies.length > 1 ? 1 : 0} ` +
    `roster=${describeEnemyRoster(session.combatState?.enemies)}`
  );
  if (config.requiresTarget !== false && targetEnemies.length <= 0) {
    session.log(
      `Combat skill use rejected source=${sourceLabel} skillId=${skillId} targetEntityId=${targetEntityId} reason=missing-target`
    );
    resendCombatCommandPrompt(session, 'skill-rejected-missing-target');
    return;
  }
  const primaryTarget = targetEnemies[0] || null;
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
  const { castTargets, pendingOutcomes, additionalDamageDealt, logSuffix } = resolveSkillEffect(
    session, skillId, skillLevel, targetEnemies, config, manaCost
  );
  sendCombatSkillCastPlayback(session, skillId, skillLevel, castTargets);
  if (additionalDamageDealt > 0) {
    session.combatState.damageDealt = Math.max(0, (session.combatState.damageDealt || 0) + additionalDamageDealt);
  }
  session.log(
    `Combat skill use ok source=${sourceLabel} skillId=${skillId} targetEntityId=${(primaryTarget?.entityId || session.entityType) >>> 0} ${logSuffix}`
  );
  session.combatState.pendingSkillOutcomes = pendingOutcomes;
  queuePostSkillEnemyResponse(session);
}

export function sendCombatSkillCastPlayback(
  session: GameSession,
  skillId: number,
  skillLevel: number,
  targets: Array<{ entityId: number; actionCode: number; value: number }>
): void {
  const normalizedSkillId = skillId >>> 0;
  const skillLevelIndex = Math.max(1, Math.min(12, skillLevel));
  const packetSkillId = (normalizedSkillId === SLAUGHTER_SKILL_ID && SLAUGHTER_PACKET_SKILL_ID_OVERRIDE > 0)
    ? SLAUGHTER_PACKET_SKILL_ID_OVERRIDE >>> 0
    : normalizedSkillId;
  const config = SKILL_CAST_CONFIGS[normalizedSkillId] ?? {};
  const packetSkillIdOverridden = packetSkillId !== normalizedSkillId;
  const useNativePacket = !packetSkillIdOverridden && !!(config.nativeEffectIds?.length);
  const useSlaughterStage2 = (skillId >>> 0) === SLAUGHTER_SKILL_ID && SLAUGHTER_PACKET_STAGE2_ENABLED;
  const probedTargets = buildSkillPacketProbeTargets(
    packetSkillId,
    skillLevel >>> 0,
    skillLevelIndex,
    session.entityType >>> 0,
    targets
  );
  const stage2Entries = buildSkillPacketProbeStage2Entries(
    packetSkillId,
    skillLevel >>> 0,
    skillLevelIndex,
    session.entityType >>> 0,
    probedTargets
  );
  const slaughterStage2Entries = useSlaughterStage2
    ? buildSkillPacketProbeStage2EntriesForSpec(
        SLAUGHTER_PACKET_STAGE2_SPEC,
        packetSkillId,
        skillLevel >>> 0,
        skillLevelIndex,
        session.entityType >>> 0,
        probedTargets
      )
    : [];
  const effectiveStage2Entries = useSlaughterStage2 ? slaughterStage2Entries : stage2Entries;
  const preludePacket = config.preludeEffectIds
    ? buildNativeCastPlaybackPacket(
        session.entityType >>> 0,
        packetSkillId,
        skillLevelIndex,
        config.preludeEffectIds,
        { leadingByte: 0 }
      )
    : null;
  const packet = useNativePacket
    ? buildNativeCastPlaybackPacket(
        session.entityType >>> 0,
        packetSkillId,
        skillLevelIndex,
        config.nativeEffectIds!,
        { leadingByte: 0 }
      )
    : buildSkillCastPlaybackPacket(
        session.entityType >>> 0,
        packetSkillId,
        skillLevelIndex,
        probedTargets,
        (SKILL_PACKET_PROBE_STAGE2_ENABLED || useSlaughterStage2)
          ? {
              stage2Flag: useSlaughterStage2 ? SLAUGHTER_PACKET_STAGE2_FLAG : SKILL_PACKET_PROBE_STAGE2_FLAG,
              stage2Entries: effectiveStage2Entries,
            }
          : {}
      );
  const delayedCastFallbackPacket = (useNativePacket && config.delayedCast)
    ? buildSkillCastPlaybackPacket(
        session.entityType >>> 0,
        packetSkillId,
        skillLevelIndex,
        probedTargets
      )
    : null;
  appendSkillPacketTrace({
    kind: 'skill-cast-outbound',
    ts: new Date().toISOString(),
    sessionId: session.id,
    skillId: skillId >>> 0,
    packetSkillId,
    skillLevel: skillLevel >>> 0,
    skillLevelIndex,
    stage2Enabled: SKILL_PACKET_PROBE_STAGE2_ENABLED || useSlaughterStage2,
    stage2Flag: (SKILL_PACKET_PROBE_STAGE2_ENABLED || useSlaughterStage2)
      ? ((useSlaughterStage2 ? SLAUGHTER_PACKET_STAGE2_FLAG : SKILL_PACKET_PROBE_STAGE2_FLAG) & 0xff)
      : null,
    stage2Spec: useSlaughterStage2 ? SLAUGHTER_PACKET_STAGE2_SPEC : (SKILL_PACKET_PROBE_STAGE2_ENABLED ? SKILL_PACKET_PROBE_STAGE2_SPEC : ''),
    nativePacket: useNativePacket,
    nativeEffectIds: useNativePacket ? config.nativeEffectIds : [],
    preludePacketHex: preludePacket ? preludePacket.toString('hex') : '',
    delayedCastFallbackPacketHex: delayedCastFallbackPacket ? delayedCastFallbackPacket.toString('hex') : '',
    targetProbe: {
      entity: SKILL_PACKET_PROBE_TARGET_ENTITY,
      action: SKILL_PACKET_PROBE_TARGET_ACTION,
      value: SKILL_PACKET_PROBE_TARGET_VALUE,
    },
    stage2Entries: effectiveStage2Entries,
    targets: probedTargets,
    packetHex: packet.toString('hex'),
  });
  if (preludePacket) {
    session.writePacket(
      preludePacket,
      DEFAULT_FLAGS,
      `Sending native-style prelude attacker=${session.entityType} skillId=${skillId} packetSkillId=${packetSkillId} levelIndex=${skillLevelIndex} effects=${config.preludeEffectIds!.join('|')}`
    );
  }
  session.writePacket(
    packet,
    DEFAULT_FLAGS,
    `Sending combat skill cast attacker=${session.entityType} skillId=${skillId} packetSkillId=${packetSkillId} levelIndex=${skillLevelIndex} targets=${probedTargets.map((target) => `${target.entityId}:${target.actionCode}:${target.value}`).join('|') || 'none'} stage2=${(SKILL_PACKET_PROBE_STAGE2_ENABLED || useSlaughterStage2) ? `${useSlaughterStage2 ? SLAUGHTER_PACKET_STAGE2_FLAG : SKILL_PACKET_PROBE_STAGE2_FLAG}:${effectiveStage2Entries.map((entry) => `${entry.wordA}/${entry.wordB}/${entry.dwordC}`).join('|') || 'none'}` : 'off'}`
  );
  if (delayedCastFallbackPacket) {
    session.combatState = {
      ...session.combatState,
      skillResolutionPhase: 'await-cast-ready',
      skillResolutionReason: 'skill-post-resolution-delayed-cast',
    };
    session.writePacket(
      delayedCastFallbackPacket,
      DEFAULT_FLAGS,
      `Sending delayed skill fallback cast probe attacker=${session.entityType} skillId=${skillId} packetSkillId=${packetSkillId} levelIndex=${skillLevelIndex} targets=${probedTargets.map((target) => `${target.entityId}:${target.actionCode}:${target.value}`).join('|') || 'none'}`
    );
  }
}

export function queuePostSkillEnemyResponse(session: GameSession): void {
  if (!session.combatState?.active) {
    return;
  }
  session.combatState.awaitingSkillResolution = true;
  session.combatState.skillResolutionStartedAt = Date.now();
  if (session.combatState.skillResolutionReason !== 'skill-post-resolution-delayed-cast') {
    session.combatState.skillResolutionReason = 'skill-post-resolution';
  }
  if (!session.combatState.skillResolutionPhase) {
    session.combatState.skillResolutionPhase = 'await-cast-ready';
  }
  if (session.combatSkillResolutionTimer) {
    clearTimeout(session.combatSkillResolutionTimer);
    session.combatSkillResolutionTimer = null;
  }
  session.log('Waiting for skill resolution client-ready event before enemy response');
}
