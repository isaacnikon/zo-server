#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { CharacterStore } from '../src/character/json-store.js';
import { buildCharacterReplaceSql, resolveCharacterId } from '../src/db/character-store-sql.js';
import { ensureDockerDatabaseReady, executeSqlViaDocker, resolvedProjectRoot } from './db-utils.js';

type CharacterRecord = Record<string, any>;
type AccountDocument = {
  accountId?: string;
  characterId?: string;
  name?: string;
  updatedAt?: string;
};
type SaveLocation = {
  root: string;
  accountsRoot: string;
  charactersRoot: string;
  store: CharacterStore;
};

const applyChanges = process.argv.includes('--apply');
const keepFiles = process.argv.includes('--keep-files');

const saveLocations = buildSaveLocations();
const legacyFiles = [
  path.join(resolvedProjectRoot, 'characters.json'),
  path.join(resolvedProjectRoot, 'runtime', 'characters.json'),
];

function buildSaveLocations(): SaveLocation[] {
  const candidates = [
    {
      root: path.join(resolvedProjectRoot, 'data', 'save'),
      legacyFilePath: path.join(resolvedProjectRoot, 'characters.json'),
    },
    {
      root: path.join(resolvedProjectRoot, 'runtime', 'data', 'save'),
      legacyFilePath: path.join(resolvedProjectRoot, 'runtime', 'characters.json'),
    },
  ];
  const seenRoots = new Set<string>();
  const locations: SaveLocation[] = [];
  for (const candidate of candidates) {
    const normalizedRoot = path.resolve(candidate.root);
    if (seenRoots.has(normalizedRoot)) {
      continue;
    }
    seenRoots.add(normalizedRoot);
    locations.push({
      root: normalizedRoot,
      accountsRoot: path.join(normalizedRoot, 'accounts'),
      charactersRoot: path.join(normalizedRoot, 'characters'),
      store: new CharacterStore(candidate.legacyFilePath),
    });
  }
  return locations;
}

function resolveDisplayName(record: CharacterRecord | null | undefined, fallback = 'Hero'): string {
  if (typeof record?.charName === 'string' && record.charName.length > 0) {
    return record.charName;
  }
  if (typeof record?.name === 'string' && record.name.length > 0) {
    return record.name;
  }
  return fallback;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function loadAccountDocumentMap(): Map<string, AccountDocument> {
  const accountDocs = new Map<string, AccountDocument>();
  for (const location of saveLocations) {
    if (!fs.existsSync(location.accountsRoot)) {
      continue;
    }
    for (const fileName of fs.readdirSync(location.accountsRoot).sort()) {
      if (!fileName.endsWith('.json')) {
        continue;
      }
      const accountDoc = readJsonFile<AccountDocument>(path.join(location.accountsRoot, fileName));
      const accountId = typeof accountDoc?.accountId === 'string'
        ? accountDoc.accountId
        : fileName.replace(/\.json$/i, '');
      if (!accountDocs.has(accountId)) {
        accountDocs.set(accountId, accountDoc || { accountId });
      }
    }
  }
  return accountDocs;
}

function loadSplitCharacterEntries(accountDocs: Map<string, AccountDocument>): Array<{
  accountId: string;
  accountName: string;
  characterId: string;
  selectedCharacterId: string | null;
  updatedAt: string | null;
  character: CharacterRecord;
}> {
  const entries: Array<{
    accountId: string;
    accountName: string;
    characterId: string;
    selectedCharacterId: string | null;
    updatedAt: string | null;
    character: CharacterRecord;
  }> = [];
  const seenKeys = new Set<string>();

  for (const location of saveLocations) {
    if (!fs.existsSync(location.charactersRoot)) {
      continue;
    }
    for (const entry of fs.readdirSync(location.charactersRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) {
        continue;
      }
      const characterId = entry.name;
      const profile = readJsonFile<Record<string, any>>(path.join(location.charactersRoot, characterId, 'profile.json'));
      const accountId = typeof profile?.accountId === 'string' && profile.accountId.length > 0
        ? profile.accountId
        : characterId;
      const dedupeKey = `${accountId}:${characterId}`;
      if (seenKeys.has(dedupeKey)) {
        continue;
      }
      const character = location.store.loadSplitCharacter(accountId, characterId);
      if (!character) {
        continue;
      }
      const accountDoc = accountDocs.get(accountId) || null;
      seenKeys.add(dedupeKey);
      entries.push({
        accountId,
        accountName:
          typeof accountDoc?.name === 'string' && accountDoc.name.length > 0
            ? accountDoc.name
            : resolveDisplayName(character),
        characterId,
        selectedCharacterId:
          typeof accountDoc?.characterId === 'string' && accountDoc.characterId.length > 0
            ? accountDoc.characterId
            : characterId,
        updatedAt: typeof accountDoc?.updatedAt === 'string' ? accountDoc.updatedAt : null,
        character,
      });
    }
  }

  return entries;
}

function loadLegacyOnlyCharacters(
  importedAccountIds: Set<string>
): Array<{
  accountId: string;
  accountName: string;
  characterId: string;
  selectedCharacterId: string | null;
  updatedAt: string | null;
  character: CharacterRecord;
}> {
  const results: Array<{
    accountId: string;
    accountName: string;
    characterId: string;
    selectedCharacterId: string | null;
    updatedAt: string | null;
    character: CharacterRecord;
  }> = [];

  for (const location of saveLocations) {
    const legacyData = location.store.legacyData || {};
    for (const [accountId, character] of Object.entries(legacyData)) {
      if (importedAccountIds.has(accountId)) {
        continue;
      }
      const record = character && typeof character === 'object' ? (character as CharacterRecord) : null;
      if (!record) {
        continue;
      }
      importedAccountIds.add(accountId);
      results.push({
        accountId,
        accountName: resolveDisplayName(record),
        characterId: resolveCharacterId(accountId, record),
        selectedCharacterId: resolveCharacterId(accountId, record),
        updatedAt: typeof record?.updatedAt === 'string' ? record.updatedAt : null,
        character: record,
      });
    }
  }
  return results;
}

function deleteLiveCharacterFiles(): void {
  for (const location of saveLocations) {
    if (fs.existsSync(location.accountsRoot)) {
      for (const fileName of fs.readdirSync(location.accountsRoot)) {
        if (fileName.endsWith('.json')) {
          fs.unlinkSync(path.join(location.accountsRoot, fileName));
        }
      }
    }

    if (fs.existsSync(location.charactersRoot)) {
      for (const entry of fs.readdirSync(location.charactersRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          fs.rmSync(path.join(location.charactersRoot, entry.name), { recursive: true, force: true });
        }
      }
    }
  }

  for (const legacyFile of legacyFiles) {
    if (fs.existsSync(legacyFile)) {
      fs.unlinkSync(legacyFile);
    }
  }
}

async function main(): Promise<void> {
  const accountDocs = loadAccountDocumentMap();
  const splitEntries = loadSplitCharacterEntries(accountDocs);
  const importedAccountIds = new Set(splitEntries.map((entry) => entry.accountId));
  const legacyEntries = loadLegacyOnlyCharacters(importedAccountIds);
  const allEntries = [...splitEntries, ...legacyEntries];

  if (!applyChanges) {
    process.stdout.write(
      `Dry run: ${allEntries.length} character records ready for Postgres import. Re-run with --apply to write and delete JSON saves.\n`
    );
    return;
  }

  if (allEntries.length < 1) {
    process.stdout.write('No character JSON saves found to migrate.\n');
    return;
  }

  await ensureDockerDatabaseReady();
  const statements = ['BEGIN;'];
  for (const entry of allEntries) {
    statements.push(
      buildCharacterReplaceSql(entry.accountId, entry.character, {
        explicitCharacterId: entry.characterId,
        accountName: entry.accountName,
        selectedCharacterId: entry.selectedCharacterId,
        updatedAt: entry.updatedAt,
        wrapTransaction: false,
      })
    );
  }
  statements.push('COMMIT;');
  await executeSqlViaDocker(statements.join('\n'));
  process.stdout.write(`Imported ${allEntries.length} character records into Postgres.\n`);

  if (!keepFiles) {
    deleteLiveCharacterFiles();
    process.stdout.write('Removed live character JSON files after import.\n');
  }
}

await main();
