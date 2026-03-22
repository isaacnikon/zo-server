'use strict';
export {};

const fs = require('fs');
const { resolveRepoPath } = require('./runtime-paths');
type UnknownRecord = Record<string, any>;
type DropEntry = {
  templateId: number;
  chance: number;
  quantity: number;
  source: string;
};
type PetTemplateProfile = {
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
type EncounterOverrides = {
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
const PRIMARY_DROP_STAT_INDEX = 30;
const PRIMARY_DROP_CHANCE_INDEX = 0;
const LOCATION_PATTERN = /\[([^\]]+)\]/g;

const ROLEINFO_BY_ID = loadRoleinfoById();

function getRoleInfo(roleId: number): UnknownRecord | null {
  if (!Number.isInteger(roleId)) {
    return null;
  }
  return ROLEINFO_BY_ID.get(roleId) || null;
}

function getRoleName(roleId: number): string | null {
  const role = getRoleInfo(roleId);
  return typeof role?.name === 'string' && role.name.length > 0 ? role.name : null;
}

function getRoleServiceId(roleId: number): number | null {
  const role = getRoleInfo(roleId);
  return getIndexedInteger(role?.tailFields, 4);
}

function getRolePrimaryDrop(roleId: number): DropEntry | null {
  const role = getRoleInfo(roleId);
  if (!role) {
    return null;
  }

  const templateId = getIndexedInteger(role.statFields, PRIMARY_DROP_STAT_INDEX);
  if (typeof templateId !== 'number' || !Number.isInteger(templateId) || templateId <= 0) {
    return null;
  }
  const resolvedTemplateId = templateId;

  const chance = getIndexedInteger(role.tailFields, PRIMARY_DROP_CHANCE_INDEX);
  const resolvedChance =
    typeof chance === 'number' && Number.isInteger(chance) && chance > 0
      ? Math.min(100, chance)
      : 100;
  return {
    templateId: resolvedTemplateId,
    chance: resolvedChance,
    quantity: 1,
    source: `client-derived roleinfo primary drop for roleId=${roleId}`,
  };
}

function isFemaleRole(roleId: number): boolean {
  const name = getRoleName(roleId);
  return typeof name === 'string' && name.startsWith('Female ');
}

function getPetTemplateProfile(roleId: number): PetTemplateProfile | null {
  const role = getRoleInfo(roleId);
  if (!role || role.roleClassField !== 2) {
    return null;
  }

  const coreFields = Array.isArray(role.coreFields) ? role.coreFields : [];
  const statFields = Array.isArray(role.statFields) ? role.statFields : [];
  const baseStats = {
    strength: clampPetField(coreFields[5], 10),
    dexterity: clampPetField(coreFields[6], 10),
    vitality: clampPetField(coreFields[7], 10),
    intelligence: clampPetField(coreFields[8], 10),
  };
  const statCoefficients = [];
  for (let index = 21; index <= 29; index += 1) {
    statCoefficients.push(clampPetField(statFields[index], 1000));
  }

  return {
    templateId: roleId,
    name: typeof role.name === 'string' && role.name.length > 0 ? role.name : null,
    typeId: clampPetField(role.roleGroupField, 0),
    generation: Math.max(0, clampPetField(role.field4, 1) - 1),
    baseStats,
    statCoefficients,
  };
}

function buildEncounterPoolEntry(roleId: number, overrides: EncounterOverrides = {}) {
  const role = getRoleInfo(roleId);
  const primaryDrop = getRolePrimaryDrop(roleId);
  const entry = {
    typeId: roleId,
    logicalId: Number.isInteger(overrides.logicalId) ? overrides.logicalId : roleId,
    levelMin: Number.isInteger(overrides.levelMin) ? overrides.levelMin : 1,
    levelMax: Number.isInteger(overrides.levelMax) ? overrides.levelMax : 1,
    hpBase: Number.isFinite(overrides.hpBase) ? overrides.hpBase : 80,
    hpPerLevel: Number.isFinite(overrides.hpPerLevel) ? overrides.hpPerLevel : 5,
    weight: Number.isFinite(overrides.weight) ? overrides.weight : 1,
    aptitude: Number.isInteger(overrides.aptitude) ? overrides.aptitude : 0,
    name: role?.name || overrides.name || `Enemy ${roleId}`,
    drops: primaryDrop ? [primaryDrop] : [],
  };

  if (Array.isArray(overrides.drops)) {
    entry.drops = overrides.drops.map((drop: DropEntry) => ({ ...drop }));
  }

  return entry;
}

function getRoleLocations(roleId: number): string[] {
  const role = getRoleInfo(roleId);
  if (!role || typeof role.description !== 'string' || role.description.length === 0) {
    return [];
  }

  const locations: string[] = [];
  for (const match of role.description.matchAll(LOCATION_PATTERN)) {
    const value = String(match[1] || '').trim();
    if (!value || locations.includes(value)) {
      continue;
    }
    locations.push(value);
  }
  return locations;
}

function roleHasLocation(roleId: number, locationName: string): boolean {
  const needle = normalizeLocationName(locationName);
  if (!needle) {
    return false;
  }
  return getRoleLocations(roleId).some((location) => normalizeLocationName(location) === needle);
}

function getOrdinaryMonsterRoleIdsForLocation(locationName: string): number[] {
  const needle = normalizeLocationName(locationName);
  if (!needle) {
    return [];
  }

  const matches = [];
  for (const role of ROLEINFO_BY_ID.values()) {
    if (role?.roleClassField !== 4) {
      continue;
    }
    const hasLocation = getRoleLocations(role.roleId).some(
      (location) => normalizeLocationName(location) === needle
    );
    if (hasLocation) {
      matches.push(role.roleId);
    }
  }
  return matches.sort((left, right) => left - right);
}

function buildEncounterPoolForLocation(locationName: string, overridesByRoleId: Record<number, EncounterOverrides> = {}) {
  return getOrdinaryMonsterRoleIdsForLocation(locationName).map((roleId) =>
    buildEncounterPoolEntry(roleId, overridesByRoleId[roleId] || {})
  );
}

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

function getIndexedInteger(values: unknown, index: number): number | null {
  if (!Array.isArray(values) || index < 0 || index >= values.length) {
    return null;
  }
  const value = values[index];
  return Number.isInteger(value) ? value : null;
}

function normalizeLocationName(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().toLowerCase()
    : '';
}

function clampPetField(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.round(value));
}

module.exports = {
  buildEncounterPoolEntry,
  buildEncounterPoolForLocation,
  getPetTemplateProfile,
  getRoleInfo,
  getRoleLocations,
  getRoleName,
  getRoleServiceId,
  getOrdinaryMonsterRoleIdsForLocation,
  getRolePrimaryDrop,
  isFemaleRole,
  roleHasLocation,
};
