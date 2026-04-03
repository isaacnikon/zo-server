import type { UnknownRecord } from '../utils.js';
import {
  ROLEINFO_BY_ID,
  CAPTURE_PET_TEMPLATE_BY_ROLE_ID,
  PRIMARY_DROP_STAT_INDEX,
  PRIMARY_DROP_CHANCE_INDEX,
  LOCATION_PATTERN,
  getIndexedInteger,
  normalizeLocationName,
  clampPetField,
} from './data.js';
import type { DropEntry, PetTemplateProfile, EncounterOverrides } from './data.js';

export function getRoleInfo(roleId: number): UnknownRecord | null {
  if (!Number.isInteger(roleId)) {
    return null;
  }
  return ROLEINFO_BY_ID.get(roleId) || null;
}

export function getRoleName(roleId: number): string | null {
  const role = getRoleInfo(roleId);
  return typeof role?.name === 'string' && role.name.length > 0 ? role.name : null;
}

export function getRoleServiceId(roleId: number): number | null {
  const role = getRoleInfo(roleId);
  return getIndexedInteger(role?.tailFields, 4);
}

export function getRolePrimaryDrop(roleId: number): DropEntry | null {
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

export function isFemaleRole(roleId: number): boolean {
  const name = getRoleName(roleId);
  return typeof name === 'string' && name.startsWith('Female ');
}

export function getPetTemplateProfile(roleId: number): PetTemplateProfile | null {
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

export function getCapturePetTemplateId(roleId: number): number | null {
  if (!Number.isInteger(roleId)) {
    return null;
  }
  const mapped = CAPTURE_PET_TEMPLATE_BY_ROLE_ID.get(roleId);
  return typeof mapped === 'number' && Number.isInteger(mapped) && mapped > 0 ? mapped : null;
}

export function buildEncounterPoolEntry(roleId: number, overrides: EncounterOverrides = {}) {
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

export function getRoleLocations(roleId: number): string[] {
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

export function roleHasLocation(roleId: number, locationName: string): boolean {
  const needle = normalizeLocationName(locationName);
  if (!needle) {
    return false;
  }
  return getRoleLocations(roleId).some((location) => normalizeLocationName(location) === needle);
}

export function getOrdinaryMonsterRoleIdsForLocation(locationName: string): number[] {
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

export function buildEncounterPoolForLocation(locationName: string, overridesByRoleId: Record<number, EncounterOverrides> = {}) {
  return getOrdinaryMonsterRoleIdsForLocation(locationName).map((roleId) =>
    buildEncounterPoolEntry(roleId, overridesByRoleId[roleId] || {})
  );
}
