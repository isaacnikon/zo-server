import type { UnknownRecord } from '../utils.js';

export function packRoleData(extra1: number, extra2: number): number {
  return ((extra2 & 0xffff) << 16) | (extra1 & 0xffff);
}

function hashStableRoleSeed(seed: string): number {
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (((hash << 5) + hash) ^ seed.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
}

export function deriveStableRoleData(role: UnknownRecord): number {
  const seed = [
    typeof role.characterId === 'string' ? role.characterId.trim() : '',
    typeof role.accountId === 'string' ? role.accountId.trim() : '',
    typeof role.accountKey === 'string' ? role.accountKey.trim() : '',
    typeof role.accountName === 'string' ? role.accountName.trim() : '',
    typeof role.charName === 'string' ? role.charName.trim() : '',
    typeof role.roleName === 'string' ? role.roleName.trim() : '',
  ].filter((value) => value.length > 0).join('|');

  if (seed.length > 0) {
    const hashed = (hashStableRoleSeed(seed) & 0x7fffffff) >>> 0;
    return hashed === 0 ? 1 : hashed;
  }

  const entityType = typeof role.roleEntityType === 'number'
    ? (role.roleEntityType >>> 0)
    : (typeof role.entityType === 'number' ? (role.entityType >>> 0) : 0);
  const aptitude = typeof role.selectedAptitude === 'number'
    ? (role.selectedAptitude >>> 0)
    : (typeof role.aptitude === 'number' ? (role.aptitude >>> 0) : 0);
  const fallback = (((entityType & 0xffff) << 16) | (aptitude & 0xffff)) >>> 0;
  return fallback === 0 ? 1 : fallback;
}

export function resolveRoleData(role: UnknownRecord): number {
  if (typeof role.roleData === 'number' && role.roleData !== 0) {
    const normalized = (role.roleData >>> 0) & 0x7fffffff;
    return normalized === 0 ? 1 : normalized;
  }
  if (typeof role.extra1 === 'number' || typeof role.extra2 === 'number') {
    const packed = packRoleData(role.extra1 || 0, role.extra2 || 0) >>> 0;
    if (packed !== 0) {
      return packed;
    }
  }
  return deriveStableRoleData(role);
}

export function resolveRoleLevel(role: UnknownRecord): number {
  if (typeof role.level === 'number') {
    return role.level & 0xff;
  }
  return 1;
}

export function resolveBirthMonth(role: UnknownRecord): number {
  if (typeof role.birthMonth === 'number') {
    return role.birthMonth & 0xff;
  }
  return (role.trait1 || 0) & 0xff;
}

export function resolveBirthDay(role: UnknownRecord): number {
  if (typeof role.birthDay === 'number') {
    return role.birthDay & 0xff;
  }
  return (role.trait2 || 0) & 0xff;
}
