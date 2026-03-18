'use strict';

const fs = require('fs');
const { resolveRepoPath } = require('./runtime-paths');

const ROLEINFO_FILE = resolveRepoPath('data', 'client-derived', 'roleinfo.json');
const PRIMARY_DROP_STAT_INDEX = 30;
const PRIMARY_DROP_CHANCE_INDEX = 0;
const LOCATION_PATTERN = /\[([^\]]+)\]/g;

const ROLEINFO_BY_ID = loadRoleinfoById();

function getRoleInfo(roleId) {
  if (!Number.isInteger(roleId)) {
    return null;
  }
  return ROLEINFO_BY_ID.get(roleId) || null;
}

function getRoleName(roleId) {
  const role = getRoleInfo(roleId);
  return typeof role?.name === 'string' && role.name.length > 0 ? role.name : null;
}

function getRolePrimaryDrop(roleId) {
  const role = getRoleInfo(roleId);
  if (!role) {
    return null;
  }

  const templateId = getIndexedInteger(role.statFields, PRIMARY_DROP_STAT_INDEX);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    return null;
  }

  const chance = getIndexedInteger(role.tailFields, PRIMARY_DROP_CHANCE_INDEX);
  return {
    templateId,
    chance: Number.isInteger(chance) && chance > 0 ? Math.min(100, chance) : 100,
    quantity: 1,
    source: `client-derived roleinfo primary drop for roleId=${roleId}`,
  };
}

function isFemaleRole(roleId) {
  const name = getRoleName(roleId);
  return typeof name === 'string' && name.startsWith('Female ');
}

function buildEncounterPoolEntry(roleId, overrides = {}) {
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
    entry.drops = overrides.drops.map((drop) => ({ ...drop }));
  }

  return entry;
}

function getRoleLocations(roleId) {
  const role = getRoleInfo(roleId);
  if (!role || typeof role.description !== 'string' || role.description.length === 0) {
    return [];
  }

  const locations = [];
  for (const match of role.description.matchAll(LOCATION_PATTERN)) {
    const value = String(match[1] || '').trim();
    if (!value || locations.includes(value)) {
      continue;
    }
    locations.push(value);
  }
  return locations;
}

function roleHasLocation(roleId, locationName) {
  const needle = normalizeLocationName(locationName);
  if (!needle) {
    return false;
  }
  return getRoleLocations(roleId).some((location) => normalizeLocationName(location) === needle);
}

function getOrdinaryMonsterRoleIdsForLocation(locationName) {
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

function buildEncounterPoolForLocation(locationName, overridesByRoleId = {}) {
  return getOrdinaryMonsterRoleIdsForLocation(locationName).map((roleId) =>
    buildEncounterPoolEntry(roleId, overridesByRoleId[roleId] || {})
  );
}

function loadRoleinfoById() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ROLEINFO_FILE, 'utf8'));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return new Map(
      entries
        .filter((entry) => Number.isInteger(entry?.roleId))
        .map((entry) => [entry.roleId, entry])
    );
  } catch (err) {
    return new Map();
  }
}

function getIndexedInteger(values, index) {
  if (!Array.isArray(values) || index < 0 || index >= values.length) {
    return null;
  }
  const value = values[index];
  return Number.isInteger(value) ? value : null;
}

function normalizeLocationName(value) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().toLowerCase()
    : '';
}

module.exports = {
  buildEncounterPoolEntry,
  buildEncounterPoolForLocation,
  getRoleInfo,
  getRoleLocations,
  getRoleName,
  getOrdinaryMonsterRoleIdsForLocation,
  getRolePrimaryDrop,
  isFemaleRole,
  roleHasLocation,
};
