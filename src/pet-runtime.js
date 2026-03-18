'use strict';

const { getRoleName } = require('./roleinfo');

const DEFAULT_PET_STATS = Object.freeze({
  strength: 10,
  dexterity: 10,
  vitality: 10,
  intelligence: 10,
});

function normalizePets(pets) {
  if (!Array.isArray(pets)) {
    return [];
  }

  return pets
    .map((pet, index) => normalizePetRecord(pet, index))
    .filter(Boolean);
}

function normalizePetRecord(pet, index = 0) {
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
  const level = Math.max(1, numberOrDefault(pet.level, 1));
  const generation = Math.max(0, numberOrDefault(pet.generation, 0));
  const currentHealth = Math.max(1, numberOrDefault(pet.currentHealth, 100));
  const currentMana = Math.max(0, numberOrDefault(pet.currentMana, 60));
  const loyalty = Math.max(0, numberOrDefault(pet.loyalty, 100));
  const statPoints = Math.max(0, numberOrDefault(pet.statPoints, 0));
  const stats = normalizePetStats(pet.stats);

  return {
    templateId,
    awardedAt,
    runtimeId,
    name: typeof pet.name === 'string' && pet.name.length > 0 ? pet.name : getRoleName(templateId) || `Pet ${templateId}`,
    level,
    generation,
    currentHealth,
    currentMana,
    loyalty,
    stateFlags: {
      // 0x03fa pet create/summon expects a valid battlefield placement:
      // modeA=row (0..2), modeB=col (0..4), activeFlag=side (1 or 0xff/-1).
      modeA: normalizePetRow(pet?.stateFlags?.modeA),
      modeB: normalizePetCol(pet?.stateFlags?.modeB),
      activeFlag: normalizePetSide(pet?.stateFlags?.activeFlag),
    },
    stats,
    statPoints,
  };
}

function createOwnedPet(templateId, overrides = {}, index = 0) {
  return normalizePetRecord(
    {
      templateId,
      awardedAt: Date.now(),
      ...overrides,
    },
    index
  );
}

function getPrimaryPet(pets) {
  const normalizedPets = normalizePets(pets);
  return normalizedPets.length > 0 ? normalizedPets[0] : null;
}

function buildDefaultPetRuntimeId(templateId, awardedAt, index) {
  const suffix = ((awardedAt >>> 0) + (index & 0xff)) & 0xffff;
  return (((templateId & 0xffff) << 16) | suffix) >>> 0;
}

function normalizePetStats(stats) {
  return {
    strength: Math.max(0, numberOrDefault(stats?.strength, DEFAULT_PET_STATS.strength)),
    dexterity: Math.max(0, numberOrDefault(stats?.dexterity, DEFAULT_PET_STATS.dexterity)),
    vitality: Math.max(0, numberOrDefault(stats?.vitality, DEFAULT_PET_STATS.vitality)),
    intelligence: Math.max(0, numberOrDefault(stats?.intelligence, DEFAULT_PET_STATS.intelligence)),
  };
}

function normalizePetRow(value) {
  const row = numberOrDefault(value, 0) | 0;
  return Math.min(2, Math.max(0, row)) & 0xff;
}

function normalizePetCol(value) {
  const col = numberOrDefault(value, 0) | 0;
  return Math.min(4, Math.max(0, col)) & 0xff;
}

function normalizePetSide(value) {
  const side = numberOrDefault(value, 1) | 0;
  if (side === 1 || side === -1 || side === 0xff) {
    return side & 0xff;
  }
  return 1;
}

function numberOrDefault(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

module.exports = {
  createOwnedPet,
  getPrimaryPet,
  normalizePetRecord,
  normalizePets,
};
