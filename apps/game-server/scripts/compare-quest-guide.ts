#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { resolveRepoPath } from '../src/runtime-paths.js';
import type { QuestDef, QuestEffectDef, RequirementDef, StepDef } from '../src/quest2/schema.js';

type GuideQuestHelperEntry = {
  taskId: number;
  title?: string;
  stepIndex: number;
  questLevel?: number;
  startNpcIds?: number[];
  mapIds?: number[];
  targetNpcIds?: number[];
  itemIds?: number[];
  referencedTaskIds?: number[];
};

type GuideQuestEntry = {
  questId: number;
  stepIndex: number;
  headingTitle?: string;
  questLevel: number | null;
  startNpcIds: number[];
  startMapIds: number[];
  endNpcIds: number[];
  endMapIds: number[];
  targetNpcIds: number[];
  itemIds: number[];
  referencedTaskIds: number[];
  sourceFile: string;
};

type Discrepancy = {
  questId: number;
  questName: string;
  stepIndex: number | null;
  field: string;
  expected: string;
  actual: string;
};

type ComparisonResult = {
  questId: number;
  questName: string;
  discrepancies: Discrepancy[];
};

const QUESTS_DIR = resolveRepoPath('data', 'quests-v2', 'quests');
const GUIDES_DIR = resolveRepoPath('guides');
const GUIDE_HELPER_FILE = resolveRepoPath('data', 'client-verified', 'quests', 'client-help-quests.json');

function parseIntegerFlag(flag: string): number | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return null;
  }

  const raw = process.argv[index + 1];
  const value = Number.parseInt(String(raw || ''), 10);
  return Number.isInteger(value) ? value : null;
}

function includesQuestId(questId: number, fromId: number | null, toId: number | null, onlyId: number | null): boolean {
  if (onlyId !== null) {
    return questId === onlyId;
  }
  if (fromId !== null && questId < fromId) {
    return false;
  }
  if (toId !== null && questId > toId) {
    return false;
  }
  return true;
}

function loadQuestDefinitions(): QuestDef[] {
  return fs
    .readdirSync(QUESTS_DIR)
    .filter((fileName) => /^\d+\.json$/i.test(fileName))
    .map((fileName) => {
      const filePath = path.join(QUESTS_DIR, fileName);
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw) as QuestDef;
    })
    .filter((quest) => Number.isInteger(quest?.id) && quest.id > 0)
    .sort((left, right) => left.id - right.id);
}

function loadGuideHelperEntries(): Map<string, GuideQuestHelperEntry> {
  if (!fs.existsSync(GUIDE_HELPER_FILE)) {
    return new Map<string, GuideQuestHelperEntry>();
  }

  const raw = fs.readFileSync(GUIDE_HELPER_FILE, 'utf8');
  const parsed = JSON.parse(raw) as { quests?: GuideQuestHelperEntry[] };
  const entries = Array.isArray(parsed?.quests) ? parsed.quests : [];

  return new Map(entries.map((entry) => [toGuideKey(entry.taskId, entry.stepIndex), entry]));
}

function loadGuideEntries(helperEntries: Map<string, GuideQuestHelperEntry>): Map<number, GuideQuestEntry[]> {
  const markdownEntries = new Map<string, GuideQuestEntry>();
  const fileNames = fs
    .readdirSync(GUIDES_DIR)
    .filter((fileName) => fileName.endsWith('.md'))
    .filter((fileName) => fileName !== 'index.md' && fileName !== 'all-help-pages.md');

  for (const fileName of fileNames) {
    const filePath = path.join(GUIDES_DIR, fileName);
    const content = fs.readFileSync(filePath, 'utf8');
    const entries = parseGuideMarkdownFile(content, fileName);
    for (const entry of entries) {
      const key = toGuideKey(entry.questId, entry.stepIndex);
      const current = markdownEntries.get(key);
      if (!current || shouldReplaceGuideEntry(current, entry)) {
        markdownEntries.set(key, entry);
      }
    }
  }

  for (const helperEntry of helperEntries.values()) {
    const key = toGuideKey(helperEntry.taskId, helperEntry.stepIndex);
    const markdownEntry = markdownEntries.get(key);
    if (markdownEntry) {
      markdownEntries.set(key, mergeGuideEntry(markdownEntry, helperEntry));
      continue;
    }

    markdownEntries.set(key, {
      questId: helperEntry.taskId,
      stepIndex: helperEntry.stepIndex,
      headingTitle: sanitizeHelperTitle(helperEntry.title),
      questLevel: Number.isInteger(helperEntry.questLevel) ? helperEntry.questLevel! : null,
      startNpcIds: uniqueSortedNumbers((helperEntry.startNpcIds || []).slice(0, 1)),
      startMapIds: uniqueSortedNumbers((helperEntry.mapIds || []).slice(0, 1)),
      endNpcIds: [],
      endMapIds: [],
      targetNpcIds: uniqueSortedNumbers(helperEntry.targetNpcIds || []),
      itemIds: uniqueSortedNumbers(helperEntry.itemIds || []),
      referencedTaskIds: uniqueSortedNumbers(helperEntry.referencedTaskIds || []),
      sourceFile: 'client-help-quests.json',
    });
  }

  const byQuestId = new Map<number, GuideQuestEntry[]>();
  for (const entry of markdownEntries.values()) {
    const current = byQuestId.get(entry.questId) || [];
    current.push(entry);
    byQuestId.set(entry.questId, current);
  }

  for (const entries of byQuestId.values()) {
    entries.sort((left, right) => left.stepIndex - right.stepIndex);
  }

  return byQuestId;
}

function parseGuideMarkdownFile(content: string, fileName: string): GuideQuestEntry[] {
  const sections = content.split(/^###\s+/m).slice(1);
  return sections
    .map((section) => parseGuideSection(section, fileName))
    .filter((entry): entry is GuideQuestEntry => Boolean(entry));
}

function parseGuideSection(section: string, fileName: string): GuideQuestEntry | null {
  const [headingLine = '', ...bodyLines] = section.split('\n');
  const body = bodyLines.join('\n');
  const questMatch = body.match(/"\[Quest #(\d+)\]"(?:\((\d+)\))?/);
  if (!questMatch) {
    return null;
  }

  const questId = Number.parseInt(questMatch[1] || '', 10);
  const stepIndex = Number.parseInt(questMatch[2] || '1', 10);
  if (!Number.isInteger(questId) || questId <= 0 || !Number.isInteger(stepIndex) || stepIndex <= 0) {
    return null;
  }

  const startLine = extractLine(body, /^\s*Start NPC.*$/m);
  const endLine = extractLine(body, /^\s*End NPC.*$/m);
  const tipLine = extractLine(body, /^\s*Tip:.*$/m);
  const questLevel = parseLevel(extractLine(body, /^\s*Quest Level.*$/m));

  return {
    questId,
    stepIndex,
    headingTitle: cleanHeadingTitle(headingLine.trim()),
    questLevel,
    startNpcIds: extractIds(startLine, /\[NPC #(\d+)\]/g),
    startMapIds: extractIds(startLine, /\[Map #(\d+)\]/g),
    endNpcIds: extractIds(endLine, /\[NPC #(\d+)\]/g),
    endMapIds: extractIds(endLine, /\[Map #(\d+)\]/g),
    targetNpcIds: extractIds(extractLine(body, /^\s*Quest Goal:.*$/m), /\[NPC #(\d+)\]/g),
    itemIds: extractIds(extractLine(body, /^\s*Quest Goal:.*$/m), /\[Item #(\d+)\]/g),
    referencedTaskIds: extractIds(tipLine, /\[Quest #(\d+)\]/g),
    sourceFile: fileName,
  };
}

function extractLine(content: string, pattern: RegExp): string {
  return content.match(pattern)?.[0]?.trim() || '';
}

function parseLevel(line: string): number | null {
  const match = line.match(/Quest Level\s*:?\s*(\d+)/i);
  const value = Number.parseInt(match?.[1] || '', 10);
  return Number.isInteger(value) ? value : null;
}

function extractIds(content: string, pattern: RegExp): number[] {
  const values: number[] = [];
  for (const match of content.matchAll(pattern)) {
    const value = Number.parseInt(match[1] || '', 10);
    if (Number.isInteger(value) && value > 0) {
      values.push(value);
    }
  }
  return uniqueSortedNumbers(values);
}

function shouldReplaceGuideEntry(current: GuideQuestEntry, candidate: GuideQuestEntry): boolean {
  if (current.sourceFile === 'quest-unassigned.md' && candidate.sourceFile !== 'quest-unassigned.md') {
    return true;
  }
  if (current.headingTitle && !candidate.headingTitle) {
    return false;
  }
  return !current.headingTitle && Boolean(candidate.headingTitle);
}

function mergeGuideEntry(markdownEntry: GuideQuestEntry, helperEntry: GuideQuestHelperEntry): GuideQuestEntry {
  const helperMapIds = uniqueSortedNumbers(helperEntry.mapIds || []);
  const fallbackEndMapIds = helperMapIds.length > 1 ? helperMapIds.slice(-1) : [];

  return {
    ...markdownEntry,
    headingTitle: markdownEntry.headingTitle || sanitizeHelperTitle(helperEntry.title),
    questLevel: markdownEntry.questLevel ?? (Number.isInteger(helperEntry.questLevel) ? helperEntry.questLevel! : null),
    startNpcIds:
      markdownEntry.startNpcIds.length > 0
        ? markdownEntry.startNpcIds
        : uniqueSortedNumbers((helperEntry.startNpcIds || []).slice(0, 1)),
    startMapIds: markdownEntry.startMapIds.length > 0 ? markdownEntry.startMapIds : helperMapIds.slice(0, 1),
    endNpcIds: markdownEntry.endNpcIds,
    endMapIds: markdownEntry.endMapIds.length > 0 ? markdownEntry.endMapIds : fallbackEndMapIds,
    targetNpcIds: mergeNumberLists(markdownEntry.targetNpcIds, helperEntry.targetNpcIds || []),
    itemIds: mergeNumberLists(markdownEntry.itemIds, helperEntry.itemIds || []),
    referencedTaskIds: mergeNumberLists(markdownEntry.referencedTaskIds, helperEntry.referencedTaskIds || []),
  };
}

function sanitizeHelperTitle(title: string | undefined): string | undefined {
  if (!title || /^quest\s+\d+$/i.test(title.trim())) {
    return undefined;
  }
  return title.trim();
}

function cleanHeadingTitle(title: string): string | undefined {
  if (!title) {
    return undefined;
  }
  return title.replace(/\s+$/g, '').trim() || undefined;
}

function toGuideKey(questId: number, stepIndex: number): string {
  return `${questId}:${stepIndex}`;
}

function mergeNumberLists(left: number[], right: number[]): number[] {
  return uniqueSortedNumbers([...left, ...right]);
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].sort((left, right) => left - right);
}

function compareQuest(quest: QuestDef, guideEntries: GuideQuestEntry[] | undefined): ComparisonResult {
  const discrepancies: Discrepancy[] = [];
  const questName = quest.name;

  if (!guideEntries || guideEntries.length < 1) {
    discrepancies.push(createDiscrepancy(quest.id, questName, null, 'guide', 'quest present in JSON', 'missing from guides'));
    return { questId: quest.id, questName, discrepancies };
  }

  const baseTitle = getGuideBaseTitle(guideEntries);
  if (baseTitle) {
    compareScalar(discrepancies, quest.id, questName, null, 'title', normalizeTitle(quest.name), normalizeTitle(baseTitle), quest.name, baseTitle);
  }

  const acceptLevel = getAcceptLevel(quest.accept.requirements);
  compareOptionalNumber(discrepancies, quest.id, questName, null, 'accept.level', acceptLevel, guideEntries[0]?.questLevel ?? null);
  compareNumberLists(
    discrepancies,
    quest.id,
    questName,
    null,
    'accept.startNpcIds',
    getRequirementIds(quest.accept.requirements, 'npc_is'),
    guideEntries[0]?.startNpcIds || []
  );
  compareNumberLists(
    discrepancies,
    quest.id,
    questName,
    null,
    'accept.startMapIds',
    getRequirementIds(quest.accept.requirements, 'map_is'),
    guideEntries[0]?.startMapIds || []
  );
  compareNumberLists(
    discrepancies,
    quest.id,
    questName,
    null,
    'accept.prerequisiteQuestIds',
    getPrerequisiteQuestIds(quest.accept.requirements),
    guideEntries[0]?.referencedTaskIds || []
  );

  compareOptionalNumber(
    discrepancies,
    quest.id,
    questName,
    null,
    'steps.count',
    quest.steps.length,
    guideEntries.length
  );

  const guideEntriesByStep = new Map(guideEntries.map((entry) => [entry.stepIndex, entry]));
  for (const [index, step] of quest.steps.entries()) {
    const stepIndex = index + 1;
    const guideEntry = guideEntriesByStep.get(stepIndex);
    if (!guideEntry) {
      discrepancies.push(
        createDiscrepancy(quest.id, questName, stepIndex, 'step', `step ${stepIndex} present in JSON`, 'missing from guides')
      );
      continue;
    }

    compareStep(discrepancies, quest, step, stepIndex, guideEntry);
  }

  const expectedStepIndexes = new Set(quest.steps.map((_, index) => index + 1));
  for (const guideEntry of guideEntries) {
    if (!expectedStepIndexes.has(guideEntry.stepIndex)) {
      discrepancies.push(
        createDiscrepancy(
          quest.id,
          questName,
          guideEntry.stepIndex,
          'guide.stepIndex',
          `steps 1-${quest.steps.length}`,
          `unexpected step ${guideEntry.stepIndex}`
        )
      );
    }
  }

  return { questId: quest.id, questName, discrepancies };
}

function compareStep(
  discrepancies: Discrepancy[],
  quest: QuestDef,
  step: StepDef,
  stepIndex: number,
  guideEntry: GuideQuestEntry
): void {
  compareNumberLists(
    discrepancies,
    quest.id,
    quest.name,
    stepIndex,
    'step.targetIds',
    getStepTargetIds(step),
    guideEntry.targetNpcIds.length > 0 ? guideEntry.targetNpcIds : guideEntry.endNpcIds
  );
  compareNumberLists(
    discrepancies,
    quest.id,
    quest.name,
    stepIndex,
    'step.targetMapIds',
    getStepTargetMapIds(step),
    guideEntry.endMapIds
  );

  const expectedItemIds = stepIndex === 1
    ? mergeNumberLists(getAcceptItemIds(quest), getStepItemIds(step))
    : getStepItemIds(step);
  if (guideEntry.itemIds.length > 0) {
    compareNumberLists(discrepancies, quest.id, quest.name, stepIndex, 'step.itemIds', expectedItemIds, guideEntry.itemIds);
  }
}

function getGuideBaseTitle(entries: GuideQuestEntry[]): string | null {
  for (const entry of entries) {
    if (!entry.headingTitle) {
      continue;
    }
    const candidate = stripGuideStepSuffix(entry.headingTitle.split(',')[0] || entry.headingTitle);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function stripGuideStepSuffix(title: string): string {
  return title.trim().replace(/\((?:\d+|[ivxlcdm]+)\)$/i, '').trim();
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function getAcceptLevel(requirements: RequirementDef[]): number | null {
  const requirement = requirements.find((entry) => entry.kind === 'level_at_least');
  return requirement?.kind === 'level_at_least' ? requirement.level : null;
}

function getPrerequisiteQuestIds(requirements: RequirementDef[]): number[] {
  return uniqueSortedNumbers(
    requirements
      .filter((entry) => entry.kind === 'quest_completed' || entry.kind === 'quest_active')
      .map((entry) => entry.questId)
  );
}

function getRequirementIds(requirements: RequirementDef[], kind: 'npc_is' | 'map_is'): number[] {
  if (kind === 'npc_is') {
    return uniqueSortedNumbers(requirements.filter((entry) => entry.kind === 'npc_is').map((entry) => entry.npcId));
  }
  return uniqueSortedNumbers(requirements.filter((entry) => entry.kind === 'map_is').map((entry) => entry.mapId));
}

function getAcceptItemIds(quest: QuestDef): number[] {
  return uniqueSortedNumbers(quest.accept.effects.flatMap((effect) => getEffectItemIds(effect)));
}

function getStepItemIds(step: StepDef): number[] {
  return uniqueSortedNumbers([
    ...step.requirements.flatMap((requirement) => getRequirementItemIds(requirement)),
    ...(step.eventEffects || []).flatMap((effect) => getEffectItemIds(effect)),
    ...step.effects.flatMap((effect) => getEffectItemIds(effect)),
  ]);
}

function getRequirementItemIds(requirement: RequirementDef): number[] {
  switch (requirement.kind) {
    case 'item_is':
    case 'item_count_at_least':
      return [requirement.templateId];
    default:
      return [];
  }
}

function getEffectItemIds(effect: QuestEffectDef): number[] {
  switch (effect.kind) {
    case 'grant_item':
    case 'remove_item':
      return [effect.item.templateId];
    case 'remove_captured_monster_item': {
      const templateId = effect.templateId;
      return typeof templateId === 'number' && Number.isInteger(templateId) && templateId > 0 ? [templateId] : [];
    }
    default:
      return [];
  }
}

function getStepTargetIds(step: StepDef): number[] {
  return uniqueSortedNumbers(
    step.requirements.flatMap((requirement) => {
      switch (requirement.kind) {
        case 'npc_is':
        case 'turn_in_npc_is':
          return [requirement.npcId];
        case 'monster_is':
        case 'captured_monster_count_at_least':
          return [requirement.monsterId];
        default:
          return [];
      }
    })
  );
}

function getStepTargetMapIds(step: StepDef): number[] {
  return uniqueSortedNumbers(
    step.requirements.flatMap((requirement) => {
      switch (requirement.kind) {
        case 'map_is':
        case 'turn_in_map_is':
          return [requirement.mapId];
        default:
          return [];
      }
    })
  );
}

function compareScalar(
  discrepancies: Discrepancy[],
  questId: number,
  questName: string,
  stepIndex: number | null,
  field: string,
  normalizedExpected: string,
  normalizedActual: string,
  expected: string,
  actual: string
): void {
  if (normalizedExpected === normalizedActual) {
    return;
  }
  discrepancies.push(createDiscrepancy(questId, questName, stepIndex, field, expected, actual));
}

function compareOptionalNumber(
  discrepancies: Discrepancy[],
  questId: number,
  questName: string,
  stepIndex: number | null,
  field: string,
  expected: number | null,
  actual: number | null
): void {
  if (expected === null && actual === null) {
    return;
  }
  if (expected === actual) {
    return;
  }
  discrepancies.push(
    createDiscrepancy(questId, questName, stepIndex, field, formatOptionalNumber(expected), formatOptionalNumber(actual))
  );
}

function compareNumberLists(
  discrepancies: Discrepancy[],
  questId: number,
  questName: string,
  stepIndex: number | null,
  field: string,
  expected: number[],
  actual: number[]
): void {
  const normalizedExpected = uniqueSortedNumbers(expected);
  const normalizedActual = uniqueSortedNumbers(actual);
  if (normalizedExpected.join(',') === normalizedActual.join(',')) {
    return;
  }
  discrepancies.push(
    createDiscrepancy(
      questId,
      questName,
      stepIndex,
      field,
      formatNumberList(normalizedExpected),
      formatNumberList(normalizedActual)
    )
  );
}

function createDiscrepancy(
  questId: number,
  questName: string,
  stepIndex: number | null,
  field: string,
  expected: string,
  actual: string
): Discrepancy {
  return { questId, questName, stepIndex, field, expected, actual };
}

function formatOptionalNumber(value: number | null): string {
  return value === null ? 'none' : String(value);
}

function formatNumberList(values: number[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

function formatComparison(result: ComparisonResult): string {
  const lines = [`[mismatch] ${result.questId} ${result.questName}`];
  for (const discrepancy of result.discrepancies) {
    const prefix = discrepancy.stepIndex === null ? '  quest' : `  step ${discrepancy.stepIndex}`;
    lines.push(`${prefix} ${discrepancy.field}: json=${discrepancy.expected} guide=${discrepancy.actual}`);
  }
  return lines.join('\n');
}

function main(): void {
  const fromId = parseIntegerFlag('--from');
  const toId = parseIntegerFlag('--to');
  const onlyId = parseIntegerFlag('--id');
  const showMatches = process.argv.includes('--all');

  const quests = loadQuestDefinitions().filter((quest) => includesQuestId(quest.id, fromId, toId, onlyId));
  const guideHelperEntries = loadGuideHelperEntries();
  const guideEntriesByQuestId = loadGuideEntries(guideHelperEntries);

  if (quests.length < 1) {
    process.stdout.write('No quests matched the requested range.\n');
    return;
  }

  const results = quests.map((quest) => compareQuest(quest, guideEntriesByQuestId.get(quest.id)));
  const mismatches = results.filter((result) => result.discrepancies.length > 0);
  const matched = results.length - mismatches.length;

  const filteredGuideQuestIds = [...guideEntriesByQuestId.keys()].filter((questId) =>
    includesQuestId(questId, fromId, toId, onlyId)
  );
  const jsonQuestIds = new Set(quests.map((quest) => quest.id));
  const guideOnlyQuestIds = filteredGuideQuestIds.filter((questId) => !jsonQuestIds.has(questId)).sort((left, right) => left - right);

  const output: string[] = [];
  if (showMatches) {
    for (const result of results.filter((entry) => entry.discrepancies.length < 1)) {
      output.push(`[ok] ${result.questId} ${result.questName}`);
    }
  }
  output.push(...mismatches.map(formatComparison));

  if (guideOnlyQuestIds.length > 0) {
    output.push(`[guide-only] ${guideOnlyQuestIds.join(', ')}`);
  }

  output.push(
    `Summary: matched=${matched} mismatched=${mismatches.length} guideOnly=${guideOnlyQuestIds.length} checked=${results.length}`
  );

  process.stdout.write(`${output.join('\n')}\n`);
  if (mismatches.length > 0 || guideOnlyQuestIds.length > 0) {
    process.exitCode = 1;
  }
}

main();
