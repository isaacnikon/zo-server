#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const QUEST2_DEFINITIONS_FILE = path.join(REPO_ROOT, 'data', 'quests-v2', 'definitions.json');
const QUEST2_DIRECTORY = path.join(REPO_ROOT, 'data', 'quests-v2', 'quests');
const QUEST2_MANIFEST_FILE = path.join(REPO_ROOT, 'data', 'quests-v2', 'manifest.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function isQuestRecord(value) {
  return Number.isInteger(value?.id) && value.id > 0;
}

function removeStaleQuestFiles(directory) {
  if (!fs.existsSync(directory)) {
    return;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    fs.unlinkSync(path.join(directory, entry.name));
  }
}

function main() {
  const parsed = readJson(QUEST2_DEFINITIONS_FILE);
  const quests = Array.isArray(parsed?.quests) ? parsed.quests.filter(isQuestRecord) : [];
  const sortedQuests = [...quests].sort((left, right) => left.id - right.id);
  const questIds = new Set();

  fs.mkdirSync(QUEST2_DIRECTORY, { recursive: true });
  removeStaleQuestFiles(QUEST2_DIRECTORY);

  for (const quest of sortedQuests) {
    if (questIds.has(quest.id)) {
      throw new Error(`Duplicate quest id ${quest.id}`);
    }

    questIds.add(quest.id);
    writeJson(path.join(QUEST2_DIRECTORY, `${quest.id}.json`), quest);
  }

  writeJson(QUEST2_MANIFEST_FILE, {
    generatedAt: new Date().toISOString(),
    source: path.relative(REPO_ROOT, QUEST2_DEFINITIONS_FILE),
    questCount: sortedQuests.length,
    questIds: sortedQuests.map((quest) => quest.id),
  });

  process.stdout.write(`Split ${sortedQuests.length} quest definitions into ${path.relative(REPO_ROOT, QUEST2_DIRECTORY)}\n`);
}

main();
