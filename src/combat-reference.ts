'use strict';
export {};

const fs = require('fs');
const path = require('path');

const {
  COMBAT_REFERENCE_ROOT,
} = require('./config');
type FightCommand = {
  id: number;
  raw: string[];
};
type SkillReference = {
  family: number;
  id: number;
  name: string;
  raw: string[];
};
type FightPosition = {
  side: number;
  x: number;
  y: number;
  index: number;
};
type CombatReference = {
  root: string;
  available: boolean;
  fightInfoPath: string;
  skillMagicPath: string;
  fightPositionPath: string;
  fightCommands: FightCommand[];
  skills: SkillReference[];
  fightPositions: FightPosition[];
};
type CombatTurnProfile = {
  profile: string;
  rows: Array<{ fieldA: number; fieldB: number; fieldC: number }>;
};

let cachedReference: CombatReference | null = null;

function loadCombatReference(): CombatReference {
  if (cachedReference) {
    return cachedReference;
  }

  const root = COMBAT_REFERENCE_ROOT;
  const fightInfoPath = path.join(root, 'attrres', 'fightinfo.txt');
  const skillMagicPath = path.join(root, 'attrres', 'skill', 'magic.txt');
  const fightPositionPath = path.join(root, 'attrres', 'fight', 'fightPosition.txt');

  const fightCommands = parseFightCommands(fightInfoPath);
  const skills = parseSkills(skillMagicPath);
  const fightPositions = parseFightPositions(fightPositionPath);

  cachedReference = {
    root,
    available: fightCommands.length > 0 || skills.length > 0 || fightPositions.length > 0,
    fightInfoPath,
    skillMagicPath,
    fightPositionPath,
    fightCommands,
    skills,
    fightPositions,
  };
  return cachedReference;
}

function buildCombatTurnProfiles(): CombatTurnProfile[] {
  const reference = loadCombatReference();
  const skillIds = reference.skills.slice(0, 6).map((skill) => skill.id);
  const actionIds = skillIds.length > 0 ? skillIds : [1001, 1002, 1003, 1004, 1005, 1006];
  const primaryActionId = actionIds[0];

  return [
    {
      profile: 'reference-skill-minimal-lv0',
      rows: [{ fieldA: primaryActionId, fieldB: 0, fieldC: 0 }],
    },
    {
      profile: 'reference-skill-minimal-lv1',
      rows: [{ fieldA: primaryActionId, fieldB: 1, fieldC: 0 }],
    },
    {
      profile: 'reference-skill-minimal-lv0-flag1',
      rows: [{ fieldA: primaryActionId, fieldB: 0, fieldC: 1 }],
    },
  ];
}

function parseFightCommands(filePath: string): FightCommand[] {
  const rows = parseDelimitedFile(filePath);
  return rows
    .filter((row) => row.length > 0 && isIntegerToken(row[0]))
    .map((row) => ({
      id: parseInt(row[0], 10),
      raw: row,
    }));
}

function parseSkills(filePath: string): SkillReference[] {
  const rows = parseDelimitedFile(filePath);
  return rows
    .filter((row) => row.length > 1 && isIntegerToken(row[1]))
    .map((row) => ({
      family: isIntegerToken(row[0]) ? parseInt(row[0], 10) : 0,
      id: parseInt(row[1], 10),
      name: row[2] || '',
      raw: row,
    }));
}

function parseFightPositions(filePath: string): FightPosition[] {
  const rows = parseDelimitedFile(filePath);
  return rows
    .filter((row) => row.length >= 3 && isIntegerToken(row[0]))
    .map((row, index) => ({
      side: parseInt(row[0], 10),
      x: parseInt(row[1], 10),
      y: parseInt(row[2], 10),
      index,
    }));
}

function parseDelimitedFile(filePath: string): string[][] {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter((line: string) => line && !line.startsWith('--'))
      .map(parseCsvLikeLine)
      .filter((row: string[]) => row.length > 0);
  } catch (_err) {
    return [];
  }
}

function parseCsvLikeLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }

  if (current.length > 0 || line.endsWith(',')) {
    cells.push(current.trim());
  }

  return cells.filter((cell, index) => cell !== '' || index < cells.length - 1);
}

function isIntegerToken(value: string): boolean {
  return /^-?\d+$/.test(value);
}

module.exports = {
  buildCombatTurnProfiles,
  loadCombatReference,
};
