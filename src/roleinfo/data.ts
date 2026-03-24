import fs from 'node:fs';
import { resolveRepoPath } from '../runtime-paths.js';
import type { UnknownRecord } from '../utils.js';

export type DropEntry = {
  templateId: number;
  chance: number;
  quantity: number;
  source: string;
};
export type PetTemplateProfile = {
  templateId: number;
  name: string | null;
  typeId: number;
  generation: number;
  baseStats: {
    strength: number;
    dexterity: number;
    vitality: number;
    intelligence: number;
  };
  statCoefficients: number[];
};
export type EncounterOverrides = {
  logicalId?: number;
  levelMin?: number;
  levelMax?: number;
  hpBase?: number;
  hpPerLevel?: number;
  weight?: number;
  aptitude?: number;
  name?: string;
  drops?: DropEntry[];
};

const ROLEINFO_FILE = resolveRepoPath('data', 'client-derived', 'roleinfo.json');
export const PRIMARY_DROP_STAT_INDEX = 30;
export const PRIMARY_DROP_CHANCE_INDEX = 0;
export const LOCATION_PATTERN = /\[([^\]]+)\]/g;
export const CAPTURE_PET_TEMPLATE_OVERRIDES = Object.freeze({
  5002: 2520, // Beetle -> Beatle Soldier
} as Record<number, number>);

export const ROLEINFO_BY_ID = loadRoleinfoById();
export const CAPTURE_PET_TEMPLATE_BY_ROLE_ID = buildCapturePetTemplateMap();

function loadRoleinfoById(): Map<number, UnknownRecord> {
  try {
    const parsed = JSON.parse(fs.readFileSync(ROLEINFO_FILE, 'utf8'));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return new Map(
      entries
        .filter((entry: UnknownRecord) => Number.isInteger(entry?.roleId))
        .map((entry: UnknownRecord) => [entry.roleId, entry] as const)
    );
  } catch (_err) {
    return new Map();
  }
}

function buildCapturePetTemplateMap(): Map<number, number> {
  const mapping = new Map<number, number>();
  for (const [roleIdText, petTemplateId] of Object.entries(CAPTURE_PET_TEMPLATE_OVERRIDES)) {
    const roleId = Number(roleIdText);
    if (!Number.isInteger(roleId) || roleId <= 0 || !Number.isInteger(petTemplateId) || petTemplateId <= 0) {
      continue;
    }
    mapping.set(roleId >>> 0, petTemplateId >>> 0);
  }

  const petCandidatesByName = new Map<string, number[]>();
  for (const role of ROLEINFO_BY_ID.values()) {
    if (role?.roleClassField !== 2 || typeof role?.name !== 'string' || role.name.length === 0) {
      continue;
    }
    const key = normalizeLocationName(role.name);
    if (!key) {
      continue;
    }
    const existing = petCandidatesByName.get(key) || [];
    existing.push(role.roleId >>> 0);
    petCandidatesByName.set(key, existing);
  }

  for (const role of ROLEINFO_BY_ID.values()) {
    if (![4, 5].includes(role?.roleClassField) || !Number.isInteger(role?.roleId)) {
      continue;
    }
    if (mapping.has(role.roleId >>> 0)) {
      continue;
    }
    const key = normalizeLocationName(role.name);
    if (!key) {
      continue;
    }
    const candidates = petCandidatesByName.get(key) || [];
    if (candidates.length === 0) {
      continue;
    }
    mapping.set(role.roleId >>> 0, Math.min(...candidates));
  }
  return mapping;
}

export function getIndexedInteger(values: unknown, index: number): number | null {
  if (!Array.isArray(values) || index < 0 || index >= values.length) {
    return null;
  }
  const value = values[index];
  return Number.isInteger(value) ? value : null;
}

export function normalizeLocationName(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().toLowerCase()
    : '';
}

export function clampPetField(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.round(value));
}
