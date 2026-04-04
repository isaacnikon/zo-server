#!/usr/bin/env node
import fs from 'node:fs';

import { resolveRepoPath } from '../src/runtime-paths.js';

type UnknownRecord = Record<string, any>;

type ValidationStatus = 'ready' | 'needs_work' | 'blocked';

type ValidationResult = {
  id: number;
  name: string;
  status: ValidationStatus;
  blockers: string[];
  notes: string[];
};

const QUEST_FILE = resolveRepoPath('data', 'quests', 'main-story.json');

function loadStoryQuests(): UnknownRecord[] {
  const raw = fs.readFileSync(QUEST_FILE, 'utf8');
  const parsed = JSON.parse(raw) as UnknownRecord;
  return Array.isArray(parsed?.quests) ? parsed.quests : [];
}

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

function analyzeQuest(quest: UnknownRecord): ValidationResult | null {
  if (!Number.isInteger(quest?.id) || quest.id <= 0) {
    return null;
  }

  const blockers: string[] = [];
  const notes: string[] = [];
  const steps = Array.isArray(quest?.steps) ? quest.steps : [];
  const auxiliaryActions = Array.isArray(quest?.auxiliaryActions) ? quest.auxiliaryActions : [];
  const acceptGrantItems = Array.isArray(quest?.acceptGrantItems) ? quest.acceptGrantItems : [];
  const rewardChoiceGroups = Array.isArray(quest?.rewards?.choiceGroups) ? quest.rewards.choiceGroups : [];
  const rewardItems = Array.isArray(quest?.rewards?.items) ? quest.rewards.items : [];

  if (acceptGrantItems.length > 0) {
    notes.push(`accept grant items: ${acceptGrantItems.length}`);
  }
  if (rewardChoiceGroups.length > 0) {
    notes.push(`reward choices: ${rewardChoiceGroups.length}`);
  }
  if (rewardItems.length > 0) {
    notes.push(`fixed reward items: ${rewardItems.length}`);
  }
  if (auxiliaryActions.length > 0) {
    blockers.push(`auxiliary actions: ${auxiliaryActions.map((action: UnknownRecord) => String(action?.type || 'unknown')).join(', ')}`);
  }

  for (const [index, step] of steps.entries()) {
    const stepNo = index + 1;
    const stepType = typeof step?.type === 'string' ? step.type : 'unknown';
    const originalType = typeof step?.originalType === 'string' ? step.originalType : '';
    const consumeItems = Array.isArray(step?.consumeItems) ? step.consumeItems : [];
    const grantItems = Array.isArray(step?.grantItems) ? step.grantItems : [];
    const requiredProgressFlag =
      typeof step?.requiredProgressFlag === 'string' && step.requiredProgressFlag.length > 0
        ? step.requiredProgressFlag
        : '';

    if (originalType === 'kill_collect') {
      blockers.push(`step ${stepNo}: kill_collect requires per-kill quest item grants`);
    } else if (originalType === 'capture') {
      blockers.push(`step ${stepNo}: capture requires captured-monster flask semantics`);
    } else if (stepType === 'escort') {
      blockers.push(`step ${stepNo}: escort not validated yet`);
    } else if (stepType !== 'talk' && stepType !== 'kill') {
      blockers.push(`step ${stepNo}: unsupported legacy type ${stepType}`);
    }

    if (grantItems.length > 0) {
      notes.push(`step ${stepNo}: grants ${grantItems.length} item(s)`);
    }
    if (consumeItems.length > 0) {
      notes.push(`step ${stepNo}: consumes ${consumeItems.length} item(s)`);
    }
    if (step?.completeOnTalkAfterKill === true) {
      notes.push(`step ${stepNo}: kill then talk hand-in`);
    }
    if (requiredProgressFlag) {
      blockers.push(`step ${stepNo}: depends on progress flag "${requiredProgressFlag}"`);
    }
  }

  let status: ValidationStatus = 'ready';
  if (blockers.length > 0) {
    status = 'blocked';
  } else if (notes.length > 0) {
    status = 'needs_work';
  }

  return {
    id: quest.id >>> 0,
    name: typeof quest?.name === 'string' && quest.name.length > 0 ? quest.name : `Quest ${quest.id}`,
    status,
    blockers,
    notes,
  };
}

function formatResult(result: ValidationResult): string {
  const lines = [`[${result.status}] ${result.id} ${result.name}`];
  for (const blocker of result.blockers) {
    lines.push(`  blocker: ${blocker}`);
  }
  for (const note of result.notes) {
    lines.push(`  note: ${note}`);
  }
  return lines.join('\n');
}

function main(): void {
  const fromId = parseIntegerFlag('--from');
  const toId = parseIntegerFlag('--to');
  const onlyId = parseIntegerFlag('--id');

  const results = loadStoryQuests()
    .filter((quest) => Number.isInteger(quest?.id))
    .filter((quest) => includesQuestId(quest.id >>> 0, fromId, toId, onlyId))
    .map((quest) => analyzeQuest(quest))
    .filter((result): result is ValidationResult => Boolean(result))
    .sort((left, right) => left.id - right.id);

  if (results.length < 1) {
    process.stdout.write('No quests matched the requested range.\n');
    return;
  }

  const summary = {
    ready: results.filter((result) => result.status === 'ready').length,
    needs_work: results.filter((result) => result.status === 'needs_work').length,
    blocked: results.filter((result) => result.status === 'blocked').length,
  };

  process.stdout.write(
    `${results.map(formatResult).join('\n')}\n\nSummary: ready=${summary.ready} needs_work=${summary.needs_work} blocked=${summary.blocked}\n`
  );
}

main();
