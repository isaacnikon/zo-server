import { DEFAULT_FLAGS, GAME_FIGHT_ACTION_CMD } from '../config.js';
import { buildSkillCastPlaybackPacket, buildSlaughterCastPlaybackPacket } from './packets.js';
import { getSkillDefinition } from '../gameplay/skill-definitions.js';
import { findLearnedSkill, incrementSkillProficiency, resolveEffectiveSkillLevel } from '../gameplay/skill-runtime.js';
import {
  resolveSkillTargets,
  FIREBALL_SKILL_ID,
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
  resolvePlayerMagicAttackRange,
  computeSkillDamage,
  resolveEnervateDuration,
  resolveEnervateAttackPenalty,
  describeLivingEnemies,
  resolveSlaughterTargetCount,
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

type CombatSkillPlan = {
  skillId: number;
  behavior: 'direct_damage' | 'heal' | 'buff_self' | 'debuff_enemy' | 'gather' | 'unknown';
  implementationClass: number | null;
  selectionMode: 'self' | 'enemy';
  followUpMode: 'none' | 'delayed_cast';
  allowEnemyCounterattack: boolean;
  description: string;
};

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

  const learnedSkill = findLearnedSkill(session, skillId >>> 0);
  if (!learnedSkill) {
    session.log(
      `Combat skill use rejected source=${sourceLabel} skillId=${skillId} targetEntityId=${targetEntityId} reason=not-learned`
    );
    resendCombatCommandPrompt(session, 'skill-rejected-not-learned');
    return;
  }

  const skillLevel = Math.max(1, Math.min(12, resolveEffectiveSkillLevel(session, skillId >>> 0)));
  const skillPlan = buildCombatSkillPlan(skillId);
  if (skillPlan.behavior === 'unknown') {
    session.log(
      `Combat skill use rejected source=${sourceLabel} skillId=${skillId} targetEntityId=${targetEntityId} reason=unsupported-implementation`
    );
    resendCombatCommandPrompt(session, 'skill-rejected-unsupported');
    return;
  }
  const slaughterTargetCapacity = (skillId >>> 0) === SLAUGHTER_SKILL_ID
    ? resolveSlaughterTargetCount(skillLevel)
    : 0;
  const slaughterFocused = (skillId >>> 0) === SLAUGHTER_SKILL_ID &&
    slaughterTargetCapacity > 1 &&
    Math.random() < SLAUGHTER_CONCENTRATION_CHANCE;
  const targetEnemies = skillPlan.selectionMode === 'enemy'
    ? resolveSkillTargets(session, skillId, targetEntityId, skillLevel)
    : [];
  const fireballExploded = (skillId >>> 0) === FIREBALL_SKILL_ID && targetEnemies.length > 1;
  session.log(
    `Combat skill request source=${sourceLabel} skillId=${skillId} rawTargetEntityId=${targetEntityId >>> 0} ` +
    `implClass=${skillPlan.implementationClass || 0} behavior=${skillPlan.behavior} selection=${skillPlan.selectionMode} followUp=${skillPlan.followUpMode} ` +
    `resolvedTargets=${targetEnemies.map((enemy) => `${enemy.entityId}[${enemy.row},${enemy.col}]`).join('|') || 'none'} ` +
    `fireballExploded=${fireballExploded ? 1 : 0} ` +
    `slaughterFocused=${slaughterFocused ? 1 : 0} ` +
    `roster=${describeEnemyRoster(session.combatState?.enemies)}`
  );
  if (skillPlan.selectionMode === 'enemy' && targetEnemies.length <= 0) {
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
  incrementSkillProficiency(session, skillId >>> 0);
  dispatchCombatSkillByImplementationClass(
    session,
    skillPlan,
    skillLevel,
    sourceLabel,
    targetEnemies,
    primaryTarget,
    slaughterFocused,
    fireballExploded
  );
}

export function sendCombatSkillCastPlayback(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  targets: Array<{ entityId: number; actionCode: number; value: number }>
): void {
  const normalizedSkillId = skillPlan.skillId >>> 0;
  const skillLevelIndex = Math.max(1, Math.min(12, skillLevel));
  const packetSkillId = (normalizedSkillId === SLAUGHTER_SKILL_ID && SLAUGHTER_PACKET_SKILL_ID_OVERRIDE > 0)
    ? SLAUGHTER_PACKET_SKILL_ID_OVERRIDE >>> 0
    : normalizedSkillId;
  const useNativeSlaughterPacket =
    skillPlan.implementationClass === 13 &&
    normalizedSkillId === SLAUGHTER_SKILL_ID &&
    packetSkillId === SLAUGHTER_SKILL_ID;
  const useSlaughterStage2 =
    skillPlan.implementationClass === 13 &&
    normalizedSkillId === SLAUGHTER_SKILL_ID &&
    SLAUGHTER_PACKET_STAGE2_ENABLED;
  const probedTargets = buildSkillPacketProbeTargets(
    packetSkillId,
    skillLevel >>> 0,
    skillLevelIndex,
    session.runtimeId >>> 0,
    targets
  );
  const stage2Entries = buildSkillPacketProbeStage2Entries(
    packetSkillId,
    skillLevel >>> 0,
    skillLevelIndex,
    session.runtimeId >>> 0,
    probedTargets
  );
  const slaughterStage2Entries = useSlaughterStage2
    ? buildSkillPacketProbeStage2EntriesForSpec(
        SLAUGHTER_PACKET_STAGE2_SPEC,
        packetSkillId,
        skillLevel >>> 0,
        skillLevelIndex,
        session.runtimeId >>> 0,
        probedTargets
      )
    : [];
  const effectiveStage2Entries = useSlaughterStage2 ? slaughterStage2Entries : stage2Entries;
  const packet = useNativeSlaughterPacket
    ? buildSlaughterCastPlaybackPacket(
        session.runtimeId >>> 0,
        packetSkillId,
        skillLevelIndex,
        [1152, 1153],
        { leadingByte: 0 }
      )
    : buildSkillCastPlaybackPacket(
        session.runtimeId >>> 0,
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
  const delayedCastFallbackPacket = useNativeSlaughterPacket
    ? buildSkillCastPlaybackPacket(
        session.runtimeId >>> 0,
        packetSkillId,
        skillLevelIndex,
        probedTargets
      )
    : null;
  appendSkillPacketTrace({
    kind: 'skill-cast-outbound',
    ts: new Date().toISOString(),
    sessionId: session.id,
    skillId: normalizedSkillId,
    packetSkillId,
    skillLevel: skillLevel >>> 0,
    skillLevelIndex,
    implementationClass: skillPlan.implementationClass,
    followUpMode: skillPlan.followUpMode,
    stage2Enabled: SKILL_PACKET_PROBE_STAGE2_ENABLED || useSlaughterStage2,
    stage2Flag: (SKILL_PACKET_PROBE_STAGE2_ENABLED || useSlaughterStage2)
      ? ((useSlaughterStage2 ? SLAUGHTER_PACKET_STAGE2_FLAG : SKILL_PACKET_PROBE_STAGE2_FLAG) & 0xff)
      : null,
    stage2Spec: useSlaughterStage2 ? SLAUGHTER_PACKET_STAGE2_SPEC : (SKILL_PACKET_PROBE_STAGE2_ENABLED ? SKILL_PACKET_PROBE_STAGE2_SPEC : ''),
    slaughterNativePacket: useNativeSlaughterPacket,
    slaughterCleanupEffectIds: useNativeSlaughterPacket ? [1152, 1153] : [],
    slaughterFallbackPacketHex: delayedCastFallbackPacket ? delayedCastFallbackPacket.toString('hex') : '',
    targetProbe: {
      entity: SKILL_PACKET_PROBE_TARGET_ENTITY,
      action: SKILL_PACKET_PROBE_TARGET_ACTION,
      value: SKILL_PACKET_PROBE_TARGET_VALUE,
    },
    stage2Entries: effectiveStage2Entries,
    targets: probedTargets,
    packetHex: packet.toString('hex'),
  });
  session.writePacket(
    packet,
    DEFAULT_FLAGS,
    `Sending combat skill cast attacker=${session.runtimeId} skillId=${normalizedSkillId} packetSkillId=${packetSkillId} implClass=${skillPlan.implementationClass || 0} levelIndex=${skillLevelIndex} targets=${probedTargets.map((target) => `${target.entityId}:${target.actionCode}:${target.value}`).join('|') || 'none'} stage2=${(SKILL_PACKET_PROBE_STAGE2_ENABLED || useSlaughterStage2) ? `${useSlaughterStage2 ? SLAUGHTER_PACKET_STAGE2_FLAG : SKILL_PACKET_PROBE_STAGE2_FLAG}:${effectiveStage2Entries.map((entry) => `${entry.wordA}/${entry.wordB}/${entry.dwordC}`).join('|') || 'none'}` : 'off'}`
  );
  if (delayedCastFallbackPacket && skillPlan.followUpMode === 'delayed_cast') {
    session.combatState = {
      ...session.combatState,
      skillResolutionPhase: 'await-cast-ready',
      skillResolutionReason: 'skill-post-resolution-delayed-cast',
    };
    session.writePacket(
      delayedCastFallbackPacket,
      DEFAULT_FLAGS,
      `Sending delayed skill follow-up cast attacker=${session.runtimeId} skillId=${normalizedSkillId} packetSkillId=${packetSkillId} implClass=${skillPlan.implementationClass || 0} levelIndex=${skillLevelIndex} targets=${probedTargets.map((target) => `${target.entityId}:${target.actionCode}:${target.value}`).join('|') || 'none'}`
    );
  }
}

export function queuePostSkillEnemyResponse(session: GameSession, skillPlan: CombatSkillPlan): void {
  if (!session.combatState?.active) {
    return;
  }
  session.combatState.pendingSkillContext = {
    skillId: skillPlan.skillId >>> 0,
    implementationClass: skillPlan.implementationClass,
    followUpMode: skillPlan.followUpMode,
    allowEnemyCounterattack: skillPlan.allowEnemyCounterattack,
  };
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

function buildCombatSkillPlan(skillId: number): CombatSkillPlan {
  const definition = getSkillDefinition(skillId >>> 0);
  return {
    skillId: skillId >>> 0,
    behavior: definition?.behavior || 'unknown',
    implementationClass: definition?.implementationClass ?? null,
    selectionMode: definition?.selectionMode || 'enemy',
    followUpMode: definition?.followUpMode || 'none',
    allowEnemyCounterattack: definition?.allowEnemyCounterattack !== false,
    description: String(definition?.description || ''),
  };
}

function dispatchCombatSkillByImplementationClass(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  primaryTarget: Record<string, any> | null,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  switch (skillPlan.implementationClass) {
    case 1:
      handleImplementationClass1(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
      return;
    case 2:
      handleImplementationClass2(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
      return;
    case 3:
      handleImplementationClass3(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
      return;
    case 4:
      handleImplementationClass4(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
      return;
    case 5:
      handleImplementationClass5(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
      return;
    case 6:
      handleImplementationClass6(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
      return;
    case 7:
      handleImplementationClass7(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
      return;
    case 8:
      handleImplementationClass8(session, skillPlan, skillLevel, sourceLabel);
      return;
    case 9:
      handleImplementationClass9(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
      return;
    case 10:
      handleImplementationClass10(session, skillPlan, skillLevel, sourceLabel, targetEnemies, primaryTarget, slaughterFocused, fireballExploded);
      return;
    case 11:
      handleImplementationClass11(session, skillPlan, skillLevel, sourceLabel);
      return;
    case 12:
      handleImplementationClass12(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
      return;
    case 13:
      handleImplementationClass13(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
      return;
    case 14:
      handleImplementationClass14(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
      return;
    case 15:
      handleImplementationClass15(session, skillPlan, skillLevel, sourceLabel);
      return;
    case 16:
      handleImplementationClass16(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
      return;
    default:
      dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
  }
}

function dispatchCombatSkillByBehavior(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  if (skillPlan.behavior === 'buff_self') {
    handleCombatBuffSkillUse(session, skillPlan, skillLevel, sourceLabel);
    return;
  }
  if (skillPlan.behavior === 'heal') {
    handleCombatHealSkillUse(session, skillPlan, skillLevel, sourceLabel);
    return;
  }
  handleCombatOffensiveSkillUse(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
}

function handleCombatBuffSkillUse(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string
): void {
  sendCombatSkillCastPlayback(session, skillPlan, skillLevel, [{
    entityId: session.runtimeId >>> 0,
    actionCode: 0,
    value: 0,
  }]);

  if ((skillPlan.skillId >>> 0) === DEFIANT_SKILL_ID) {
    const durationRounds = resolveDefiantDuration(skillLevel);
    const defenseBonusPercent = DEFIANT_DEFENSE_BONUS_BY_LEVEL[Math.max(0, skillLevel - 1)] || 20;
    session.combatState.playerStatus = {
      ...session.combatState.playerStatus,
      defiantRoundsRemaining: durationRounds,
      defiantDefenseBonusPercent: defenseBonusPercent,
      defiantAttackPenaltyPercent: 10,
    };
    session.log(
      `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${session.runtimeId} effect=defiant rounds=${durationRounds} defenseBonus=${defenseBonusPercent}`
    );
  } else {
    session.log(
      `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${session.runtimeId} effect=generic-buff implClass=${skillPlan.implementationClass || 0}`
    );
  }

  session.combatState.pendingSkillOutcomes = null;
  queuePostSkillEnemyResponse(session, skillPlan);
}

function handleCombatHealSkillUse(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string
): void {
  const healAmount = resolveGenericSkillHealing(session, skillPlan.skillId, skillLevel);
  const previousHealth = Math.max(0, session.currentHealth || 0);
  const maxHealth = Math.max(previousHealth, session.maxHealth || previousHealth || 1);
  const appliedHeal = Math.max(0, Math.min(maxHealth - previousHealth, healAmount));
  session.currentHealth = Math.max(0, Math.min(maxHealth, previousHealth + healAmount));
  sendCombatSkillCastPlayback(session, skillPlan, skillLevel, [{
    entityId: session.runtimeId >>> 0,
    actionCode: 1,
    value: Math.max(1, appliedHeal || healAmount || 1),
  }]);
  session.log(
    `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${session.runtimeId} effect=generic-heal healed=${appliedHeal} hp=${session.currentHealth}/${maxHealth}`
  );
  session.combatState.pendingSkillOutcomes = [{
    skillId: skillPlan.skillId >>> 0,
    targetEntityId: session.runtimeId >>> 0,
    healAmount: appliedHeal,
  }];
  queuePostSkillEnemyResponse(session, skillPlan);
}

function resolveGenericSkillHealing(session: GameSession, skillId: number, skillLevel: number): number {
  const explicit = resolveSkillHealing(session, skillId, skillLevel);
  if (explicit > 0) {
    return explicit;
  }
  const magicRange = resolvePlayerMagicAttackRange(session);
  const base = Math.max(1, magicRange.min || 1);
  return Math.max(1, Math.round(base * (1 + (Math.max(1, skillLevel) * 0.04))));
}

function handleCombatOffensiveSkillUse(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  const skillId = skillPlan.skillId >>> 0;
  const castTargets: Array<{ entityId: number; actionCode: number; value: number }> = [];
  const pendingOutcomes: Array<{ skillId: number; targetEntityId: number; playerDamage: number; targetDied: boolean }> = [];
  let totalAppliedDamage = 0;
  const effectiveTargets = slaughterFocused && targetEnemies[0] ? [targetEnemies[0]] : targetEnemies;
  const slaughterDamageMultiplier = slaughterFocused ? Math.max(1, targetEnemies.length) : 1;
  for (const targetEnemy of effectiveTargets) {
    const baseDamage = computeSkillDamage(session, skillId, skillLevel, targetEnemy);
    const playerDamage = Math.max(1, baseDamage * slaughterDamageMultiplier);
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
    if (skillId === ENERVATE_SKILL_ID) {
      session.combatState.enemyStatuses[targetEnemy.entityId >>> 0] = {
        enervateRoundsRemaining: resolveEnervateDuration(skillLevel),
        enervateAttackPenaltyPercent: resolveEnervateAttackPenalty(skillLevel),
      };
    }
  }
  sendCombatSkillCastPlayback(session, skillPlan, skillLevel, castTargets);
  session.combatState.damageDealt = Math.max(0, (session.combatState.damageDealt || 0) + totalAppliedDamage);
  session.log(
    `Combat skill use ok source=${sourceLabel} skillId=${skillId} class=${skillPlan.implementationClass || 0} targetCount=${pendingOutcomes.length} totalDamage=${totalAppliedDamage} fireballExploded=${fireballExploded ? 1 : 0} slaughterFocused=${slaughterFocused ? 1 : 0} remaining=${describeLivingEnemies(session.combatState.enemies)}`
  );
  session.combatState.pendingSkillOutcomes = pendingOutcomes;
  queuePostSkillEnemyResponse(session, skillPlan);
}

function handleImplementationClass1(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
}

function handleImplementationClass2(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
}

function handleImplementationClass3(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
}

function handleImplementationClass4(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
}

function handleImplementationClass5(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  handleCombatOffensiveSkillUse(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
}

function handleImplementationClass6(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
}

function handleImplementationClass7(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
}

function handleImplementationClass8(session: GameSession, skillPlan: CombatSkillPlan, skillLevel: number, sourceLabel: string): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, [], false, false);
}

function handleImplementationClass9(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
}

function handleImplementationClass10(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  _primaryTarget: Record<string, any> | null,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
}

function handleImplementationClass11(session: GameSession, skillPlan: CombatSkillPlan, skillLevel: number, sourceLabel: string): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, [], false, false);
}

function handleImplementationClass12(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
}

function handleImplementationClass13(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
}

function handleImplementationClass14(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
}

function handleImplementationClass15(session: GameSession, skillPlan: CombatSkillPlan, skillLevel: number, sourceLabel: string): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, [], false, false);
}

function handleImplementationClass16(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded);
}
