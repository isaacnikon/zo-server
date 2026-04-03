import { readStaticJsonDocument } from '../db/static-json-store.js';
import { resolveRepoPath } from '../runtime-paths.js';
import { numberOrDefault, type UnknownRecord } from '../utils.js';

const PROGRESSION_DATA_FILE = resolveRepoPath('data', 'client-verified', 'progression', 'playlevelup.json');

export const STATUS_POINTS_PER_LEVEL = 4;
const DEFAULT_REQUIRED_EXPERIENCE = 327000000;
export const PROGRESSION = loadProgressionTable();

function loadProgressionTable() {
  const parsed = readStaticJsonDocument<UnknownRecord>(PROGRESSION_DATA_FILE);
  const rows = Array.isArray(parsed?.levels) ? parsed.levels : [];
  const requiredExperienceByLevel = new Map();
  let maxLevel = 1;

  for (const row of rows) {
    if (!Number.isInteger(row?.level) || typeof row?.requiredExperience !== 'number') {
      continue;
    }
    requiredExperienceByLevel.set(row.level >>> 0, Math.max(0, row.requiredExperience | 0));
    maxLevel = Math.max(maxLevel, row.level >>> 0);
  }

  return Object.freeze({
    maxLevel,
    requiredExperienceByLevel,
  });
}

export function getRequiredExperienceForNextLevel(level: number): number | null {
  if (level >= PROGRESSION.maxLevel) {
    return null;
  }
  return PROGRESSION.requiredExperienceByLevel.get(level) || DEFAULT_REQUIRED_EXPERIENCE;
}

export function getClientVisibleExperience(level: number, experience: number): number {
  if (Math.max(1, numberOrDefault(level, 1)) >= PROGRESSION.maxLevel) {
    return 0;
  }
  return Math.max(0, numberOrDefault(experience, 0));
}

export function applyExperienceGain(character: UnknownRecord | null | undefined, gainedExperience: number) {
  const currentLevel = Math.max(1, numberOrDefault(character?.level, 1));
  let level = currentLevel;
  let experience = Math.max(0, numberOrDefault(character?.experience, 0)) + Math.max(0, numberOrDefault(gainedExperience, 0));
  let statusPoints = Math.max(0, numberOrDefault(character?.statusPoints, 0));
  let levelsGained = 0;

  while (level < PROGRESSION.maxLevel) {
    const requiredExperience = getRequiredExperienceForNextLevel(level);
    if (requiredExperience == null || experience < requiredExperience) {
      break;
    }
    experience -= requiredExperience;
    level += 1;
    levelsGained += 1;
    statusPoints += STATUS_POINTS_PER_LEVEL;
  }

  if (level >= PROGRESSION.maxLevel) {
    level = PROGRESSION.maxLevel;
    experience = 0;
  }

  return {
    level,
    experience,
    statusPoints,
    levelsGained,
    statusPointsGained: levelsGained * STATUS_POINTS_PER_LEVEL,
    requiredExperienceForNextLevel: getRequiredExperienceForNextLevel(level),
  };
}
