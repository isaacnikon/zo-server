'use strict';
export {};

import fs from 'fs';

const { resolveRepoPath } = require('../runtime-paths');
const { DEFAULT_FLAGS } = require('../config');
const { buildSkillStateSyncPacket } = require('../protocol/gameplay-packets');

type UnknownRecord = Record<string, any>;
type SessionLike = Record<string, any>;
type SkillAttribute = 'strength' | 'dexterity' | 'vitality' | 'intelligence' | null;

interface SkillBookDefinition {
  templateId: number;
  skillId: number;
  name: string;
  requiredLevel: number;
  requiredAttribute: SkillAttribute;
  requiredAttributeValue: number;
  incompatibleSkillIds: number[];
}

const SKILL_BOOK_OVERRIDES = new Map<number, Partial<SkillBookDefinition>>([
  [27010, {
    skillId: 4101,
    name: 'Fire Ball',
    requiredLevel: 10,
    requiredAttribute: 'intelligence',
    requiredAttributeValue: 20,
    incompatibleSkillIds: [4102, 4103],
  }],
  [27011, {
    skillId: 4102,
    name: 'Frost Bolt',
    requiredLevel: 10,
    requiredAttribute: 'intelligence',
    requiredAttributeValue: 20,
    incompatibleSkillIds: [4101, 4103],
  }],
  [27012, {
    skillId: 4103,
    name: 'Cure',
    requiredLevel: 10,
    requiredAttribute: 'intelligence',
    requiredAttributeValue: 20,
    incompatibleSkillIds: [4101, 4102],
  }],
]);

const ITEMS_TABLE_FILE = resolveRepoPath('data', 'client-derived', 'items.json');
const SKILL_BOOKS_BY_TEMPLATE_ID = loadSkillBookDefinitions();

function getSkillBookDefinition(templateId: number): SkillBookDefinition | null {
  return SKILL_BOOKS_BY_TEMPLATE_ID.get(templateId >>> 0) || null;
}

function ensureSkillState(session: SessionLike): UnknownRecord {
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

function learnSkillFromBook(session: SessionLike, bagItem: UnknownRecord): UnknownRecord {
  const book = getSkillBookDefinition(bagItem?.templateId || 0);
  if (!book) {
    return {
      ok: false,
      reason: `Item templateId=${bagItem?.templateId || 0} is not a skill book`,
    };
  }

  const skillState = ensureSkillState(session);
  const learnedSkills = Array.isArray(skillState.learnedSkills) ? skillState.learnedSkills : [];
  const alreadyLearned = learnedSkills.find((entry: UnknownRecord) => (entry?.skillId >>> 0) === (book.skillId >>> 0));
  if (alreadyLearned) {
    return {
      ok: false,
      reason: `${book.name} is already learned`,
      skillBook: book,
    };
  }

  if ((session.level || 0) < book.requiredLevel) {
    return {
      ok: false,
      reason: `${book.name} requires level ${book.requiredLevel}`,
      skillBook: book,
    };
  }

  if (book.requiredAttribute && book.requiredAttributeValue > 0) {
    const currentValue = Math.max(0, Number(session?.primaryAttributes?.[book.requiredAttribute] || 0));
    if (currentValue < book.requiredAttributeValue) {
      return {
        ok: false,
        reason: `${book.name} requires ${book.requiredAttribute} ${book.requiredAttributeValue}`,
        skillBook: book,
      };
    }
  }

  const conflictingSkill = learnedSkills.find((entry: UnknownRecord) =>
    book.incompatibleSkillIds.includes(entry?.skillId >>> 0)
  );
  if (conflictingSkill) {
    return {
      ok: false,
      reason: `${book.name} is incompatible with ${conflictingSkill.name || `skill ${conflictingSkill.skillId}`}`,
      skillBook: book,
    };
  }

  const hotbarSkillIds = Array.isArray(skillState.hotbarSkillIds) ? skillState.hotbarSkillIds : [];
  const emptyHotbarIndex = hotbarSkillIds.findIndex((value: unknown) => !Number(value));
  const hotbarSlot = emptyHotbarIndex >= 0 ? emptyHotbarIndex : null;
  if (hotbarSlot !== null) {
    hotbarSkillIds[hotbarSlot] = book.skillId >>> 0;
  }

  const learnedSkill = {
    skillId: book.skillId >>> 0,
    name: book.name,
    level: 1,
    proficiency: 0,
    sourceTemplateId: book.templateId >>> 0,
    learnedAt: Date.now(),
    requiredLevel: book.requiredLevel >>> 0,
    requiredAttribute: book.requiredAttribute,
    requiredAttributeValue: book.requiredAttributeValue >>> 0,
    hotbarSlot,
  };
  learnedSkills.push(learnedSkill);
  session.skillState = {
    learnedSkills,
    hotbarSkillIds,
  };

  return {
    ok: true,
    learnedSkill,
    skillBook: book,
    autoAssignedHotbarSlot: hotbarSlot,
  };
}

function sendSkillStateSync(session: SessionLike, reason = 'runtime'): void {
  if (!session || typeof session.writePacket !== 'function') {
    return;
  }

  const skillState = ensureSkillState(session);
  const learnedSkills = Array.isArray(skillState.learnedSkills) ? skillState.learnedSkills : [];
  const skills = learnedSkills
    .filter((entry: UnknownRecord) => Number.isInteger(entry?.skillId))
    .map((entry: UnknownRecord) => ({
      skillId: entry.skillId >>> 0,
      level: Number.isInteger(entry?.level) && entry.level > 0 ? (entry.level >>> 0) : 1,
      proficiency: Number.isInteger(entry?.proficiency) && entry.proficiency >= 0 ? (entry.proficiency >>> 0) : 0,
    }));

  const packet = buildSkillStateSyncPacket({ skills });
  session.writePacket(
    packet,
    DEFAULT_FLAGS,
    `Sending skill state sync cmd=0x03f0 sub=0x00 reason=${reason} count=${skills.length} skills=${skills
      .map((entry: { skillId: number; level: number; proficiency: number }) => `${entry.skillId}:${entry.level}:${entry.proficiency}`)
      .join(',')}`
  );
}

function loadSkillBookDefinitions(): Map<number, SkillBookDefinition> {
  const byTemplateId = new Map<number, SkillBookDefinition>();
  let raw: UnknownRecord = {};
  try {
    raw = JSON.parse(fs.readFileSync(ITEMS_TABLE_FILE, 'utf8')) as UnknownRecord;
  } catch (_err) {
    return byTemplateId;
  }

  const entries = Array.isArray(raw?.entries) ? raw.entries : [];
  const nameToSkillId = new Map<string, number>();
  for (const entry of entries) {
    if (!Number.isInteger(entry?.templateId)) {
      continue;
    }
    const skillId = resolveSkillId(entry);
    if (skillId === null || skillId <= 0) {
      continue;
    }
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (name) {
      const normalizedSkillId = skillId >>> 0;
      nameToSkillId.set(name.toLowerCase(), normalizedSkillId);
    }
  }

  for (const entry of entries) {
    if (!Number.isInteger(entry?.templateId)) {
      continue;
    }
    const skillId = resolveSkillId(entry);
    if (skillId === null || skillId <= 0 || !looksLikeSkillBook(entry)) {
      continue;
    }

    const normalizedSkillId = skillId >>> 0;
    const name = typeof entry?.name === 'string' && entry.name.length > 0 ? entry.name : `Skill ${normalizedSkillId}`;
    const requiredAttribute = resolveRequiredAttribute(entry);
    const requiredAttributeValue = resolveRequiredAttributeValue(entry);
    const incompatibleNames = parseIncompatibleSkillNames(entry);
    const override = SKILL_BOOK_OVERRIDES.get(entry.templateId >>> 0) || {};
    byTemplateId.set(entry.templateId >>> 0, {
      templateId: entry.templateId >>> 0,
      skillId: typeof override.skillId === 'number' && Number.isInteger(override.skillId)
        ? (override.skillId >>> 0)
        : normalizedSkillId,
      name: typeof override.name === 'string' && override.name.length > 0 ? override.name : name,
      requiredLevel: typeof override.requiredLevel === 'number' && Number.isInteger(override.requiredLevel)
        ? Math.max(1, override.requiredLevel) >>> 0
        : (Math.max(1, Number(entry?.templateTierField || 1)) >>> 0),
      requiredAttribute: override.requiredAttribute ?? requiredAttribute,
      requiredAttributeValue: typeof override.requiredAttributeValue === 'number' && Number.isInteger(override.requiredAttributeValue)
        ? (override.requiredAttributeValue >>> 0)
        : requiredAttributeValue,
      incompatibleSkillIds: Array.isArray(override.incompatibleSkillIds)
        ? override.incompatibleSkillIds.map((value) => value >>> 0)
        : incompatibleNames
            .map((skillName) => nameToSkillId.get(skillName.toLowerCase()) || 0)
            .filter((value) => value > 0),
    });
  }

  return byTemplateId;
}

function looksLikeSkillBook(entry: UnknownRecord): boolean {
  const tooltip = `${typeof entry?.tooltipMarkup === 'string' ? entry.tooltipMarkup : ''} ${typeof entry?.description === 'string' ? entry.description : ''}`;
  return /skill book/i.test(tooltip);
}

function resolveSkillId(entry: UnknownRecord): number | null {
  const valueFields = Array.isArray(entry?.valueFields) ? entry.valueFields : [];
  const candidate = valueFields.length > 2 ? valueFields[2] : null;
  return Number.isInteger(candidate) ? (candidate >>> 0) : null;
}

function resolveRequiredAttribute(entry: UnknownRecord): SkillAttribute {
  const tooltip = `${typeof entry?.tooltipMarkup === 'string' ? entry.tooltipMarkup : ''}`.toLowerCase();
  if (tooltip.includes('strength')) {
    return 'strength';
  }
  if (tooltip.includes('dexterity')) {
    return 'dexterity';
  }
  if (tooltip.includes('vitality')) {
    return 'vitality';
  }
  if (tooltip.includes('intelligence')) {
    return 'intelligence';
  }
  return null;
}

function resolveRequiredAttributeValue(entry: UnknownRecord): number {
  const valueFields = Array.isArray(entry?.valueFields) ? entry.valueFields : [];
  const candidate = valueFields.length > 1 ? Number(valueFields[1] || 0) : 0;
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor(candidate / 10));
}

function parseIncompatibleSkillNames(entry: UnknownRecord): string[] {
  const tooltip = `${typeof entry?.tooltipMarkup === 'string' ? entry.tooltipMarkup : ''}`;
  const match = tooltip.match(/incompatible with\s+([^.;]+)/i);
  if (!match) {
    return [];
  }
  return match[1]
    .split(/\s+and\s+|,/i)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

module.exports = {
  ensureSkillState,
  getSkillBookDefinition,
  learnSkillFromBook,
  sendSkillStateSync,
};
