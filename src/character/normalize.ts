import { MAP_ID, SPAWN_X, SPAWN_Y } from '../config.js';
import { normalizeQuestState } from '../quest-engine/index.js';
import { normalizeInventoryState } from '../inventory/index.js';
import { normalizePets } from '../pet-runtime.js';
import { CHARACTER_VITALS_BASELINE } from '../gameplay/session-flows.js';
import { resolveCharacterMaxVitals } from '../gameplay/max-vitals.js';
import {
  getAptitudeSkillDefinition,
  getPassiveSkillDefinition,
  isActiveSkillId,
} from '../gameplay/skill-definitions.js';
import type { UnknownRecord } from '../utils.js';
type PrimaryAttributes = {
  intelligence: number;
  vitality: number;
  dexterity: number;
  strength: number;
};
type LearnedSkillRecord = {
  skillId: number;
  name: string;
  level?: number;
  proficiency?: number;
  sourceTemplateId?: number;
  learnedAt: number;
  requiredLevel?: number;
  requiredAttribute?: 'strength' | 'dexterity' | 'vitality' | 'intelligence' | null;
  requiredAttributeValue?: number;
  hotbarSlot?: number | null;
};
type SkillState = {
  learnedSkills: LearnedSkillRecord[];
  hotbarSkillIds: number[];
};

export function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

export function defaultPrimaryAttributes(): PrimaryAttributes {
  return {
    intelligence: 15,
    vitality: 15,
    dexterity: 15,
    strength: 15,
  };
}

export function defaultBonusAttributes(): PrimaryAttributes {
  return {
    intelligence: 0,
    vitality: 0,
    dexterity: 0,
    strength: 0,
  };
}

export function defaultSkillState(): SkillState {
  return {
    learnedSkills: [],
    hotbarSkillIds: Array.from({ length: 12 }, () => 0),
  };
}

export function normalizePrimaryAttributes(primaryAttributes: UnknownRecord | null | undefined): PrimaryAttributes {
  const defaults = defaultPrimaryAttributes();
  return {
    intelligence:
      typeof primaryAttributes?.intelligence === 'number'
        ? primaryAttributes.intelligence
        : (typeof primaryAttributes?.ene === 'number' ? primaryAttributes.ene : defaults.intelligence),
    vitality:
      typeof primaryAttributes?.vitality === 'number'
        ? primaryAttributes.vitality
        : (typeof primaryAttributes?.con === 'number' ? primaryAttributes.con : defaults.vitality),
    dexterity:
      typeof primaryAttributes?.dexterity === 'number'
        ? primaryAttributes.dexterity
        : (typeof primaryAttributes?.dex === 'number' ? primaryAttributes.dex : defaults.dexterity),
    strength:
      typeof primaryAttributes?.strength === 'number'
        ? primaryAttributes.strength
        : (typeof primaryAttributes?.str === 'number' ? primaryAttributes.str : defaults.strength),
  };
}

export function normalizeBonusAttributes(primaryAttributes: UnknownRecord | null | undefined): PrimaryAttributes {
  const defaults = defaultBonusAttributes();
  return {
    intelligence:
      typeof primaryAttributes?.intelligence === 'number'
        ? primaryAttributes.intelligence
        : (typeof primaryAttributes?.ene === 'number' ? primaryAttributes.ene : defaults.intelligence),
    vitality:
      typeof primaryAttributes?.vitality === 'number'
        ? primaryAttributes.vitality
        : (typeof primaryAttributes?.con === 'number' ? primaryAttributes.con : defaults.vitality),
    dexterity:
      typeof primaryAttributes?.dexterity === 'number'
        ? primaryAttributes.dexterity
        : (typeof primaryAttributes?.dex === 'number' ? primaryAttributes.dex : defaults.dexterity),
    strength:
      typeof primaryAttributes?.strength === 'number'
        ? primaryAttributes.strength
        : (typeof primaryAttributes?.str === 'number' ? primaryAttributes.str : defaults.strength),
  };
}

export function normalizeSkillState(skillState: UnknownRecord | null | undefined): SkillState {
  const defaults = defaultSkillState();
  const learnedSkills = Array.isArray(skillState?.learnedSkills)
    ? skillState.learnedSkills
        .filter((entry: UnknownRecord) => Number.isInteger(entry?.skillId))
        .map((entry: UnknownRecord) => ({
          skillId: entry.skillId >>> 0,
          name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : `Skill ${entry.skillId >>> 0}`,
          ...(Number.isInteger(entry?.level) ? { level: entry.level >>> 0 } : {}),
          ...(Number.isInteger(entry?.proficiency) ? { proficiency: entry.proficiency >>> 0 } : {}),
          ...(Number.isInteger(entry?.sourceTemplateId) ? { sourceTemplateId: entry.sourceTemplateId >>> 0 } : {}),
          learnedAt: numberOrDefault(entry.learnedAt, Date.now()),
          ...(Number.isInteger(entry?.requiredLevel) ? { requiredLevel: entry.requiredLevel >>> 0 } : {}),
          ...(typeof entry?.requiredAttribute === 'string'
            ? { requiredAttribute: entry.requiredAttribute as LearnedSkillRecord['requiredAttribute'] }
            : {}),
          ...(Number.isInteger(entry?.requiredAttributeValue)
            ? { requiredAttributeValue: entry.requiredAttributeValue >>> 0 }
            : {}),
          ...(Number.isInteger(entry?.hotbarSlot) ? { hotbarSlot: entry.hotbarSlot | 0 } : {}),
        }))
    : defaults.learnedSkills;
  // Backfill passive and aptitude skill variants for any active skill missing them.
  const learnedSkillIds = new Set(learnedSkills.map((entry) => entry.skillId));
  for (const activeSkill of learnedSkills.filter((entry) => isActiveSkillId(entry.skillId >>> 0))) {
    const passiveDefinition = getPassiveSkillDefinition(activeSkill.skillId >>> 0);
    const passiveSkillId = passiveDefinition?.skillId ? (passiveDefinition.skillId >>> 0) : 0;
    if (passiveSkillId > 0 && !learnedSkillIds.has(passiveSkillId)) {
      learnedSkills.push({
        skillId: passiveSkillId,
        name: passiveDefinition?.name || `${activeSkill.name} (Passive)`,
        level: 1,
        proficiency: 0,
        ...(activeSkill.sourceTemplateId ? { sourceTemplateId: activeSkill.sourceTemplateId } : {}),
        learnedAt: activeSkill.learnedAt,
        hotbarSlot: null,
      });
      learnedSkillIds.add(passiveSkillId);
    }

    const aptitudeDefinition = getAptitudeSkillDefinition(activeSkill.skillId >>> 0);
    const aptitudeSkillId = aptitudeDefinition?.skillId ? (aptitudeDefinition.skillId >>> 0) : 0;
    if (aptitudeSkillId > 0 && !learnedSkillIds.has(aptitudeSkillId)) {
      learnedSkills.push({
        skillId: aptitudeSkillId,
        name: aptitudeDefinition?.name || `${activeSkill.name} (Aptitude)`,
        level: 1,
        proficiency: 0,
        ...(activeSkill.sourceTemplateId ? { sourceTemplateId: activeSkill.sourceTemplateId } : {}),
        learnedAt: activeSkill.learnedAt,
        hotbarSlot: null,
      });
      learnedSkillIds.add(aptitudeSkillId);
    }
  }

  const hotbarSource = Array.isArray(skillState?.hotbarSkillIds)
    ? skillState.hotbarSkillIds
    : defaults.hotbarSkillIds;
  const hotbarSkillIds = Array.from({ length: defaults.hotbarSkillIds.length }, (_value, index) => {
    const candidate = hotbarSource[index];
    if (!Number.isInteger(candidate)) {
      return 0;
    }
    const normalizedCandidate = candidate >>> 0;
    return isActiveSkillId(normalizedCandidate) ? normalizedCandidate : 0;
  });

  return {
    learnedSkills,
    hotbarSkillIds,
  };
}

export function normalizeCharacterRecord(character: UnknownRecord): UnknownRecord {
  const mapId = numberOrDefault(character.mapId, MAP_ID);
  const x = numberOrDefault(character.x, SPAWN_X);
  const y = numberOrDefault(character.y, SPAWN_Y);
  const questState = normalizeQuestState(character);
  const inventoryState = normalizeInventoryState(character);
  const bonusAttributes = normalizeBonusAttributes(character.bonusAttributes);
  const skillState = normalizeSkillState(character.skillState);
  const maxVitals = resolveCharacterMaxVitals({
    roleEntityType: numberOrDefault(
      character.roleEntityType,
      numberOrDefault(character.entityType, 0)
    ),
    entityType: numberOrDefault(character.entityType, 0),
    selectedAptitude: numberOrDefault(character.selectedAptitude, 0),
    level: numberOrDefault(character.level, 1),
    primaryAttributes: normalizePrimaryAttributes(character.primaryAttributes),
    bonusAttributes,
    currentHealth: numberOrDefault(character.currentHealth, CHARACTER_VITALS_BASELINE.health),
    currentMana: numberOrDefault(character.currentMana, CHARACTER_VITALS_BASELINE.mana),
    currentRage: numberOrDefault(character.currentRage, 100),
    maxHealth: numberOrDefault(character.maxHealth, 0),
    maxMana: numberOrDefault(character.maxMana, 0),
    maxRage: numberOrDefault(character.maxRage, 0),
  });
  return {
    ...character,
    charName: character.charName || character.roleName || 'Hero',
    roleName: character.roleName || character.charName || 'Hero',
    mapId,
    x,
    y,
    level: numberOrDefault(character.level, 1),
    selectedAptitude: numberOrDefault(character.selectedAptitude, 0),
    experience: numberOrDefault(character.experience, 0),
    currentHealth: numberOrDefault(character.currentHealth, CHARACTER_VITALS_BASELINE.health),
    currentMana: numberOrDefault(character.currentMana, CHARACTER_VITALS_BASELINE.mana),
    currentRage: numberOrDefault(character.currentRage, 100),
    maxHealth: maxVitals.health,
    maxMana: maxVitals.mana,
    maxRage: maxVitals.rage,
    gold: numberOrDefault(character.gold, 0),
    bankGold: numberOrDefault(character.bankGold, 0),
    boundGold: numberOrDefault(character.boundGold, 0),
    coins: numberOrDefault(character.coins, 0),
    renown: numberOrDefault(character.renown, 0),
    statusPoints: numberOrDefault(character.statusPoints, 0),
    primaryAttributes: normalizePrimaryAttributes(character.primaryAttributes),
    bonusAttributes,
    skillState,
    activeQuests: questState.activeQuests,
    completedQuests: questState.completedQuests,
    pets: normalizePets(character.pets),
    selectedPetRuntimeId:
      typeof character.selectedPetRuntimeId === 'number'
        ? (character.selectedPetRuntimeId >>> 0)
        : null,
    petSummoned: character.petSummoned === true,
    inventory: inventoryState.inventory,
  };
}
