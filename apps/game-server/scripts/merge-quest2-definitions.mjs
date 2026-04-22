#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const QUEST2_DIRECTORY = path.join(REPO_ROOT, 'data', 'quests-v2', 'quests');
const QUEST2_DEFINITIONS_FILE = path.join(REPO_ROOT, 'data', 'quests-v2', 'definitions.json');
const QUEST2_MANIFEST_FILE = path.join(REPO_ROOT, 'data', 'quests-v2', 'manifest.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function isQuestFileName(fileName) {
  return /^\d+\.json$/u.test(fileName);
}

function readQuestFile(filePath) {
  const parsed = readJson(filePath);
  if (!Number.isInteger(parsed?.id) || parsed.id <= 0) {
    throw new Error(`Missing or invalid quest id in ${path.basename(filePath)}`);
  }

  const expectedId = Number.parseInt(path.basename(filePath, '.json'), 10);
  if (parsed.id !== expectedId) {
    throw new Error(`Quest id mismatch in ${path.basename(filePath)}: expected ${expectedId}, found ${parsed.id}`);
  }

  return parsed;
}

function loadQuestFiles(directory) {
  if (!fs.existsSync(directory)) {
    throw new Error(`Quest directory not found: ${path.relative(REPO_ROOT, directory)}`);
  }

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isQuestFileName(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => Number.parseInt(path.basename(left, '.json'), 10) - Number.parseInt(path.basename(right, '.json'), 10));
}

function main() {
  const questFiles = loadQuestFiles(QUEST2_DIRECTORY);
  const quests = [];
  const questIds = new Set();

  for (const questFile of questFiles) {
    const quest = readQuestFile(questFile);
    if (questIds.has(quest.id)) {
      throw new Error(`Duplicate quest id ${quest.id} in ${path.relative(REPO_ROOT, questFile)}`);
    }
    questIds.add(quest.id);
    quests.push(quest);
  }

  quests.sort((left, right) => left.id - right.id);

  writeJson(QUEST2_DEFINITIONS_FILE, { quests });
  writeJson(QUEST2_MANIFEST_FILE, {
    generatedAt: new Date().toISOString(),
    source: path.relative(REPO_ROOT, QUEST2_DIRECTORY),
    questCount: quests.length,
    questIds: quests.map((quest) => quest.id),
  });

  process.stdout.write(`Merged ${quests.length} quest files into ${path.relative(REPO_ROOT, QUEST2_DEFINITIONS_FILE)}\n`);
}

main();
