import { DEFAULT_FLAGS, GAME_FIGHT_ACTION_CMD } from '../config.js';
import { buildSkillCastPlaybackPacket } from './packets.js';
import {
  resolveSkillTargets,
  FIREBALL_SKILL_ID,
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
  appendSkillPacketTrace,
  SKILL_PACKET_PROBE_STAGE2_ENABLED,
  SKILL_PACKET_PROBE_STAGE2_FLAG,
  SKILL_PACKET_PROBE_STAGE2_SPEC,
  SKILL_PACKET_PROBE_TARGET_ENTITY,
  SKILL_PACKET_PROBE_TARGET_ACTION,
  SKILL_PACKET_PROBE_TARGET_VALUE,
  MULTI_TARGET_ENTITY_SENTINEL,
} from './combat-formulas.js';
import { resendCombatCommandPrompt } from './combat-resolution.js';
import type { GameSession } from '../types.js';

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

  const targetEnemies = resolveSkillTargets(session, skillId, targetEntityId);
  const fireballExploded = (skillId >>> 0) === FIREBALL_SKILL_ID && targetEnemies.length > 1;
  session.log(
    `Combat skill request source=${sourceLabel} skillId=${skillId} rawTargetEntityId=${targetEntityId >>> 0} ` +
    `resolvedTargets=${targetEnemies.map((enemy) => `${enemy.entityId}[${enemy.row},${enemy.col}]`).join('|') || 'none'} ` +
    `fireballExploded=${fireballExploded ? 1 : 0} ` +
    `roster=${describeEnemyRoster(session.combatState?.enemies)}`
  );
  if ((skillId >>> 0) !== CURE_SKILL_ID && targetEnemies.length <= 0) {
    session.log(
      `Combat skill use rejected source=${sourceLabel} skillId=${skillId} targetEntityId=${targetEntityId} reason=missing-target`
    );
    resendCombatCommandPrompt(session, 'skill-rejected-missing-target');
    return;
  }
  const primaryTarget = targetEnemies[0] || null;

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

  if ((skillId >>> 0) === DEFIANT_SKILL_ID) {
    sendCombatSkillCastPlayback(session, skillId, skillLevel, [{
      entityId: (primaryTarget?.entityId || session.entityType) >>> 0,
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
      `Combat skill use ok source=${sourceLabel} skillId=${skillId} targetEntityId=${(primaryTarget?.entityId || session.entityType) >>> 0} effect=defiant manaCost=${manaCost} rounds=${durationRounds} defenseBonus=${defenseBonusPercent}`
    );
    session.combatState.pendingSkillOutcomes = null;
    queuePostSkillEnemyResponse(session);
    return;
  }

  if ((skillId >>> 0) === CURE_SKILL_ID) {
    const healAmount = resolveSkillHealing(session, skillId, skillLevel);
    const previousHealth = Math.max(0, session.currentHealth || 0);
    const maxHealth = Math.max(previousHealth, session.maxHealth || previousHealth || 1);
    const appliedHeal = Math.max(0, Math.min(maxHealth - previousHealth, healAmount));
    session.currentHealth = Math.max(0, Math.min(maxHealth, previousHealth + healAmount));
    sendCombatSkillCastPlayback(session, skillId, skillLevel, [{
      entityId: session.entityType >>> 0,
      actionCode: 1,
      value: Math.max(1, appliedHeal || healAmount || 1),
    }]);
    session.log(
      `Combat skill use ok source=${sourceLabel} skillId=${skillId} targetEntityId=${session.entityType} effect=cure manaCost=${manaCost} healed=${appliedHeal} hp=${session.currentHealth}/${maxHealth}`
    );
    session.combatState.pendingSkillOutcomes = [{
      skillId,
      targetEntityId: session.entityType >>> 0,
      healAmount: appliedHeal,
    }];
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
    if ((skillId >>> 0) === ENERVATE_SKILL_ID) {
      session.combatState.enemyStatuses[targetEnemy.entityId >>> 0] = {
        enervateRoundsRemaining: resolveEnervateDuration(skillLevel),
        enervateAttackPenaltyPercent: resolveEnervateAttackPenalty(skillLevel),
      };
    }
  }
  sendCombatSkillCastPlayback(session, skillId, skillLevel, castTargets);
  session.combatState.damageDealt = Math.max(0, (session.combatState.damageDealt || 0) + totalAppliedDamage);
  session.log(
    `Combat skill use ok source=${sourceLabel} skillId=${skillId} targetCount=${pendingOutcomes.length} manaCost=${manaCost} totalDamage=${totalAppliedDamage} fireballExploded=${fireballExploded ? 1 : 0} remaining=${describeLivingEnemies(session.combatState.enemies)}`
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

export function queuePostSkillEnemyResponse(session: GameSession): void {
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
