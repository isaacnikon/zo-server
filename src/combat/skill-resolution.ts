import { DEFAULT_FLAGS, GAME_FIGHT_ACTION_CMD } from '../config.js';
import { buildSkillCastPlaybackPacket, buildSlaughterCastPlaybackPacket } from './packets.js';
import { getSkillDefinition } from '../gameplay/skill-definitions.js';
import { ensureSkillState, findLearnedSkill, incrementSkillProficiency, resolveEffectiveSkillLevel } from '../gameplay/skill-runtime.js';
import {
  resolveSkillTargets,
  BLEED_SKILL_ID,
  BLOOD_DRAIN_SKILL_ID,
  BLIZZARD_SKILL_ID,
  CONCEAL_SKILL_ID,
  CONFUSE_SKILL_ID,
  CRASH_SKILL_ID,
  FIREBALL_SKILL_ID,
  FROST_BOLT_SKILL_ID,
  HYPNOSIS_SKILL_ID,
  SEAL_SKILL_ID,
  SLOW_DOWN_SKILL_ID,
  SOUL_FIRE_SKILL_ID,
  STUN_SKILL_ID,
  SLAUGHTER_SKILL_ID,
  SLAUGHTER_CONCENTRATION_CHANCE,
  SLAUGHTER_PACKET_SKILL_ID_OVERRIDE,
  SLAUGHTER_PACKET_STAGE2_ENABLED,
  SLAUGHTER_PACKET_STAGE2_FLAG,
  SLAUGHTER_PACKET_STAGE2_SPEC,
  DEFIANT_SKILL_ID,
  ENERVATE_SKILL_ID,
  UTMOST_STRIKE_SKILL_ID,
  CURE_SKILL_ID,
  describeEnemyRoster,
  computePlayerDamage,
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
  findEnemyByEntityId,
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
  PUZZLE_SKILL_ID,
  DEDICATE_SKILL_ID,
  DISPEL_SKILL_ID,
  resolvePuzzleManaCostReduction,
  resolveBleedDamagePerRound,
  resolveBleedDuration,
  resolveBloodDrainHealAmount,
  resolveConcealDuration,
  DIVINE_BLESS_SKILL_ID,
  GOSPEL_SKILL_ID,
  HASTE_SKILL_ID,
  LIONS_ROAR_SKILL_ID,
  PET_HEALING_SKILL_ID,
  REGENERATE_SKILL_ID,
  resolveDivineBlessDuration,
  resolveDivineBlessMagicAttackBonus,
  resolveDivineBlessMagicDefenseBonus,
  resolveGospelDuration,
  resolveGospelHealAmount,
  resolveHasteDuration,
  resolveLionRoarAttackBonus,
  resolveLionRoarDefenseBonus,
  resolveLionRoarDuration,
  resolveRegenerateDuration,
  resolveRegenerateHealAmount,
  REVIVE_SKILL_ID,
  SACRIFICE_SKILL_ID,
} from './combat-formulas.js';
import {
  finalizeSkillResolutionAndEnemyTurn,
  resendCombatCommandPrompt,
  resolveSharedTeamQueuedTurn,
} from './combat-resolution.js';
import {
  areAllSharedTeamCombatActionsReady,
  getSharedTeamCombatOwnerSession,
  setSharedTeamCombatQueuedAction,
} from '../gameplay/team-runtime.js';
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

type EnemyDisableEffect = {
  reason: 'confuse' | 'freeze' | 'seal' | 'sleep' | 'slow' | 'stun';
  rounds: number;
  chancePercent: number;
};

type NativeSkillPlaybackProfileDefinition = {
  skillId: number;
  implementationClass: number | null;
  profileName: string;
  nativePreludeEffectIds: number[];
  delayedFollowUp: boolean;
  packetSkillIdOverride?: number | null;
  requireNativePacketSkillIdMatch?: boolean;
  stage2Enabled?: boolean;
  stage2Flag?: number | null;
  stage2Spec?: string;
};

type ResolvedSkillPlaybackProfile = {
  packetSkillId: number;
  profileName: string | null;
  nativePreludeEffectIds: number[];
  delayedFollowUp: boolean;
  stage2Enabled: boolean;
  stage2Flag: number | null;
  stage2Spec: string;
};

const SLAUGHTER_NATIVE_EFFECT_IDS = [1152, 1153];
const BLIZZARD_NATIVE_EFFECT_IDS = [1170, 1171, 1172];
const NATIVE_SKILL_PLAYBACK_PROFILES: NativeSkillPlaybackProfileDefinition[] = [
  {
    skillId: SLAUGHTER_SKILL_ID,
    implementationClass: 13,
    profileName: 'slaughter',
    nativePreludeEffectIds: SLAUGHTER_NATIVE_EFFECT_IDS,
    delayedFollowUp: true,
    packetSkillIdOverride: SLAUGHTER_PACKET_SKILL_ID_OVERRIDE,
    requireNativePacketSkillIdMatch: true,
    stage2Enabled: SLAUGHTER_PACKET_STAGE2_ENABLED,
    stage2Flag: SLAUGHTER_PACKET_STAGE2_FLAG,
    stage2Spec: SLAUGHTER_PACKET_STAGE2_SPEC,
  },
  {
    skillId: BLIZZARD_SKILL_ID,
    implementationClass: 16,
    profileName: 'blizzard',
    nativePreludeEffectIds: BLIZZARD_NATIVE_EFFECT_IDS,
    delayedFollowUp: true,
    requireNativePacketSkillIdMatch: true,
  },
];

function resolveSkillPlaybackProfile(skillPlan: CombatSkillPlan): ResolvedSkillPlaybackProfile {
  const normalizedSkillId = skillPlan.skillId >>> 0;
  const definition = NATIVE_SKILL_PLAYBACK_PROFILES.find((profile) =>
    profile.skillId === normalizedSkillId &&
    profile.implementationClass === skillPlan.implementationClass
  );
  const packetSkillId = definition?.packetSkillIdOverride && definition.packetSkillIdOverride > 0
    ? definition.packetSkillIdOverride >>> 0
    : normalizedSkillId;
  const nativePreludeEnabled =
    Array.isArray(definition?.nativePreludeEffectIds) &&
    definition.nativePreludeEffectIds.length > 0 &&
    (definition.requireNativePacketSkillIdMatch !== true || packetSkillId === normalizedSkillId);

  return {
    packetSkillId,
    profileName: nativePreludeEnabled ? (definition?.profileName || null) : null,
    nativePreludeEffectIds: nativePreludeEnabled ? [...(definition?.nativePreludeEffectIds || [])] : [],
    delayedFollowUp: nativePreludeEnabled && definition?.delayedFollowUp === true,
    stage2Enabled: definition?.stage2Enabled === true,
    stage2Flag: definition?.stage2Enabled === true ? ((definition.stage2Flag || 0) & 0xff) : null,
    stage2Spec: definition?.stage2Enabled === true ? String(definition.stage2Spec || '') : '',
  };
}

export function handleCombatSkillUse(session: GameSession, payload: Buffer): void {
  const skillId = payload.readUInt16LE(3) & 0xffff;
  const targetEntityId = payload.readUInt32LE(5) >>> 0;
  if (tryHandleSharedTeamSkillSelection(session, skillId, targetEntityId)) {
    return;
  }
  resolveCombatSkillUse(
    session,
    skillId,
    targetEntityId,
    `cmd=0x${GAME_FIGHT_ACTION_CMD.toString(16)} sub=0x${payload[2].toString(16)}`
  );
}

function tryHandleSharedTeamSkillSelection(
  session: GameSession,
  skillId: number,
  targetEntityId: number
): boolean {
  const owner = getSharedTeamCombatOwnerSession(session);
  if (!owner || !owner.combatState?.active) {
    return false;
  }

  if (!session.combatState?.active || !session.combatState.awaitingPlayerAction) {
    session.log(`Ignoring combat round skill selection without command prompt active=${session.combatState?.active ? 1 : 0}`);
    return true;
  }

  const skillState = ensureSkillState(session);
  skillState.lastCombatAction = 'skill';
  skillState.lastCombatSkillId = skillId & 0xffff;

  session.combatState.awaitingPlayerAction = false;
  session.combatState.awaitingClientReady = false;
  session.combatState.phase = 'resolved';
  setSharedTeamCombatQueuedAction(owner, session, {
    round: Math.max(1, owner.combatState.round || 1),
    kind: 'skill',
    skillId: skillId & 0xffff,
    targetEntityId: targetEntityId >>> 0,
  });
  session.log(
    `Queued combat round skill selection round=${owner.combatState.round} skillId=${skillId & 0xffff} targetEntityId=${targetEntityId >>> 0} ownerSession=${owner.id >>> 0}`
  );

  if (!areAllSharedTeamCombatActionsReady(owner)) {
    return true;
  }

  resolveSharedTeamQueuedTurn(owner);
  return true;
}

export function resolveCombatSkillUse(
  session: GameSession,
  skillId: number,
  targetEntityId: number,
  sourceLabel: string,
  options: {
    deferSharedTeamPostResolution?: boolean;
  } = {}
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
  if (
    (session.combatState?.playerStatus?.concealRoundsRemaining || 0) > 0 &&
    (skillId >>> 0) !== CONCEAL_SKILL_ID
  ) {
    session.log(
      `Combat skill use rejected source=${sourceLabel} skillId=${skillId} targetEntityId=${targetEntityId} reason=concealed`
    );
    resendCombatCommandPrompt(session, 'skill-rejected-concealed');
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
  const effectiveSelectionMode = resolveSkillSelectionMode(session, skillPlan, targetEntityId);
  const slaughterFocused = (skillId >>> 0) === SLAUGHTER_SKILL_ID &&
    slaughterTargetCapacity > 1 &&
    Math.random() < SLAUGHTER_CONCENTRATION_CHANCE;
  const targetEnemies = effectiveSelectionMode === 'enemy'
    ? resolveSkillTargets(session, skillId, targetEntityId, skillLevel, {
        strictTargetLock: options.deferSharedTeamPostResolution === true,
      })
    : [];
  const fireballExploded = (skillId >>> 0) === FIREBALL_SKILL_ID && targetEnemies.length > 1;
  session.log(
    `Combat skill request source=${sourceLabel} skillId=${skillId} rawTargetEntityId=${targetEntityId >>> 0} ` +
    `implClass=${skillPlan.implementationClass || 0} behavior=${skillPlan.behavior} selection=${skillPlan.selectionMode}->${effectiveSelectionMode} followUp=${skillPlan.followUpMode} ` +
    `resolvedTargets=${targetEnemies.map((enemy) => `${enemy.entityId}[${enemy.row},${enemy.col}]`).join('|') || 'none'} ` +
    `fireballExploded=${fireballExploded ? 1 : 0} ` +
    `slaughterFocused=${slaughterFocused ? 1 : 0} ` +
    `roster=${describeEnemyRoster(session.combatState?.enemies)}`
  );
  if (effectiveSelectionMode === 'enemy' && targetEnemies.length <= 0) {
    session.log(
      `Combat skill use rejected source=${sourceLabel} skillId=${skillId} targetEntityId=${targetEntityId} reason=missing-target`
    );
    resendCombatCommandPrompt(session, 'skill-rejected-missing-target');
    return;
  }
  const primaryTarget = targetEnemies[0] || null;
  const unsupportedReason = resolveUnsupportedCombatSkillReason(skillId);
  if (unsupportedReason) {
    session.log(
      `Combat skill use rejected source=${sourceLabel} skillId=${skillId} targetEntityId=${targetEntityId} reason=${unsupportedReason}`
    );
    resendCombatCommandPrompt(session, unsupportedReason);
    return;
  }
  const manaCost = resolveAdjustedSkillManaCost(session, skillId, skillLevel);
  if ((session.currentMana || 0) < manaCost) {
    session.log(
      `Combat skill use rejected source=${sourceLabel} skillId=${skillId} targetEntityId=${targetEntityId} reason=insufficient-mana currentMana=${session.currentMana || 0} cost=${manaCost}`
    );
    resendCombatCommandPrompt(session, 'skill-rejected-mana');
    return;
  }

  const skillState = ensureSkillState(session);
  skillState.lastCombatAction = 'skill';
  skillState.lastCombatSkillId = skillId >>> 0;

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
    fireballExploded,
    options
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
  const playbackProfile = resolveSkillPlaybackProfile(skillPlan);
  const packetSkillId = playbackProfile.packetSkillId >>> 0;
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
  const profileStage2Entries = playbackProfile.stage2Enabled
    ? buildSkillPacketProbeStage2EntriesForSpec(
        playbackProfile.stage2Spec,
        packetSkillId,
        skillLevel >>> 0,
        skillLevelIndex,
        session.runtimeId >>> 0,
        probedTargets
      )
    : [];
  const effectiveStage2Entries = playbackProfile.stage2Enabled ? profileStage2Entries : stage2Entries;
  const packet = playbackProfile.nativePreludeEffectIds.length > 0
    ? buildSlaughterCastPlaybackPacket(
        session.runtimeId >>> 0,
        packetSkillId,
        skillLevelIndex,
        playbackProfile.nativePreludeEffectIds,
        { leadingByte: 0 }
      )
    : buildSkillCastPlaybackPacket(
        session.runtimeId >>> 0,
        packetSkillId,
        skillLevelIndex,
        probedTargets,
        (SKILL_PACKET_PROBE_STAGE2_ENABLED || playbackProfile.stage2Enabled)
          ? {
              stage2Flag: playbackProfile.stage2Enabled
                ? (playbackProfile.stage2Flag || 0)
                : SKILL_PACKET_PROBE_STAGE2_FLAG,
              stage2Entries: effectiveStage2Entries,
            }
          : {}
      );
  const delayedCastFallbackPacket = playbackProfile.delayedFollowUp
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
    stage2Enabled: SKILL_PACKET_PROBE_STAGE2_ENABLED || playbackProfile.stage2Enabled,
    stage2Flag: (SKILL_PACKET_PROBE_STAGE2_ENABLED || playbackProfile.stage2Enabled)
      ? ((playbackProfile.stage2Enabled ? (playbackProfile.stage2Flag || 0) : SKILL_PACKET_PROBE_STAGE2_FLAG) & 0xff)
      : null,
    stage2Spec: playbackProfile.stage2Enabled ? playbackProfile.stage2Spec : (SKILL_PACKET_PROBE_STAGE2_ENABLED ? SKILL_PACKET_PROBE_STAGE2_SPEC : ''),
    nativePreludeProfile: playbackProfile.profileName,
    nativePreludeEffectIds: playbackProfile.nativePreludeEffectIds,
    followUpCastPacketHex: delayedCastFallbackPacket ? delayedCastFallbackPacket.toString('hex') : '',
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
    `Sending combat skill cast attacker=${session.runtimeId} skillId=${normalizedSkillId} packetSkillId=${packetSkillId} implClass=${skillPlan.implementationClass || 0} levelIndex=${skillLevelIndex} targets=${probedTargets.map((target) => `${target.entityId}:${target.actionCode}:${target.value}`).join('|') || 'none'} prelude=${playbackProfile.profileName || 'none'} stage2=${(SKILL_PACKET_PROBE_STAGE2_ENABLED || playbackProfile.stage2Enabled) ? `${playbackProfile.stage2Enabled ? (playbackProfile.stage2Flag || 0) : SKILL_PACKET_PROBE_STAGE2_FLAG}:${effectiveStage2Entries.map((entry) => `${entry.wordA}/${entry.wordB}/${entry.dwordC}`).join('|') || 'none'}` : 'off'}`
  );
  if (delayedCastFallbackPacket && (skillPlan.followUpMode === 'delayed_cast' || playbackProfile.delayedFollowUp)) {
    session.combatState = {
      ...session.combatState,
      skillResolutionPhase: 'await-cast-ready',
      skillResolutionReason: 'skill-post-resolution-delayed-cast',
    };
    session.writePacket(
      delayedCastFallbackPacket,
      DEFAULT_FLAGS,
      `Sending delayed skill follow-up cast attacker=${session.runtimeId} skillId=${normalizedSkillId} packetSkillId=${packetSkillId} implClass=${skillPlan.implementationClass || 0} levelIndex=${skillLevelIndex} targets=${probedTargets.map((target) => `${target.entityId}:${target.actionCode}:${target.value}`).join('|') || 'none'} mode=${playbackProfile.profileName ? `${playbackProfile.profileName}-native` : 'delayed-cast'}`
    );
  }
}

export function queuePostSkillEnemyResponse(session: GameSession, skillPlan: CombatSkillPlan): void {
  queuePostSkillEnemyResponseWithOptions(session, skillPlan, {});
}

export function queuePostSkillEnemyResponseWithOptions(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  if (!session.combatState?.active) {
    return;
  }
  session.combatState.pendingSkillContext = {
    skillId: skillPlan.skillId >>> 0,
    implementationClass: skillPlan.implementationClass,
    followUpMode: skillPlan.followUpMode,
    allowEnemyCounterattack: skillPlan.allowEnemyCounterattack,
    deferSharedTeamPostResolution: options.deferSharedTeamPostResolution === true,
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

function resolveSkillSelectionMode(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  targetEntityId: number
): 'self' | 'enemy' {
  if ((skillPlan.skillId >>> 0) === DISPEL_SKILL_ID) {
    return findEnemyByEntityId(session.combatState?.enemies, targetEntityId >>> 0) ? 'enemy' : 'self';
  }
  if ((skillPlan.skillId >>> 0) === BLOOD_DRAIN_SKILL_ID) {
    return 'enemy';
  }
  if ((skillPlan.skillId >>> 0) === CONCEAL_SKILL_ID) {
    return 'self';
  }
  return skillPlan.selectionMode;
}

function resolveAdjustedSkillManaCost(session: GameSession, skillId: number, skillLevel: number): number {
  const baseCost = resolveSkillManaCost(skillId, skillLevel);
  const reductionPercent = Math.max(0, Math.min(80, session.combatState?.playerStatus?.puzzleManaCostReductionPercent || 0));
  if (reductionPercent <= 0) {
    return baseCost;
  }
  return Math.max(0, Math.round(baseCost * (1 - (reductionPercent / 100))));
}

function resolveUnsupportedCombatSkillReason(skillId: number): string | null {
  switch (skillId >>> 0) {
    case PET_HEALING_SKILL_ID:
      return 'skill-rejected-no-pet-combat-target';
    case REVIVE_SKILL_ID:
      return 'skill-rejected-no-dead-ally-target';
    case SACRIFICE_SKILL_ID:
      return 'skill-rejected-no-ally-combat-target';
    default:
      return null;
  }
}

function dispatchCombatSkillByImplementationClass(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  primaryTarget: Record<string, any> | null,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  switch (skillPlan.implementationClass) {
    case 1:
      handleImplementationClass1(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
      return;
    case 2:
      handleImplementationClass2(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
      return;
    case 3:
      handleImplementationClass3(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
      return;
    case 4:
      handleImplementationClass4(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
      return;
    case 5:
      handleImplementationClass5(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
      return;
    case 6:
      handleImplementationClass6(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
      return;
    case 7:
      handleImplementationClass7(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
      return;
    case 8:
      handleImplementationClass8(session, skillPlan, skillLevel, sourceLabel, options);
      return;
    case 9:
      handleImplementationClass9(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
      return;
    case 10:
      handleImplementationClass10(session, skillPlan, skillLevel, sourceLabel, targetEnemies, primaryTarget, slaughterFocused, fireballExploded, options);
      return;
    case 11:
      handleImplementationClass11(session, skillPlan, skillLevel, sourceLabel, options);
      return;
    case 12:
      handleImplementationClass12(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
      return;
    case 13:
      handleImplementationClass13(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
      return;
    case 14:
      handleImplementationClass14(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
      return;
    case 15:
      handleImplementationClass15(session, skillPlan, skillLevel, sourceLabel, options);
      return;
    case 16:
      handleImplementationClass16(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
      return;
    default:
      dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
  }
}

function dispatchCombatSkillByBehavior(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  if (skillPlan.behavior === 'buff_self') {
    handleCombatBuffSkillUse(session, skillPlan, skillLevel, sourceLabel, options);
    return;
  }
  if ((skillPlan.skillId >>> 0) === BLOOD_DRAIN_SKILL_ID) {
    handleCombatDrainSkillUse(session, skillPlan, skillLevel, sourceLabel, targetEnemies, options);
    return;
  }
  if (skillPlan.behavior === 'heal') {
    handleCombatHealSkillUse(session, skillPlan, skillLevel, sourceLabel, options);
    return;
  }
  if (skillPlan.selectionMode === 'self') {
    handleCombatSupportSkillUse(session, skillPlan, skillLevel, sourceLabel, targetEnemies, options);
    return;
  }
  handleCombatOffensiveSkillUse(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
}

function handleCombatSupportSkillUse(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  const primaryEnemy = targetEnemies[0] || null;
  const castTargetEntityId = primaryEnemy ? (primaryEnemy.entityId >>> 0) : (session.runtimeId >>> 0);
  sendCombatSkillCastPlayback(session, skillPlan, skillLevel, [{
    entityId: castTargetEntityId,
    actionCode: 0,
    value: 0,
  }]);

  if ((skillPlan.skillId >>> 0) === PUZZLE_SKILL_ID) {
    const reductionPercent = resolvePuzzleManaCostReduction(skillLevel);
    session.combatState.playerStatus = {
      ...session.combatState.playerStatus,
      puzzleRoundsRemaining: 2,
      puzzleManaCostReductionPercent: reductionPercent,
    };
    session.log(
      `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${session.runtimeId} effect=puzzle rounds=2 manaReduction=${reductionPercent}`
    );
    session.combatState.pendingSkillOutcomes = null;
    queuePostSkillEnemyResponseWithOptions(session, skillPlan, options);
    return;
  }

  if ((skillPlan.skillId >>> 0) === DEDICATE_SKILL_ID) {
    session.log(
      `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${session.runtimeId} effect=dedicate nextEnemyCounterattack=skipped`
    );
    session.combatState.pendingSkillOutcomes = null;
    queuePostSkillEnemyResponseWithOptions(session, {
      ...skillPlan,
      allowEnemyCounterattack: false,
    }, options);
    return;
  }

  if ((skillPlan.skillId >>> 0) === DISPEL_SKILL_ID) {
    let removed = 0;
    if (primaryEnemy) {
      if (session.combatState.enemyStatuses?.[primaryEnemy.entityId >>> 0]) {
        delete session.combatState.enemyStatuses[primaryEnemy.entityId >>> 0];
        removed += 1;
      }
      session.log(
        `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${primaryEnemy.entityId} effect=enemy-dispel removed=${removed}`
      );
    } else {
      removed += clearPlayerSupportDebuffs(session);
      session.log(
        `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${session.runtimeId} effect=self-cleanse removed=${removed}`
      );
    }
    session.combatState.pendingSkillOutcomes = null;
    queuePostSkillEnemyResponseWithOptions(session, skillPlan, options);
    return;
  }

  if ((skillPlan.skillId >>> 0) === CONCEAL_SKILL_ID) {
    const durationRounds = resolveConcealDuration(skillLevel);
    session.combatState.playerStatus = {
      ...session.combatState.playerStatus,
      concealRoundsRemaining: durationRounds,
    };
    session.log(
      `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${session.runtimeId} effect=conceal rounds=${durationRounds}`
    );
    session.combatState.pendingSkillOutcomes = null;
    queuePostSkillEnemyResponseWithOptions(session, skillPlan, options);
    return;
  }

  session.log(
    `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${castTargetEntityId} effect=generic-support implClass=${skillPlan.implementationClass || 0}`
  );
  session.combatState.pendingSkillOutcomes = null;
  queuePostSkillEnemyResponseWithOptions(session, skillPlan, options);
}

function clearPlayerSupportDebuffs(session: GameSession): number {
  void session;
  return 0;
}

function handleCombatBuffSkillUse(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
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
  } else if ((skillPlan.skillId >>> 0) === LIONS_ROAR_SKILL_ID) {
    const durationRounds = resolveLionRoarDuration(skillLevel);
    const attackBonusPercent = resolveLionRoarAttackBonus(skillLevel);
    const defenseBonusPercent = resolveLionRoarDefenseBonus(skillLevel);
    session.combatState.playerStatus = {
      ...session.combatState.playerStatus,
      lionsRoarRoundsRemaining: durationRounds,
      lionsRoarAttackBonusPercent: attackBonusPercent,
      lionsRoarDefenseBonusPercent: defenseBonusPercent,
    };
    session.log(
      `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${session.runtimeId} effect=lions-roar rounds=${durationRounds} attackBonus=${attackBonusPercent} defenseBonus=${defenseBonusPercent}`
    );
  } else if ((skillPlan.skillId >>> 0) === DIVINE_BLESS_SKILL_ID) {
    const durationRounds = resolveDivineBlessDuration(skillLevel);
    const magicAttackBonusPercent = resolveDivineBlessMagicAttackBonus(skillLevel);
    const magicDefenseBonusPercent = resolveDivineBlessMagicDefenseBonus(skillLevel);
    session.combatState.playerStatus = {
      ...session.combatState.playerStatus,
      divineBlessRoundsRemaining: durationRounds,
      divineBlessMagicAttackBonusPercent: magicAttackBonusPercent,
      divineBlessMagicDefenseBonusPercent: magicDefenseBonusPercent,
    };
    session.log(
      `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${session.runtimeId} effect=divine-bless rounds=${durationRounds} magicAttackBonus=${magicAttackBonusPercent} magicDefenseBonus=${magicDefenseBonusPercent}`
    );
  } else if ((skillPlan.skillId >>> 0) === HASTE_SKILL_ID) {
    const durationRounds = resolveHasteDuration(skillLevel);
    session.combatState.playerStatus = {
      ...session.combatState.playerStatus,
      hasteRoundsRemaining: durationRounds,
    };
    session.log(
      `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${session.runtimeId} effect=haste rounds=${durationRounds}`
    );
  } else {
    session.log(
      `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${session.runtimeId} effect=generic-buff implClass=${skillPlan.implementationClass || 0}`
    );
  }

  session.combatState.pendingSkillOutcomes = null;
  queuePostSkillEnemyResponseWithOptions(session, skillPlan, options);
}

function handleCombatHealSkillUse(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  if ((skillPlan.skillId >>> 0) === GOSPEL_SKILL_ID) {
    const durationRounds = resolveGospelDuration();
    const healAmount = resolveGospelHealAmount(session, skillLevel);
    session.combatState.playerStatus = {
      ...session.combatState.playerStatus,
      regenerateRoundsRemaining: durationRounds,
      regenerateHealAmount: healAmount,
    };
    sendCombatSkillCastPlayback(session, skillPlan, skillLevel, [{
      entityId: session.runtimeId >>> 0,
      actionCode: 0,
      value: Math.max(1, healAmount),
    }]);
    session.log(
      `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${session.runtimeId} effect=gospel rounds=${durationRounds} healPerRound=${healAmount}`
    );
    session.combatState.pendingSkillOutcomes = null;
    queuePostSkillEnemyResponseWithOptions(session, skillPlan, options);
    return;
  }

  if ((skillPlan.skillId >>> 0) === REGENERATE_SKILL_ID) {
    const durationRounds = resolveRegenerateDuration();
    const healAmount = resolveRegenerateHealAmount(session, skillLevel);
    session.combatState.playerStatus = {
      ...session.combatState.playerStatus,
      regenerateRoundsRemaining: durationRounds,
      regenerateHealAmount: healAmount,
    };
    sendCombatSkillCastPlayback(session, skillPlan, skillLevel, [{
      entityId: session.runtimeId >>> 0,
      actionCode: 0,
      value: Math.max(1, healAmount),
    }]);
    session.log(
      `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${session.runtimeId} effect=regenerate rounds=${durationRounds} healPerRound=${healAmount}`
    );
    session.combatState.pendingSkillOutcomes = null;
    queuePostSkillEnemyResponseWithOptions(session, skillPlan, options);
    return;
  }

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
  queuePostSkillEnemyResponseWithOptions(session, skillPlan, options);
}

function handleCombatDrainSkillUse(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  const targetEnemy = targetEnemies[0];
  if (!targetEnemy) {
    resendCombatCommandPrompt(session, 'skill-rejected-missing-target');
    return;
  }

  const playerDamage = Math.max(1, computePlayerDamage(session, targetEnemy));
  const appliedDamage = Math.max(0, Math.min(targetEnemy.hp, playerDamage));
  targetEnemy.hp = Math.max(0, targetEnemy.hp - playerDamage);
  const targetDied = targetEnemy.hp <= 0;
  const healAmount = resolveBloodDrainHealAmount(skillLevel, appliedDamage);
  const previousHealth = Math.max(0, session.currentHealth || 0);
  const maxHealth = Math.max(previousHealth, session.maxHealth || previousHealth || 1);
  const appliedHeal = Math.max(0, Math.min(maxHealth - previousHealth, healAmount));
  session.currentHealth = Math.max(0, Math.min(maxHealth, previousHealth + healAmount));
  session.combatState.damageDealt = Math.max(0, (session.combatState.damageDealt || 0) + appliedDamage);

  sendCombatSkillCastPlayback(session, skillPlan, skillLevel, [
    {
      entityId: targetEnemy.entityId >>> 0,
      actionCode: targetDied ? 3 : 1,
      value: Math.max(1, playerDamage),
    },
    {
      entityId: session.runtimeId >>> 0,
      actionCode: 1,
      value: Math.max(1, appliedHeal || healAmount),
    },
  ]);
  session.log(
    `Combat skill use ok source=${sourceLabel} skillId=${skillPlan.skillId} targetEntityId=${targetEnemy.entityId} effect=blood-drain damage=${appliedDamage} healed=${appliedHeal} enemyHp=${targetEnemy.hp} hp=${session.currentHealth}/${maxHealth}`
  );
  session.combatState.pendingSkillOutcomes = [{
    skillId: skillPlan.skillId >>> 0,
    targetEntityId: targetEnemy.entityId >>> 0,
    playerDamage: Math.max(1, playerDamage),
    targetDied,
  }];
  queuePostSkillEnemyResponseWithOptions(session, skillPlan, options);
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
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  const skillId = skillPlan.skillId >>> 0;
  const castTargets: Array<{ entityId: number; actionCode: number; value: number }> = [];
  const pendingOutcomes: Array<{ skillId: number; targetEntityId: number; playerDamage: number; targetDied: boolean }> = [];
  let totalAppliedDamage = 0;
  let disabledTargets = 0;
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
    if (skillId === BLEED_SKILL_ID) {
      session.combatState.enemyStatuses[targetEnemy.entityId >>> 0] = {
        ...(session.combatState.enemyStatuses?.[targetEnemy.entityId >>> 0] || {}),
        bleedRoundsRemaining: resolveBleedDuration(skillLevel),
        bleedDamagePerRound: resolveBleedDamagePerRound(session, skillLevel),
      };
    }
    if (applyEnemyDisableEffect(session, targetEnemy, skillId, skillLevel)) {
      disabledTargets += 1;
    }
  }
  sendCombatSkillCastPlayback(session, skillPlan, skillLevel, castTargets);
  session.combatState.damageDealt = Math.max(0, (session.combatState.damageDealt || 0) + totalAppliedDamage);
  session.log(
    `Combat skill use ok source=${sourceLabel} skillId=${skillId} class=${skillPlan.implementationClass || 0} targetCount=${pendingOutcomes.length} totalDamage=${totalAppliedDamage} disabledTargets=${disabledTargets} fireballExploded=${fireballExploded ? 1 : 0} slaughterFocused=${slaughterFocused ? 1 : 0} remaining=${describeLivingEnemies(session.combatState.enemies)}`
  );
  session.combatState.pendingSkillOutcomes = pendingOutcomes;
  queuePostSkillEnemyResponseWithOptions(session, skillPlan, options);
}

function applyEnemyDisableEffect(
  session: GameSession,
  targetEnemy: Record<string, any>,
  skillId: number,
  skillLevel: number
): boolean {
  const effect = resolveEnemyDisableEffect(skillId, skillLevel);
  if (!effect || (targetEnemy?.hp || 0) <= 0) {
    return false;
  }

  const roll = Math.floor(Math.random() * 100);
  if (roll >= effect.chancePercent) {
    return false;
  }

  const entityId = targetEnemy.entityId >>> 0;
  const nextStatus: Record<string, any> = {
    ...(session.combatState.enemyStatuses?.[entityId] || {}),
    actionDisabledRoundsRemaining: Math.max(
      effect.rounds,
      Number(session.combatState.enemyStatuses?.[entityId]?.actionDisabledRoundsRemaining || 0)
    ),
    actionDisabledReason: effect.reason,
  };
  session.combatState.enemyStatuses[entityId] = nextStatus;
  return true;
}

function resolveEnemyDisableEffect(skillId: number, skillLevel: number): EnemyDisableEffect | null {
  switch (skillId >>> 0) {
    case CONFUSE_SKILL_ID:
      return { reason: 'confuse', rounds: skillLevel >= 6 ? 3 : 2, chancePercent: 35 };
    case UTMOST_STRIKE_SKILL_ID:
    case SOUL_FIRE_SKILL_ID:
      return { reason: 'seal', rounds: 1, chancePercent: 30 };
    case STUN_SKILL_ID:
      return { reason: 'stun', rounds: 1, chancePercent: 100 };
    case FROST_BOLT_SKILL_ID:
      return { reason: 'freeze', rounds: 1, chancePercent: 30 };
    case CRASH_SKILL_ID:
      return { reason: 'slow', rounds: 1, chancePercent: 30 };
    case SEAL_SKILL_ID:
      return { reason: 'seal', rounds: 2, chancePercent: 100 };
    case HYPNOSIS_SKILL_ID:
      return { reason: 'sleep', rounds: 3, chancePercent: 100 };
    case BLIZZARD_SKILL_ID:
      return { reason: 'freeze', rounds: 1, chancePercent: 30 };
    case SLOW_DOWN_SKILL_ID:
      return { reason: 'slow', rounds: 2, chancePercent: 100 };
    default:
      return null;
  }
}

function handleImplementationClass1(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
}

function handleImplementationClass2(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
}

function handleImplementationClass3(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
}

function handleImplementationClass4(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
}

function handleImplementationClass5(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  handleCombatOffensiveSkillUse(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
}

function handleImplementationClass6(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
}

function handleImplementationClass7(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
}

function handleImplementationClass8(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, [], false, false, options);
}

function handleImplementationClass9(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
}

function handleImplementationClass10(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  _primaryTarget: Record<string, any> | null,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
}

function handleImplementationClass11(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, [], false, false, options);
}

function handleImplementationClass12(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
}

function handleImplementationClass13(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
}

function handleImplementationClass14(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
}

function handleImplementationClass15(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, [], false, false, options);
}

function handleImplementationClass16(
  session: GameSession,
  skillPlan: CombatSkillPlan,
  skillLevel: number,
  sourceLabel: string,
  targetEnemies: Array<Record<string, any>>,
  slaughterFocused: boolean,
  fireballExploded: boolean,
  options: {
    deferSharedTeamPostResolution?: boolean;
  }
): void {
  dispatchCombatSkillByBehavior(session, skillPlan, skillLevel, sourceLabel, targetEnemies, slaughterFocused, fireballExploded, options);
}
