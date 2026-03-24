import type { UnknownRecord } from '../utils.js';

export function packRoleData(extra1: number, extra2: number): number {
  return ((extra2 & 0xffff) << 16) | (extra1 & 0xffff);
}

export function resolveRoleData(role: UnknownRecord): number {
  if (typeof role.extra1 === 'number' || typeof role.extra2 === 'number') {
    return packRoleData(role.extra1 || 0, role.extra2 || 0) >>> 0;
  }
  if (typeof role.roleData === 'number' && typeof role.aptitude === 'number') {
    return role.roleData >>> 0;
  }
  return 0;
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
