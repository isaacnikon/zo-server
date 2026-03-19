'use strict';
export {};

import fs from 'fs';

const { resolveRepoPath } = require('../runtime-paths');

type UnknownRecord = Record<string, any>;
type PrimaryAttributes = {
  intelligence: number;
  vitality: number;
  dexterity: number;
  strength: number;
};
type Vitals = { health: number; mana: number; rage: number };
type GrowthRow = { hpGrowth: number; mpGrowth: number };

const ZIZHI_INFO_FILE = resolveRepoPath('data', 'client-derived', 'archive', '00007383__zizhiinfo.txt');
const DEFAULT_MAX_VITALS = Object.freeze({
  health: 432,
  mana: 630,
  rage: 100,
});
const GROWTH_ROWS = loadGrowthRows();

function resolveCharacterMaxVitals(input: UnknownRecord | null | undefined = {}): Vitals {
  const selectedAptitude = numberOrDefault(input?.selectedAptitude, 0);
  const level = Math.max(1, numberOrDefault(input?.level, 1));
  const stats = normalizePrimaryAttributes(input?.primaryAttributes);
  const bonuses = resolveCharacterBonusAttributes(input);
  const growth = GROWTH_ROWS.get(selectedAptitude) || GROWTH_ROWS.get(0) || { hpGrowth: 950, mpGrowth: 1040 };

  const strength = stats.strength + bonuses.strength;
  const dexterity = stats.dexterity + bonuses.dexterity;
  const vitality = stats.vitality + bonuses.vitality;
  const intelligence = stats.intelligence + bonuses.intelligence;

  const computedHealth = Math.floor(
    (((intelligence + strength) * 40) + (((dexterity * 3) + (level * 5) + vitality) * 30)) * growth.hpGrowth / 10000
  );
  const computedMana = Math.floor(
    ((((strength + (vitality * 2)) * 40) + ((dexterity + (intelligence * 2)) * 60)) * growth.mpGrowth) / 10000
  );

  return {
    // Preserve any already-higher observed max values because the server does
    // not model equipment/temporary bonus attributes yet.
    health: Math.max(
      DEFAULT_MAX_VITALS.health,
      computedHealth,
      numberOrDefault(input?.maxHealth, 0),
      numberOrDefault(input?.currentHealth, 0)
    ),
    mana: Math.max(
      DEFAULT_MAX_VITALS.mana,
      computedMana,
      numberOrDefault(input?.maxMana, 0),
      numberOrDefault(input?.currentMana, 0)
    ),
    rage: Math.max(
      DEFAULT_MAX_VITALS.rage,
      numberOrDefault(input?.maxRage, 0),
      numberOrDefault(input?.currentRage, 0)
    ),
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

function resolveCharacterBonusAttributes(input: UnknownRecord | null | undefined): PrimaryAttributes {
  const explicitBonuses = normalizePrimaryAttributes(input?.bonusAttributes);
  const levelBonus = Math.max(0, numberOrDefault(input?.level, 1) - 1);
  return {
    intelligence: explicitBonuses.intelligence + levelBonus,
    vitality: explicitBonuses.vitality + levelBonus,
    dexterity: explicitBonuses.dexterity + levelBonus,
    strength: explicitBonuses.strength + levelBonus,
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

module.exports = {
  DEFAULT_MAX_VITALS,
  resolveCharacterBonusAttributes,
  resolveCharacterMaxVitals,
};
