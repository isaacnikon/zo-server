import { tryReadStaticJsonDocument } from './db/static-json-store.js';
import { resolveRepoPath } from './runtime-paths.js';

type UnknownRecord = Record<string, any>;
export type SkillAttribute = 'strength' | 'dexterity' | 'vitality' | 'intelligence' | null;
export type SkillBehavior = 'direct_damage' | 'heal' | 'buff_self' | 'debuff_enemy' | 'gather' | 'unknown';
export type SkillSelectionMode = 'self' | 'enemy';
export type SkillFollowUpMode = 'none' | 'delayed_cast';
export type SkillAcquisitionSource = 'skill_book' | 'npc-teach' | 'npc_or_other';
export type SkillTargetPatternHint = 'single' | 'line' | 'adjacent' | 'multi' | 'all';
export type SkillVariantKind = 'active' | 'passive' | 'aptitude';
export const PASSIVE_SKILL_ID_OFFSET = 10000;
export const APTITUDE_SKILL_ID_OFFSET = 20000;

export interface SkillDefinition {
  skillId: number;
  name: string;
  sourceTemplateId?: number;
  requiredLevel?: number;
  requiredAttribute?: SkillAttribute;
  requiredAttributeValue?: number;
  incompatibleSkillIds?: number[];
  manaCosts?: number[];
  proficiencyThresholds?: number[];
  behavior?: SkillBehavior;
  implementationClass?: number | null;
  selectionMode?: SkillSelectionMode;
  followUpMode?: SkillFollowUpMode;
  allowEnemyCounterattack?: boolean;
  description?: string;
  isPassive?: boolean;
  acquisitionSource?: SkillAcquisitionSource;
  gatherToolType?: number | null;
  maxTargetsHint?: number | null;
  targetPatternHint?: SkillTargetPatternHint | null;
  timedRoundsHint?: number | null;
  durationScalingAttributeHint?: SkillAttribute;
  effectHint?: string | null;
}

export interface SkillBookDefinition extends SkillDefinition {
  templateId: number;
  sourceTemplateId: number;
  requiredLevel: number;
  requiredAttribute: SkillAttribute;
  requiredAttributeValue: number;
  incompatibleSkillIds: number[];
}

type SkillDefinitionsDocument = {
  skills?: UnknownRecord[];
};

const SKILL_DEFINITIONS_FILE = resolveRepoPath('data', 'skills.json');
const SKILL_DEFINITIONS_BY_ID = loadSkillDefinitions();
const SKILL_BOOKS_BY_TEMPLATE_ID = buildSkillBookIndex(SKILL_DEFINITIONS_BY_ID);

export function getSkillDefinition(skillId: number): SkillDefinition | null {
  return SKILL_DEFINITIONS_BY_ID.get(skillId >>> 0) || null;
}

export function getSkillBookDefinition(templateId: number): SkillBookDefinition | null {
  return SKILL_BOOKS_BY_TEMPLATE_ID.get(templateId >>> 0) || null;
}

export function resolveSkillManaCostFromDefinition(skillId: number, skillLevel: number): number {
  const definition = getSkillDefinition(skillId);
  const manaCosts = Array.isArray(definition?.manaCosts) ? definition.manaCosts : [];
  if (manaCosts.length <= 0) {
    return 0;
  }
  return Math.max(0, manaCosts[Math.max(0, skillLevel - 1)] || manaCosts[0] || 0);
}

export function isPassiveSkillId(skillId: number): boolean {
  const normalizedSkillId = skillId >>> 0;
  return normalizedSkillId >= PASSIVE_SKILL_ID_OFFSET && normalizedSkillId < APTITUDE_SKILL_ID_OFFSET;
}

export function isAptitudeSkillId(skillId: number): boolean {
  return (skillId >>> 0) >= APTITUDE_SKILL_ID_OFFSET;
}

export function isActiveSkillId(skillId: number): boolean {
  return !isPassiveSkillId(skillId) && !isAptitudeSkillId(skillId);
}

export function getSkillVariantKind(skillId: number): SkillVariantKind {
  if (isAptitudeSkillId(skillId)) {
    return 'aptitude';
  }
  if (isPassiveSkillId(skillId)) {
    return 'passive';
  }
  return 'active';
}

export function resolveBaseSkillId(skillId: number): number {
  const normalizedSkillId = skillId >>> 0;
  if (isAptitudeSkillId(normalizedSkillId)) {
    return (normalizedSkillId - APTITUDE_SKILL_ID_OFFSET) >>> 0;
  }
  if (isPassiveSkillId(normalizedSkillId)) {
    return (normalizedSkillId - PASSIVE_SKILL_ID_OFFSET) >>> 0;
  }
  return normalizedSkillId;
}

export function resolvePassiveSkillId(skillId: number): number {
  return (resolveBaseSkillId(skillId) + PASSIVE_SKILL_ID_OFFSET) >>> 0;
}

export function resolveAptitudeSkillId(skillId: number): number {
  return (resolveBaseSkillId(skillId) + APTITUDE_SKILL_ID_OFFSET) >>> 0;
}

export function getPassiveSkillDefinition(skillId: number): SkillDefinition | null {
  return getSkillDefinition(resolvePassiveSkillId(skillId));
}

export function getAptitudeSkillDefinition(skillId: number): SkillDefinition | null {
  return getSkillDefinition(resolveAptitudeSkillId(skillId));
}

function loadSkillDefinitions(): Map<number, SkillDefinition> {
  const byId = new Map<number, SkillDefinition>();
  const rawDocument = tryReadStaticJsonDocument<SkillDefinitionsDocument>(SKILL_DEFINITIONS_FILE);
  if (!rawDocument) {
    return byId;
  }

  const skills = Array.isArray(rawDocument?.skills) ? rawDocument.skills : [];
  for (const entry of skills) {
    const skillId = Number(entry?.skillId || 0);
    if (!Number.isInteger(skillId) || skillId <= 0) {
      continue;
    }
    const normalizedSkillId = skillId >>> 0;
    byId.set(normalizedSkillId, {
      skillId: normalizedSkillId,
      name: typeof entry?.name === 'string' && entry.name.length > 0 ? entry.name : `Skill ${normalizedSkillId}`,
      sourceTemplateId: Number.isInteger(entry?.templateId) ? (entry.templateId >>> 0) : undefined,
      requiredLevel: Math.max(1, Number(entry?.requiredLevel || 1)) >>> 0,
      requiredAttribute: normalizeSkillAttribute(entry?.requiredAttribute),
      requiredAttributeValue: Math.max(0, Number(entry?.requiredAttributeValue || 0)) >>> 0,
      incompatibleSkillIds: Array.isArray(entry?.incompatibleSkillIds)
        ? entry.incompatibleSkillIds.map((value: unknown) => Math.max(0, Number(value || 0)) >>> 0).filter((value: number) => value > 0)
        : [],
      manaCosts: Array.isArray(entry?.manaCosts)
        ? entry.manaCosts.slice(0, 12).map((value: unknown) => Math.max(0, Number(value || 0) | 0))
        : [],
      proficiencyThresholds: Array.isArray(entry?.proficiencyThresholds)
        ? entry.proficiencyThresholds.slice(0, 12).map((value: unknown) => Math.max(0, Number(value || 0) | 0))
        : [],
      behavior: normalizeSkillBehavior(entry?.behavior),
      implementationClass: Number.isInteger(entry?.implementationClass) && Number(entry.implementationClass) > 0
        ? (Number(entry.implementationClass) >>> 0)
        : null,
      selectionMode: normalizeSelectionMode(entry?.selectionMode),
      followUpMode: normalizeFollowUpMode(entry?.followUpMode),
      allowEnemyCounterattack: entry?.allowEnemyCounterattack !== false,
      description: typeof entry?.description === 'string' ? entry.description : '',
      isPassive: entry?.isPassive === true,
      acquisitionSource: normalizeAcquisitionSource(entry?.acquisitionSource, Number(entry?.templateId || 0) > 0),
      gatherToolType:
        Number.isInteger(entry?.gatherToolType) && Number(entry.gatherToolType) > 0
          ? (Number(entry.gatherToolType) >>> 0)
          : null,
      ...inferSkillHints(typeof entry?.description === 'string' ? entry.description : '', entry?.isPassive === true),
    });
  }

  return byId;
}

function buildSkillBookIndex(definitionsById: Map<number, SkillDefinition>): Map<number, SkillBookDefinition> {
  const byTemplateId = new Map<number, SkillBookDefinition>();
  for (const definition of definitionsById.values()) {
    if (!Number.isInteger(definition.sourceTemplateId)) {
      continue;
    }
    const templateId = Number(definition.sourceTemplateId) >>> 0;
    byTemplateId.set(templateId, {
      ...definition,
      templateId,
      sourceTemplateId: templateId,
      requiredLevel: Math.max(1, Number(definition.requiredLevel || 1)) >>> 0,
      requiredAttribute: definition.requiredAttribute ?? null,
      requiredAttributeValue: Math.max(0, Number(definition.requiredAttributeValue || 0)) >>> 0,
      incompatibleSkillIds: Array.isArray(definition.incompatibleSkillIds)
        ? definition.incompatibleSkillIds.map((value) => value >>> 0)
        : [],
    });
  }
  return byTemplateId;
}

function normalizeSkillAttribute(value: unknown): SkillAttribute {
  switch (String(value || '').trim().toLowerCase()) {
    case 'strength':
      return 'strength';
    case 'dexterity':
      return 'dexterity';
    case 'vitality':
      return 'vitality';
    case 'intelligence':
      return 'intelligence';
    default:
      return null;
  }
}

function normalizeSkillBehavior(value: unknown): SkillBehavior {
  switch (String(value || '').trim().toLowerCase()) {
    case 'direct_damage':
      return 'direct_damage';
    case 'heal':
      return 'heal';
    case 'buff_self':
      return 'buff_self';
    case 'debuff_enemy':
      return 'debuff_enemy';
    case 'gather':
      return 'gather';
    default:
      return 'unknown';
  }
}

function normalizeSelectionMode(value: unknown): SkillSelectionMode {
  return String(value || '').trim().toLowerCase() === 'self' ? 'self' : 'enemy';
}

function normalizeFollowUpMode(value: unknown): SkillFollowUpMode {
  return String(value || '').trim().toLowerCase() === 'delayed_cast' ? 'delayed_cast' : 'none';
}

function normalizeAcquisitionSource(value: unknown, hasTemplateId: boolean): SkillAcquisitionSource {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'skill_book') {
    return 'skill_book';
  }
  if (normalized === 'npc-teach') {
    return 'npc-teach';
  }
  if (normalized === 'npc_or_other') {
    return 'npc_or_other';
  }
  return hasTemplateId ? 'skill_book' : 'npc_or_other';
}

function inferSkillHints(description: string, isPassive: boolean): Partial<SkillDefinition> {
  const normalizedDescription = String(description || '');
  const lower = normalizedDescription.toLowerCase();
  const hintedTargets = inferMaxTargetsHint(normalizedDescription, lower);
  return {
    maxTargetsHint: hintedTargets.maxTargetsHint,
    targetPatternHint: hintedTargets.targetPatternHint,
    timedRoundsHint: inferTimedRoundsHint(normalizedDescription),
    durationScalingAttributeHint: isPassive ? null : inferDurationScalingAttributeHint(lower),
    effectHint: inferEffectHint(lower),
  };
}

function inferMaxTargetsHint(
  description: string,
  lower: string
): { maxTargetsHint: number | null; targetPatternHint: SkillTargetPatternHint | null } {
  if (/all allies|all foes|all enemies/.test(lower)) {
    return { maxTargetsHint: 999, targetPatternHint: 'all' };
  }

  const adjacentMatch = lower.match(/adjacent\s+(\d+)\s+targets?/);
  if (adjacentMatch) {
    const adjacentCount = Math.max(1, Number(adjacentMatch[1]) || 0);
    return { maxTargetsHint: adjacentCount + 1, targetPatternHint: 'adjacent' };
  }

  const lineMatch = lower.match(/attack\s+(?:at most\s+)?(\d+)\s+targets?\s+in\s+line/);
  if (lineMatch) {
    return { maxTargetsHint: Math.max(1, Number(lineMatch[1]) || 1), targetPatternHint: 'line' };
  }

  const directTargetMatch = lower.match(/attack\s+(\d+)\s+targets?/);
  if (directTargetMatch) {
    const count = Math.max(1, Number(directTargetMatch[1]) || 1);
    return { maxTargetsHint: count, targetPatternHint: count > 1 ? 'multi' : 'single' };
  }

  const levelTargetMatches = [...description.matchAll(/Lv[^:]*:\s*(\d+)\s*Targets?/gi)];
  if (levelTargetMatches.length > 0) {
    const count = Math.max(...levelTargetMatches.map((match) => Math.max(1, Number(match[1]) || 1)));
    return { maxTargetsHint: count, targetPatternHint: count > 1 ? 'multi' : 'single' };
  }

  if (/several targets|multiple targets/.test(lower)) {
    return { maxTargetsHint: 3, targetPatternHint: 'multi' };
  }

  return { maxTargetsHint: 1, targetPatternHint: 'single' };
}

function inferTimedRoundsHint(description: string): number | null {
  const matches = [...String(description || '').matchAll(/(?:for|duration:\s*)(\d+)\s+rounds?/gi)];
  if (matches.length <= 0) {
    return null;
  }
  return Math.max(...matches.map((match) => Math.max(1, Number(match[1]) || 1)));
}

function inferDurationScalingAttributeHint(lower: string): SkillAttribute {
  if (lower.includes('by str goes up')) {
    return 'strength';
  }
  if (lower.includes('by dex goes up')) {
    return 'dexterity';
  }
  if (lower.includes('by vit goes up')) {
    return 'vitality';
  }
  if (lower.includes('by int goes up')) {
    return 'intelligence';
  }
  return null;
}

function inferEffectHint(lower: string): string | null {
  if (lower.includes('seal')) {
    return 'seal';
  }
  if (lower.includes('freeze')) {
    return 'freeze';
  }
  if (lower.includes('sleep')) {
    return 'sleep';
  }
  if (lower.includes('stun')) {
    return 'stun';
  }
  if (lower.includes('confuse')) {
    return 'confuse';
  }
  if (lower.includes('counterattack')) {
    return 'counterattack';
  }
  if (lower.includes('dodge')) {
    return 'dodge';
  }
  if (lower.includes('defense')) {
    return 'defense';
  }
  if (lower.includes('attack priority')) {
    return 'attack_priority';
  }
  if (lower.includes('mp consumption')) {
    return 'mp_consumption';
  }
  if (lower.includes('invisible')) {
    return 'invisible';
  }
  return null;
}
