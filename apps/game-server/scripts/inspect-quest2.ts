#!/usr/bin/env node
import fs from 'node:fs';

import { resolveRepoPath } from '../src/runtime-paths.js';

type UnknownRecord = Record<string, any>;

type QuestGuideEntry = {
  taskId: number;
  startNpcId: number;
  title: string;
  minLevel: number;
  prerequisiteTaskId: number;
};

type TaskStateMatch = {
  taskId: number;
  title?: string;
  stepMatches?: Array<UnknownRecord>;
};

const QUEST_DEFINITIONS_FILE = resolveRepoPath('data', 'quests-v2', 'definitions.json');
const QUEST_GUIDE_FILE = resolveRepoPath('data', 'client-derived', 'quests.json');
const QUEST_MATCHES_FILE = resolveRepoPath('data', 'client-derived', 'task-state-matches.json');

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function parseQuestId(): number | null {
  const flagIndex = process.argv.indexOf('--id');
  const raw = flagIndex >= 0 ? process.argv[flagIndex + 1] : process.argv[2];
  const questId = Number.parseInt(String(raw || ''), 10);
  return Number.isInteger(questId) && questId > 0 ? questId : null;
}

function formatRequirement(requirement: UnknownRecord): string {
  switch (requirement?.kind) {
    case 'level_at_least':
      return `level>=${requirement.level}`;
    case 'quest_completed':
      return `completed=${requirement.questId}`;
    case 'npc_is':
      return `npc=${requirement.npcId}`;
    case 'map_is':
      return `map=${requirement.mapId}`;
    case 'subtype_is':
      return `subtype=${requirement.subtype}`;
    case 'turn_in_npc_is':
      return `turnInNpc=${requirement.npcId}`;
    case 'turn_in_map_is':
      return `turnInMap=${requirement.mapId}`;
    case 'monster_is':
      return `monster=${requirement.monsterId}`;
    case 'item_count_at_least':
      return `item>=${requirement.templateId}x${requirement.quantity}`;
    default:
      return String(requirement?.kind || 'unknown');
  }
}

function summarizeRequirements(requirements: UnknownRecord[]): string {
  return requirements.map(formatRequirement).join(', ');
}

function getQuestDefinition(questId: number): UnknownRecord | null {
  const document = loadJson<UnknownRecord>(QUEST_DEFINITIONS_FILE);
  return Array.isArray(document?.quests)
    ? document.quests.find((quest: UnknownRecord) => (quest?.id >>> 0) === (questId >>> 0)) || null
    : null;
}

function getQuestGuideEntry(questId: number): QuestGuideEntry | null {
  const document = loadJson<UnknownRecord>(QUEST_GUIDE_FILE);
  const entries = Array.isArray(document?.entries)
    ? document.entries
    : Array.isArray(document?.quests)
      ? document.quests
      : [];
  return entries.find((quest: QuestGuideEntry) => (quest?.taskId >>> 0) === (questId >>> 0)) || null;
}

function getQuestMatchEntry(questId: number): TaskStateMatch | null {
  const document = loadJson<UnknownRecord>(QUEST_MATCHES_FILE);
  const entries = Array.isArray(document?.matches)
    ? document.matches
    : Array.isArray(document?.quests)
      ? document.quests
      : [];
  const entry = entries.find((quest: TaskStateMatch) => (quest?.taskId >>> 0) === (questId >>> 0)) || null;
  return entry || null;
}

function getAcceptSummary(quest: UnknownRecord): string {
  const requirements = Array.isArray(quest?.accept?.requirements) ? quest.accept.requirements : [];
  return summarizeRequirements(requirements);
}

function getStepSummary(step: UnknownRecord, index: number): string {
  const client = step?.client || {};
  const parts = [
    `#${index + 1}`,
    String(step?.id || `step_${index + 1}`),
    String(step?.kind || 'unknown'),
    `npc=${client.overNpcId || client.markerNpcId || 0}`,
    `taskType=${client.taskType ?? 0}`,
    `taskStep=${client.taskStep ?? 0}`,
    `status=${client.status ?? 0}`,
  ];
  if (client.taskRoleNpcId) {
    parts.push(`roleNpc=${client.taskRoleNpcId}`);
  }
  return parts.join(' ');
}

function getCandidateSummary(candidate: UnknownRecord): string {
  const reasons = Array.isArray(candidate?.reasons) ? candidate.reasons.join('|') : '';
  return [
    `cluster=${candidate?.clusterIndex ?? 0}`,
    `score=${candidate?.score ?? 0}`,
    `step=${candidate?.taskStep ?? 0}`,
    `type=${candidate?.taskType ?? 0}`,
    `npc=${candidate?.overNpcId ?? 0}`,
    `reasons=${reasons}`,
  ].join(' ');
}

function main(): void {
  const questId = parseQuestId();
  if (!questId) {
    process.stderr.write('Usage: npm run inspect:quest2 -w @zo/game-server -- --id <questId>\n');
    process.exitCode = 1;
    return;
  }

  const quest = getQuestDefinition(questId);
  const guide = getQuestGuideEntry(questId);
  const matches = getQuestMatchEntry(questId);

  if (!quest) {
    process.stdout.write(`Quest ${questId} not found in definitions.\n`);
    return;
  }

  const acceptRequirements = Array.isArray(quest?.accept?.requirements) ? quest.accept.requirements : [];
  const questSteps = Array.isArray(quest?.steps) ? quest.steps : [];
  const guideDocument = loadJson<UnknownRecord>(QUEST_GUIDE_FILE);
  const guideEntries = Array.isArray(guideDocument?.entries)
    ? guideDocument.entries
    : Array.isArray(guideDocument?.quests)
      ? guideDocument.quests
      : [];
  const guideMatches = guideEntries.filter(
    (entry: QuestGuideEntry) => (entry?.prerequisiteTaskId >>> 0) === (questId >>> 0)
  );

  const acceptNpcIds = acceptRequirements
    .filter((requirement: UnknownRecord) => requirement?.kind === 'npc_is')
    .map((requirement: UnknownRecord) => requirement.npcId);
  const acceptMapIds = acceptRequirements
    .filter((requirement: UnknownRecord) => requirement?.kind === 'map_is')
    .map((requirement: UnknownRecord) => requirement.mapId);
  const acceptLevel =
    acceptRequirements.find((requirement: UnknownRecord) => requirement?.kind === 'level_at_least')?.level ?? 0;

  process.stdout.write(`Quest ${questId}: ${quest.name}\n`);
  process.stdout.write(`Accept: ${getAcceptSummary(quest)}\n`);
  process.stdout.write(`Guide: ${guide ? `startNpc=${guide.startNpcId} minLevel=${guide.minLevel} prereq=${guide.prerequisiteTaskId}` : 'missing'}\n`);
  process.stdout.write(
    `Check: npc=${acceptNpcIds.join(',') || 'none'} map=${acceptMapIds.join(',') || 'none'} level=${acceptLevel} next=${guideMatches.map((entry: QuestGuideEntry) => `${entry.taskId}:${entry.title}`).join(', ') || 'none'}\n`
  );
  process.stdout.write(`Steps (${questSteps.length}):\n`);
  for (const [index, step] of questSteps.entries()) {
    process.stdout.write(`  ${getStepSummary(step, index)}\n`);
  }

  if (matches?.stepMatches?.length) {
    process.stdout.write('Client step matches:\n');
    for (const stepMatch of matches.stepMatches) {
      process.stdout.write(
        `  stepIndex=${stepMatch.stepIndex} type=${stepMatch.type} npc=${stepMatch.npcId ?? 0} consume=${Array.isArray(stepMatch.consumeItems) ? stepMatch.consumeItems.length : 0}\n`
      );
      const candidates = Array.isArray(stepMatch.topCandidates) ? stepMatch.topCandidates.slice(0, 3) : [];
      for (const candidate of candidates) {
        process.stdout.write(`    ${getCandidateSummary(candidate)}\n`);
      }
    }
  }
}

main();
