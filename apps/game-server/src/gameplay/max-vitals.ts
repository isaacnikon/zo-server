import fs from 'node:fs';

import { resolveRepoPath } from '../runtime-paths.js';

type UnknownRecord = Record<string, any>;
type PrimaryAttributes = {
  intelligence: number;
  vitality: number;
  dexterity: number;
  strength: number;
};
type Vitals = { health: number; mana: number; rage: number };
type GrowthRow = { hpGrowth: number; mpGrowth: number };
type PetStats = {
  strength: number;
  dexterity: number;
  vitality: number;
  intelligence: number;
};
type ResolveCharacterMaxVitalsOptions = {
  includeExplicitMaximums?: boolean;
};

const ZIZHI_INFO_FILE = resolveRepoPath('data', 'client-derived', 'archive', '00007383__zizhiinfo.txt');
export const DEFAULT_MAX_VITALS = Object.freeze({
  health: 432,
  mana: 630,
  rage: 100,
});
const GROWTH_ROWS = loadGrowthRows();

export function resolveCharacterMaxVitals(input: UnknownRecord | null | undefined = {}): Vitals {
  return resolveCharacterMaxVitalsInternal(input, { includeExplicitMaximums: true });
}

export function resolveCharacterDerivedMaxVitals(
  input: UnknownRecord | null | undefined = {}
): Vitals {
  return resolveCharacterMaxVitalsInternal(input, { includeExplicitMaximums: false });
}

function resolveCharacterMaxVitalsInternal(
  input: UnknownRecord | null | undefined = {},
  options: ResolveCharacterMaxVitalsOptions = {}
): Vitals {
  const includeExplicitMaximums = options.includeExplicitMaximums !== false;
  const selectedAptitude = numberOrDefault(input?.selectedAptitude, 0);
  const level = Math.max(1, numberOrDefault(input?.level, 1));
  const stats = normalizePrimaryAttributes(input?.primaryAttributes);
  const bonuses = resolveCharacterBonusAttributes(input);
  const baseAttributes = resolveCharacterBaseAttributes(input);
  const growth = GROWTH_ROWS.get(selectedAptitude) || GROWTH_ROWS.get(0) || { hpGrowth: 950, mpGrowth: 1040 };
  const explicitHealth = includeExplicitMaximums
    ? Math.max(0, numberOrDefault(input?.maxHealth, 0), numberOrDefault(input?.maxHp, 0))
    : 0;
  const explicitMana = includeExplicitMaximums
    ? Math.max(0, numberOrDefault(input?.maxMana, 0), numberOrDefault(input?.maxMp, 0))
    : 0;

  const strength = stats.strength + bonuses.strength + baseAttributes.strength;
  const dexterity = stats.dexterity + bonuses.dexterity + baseAttributes.dexterity;
  const vitality = stats.vitality + bonuses.vitality + baseAttributes.vitality;
  const intelligence = stats.intelligence + bonuses.intelligence + baseAttributes.intelligence;

  const computedHealth = Math.floor(
    (((intelligence + strength) * 40) + (((dexterity * 3) + (level * 5) + vitality) * 30)) * growth.hpGrowth / 10000
  );
  const computedMana = Math.floor(
    ((((strength + (vitality * 2)) * 40) + ((dexterity + (intelligence * 2)) * 60)) * growth.mpGrowth) / 10000
  );

  return {
    health: Math.max(DEFAULT_MAX_VITALS.health, computedHealth, explicitHealth),
    mana: Math.max(DEFAULT_MAX_VITALS.mana, computedMana, explicitMana),
    rage: Math.max(
      DEFAULT_MAX_VITALS.rage,
      numberOrDefault(input?.maxRage, 0),
      numberOrDefault(input?.currentRage, 0),
      numberOrDefault(input?.rage, 0)
    ),
  };
}

export function resolvePetMaxVitals(input: UnknownRecord | null | undefined = {}): Vitals {
  const level = Math.max(1, numberOrDefault(input?.level, 1));
  const currentStats = normalizePrimaryAttributes(input?.stats);
  const baseStats = normalizePrimaryAttributes(input?.baseStats);
  const statCoefficients = Array.isArray(input?.statCoefficients) ? input.statCoefficients : [];

  const effectiveStats: PetStats = {
    strength: Math.max(0, currentStats.strength + baseStats.strength),
    dexterity: Math.max(0, currentStats.dexterity + baseStats.dexterity),
    vitality: Math.max(0, currentStats.vitality + baseStats.vitality),
    intelligence: Math.max(0, currentStats.intelligence + baseStats.intelligence),
  };

  const hpGrowth = Math.max(1, numberOrDefault(statCoefficients[7], 750));
  const mpGrowth = Math.max(1, numberOrDefault(statCoefficients[8], 750));

  const computedHealth = Math.floor(
    (((effectiveStats.intelligence + effectiveStats.strength) * 40) +
      (((effectiveStats.dexterity * 3) + (level * 5) + effectiveStats.vitality) * 30)) *
      hpGrowth /
      10000
  );
  const computedMana = Math.floor(
    ((((effectiveStats.strength + (effectiveStats.vitality * 2)) * 40) +
      ((effectiveStats.dexterity + (effectiveStats.intelligence * 2)) * 60)) *
      mpGrowth) /
      10000
  );

  return {
    health: Math.max(1, computedHealth),
    mana: Math.max(0, computedMana),
    rage: 0,
  };
}

function normalizePrimaryAttributes(primaryAttributes: UnknownRecord | null | undefined): PrimaryAttributes {
  return {
    intelligence: Math.max(0, numberOrDefault(primaryAttributes?.intelligence ?? primaryAttributes?.ene, 0)),
    vitality: Math.max(0, numberOrDefault(primaryAttributes?.vitality ?? primaryAttributes?.con, 0)),
    dexterity: Math.max(0, numberOrDefault(primaryAttributes?.dexterity ?? primaryAttributes?.dex, 0)),
    strength: Math.max(0, numberOrDefault(primaryAttributes?.strength ?? primaryAttributes?.str, 0)),
  };
}

export function resolveCharacterBonusAttributes(input: UnknownRecord | null | undefined): PrimaryAttributes {
  const explicitBonuses = normalizePrimaryAttributes(input?.bonusAttributes);
  return {
    intelligence: explicitBonuses.intelligence,
    vitality: explicitBonuses.vitality,
    dexterity: explicitBonuses.dexterity,
    strength: explicitBonuses.strength,
  };
}

function resolveCharacterBaseAttributes(input: UnknownRecord | null | undefined): PrimaryAttributes {
  const level = Math.max(1, numberOrDefault(input?.level, 1));
  const base = level + 4;
  return {
    intelligence: base,
    vitality: base,
    dexterity: base,
    strength: base,
  };
}

function loadGrowthRows(): Map<number, GrowthRow> {
  const rows = new Map<number, GrowthRow>();
  let raw = '';
  try {
    raw = fs.readFileSync(ZIZHI_INFO_FILE, 'utf8');
  } catch (_err) {
    return rows;
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  for (const line of lines.slice(1)) {
    const fields = splitCsv(line).map((field) => field.trim());
    if (fields.length < 11) {
      continue;
    }
    const aptitudeId = numberOrDefault(fields[0], -1);
    const hpGrowth = numberOrDefault(fields[9], 0);
    const mpGrowth = numberOrDefault(fields[10], 0);
    if (aptitudeId < 0 || hpGrowth <= 0 || mpGrowth <= 0) {
      continue;
    }
    rows.set(aptitudeId, { hpGrowth, mpGrowth });
  }
  return rows;
}

function splitCsv(line: string): string[] {
  return line
    .split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/)
    .map((field) => field.replace(/^"(.*)"$/, '$1'));
}

function numberOrDefault(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number(value.replace(/\s+/g, '')) : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
