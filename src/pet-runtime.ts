'use strict';
export {};

const { getPetTemplateProfile, getRoleName } = require('./roleinfo');
const { resolvePetMaxVitals } = require('./gameplay/max-vitals');
type UnknownRecord = Record<string, any>;
type PetStats = {
  strength: number;
  dexterity: number;
  vitality: number;
  intelligence: number;
};
type PetRecord = {
  templateId: number;
  awardedAt: number;
  runtimeId: number;
  name: string;
  level: number;
  generation: number;
  currentHealth: number;
  currentMana: number;
  loyalty: number;
  typeId: number;
  rebirth: number;
  experience: number;
  stateFlags: {
    modeA: number;
    modeB: number;
    activeFlag: number;
  };
  stats: PetStats;
  baseStats: PetStats;
  statCoefficients: number[];
  statPoints: number;
};

const DEFAULT_PET_STATS = Object.freeze({
  strength: 10,
  dexterity: 10,
  vitality: 10,
  intelligence: 10,
});

function normalizePets(pets: unknown): PetRecord[] {
  if (!Array.isArray(pets)) {
    return [];
  }

  return pets
    .map((pet, index) => normalizePetRecord(pet, index))
    .filter((pet): pet is PetRecord => pet !== null);
}

function normalizePetRecord(pet: UnknownRecord | null | undefined, index = 0): PetRecord | null {
  if (!pet || typeof pet !== 'object') {
    return null;
  }

  const templateId = numberOrDefault(pet.templateId, 0);
  if (templateId <= 0) {
    return null;
  }

  const awardedAt = numberOrDefault(pet.awardedAt, Date.now());
  const runtimeId = numberOrDefault(
    pet.runtimeId,
    buildDefaultPetRuntimeId(templateId, awardedAt, index)
  ) >>> 0;
  const templateProfile = getPetTemplateProfile(templateId);
  const level = Math.max(1, numberOrDefault(pet.level, 1));
  const generation = Math.max(
    0,
    numberOrDefault(pet.generation, templateProfile?.generation ?? 0)
  );
  const currentHealth = Math.max(1, numberOrDefault(pet.currentHealth, 100));
  const currentMana = Math.max(0, numberOrDefault(pet.currentMana, 60));
  const loyalty = Math.max(0, numberOrDefault(pet.loyalty, 100));
  const statPoints = Math.max(0, numberOrDefault(pet.statPoints, 0));
  const stats = normalizePetStats(pet.stats);
  const baseStats = normalizePetBaseStats(pet.baseStats, templateProfile?.baseStats);
  const statCoefficients = normalizePetStatCoefficients(
    pet.statCoefficients,
    templateProfile?.statCoefficients
  );
  const maxVitals = resolvePetMaxVitals({
    level,
    stats,
    baseStats,
    statCoefficients,
  });

  return {
    templateId,
    awardedAt,
    runtimeId,
    name:
      typeof pet.name === 'string' && pet.name.length > 0
        ? pet.name
        : getRoleName(templateId) || `Pet ${templateId}`,
    level,
    generation,
    currentHealth: Math.min(currentHealth, maxVitals.health),
    currentMana: Math.min(currentMana, maxVitals.mana),
    loyalty,
    typeId: Math.max(0, numberOrDefault(pet.typeId, templateProfile?.typeId ?? 0)),
    rebirth: Math.max(0, numberOrDefault(pet.rebirth, 0)),
    experience: Math.max(0, numberOrDefault(pet.experience, 0)),
    stateFlags: {
      // 0x03fa pet create/summon expects a valid battlefield placement:
      // modeA=row (0..2), modeB=col (0..4), activeFlag=side (1 or 0xff/-1).
      modeA: normalizePetRow(pet?.stateFlags?.modeA),
      modeB: normalizePetCol(pet?.stateFlags?.modeB),
      activeFlag: normalizePetSide(pet?.stateFlags?.activeFlag),
    },
    stats,
    baseStats,
    statCoefficients,
    statPoints,
  };
}

function createOwnedPet(templateId: number, overrides: UnknownRecord = {}, index = 0): PetRecord | null {
  return normalizePetRecord(
    {
      templateId,
      awardedAt: Date.now(),
      ...overrides,
    },
    index
  );
}

function getPrimaryPet(pets: unknown): PetRecord | null {
  const normalizedPets = normalizePets(pets);
  return normalizedPets.length > 0 ? normalizedPets[0] : null;
}

function buildDefaultPetRuntimeId(templateId: number, awardedAt: number, index: number): number {
  const suffix = ((awardedAt >>> 0) + (index & 0xff)) & 0xffff;
  return (((templateId & 0xffff) << 16) | suffix) >>> 0;
}

function normalizePetStats(stats: UnknownRecord | null | undefined): PetStats {
  return {
    strength: Math.max(0, numberOrDefault(stats?.strength, DEFAULT_PET_STATS.strength)),
    dexterity: Math.max(0, numberOrDefault(stats?.dexterity, DEFAULT_PET_STATS.dexterity)),
    vitality: Math.max(0, numberOrDefault(stats?.vitality, DEFAULT_PET_STATS.vitality)),
    intelligence: Math.max(0, numberOrDefault(stats?.intelligence, DEFAULT_PET_STATS.intelligence)),
  };
}

function normalizePetBaseStats(
  stats: UnknownRecord | null | undefined,
  fallback: PetStats | null | undefined
): PetStats {
  return {
    strength: Math.max(0, numberOrDefault(stats?.strength, fallback?.strength ?? DEFAULT_PET_STATS.strength)),
    dexterity: Math.max(0, numberOrDefault(stats?.dexterity, fallback?.dexterity ?? DEFAULT_PET_STATS.dexterity)),
    vitality: Math.max(0, numberOrDefault(stats?.vitality, fallback?.vitality ?? DEFAULT_PET_STATS.vitality)),
    intelligence: Math.max(0, numberOrDefault(stats?.intelligence, fallback?.intelligence ?? DEFAULT_PET_STATS.intelligence)),
  };
}

function normalizePetStatCoefficients(value: unknown, fallback: number[] | null | undefined): number[] {
  const source = Array.isArray(value) && value.length === 9 ? value : fallback;
  if (!Array.isArray(source) || source.length !== 9) {
    return [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];
  }
  return source.map((entry) => Math.max(0, numberOrDefault(entry, 1000)));
}

function normalizePetRow(value: unknown): number {
  const row = numberOrDefault(value, 0) | 0;
  return Math.min(2, Math.max(0, row)) & 0xff;
}

function normalizePetCol(value: unknown): number {
  const col = numberOrDefault(value, 0) | 0;
  return Math.min(4, Math.max(0, col)) & 0xff;
}

function normalizePetSide(value: unknown): number {
  const side = numberOrDefault(value, 1) | 0;
  if (side === 1 || side === -1 || side === 0xff) {
    return side & 0xff;
  }
  return 1;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

module.exports = {
  createOwnedPet,
  getPrimaryPet,
  normalizePetRecord,
  normalizePets,
};
