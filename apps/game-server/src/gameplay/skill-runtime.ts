import { DEFAULT_FLAGS } from '../config.js';
import { buildSkillStateSyncPacket } from '../protocol/gameplay-packets.js';
import {
  getSkillDefinition,
  getAptitudeSkillDefinition,
  getPassiveSkillDefinition,
  getSkillBookDefinition,
  getSkillVariantKind,
  isActiveSkillId,
  resolveAptitudeSkillId,
  resolveBaseSkillId,
} from '../skill-definitions.js';

import type { GameSession } from '../types.js';
type UnknownRecord = Record<string, any>;
const DEFAULT_SKILL_PROFICIENCY_THRESHOLD = 10000;
type ProficiencySyncMode = 'always' | 'upgrade-only' | 'never';

export function ensureSkillState(session: GameSession): UnknownRecord {
  if (!session.skillState || typeof session.skillState !== 'object') {
    session.skillState = {
      learnedSkills: [],
      hotbarSkillIds: Array.from({ length: 12 }, () => 0),
    };
  }
  if (!Array.isArray(session.skillState.learnedSkills)) {
    session.skillState.learnedSkills = [];
  }
  if (!Array.isArray(session.skillState.hotbarSkillIds)) {
    session.skillState.hotbarSkillIds = Array.from({ length: 12 }, () => 0);
  }
  while (session.skillState.hotbarSkillIds.length < 12) {
    session.skillState.hotbarSkillIds.push(0);
  }
  return session.skillState;
}

export function findLearnedSkill(session: GameSession, skillId: number): UnknownRecord | null {
  const normalizedSkillId = skillId >>> 0;
  const learnedSkills = Array.isArray(session.skillState?.learnedSkills) ? session.skillState.learnedSkills : [];
  return learnedSkills.find((entry: UnknownRecord) => (Number(entry?.skillId || 0) >>> 0) === normalizedSkillId) || null;
}

export function resolveStoredSkillLevel(session: GameSession, skillId: number): number {
  const learned = findLearnedSkill(session, skillId);
  return Math.max(0, Number(learned?.level || 0) || 0);
}

export function resolveEffectiveSkillLevel(session: GameSession, skillId: number): number {
  const normalizedSkillId = skillId >>> 0;
  const variantKind = getSkillVariantKind(normalizedSkillId);
  if (variantKind === 'passive') {
    const baseSkillId = resolveBaseSkillId(normalizedSkillId);
    const baseSkillLevel = Math.max(1, resolveEffectiveSkillLevel(session, baseSkillId));
    return Math.max(1, Math.min(5, Math.floor(baseSkillLevel / 2)));
  }
  if (variantKind !== 'active') {
    return Math.max(1, resolveStoredSkillLevel(session, normalizedSkillId) || 1);
  }

  const activeLevel = Math.max(1, resolveStoredSkillLevel(session, normalizedSkillId) || 1);
  if (activeLevel >= 11) {
    return Math.min(12, activeLevel);
  }

  const aptitudeLevel = Math.max(0, resolveStoredSkillLevel(session, resolveAptitudeSkillId(normalizedSkillId)));
  if (aptitudeLevel <= 0) {
    return Math.min(10, activeLevel);
  }

  return Math.max(activeLevel, Math.min(12, 10 + Math.min(2, aptitudeLevel)));
}

export function resolveSkillMaxLevel(skillId: number): number {
  const normalizedSkillId = skillId >>> 0;
  const variantKind = getSkillVariantKind(normalizedSkillId);
  if (variantKind === 'aptitude') {
    return 2;
  }
  if (variantKind === 'passive') {
    return 5;
  }
  return getAptitudeSkillDefinition(normalizedSkillId) ? 10 : 12;
}

type SkillUpgradeEligibility = {
  ok: boolean;
  reason?: string;
  skillId: number;
  currentLevel: number;
  nextLevel: number;
  maxLevel: number;
};

export function canUpgradeSkill(session: GameSession, skillId: number): SkillUpgradeEligibility {
  const normalizedSkillId = skillId >>> 0;
  const definition = getSkillDefinition(normalizedSkillId);
  if (!definition) {
    return {
      ok: false,
      reason: `Unknown skillId=${normalizedSkillId}`,
      skillId: normalizedSkillId,
      currentLevel: 0,
      nextLevel: 0,
      maxLevel: 0,
    };
  }

  const learned = findLearnedSkill(session, normalizedSkillId);
  const currentLevel = Math.max(0, Number(learned?.level || 0) || 0);
  if (!learned) {
    return {
      ok: false,
      reason: `${definition.name} is not learned`,
      skillId: normalizedSkillId,
      currentLevel: 0,
      nextLevel: 0,
      maxLevel: resolveSkillMaxLevel(normalizedSkillId),
    };
  }

  const maxLevel = resolveSkillMaxLevel(normalizedSkillId);
  if (currentLevel >= maxLevel) {
    return {
      ok: false,
      reason: `${definition.name} is already at max level ${maxLevel}`,
      skillId: normalizedSkillId,
      currentLevel,
      nextLevel: currentLevel,
      maxLevel,
    };
  }

  const variantKind = getSkillVariantKind(normalizedSkillId);
  if (variantKind === 'aptitude') {
    const baseSkillId = resolveBaseSkillId(normalizedSkillId);
    const baseSkillLevel = resolveStoredSkillLevel(session, baseSkillId);
    if (baseSkillLevel < 10) {
      return {
        ok: false,
        reason: `${definition.name} requires base skill level 10`,
        skillId: normalizedSkillId,
        currentLevel,
        nextLevel: currentLevel + 1,
        maxLevel,
      };
    }
    if ((session.selectedAptitude || 0) <= 0) {
      return {
        ok: false,
        reason: `${definition.name} requires a selected aptitude`,
        skillId: normalizedSkillId,
        currentLevel,
        nextLevel: currentLevel + 1,
        maxLevel,
      };
    }
  } else if (variantKind === 'passive') {
    const baseSkillId = resolveBaseSkillId(normalizedSkillId);
    const effectiveBaseLevel = Math.max(1, resolveEffectiveSkillLevel(session, baseSkillId));
    const derivedPassiveLevel = Math.max(1, Math.min(5, Math.floor(effectiveBaseLevel / 2)));
    return {
      ok: false,
      reason: `${definition.name} is derived from base skill level (${derivedPassiveLevel} = floor(${effectiveBaseLevel}/2))`,
      skillId: normalizedSkillId,
      currentLevel,
      nextLevel: derivedPassiveLevel,
      maxLevel,
    };
  }

  return {
    ok: true,
    skillId: normalizedSkillId,
    currentLevel,
    nextLevel: currentLevel + 1,
    maxLevel,
  };
}

export function upgradeSkill(session: GameSession, skillId: number, options: { sendSync?: boolean } = {}): UnknownRecord {
  const eligibility = canUpgradeSkill(session, skillId);
  if (!eligibility.ok) {
    return {
      ok: false,
      reason: eligibility.reason || `skillId=${eligibility.skillId} cannot be upgraded`,
      skillId: eligibility.skillId,
      currentLevel: eligibility.currentLevel,
      maxLevel: eligibility.maxLevel,
    };
  }

  const learned = findLearnedSkill(session, eligibility.skillId);
  if (!learned) {
    return {
      ok: false,
      reason: `skillId=${eligibility.skillId} is not learned`,
      skillId: eligibility.skillId,
      currentLevel: 0,
      maxLevel: eligibility.maxLevel,
    };
  }

  learned.level = eligibility.nextLevel;
  if (options.sendSync !== false) {
    sendSkillStateSync(session, `skill-upgrade skillId=${eligibility.skillId} level=${eligibility.nextLevel}`);
  }
  return {
    ok: true,
    skillId: eligibility.skillId,
    currentLevel: eligibility.currentLevel,
    upgradedLevel: eligibility.nextLevel,
    maxLevel: eligibility.maxLevel,
    learnedSkill: learned,
  };
}

function resolveSkillProficiencyThreshold(session: GameSession, skillId: number): number {
  const normalizedSkillId = skillId >>> 0;
  const definition = getSkillDefinition(normalizedSkillId);
  const currentLevel = Math.max(1, resolveStoredSkillLevel(session, normalizedSkillId) || 1);
  const thresholds = Array.isArray(definition?.proficiencyThresholds) ? definition.proficiencyThresholds : [];
  const threshold = thresholds[Math.max(0, currentLevel - 1)] || thresholds[thresholds.length - 1] || 0;
  return Math.max(1, threshold || DEFAULT_SKILL_PROFICIENCY_THRESHOLD);
}

function resolveNextProficiencyUpgradeTarget(session: GameSession, skillId: number): UnknownRecord | null {
  const normalizedSkillId = skillId >>> 0;
  const activeSkill = findLearnedSkill(session, normalizedSkillId);
  if (!activeSkill) {
    return null;
  }

  const activeMaxLevel = resolveSkillMaxLevel(normalizedSkillId);
  const activeLevel = Math.max(0, Number(activeSkill.level || 0) || 0);
  if (activeLevel < activeMaxLevel) {
    return activeSkill;
  }

  const aptitudeDefinition = getAptitudeSkillDefinition(normalizedSkillId);
  if (!aptitudeDefinition?.skillId) {
    return activeSkill;
  }

  return findLearnedSkill(session, aptitudeDefinition.skillId >>> 0) || null;
}

type GrantSkillOptions = {
  sourceTemplateId?: number;
  learnedAt?: number;
  autoAssignHotbar?: boolean;
  skipRequirementChecks?: boolean;
};

type GrantSkillResult = {
  ok: boolean;
  reason?: string;
  learnedSkill?: UnknownRecord;
  grantedSkillIds?: number[];
  autoAssignedHotbarSlot?: number | null;
};

export function grantSkill(session: GameSession, skillId: number, options: GrantSkillOptions = {}): GrantSkillResult {
  const normalizedSkillId = skillId >>> 0;
  const definition = getSkillDefinition(normalizedSkillId);
  if (!definition) {
    return {
      ok: false,
      reason: `Unknown skillId=${normalizedSkillId}`,
    };
  }

  const skillState = ensureSkillState(session);
  const learnedSkills = Array.isArray(skillState.learnedSkills) ? skillState.learnedSkills : [];
  const existing = findLearnedSkill(session, normalizedSkillId);
  if (existing) {
    return {
      ok: false,
      reason: `${definition.name} is already learned`,
      learnedSkill: existing,
      grantedSkillIds: [normalizedSkillId],
      autoAssignedHotbarSlot: Number.isInteger(existing?.hotbarSlot) ? (existing.hotbarSlot | 0) : null,
    };
  }

  if (!options.skipRequirementChecks) {
    const requiredLevel = Math.max(1, Number(definition.requiredLevel || 1) || 1);
    if ((session.level || 0) < requiredLevel) {
      return {
        ok: false,
        reason: `${definition.name} requires level ${requiredLevel}`,
      };
    }

    if (definition.requiredAttribute && Number(definition.requiredAttributeValue || 0) > 0) {
      const currentValue = Math.max(0, Number(session?.primaryAttributes?.[definition.requiredAttribute] || 0));
      if (currentValue < Number(definition.requiredAttributeValue || 0)) {
        return {
          ok: false,
          reason: `${definition.name} requires ${definition.requiredAttribute} ${Number(definition.requiredAttributeValue || 0)}`,
        };
      }
    }

    const incompatibleSkillIds = Array.isArray(definition.incompatibleSkillIds) ? definition.incompatibleSkillIds : [];
    const conflictingSkill = learnedSkills.find((entry: UnknownRecord) =>
      incompatibleSkillIds.includes(Number(entry?.skillId || 0) >>> 0)
    );
    if (conflictingSkill) {
      return {
        ok: false,
        reason: `${definition.name} is incompatible with ${conflictingSkill.name || `skill ${conflictingSkill.skillId}`}`,
      };
    }
  }

  const hotbarSkillIds = Array.isArray(skillState.hotbarSkillIds) ? skillState.hotbarSkillIds : [];
  const shouldAssignHotbar = options.autoAssignHotbar !== false && isActiveSkillId(normalizedSkillId);
  const emptyHotbarIndex = shouldAssignHotbar ? hotbarSkillIds.findIndex((value: unknown) => !Number(value)) : -1;
  const hotbarSlot = emptyHotbarIndex >= 0 ? emptyHotbarIndex : null;
  if (hotbarSlot !== null) {
    hotbarSkillIds[hotbarSlot] = normalizedSkillId;
  }

  const learnedAt = Number.isInteger(options.learnedAt) ? (options.learnedAt as number) : Date.now();
  const normalizedRequiredLevel = Number.isInteger(definition.requiredLevel)
    ? (Number(definition.requiredLevel) >>> 0)
    : null;
  const normalizedRequiredAttributeValue = Number.isInteger(definition.requiredAttributeValue)
    ? (Number(definition.requiredAttributeValue) >>> 0)
    : null;
  const learnedSkill = {
    skillId: normalizedSkillId,
    name: definition.name,
    level: 1,
    proficiency: 0,
    ...(Number.isInteger(options.sourceTemplateId) ? { sourceTemplateId: (options.sourceTemplateId as number) >>> 0 } : {}),
    learnedAt,
    ...(normalizedRequiredLevel !== null ? { requiredLevel: normalizedRequiredLevel } : {}),
    ...(definition.requiredAttribute ? { requiredAttribute: definition.requiredAttribute } : {}),
    ...(normalizedRequiredAttributeValue !== null ? { requiredAttributeValue: normalizedRequiredAttributeValue } : {}),
    hotbarSlot,
  };
  learnedSkills.push(learnedSkill);

  const grantedSkillIds = [normalizedSkillId];
  if (isActiveSkillId(normalizedSkillId)) {
    for (const linkedDefinition of [getPassiveSkillDefinition(normalizedSkillId), getAptitudeSkillDefinition(normalizedSkillId)]) {
      const linkedSkillId = linkedDefinition?.skillId ? (linkedDefinition.skillId >>> 0) : 0;
      if (linkedSkillId <= 0 || findLearnedSkill(session, linkedSkillId)) {
        continue;
      }
      const linkedResult = grantSkill(session, linkedSkillId, {
        sourceTemplateId: Number.isInteger(options.sourceTemplateId) ? (options.sourceTemplateId as number) >>> 0 : undefined,
        learnedAt,
        autoAssignHotbar: false,
        skipRequirementChecks: true,
      });
      if (linkedResult.ok && Array.isArray(linkedResult.grantedSkillIds)) {
        grantedSkillIds.push(...linkedResult.grantedSkillIds);
      }
    }
  }

  session.skillState = {
    learnedSkills,
    hotbarSkillIds,
  };

  return {
    ok: true,
    learnedSkill,
    grantedSkillIds,
    autoAssignedHotbarSlot: hotbarSlot,
  };
}

export function learnSkillFromBook(session: GameSession, bagItem: UnknownRecord): UnknownRecord {
  const book = getSkillBookDefinition(bagItem?.templateId || 0);
  if (!book) {
    return {
      ok: false,
      reason: `Item templateId=${bagItem?.templateId || 0} is not a skill book`,
    };
  }

  const grantResult = grantSkill(session, book.skillId >>> 0, {
    sourceTemplateId: book.templateId >>> 0,
    autoAssignHotbar: true,
  });
  if (!grantResult.ok) {
    return {
      ok: false,
      reason: grantResult.reason || `${book.name} could not be learned`,
      skillBook: book,
    };
  }

  return {
    ok: true,
    learnedSkill: grantResult.learnedSkill,
    skillBook: book,
    grantedSkillIds: grantResult.grantedSkillIds || [resolveBaseSkillId(book.skillId >>> 0)],
    autoAssignedHotbarSlot: grantResult.autoAssignedHotbarSlot ?? null,
  };
}

export function incrementSkillProficiency(session: GameSession, skillId: number): void {
  addSkillProficiency(session, skillId, 1, 'proficiency-increment', {
    syncMode: 'upgrade-only',
  });
}

export function addSkillProficiency(
  session: GameSession,
  skillId: number,
  amount: number,
  reason = 'proficiency-grant',
  options: {
    syncMode?: ProficiencySyncMode;
  } = {}
): UnknownRecord {
  const normalizedSkillId = skillId >>> 0;
  const normalizedAmount = Math.max(0, Math.floor(amount));
  const syncMode = options.syncMode || 'always';
  if (normalizedAmount <= 0) {
    return {
      ok: false,
      reason: 'amount must be positive',
      skillId: normalizedSkillId,
      amount: normalizedAmount,
    };
  }

  const skillState = ensureSkillState(session);
  const learnedSkills = Array.isArray(skillState.learnedSkills) ? skillState.learnedSkills : [];
  const activeEntry = learnedSkills.find((s: UnknownRecord) => (Number(s?.skillId || 0) >>> 0) === normalizedSkillId);
  if (!activeEntry) {
    return {
      ok: false,
      reason: `skillId=${normalizedSkillId} is not learned`,
      skillId: normalizedSkillId,
      amount: normalizedAmount,
    };
  }

  let progressionEntry: UnknownRecord = resolveNextProficiencyUpgradeTarget(session, normalizedSkillId) || activeEntry;
  let threshold = Math.max(1, resolveSkillProficiencyThreshold(session, Number(progressionEntry.skillId || 0) >>> 0));
  progressionEntry.proficiency = Math.max(0, (Number(progressionEntry.proficiency) || 0) + normalizedAmount);
  let upgradedSkillIds: number[] = [];

  while ((Number(progressionEntry.proficiency) || 0) >= threshold && threshold > 0) {
    const upgradeResult = upgradeSkill(session, Number(progressionEntry.skillId || 0) >>> 0, { sendSync: false });
    if (!upgradeResult.ok) {
      break;
    }
    progressionEntry.proficiency = Math.max(0, (Number(progressionEntry.proficiency) || 0) - threshold);
    upgradedSkillIds.push(Number(upgradeResult.skillId || 0) >>> 0);
    const nextTarget = resolveNextProficiencyUpgradeTarget(session, normalizedSkillId);
    if (!nextTarget) {
      break;
    }
    progressionEntry = nextTarget;
    threshold = Math.max(1, resolveSkillProficiencyThreshold(session, Number(progressionEntry.skillId || 0) >>> 0));
  }

  const progressionSkillId = Number(progressionEntry.skillId || 0) >>> 0;
  const effectiveLevel = resolveEffectiveSkillLevel(session, normalizedSkillId);
  const proficiencyValue = Math.max(0, Number(progressionEntry.proficiency) || 0);
  const progressionTarget = getSkillVariantKind(progressionSkillId) === 'aptitude' ? 'aptitude' : 'active';
  const passiveSkillId = resolveBaseSkillId(normalizedSkillId) + 10000;
  const passiveLevel = findLearnedSkill(session, passiveSkillId)
    ? resolveEffectiveSkillLevel(session, passiveSkillId)
    : 0;
  const passiveEntry = findLearnedSkill(session, passiveSkillId);
  if (passiveEntry) {
    passiveEntry.level = passiveLevel;
  }
  const syncReason =
    `${reason} skillId=${normalizedSkillId} progressionTarget=${progressionTarget} progressionSkillId=${progressionSkillId} effectiveLevel=${effectiveLevel} passiveLevel=${passiveLevel} proficiency=${proficiencyValue}/${threshold}${upgradedSkillIds.length > 0 ? ` upgraded=${upgradedSkillIds.join(',')}` : ''}`;
  const shouldSendSync =
    syncMode === 'always' ||
    (syncMode === 'upgrade-only' && upgradedSkillIds.length > 0);
  if (!shouldSendSync) {
    session.log(`Skipping skill state sync on proficiency-only update reason=${syncReason}`);
  } else if (session.combatState?.active) {
    session.log(`Deferring skill state sync until out-of-combat reason=${syncReason}`);
  } else {
    sendSkillStateSync(session, syncReason);
  }

  return {
    ok: true,
    skillId: normalizedSkillId,
    amount: normalizedAmount,
    progressionSkillId,
    effectiveLevel,
    passiveLevel,
    proficiency: proficiencyValue,
    threshold,
    upgradedSkillIds,
  };
}

export function sendSkillStateSync(session: GameSession, reason = 'runtime'): void {
  if (!session || typeof session.writePacket !== 'function') {
    return;
  }

  const skills = collectSkillSyncEntries(session);
  writeSkillStateSyncPacket(session, skills, reason);
}

export function sendCombatSkillUiStateSync(session: GameSession, reason = 'runtime'): void {
  if (!session || typeof session.writePacket !== 'function') {
    return;
  }

  const skills = collectSkillSyncEntries(session).filter((entry) => getSkillVariantKind(entry.skillId) !== 'passive');
  writeSkillStateSyncPacket(session, skills, reason);
}

function collectSkillSyncEntries(session: GameSession, skillIds?: number[]): Array<{ skillId: number; level: number; proficiency: number }> {
  const skillState = ensureSkillState(session);
  const learnedSkills = Array.isArray(skillState.learnedSkills) ? skillState.learnedSkills : [];
  const normalizedFilter = Array.isArray(skillIds) && skillIds.length > 0
    ? new Set(
        skillIds
          .filter((skillId) => Number.isInteger(skillId) && (skillId >>> 0) > 0)
          .map((skillId) => skillId >>> 0)
      )
    : null;
  return learnedSkills
    .filter((entry: UnknownRecord) => Number.isInteger(entry?.skillId))
    .filter((entry: UnknownRecord) => normalizedFilter === null || normalizedFilter.has(entry.skillId >>> 0))
    .map((entry: UnknownRecord) => ({
      skillId: entry.skillId >>> 0,
      level: Number.isInteger(entry?.level) && entry.level > 0 ? (entry.level >>> 0) : 1,
      proficiency: Number.isInteger(entry?.proficiency) && entry.proficiency >= 0 ? (entry.proficiency >>> 0) : 0,
    }));
}

function writeSkillStateSyncPacket(
  session: GameSession,
  skills: Array<{ skillId: number; level: number; proficiency: number }>,
  reason: string
): void {
  const packet = buildSkillStateSyncPacket({ skills });
  session.writePacket(
    packet,
    DEFAULT_FLAGS,
    `Sending skill state sync cmd=0x03f0 sub=0x00 reason=${reason} count=${skills.length} skills=${skills
      .map((entry: { skillId: number; level: number; proficiency: number }) => `${entry.skillId}:${entry.level}:${entry.proficiency}`)
      .join(',')}`
  );
}
