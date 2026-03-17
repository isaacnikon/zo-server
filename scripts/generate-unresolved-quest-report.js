#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const CANDIDATES_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-runtime-candidates.json');
const ROLEINFO_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'roleinfo.json');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-unresolved-report.json');

function main() {
  const candidates = JSON.parse(fs.readFileSync(CANDIDATES_FILE, 'utf8'));
  const roleinfo = JSON.parse(fs.readFileSync(ROLEINFO_FILE, 'utf8'));
  const rolesById = new Map(
    (Array.isArray(roleinfo?.entries) ? roleinfo.entries : [])
      .filter((role) => Number.isInteger(role?.roleId))
      .map((role) => [role.roleId, role])
  );

  const quests = (Array.isArray(candidates?.quests) ? candidates.quests : [])
    .filter((quest) => quest?.runtimeCandidate?.ready === false)
    .map((quest) => buildQuestEntry(quest, rolesById));

  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({
      source: {
        runtimeCandidates: CANDIDATES_FILE,
        roleinfo: ROLEINFO_FILE,
      },
      generatedAt: new Date().toISOString(),
      summary: buildSummary(quests),
      quests,
    }, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write(`${OUTPUT_FILE}\n`);
}

function buildQuestEntry(quest, rolesById) {
  const steps = (quest.runtimeCandidate?.steps || [])
    .filter((step) => Array.isArray(step?.originalConflicts) && step.originalConflicts.length > 0)
    .map((step) => ({
      stepIndex: step.stepIndex,
      type: step.type,
      npcId: step.npcId,
      monsterId: step.monsterId,
      count: step.count,
      confidence: step.confidence,
      contextRefs: Array.isArray(step.contextRefs) ? step.contextRefs : [],
      conflicts: step.originalConflicts.map((conflict) => describeConflict(conflict, rolesById)),
    }));

  return {
    taskId: quest.taskId,
    title: quest.title || `Quest ${quest.taskId}`,
    unresolvedSteps: Array.isArray(quest.runtimeCandidate?.unresolvedSteps)
      ? quest.runtimeCandidate.unresolvedSteps.slice()
      : [],
    conflictingSteps: steps,
  };
}

function describeConflict(conflict, rolesById) {
  if (!conflict || typeof conflict !== 'object') {
    return { kind: 'unknown' };
  }

  if (conflict.kind === 'monsterId') {
    const schemaRole = rolesById.get(conflict.schema);
    const stateRole = rolesById.get(conflict.state);
    return {
      kind: 'monsterId',
      schema: conflict.schema,
      state: conflict.state,
      schemaName: schemaRole?.name || '',
      stateName: stateRole?.name || '',
      schemaClass: Number.isInteger(schemaRole?.roleClassField) ? schemaRole.roleClassField : null,
      stateClass: Number.isInteger(stateRole?.roleClassField) ? stateRole.roleClassField : null,
    };
  }

  return { ...conflict };
}

function buildSummary(quests) {
  const byConflictKind = {};
  for (const quest of quests) {
    for (const step of quest.conflictingSteps) {
      for (const conflict of step.conflicts) {
        byConflictKind[conflict.kind] = (byConflictKind[conflict.kind] || 0) + 1;
      }
    }
  }

  return {
    unresolvedQuestCount: quests.length,
    conflictCounts: byConflictKind,
  };
}

main();
