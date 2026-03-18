#!/usr/bin/env node
// @ts-nocheck
'use strict';
export {};

const fs = require('fs');
const path = require('path');

const CANDIDATES_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quest-runtime-candidates.json');
const TASKLIST_FILE = path.resolve(__dirname, '..', 'data', 'client-derived', 'quests.json');
const OVERRIDES_FILE = path.resolve(__dirname, '..', 'data', 'quests', 'main-story.overrides.json');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'quests', 'main-story.json');

function main() {
  const candidates = JSON.parse(fs.readFileSync(CANDIDATES_FILE, 'utf8'));
  const tasklist = JSON.parse(fs.readFileSync(TASKLIST_FILE, 'utf8'));
  const overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));

  const candidateByTaskId = new Map(
    (Array.isArray(candidates?.quests) ? candidates.quests : [])
      .filter((quest) => Number.isInteger(quest?.taskId))
      .map((quest) => [quest.taskId, quest])
  );
  const taskById = new Map(
    (Array.isArray(tasklist?.entries) ? tasklist.entries : [])
      .filter((task) => Number.isInteger(task?.taskId))
      .map((task) => [task.taskId, task])
  );
  const overrideById = new Map(
    (Array.isArray(overrides?.quests) ? overrides.quests : [])
      .filter((quest) => Number.isInteger(quest?.id))
      .map((quest) => [quest.id, quest])
  );

  const taskIds = [...new Set([
    ...candidateByTaskId.keys(),
    ...overrideById.keys(),
  ])].sort((left, right) => left - right);

  const quests = taskIds
    .map((taskId) => buildQuest(
      taskId,
      candidateByTaskId.get(taskId) || null,
      overrideById.get(taskId) || null,
      taskById.get(taskId) || null
    ))
    .filter(Boolean);

  for (const quest of quests) {
    if ((quest?.id >>> 0) === 51 && quest.steps?.[0]?.npcId === 3004) {
      delete quest.steps[0].consumeItems;
      delete quest.steps[0].grantItems;
      quest.steps[0].description = 'Bring "Candy\'s Recommendation" to "Scholar"';
    }
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({
      source: {
        runtimeCandidates: CANDIDATES_FILE,
        tasklist: TASKLIST_FILE,
        overrides: OVERRIDES_FILE,
      },
      generatedAt: new Date().toISOString(),
      quests,
    }, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write(`${OUTPUT_FILE}\n`);
}

function buildQuest(taskId, candidateQuest, overrideQuest, taskMeta) {
  if (!candidateQuest && !overrideQuest) {
    return null;
  }

  const candidateSteps = Array.isArray(candidateQuest?.runtimeCandidate?.steps)
    ? candidateQuest.runtimeCandidate.steps
    : [];
  const overrideSteps = Array.isArray(overrideQuest?.steps) ? overrideQuest.steps : [];
  const stepCount = Math.max(candidateSteps.length, overrideSteps.length);
  const acceptGrantItems = normalizeItems(overrideQuest?.acceptGrantItems || candidateQuest?.acceptGrantItems);

  const quest = {
    id: taskId,
    name:
      stringOrDefault(overrideQuest?.name) ||
      stringOrDefault(candidateQuest?.title) ||
      cleanQuestTitle(taskMeta?.title) ||
      `Quest ${taskId}`,
    type: stringOrDefault(overrideQuest?.type) || 'story',
    acceptMessage:
      stringOrDefault(overrideQuest?.acceptMessage) ||
      `${stringOrDefault(candidateQuest?.title) || `Quest ${taskId}`} is active.`,
    completionMessage:
      stringOrDefault(overrideQuest?.completionMessage) ||
      `${stringOrDefault(candidateQuest?.title) || `Quest ${taskId}`} is complete.`,
    acceptNpcId:
      firstNumber(overrideQuest?.acceptNpcId, candidateQuest?.startNpcId, taskMeta?.startNpcId),
    acceptSubtype:
      Number.isInteger(overrideQuest?.acceptSubtype)
        ? overrideQuest.acceptSubtype
        : 3,
    prerequisiteTaskIds: normalizePrerequisiteTaskIds(
      overrideQuest?.prerequisiteTaskIds,
      candidateQuest?.prerequisiteTaskId,
      taskMeta?.prerequisiteTaskId
    ),
    acceptGrantItems,
    rewards: mergeReward(overrideQuest?.rewards, candidateQuest),
    auxiliaryActions: normalizeAuxiliaryActions(
      Array.isArray(overrideQuest?.auxiliaryActions)
        ? overrideQuest.auxiliaryActions
        : deriveAuxiliaryActions(taskId)
    ),
    steps: buildQuestSteps(taskId, candidateSteps, overrideSteps, {
      acceptGrantItems,
    }),
  };

  if ((taskId >>> 0) === 51 && quest.steps[0]?.npcId === 3004) {
    delete quest.steps[0].consumeItems;
    delete quest.steps[0].grantItems;
    quest.steps[0].description = 'Bring "Candy\'s Recommendation" to "Scholar"';
  }

  if (Number.isInteger(taskMeta?.nextTaskId) && taskMeta.nextTaskId > 0) {
    quest.nextQuestId = taskMeta.nextTaskId;
  } else if (Number.isInteger(overrideQuest?.nextQuestId)) {
    quest.nextQuestId = overrideQuest.nextQuestId;
  }

  if (Number.isInteger(candidateQuest?.minLevel) && candidateQuest.minLevel > 0) {
    quest.minLevel = candidateQuest.minLevel;
  } else if (Number.isInteger(taskMeta?.minLevel) && taskMeta.minLevel > 0) {
    quest.minLevel = taskMeta.minLevel;
  }

  return quest.steps.length > 0 ? quest : null;
}

function mergeReward(overrideReward, candidateQuest) {
  const candidateReward = candidateQuest?.rewards;
  const overrideItems = normalizeItems(overrideReward?.items);
  const choiceGroups = normalizeRewardChoiceGroups(candidateQuest?.runtimeRewardChoices || candidateReward?.choiceGroups);
  return {
    gold: numberOrDefault(overrideReward?.gold, numberOrDefault(candidateReward?.gold, 0)),
    experience: numberOrDefault(overrideReward?.experience, numberOrDefault(candidateReward?.experience, 0)),
    coins: numberOrDefault(overrideReward?.coins, numberOrDefault(candidateReward?.coins, 0)),
    renown: numberOrDefault(overrideReward?.renown, numberOrDefault(candidateReward?.renown, 0)),
    pets: Array.isArray(candidateReward?.pets) ? candidateReward.pets.slice() : [],
    items: overrideItems.length > 0 ? overrideItems : (choiceGroups.length > 0 ? [] : normalizeRewardItems(candidateReward?.items)),
    choiceGroups,
  };
}

function mergeStep(candidateStep, overrideStep, index, questContext = {}) {
  if (!candidateStep && !overrideStep) {
    return null;
  }

  const candidateType = stringOrDefault(candidateStep?.type);
  const overrideType = stringOrDefault(overrideStep?.type);
  const runtimeType = normalizeRuntimeStepType(overrideType || candidateType);
  const runtimeShapeChanged =
    overrideType.length > 0 &&
    candidateType.length > 0 &&
    normalizeRuntimeStepType(overrideType) !== normalizeRuntimeStepType(candidateType);
  const step = {
    type: runtimeType,
    npcId: inferNpcId(candidateStep, overrideStep),
    status:
      Number.isInteger(overrideStep?.status)
        ? overrideStep.status
        : Number.isInteger(candidateStep?.status)
          ? candidateStep.status
          : index + 1,
    description:
      stringOrDefault(overrideStep?.description) ||
      stringOrDefault(candidateStep?.description) ||
      `Quest step ${index + 1}`,
  };

  if (Number.isInteger(overrideStep?.subtype)) {
    step.subtype = overrideStep.subtype;
  }
  if (Number.isInteger(overrideStep?.scriptId)) {
    step.scriptId = overrideStep.scriptId;
  }
  if (Number.isInteger(overrideStep?.mapId)) {
    step.mapId = overrideStep.mapId;
  } else if (Number.isInteger(candidateStep?.mapId)) {
    step.mapId = candidateStep.mapId;
  }
  if (Number.isInteger(overrideStep?.monsterId)) {
    step.monsterId = overrideStep.monsterId;
  } else if (runtimeType === 'kill' && Number.isInteger(candidateStep?.monsterId)) {
    step.monsterId = candidateStep.monsterId;
  }
  if (Number.isInteger(overrideStep?.count)) {
    step.count = overrideStep.count;
  } else if (runtimeType === 'kill' && Number.isInteger(candidateStep?.count)) {
    step.count = candidateStep.count;
  }

  const overrideGrantItems = normalizeItems(overrideStep?.grantItems);
  const acceptGrantItems = normalizeItems(questContext?.acceptGrantItems);
  if (overrideGrantItems.length > 0) {
    step.grantItems = overrideGrantItems;
  } else if (!runtimeShapeChanged && runtimeType === 'talk') {
    const inferredGrantItems = normalizeItems(candidateStep?.grantItems);
    if (inferredGrantItems.length > 0) {
      if (itemsEqual(inferredGrantItems, acceptGrantItems)) {
        step.consumeItems = inferredGrantItems;
      } else {
        step.grantItems = inferredGrantItems;
      }
    }
  }

  const overrideConsumeItems = normalizeItems(overrideStep?.consumeItems);
  if (overrideConsumeItems.length > 0) {
    step.consumeItems = overrideConsumeItems;
  } else if (!runtimeShapeChanged && !Array.isArray(step.grantItems)) {
    const inferredConsumeItems = normalizeItems(candidateStep?.consumeItems);
    if (inferredConsumeItems.length > 0) {
      step.consumeItems = inferredConsumeItems;
    }
  }

  if (
    itemsEqual(step.grantItems, step.consumeItems) &&
    Array.isArray(step.grantItems) &&
    Array.isArray(step.consumeItems)
  ) {
    if (overrideGrantItems.length > 0 && overrideConsumeItems.length === 0) {
      delete step.consumeItems;
    } else {
      delete step.grantItems;
    }
  }

  if (stringOrDefault(candidateStep?.type) && candidateStep.type !== runtimeType) {
    step.originalType = candidateStep.type;
  }

  return step;
}

function buildQuestSteps(taskId, candidateSteps, overrideSteps, questContext) {
  const stepCount = Math.max(candidateSteps.length, overrideSteps.length);
  const steps = [];

  for (let index = 0; index < stepCount; index += 1) {
    const step = mergeStep(candidateSteps[index] || null, overrideSteps[index] || {}, index, questContext);
    if (!step) {
      continue;
    }

    const candidateStep = candidateSteps[index] || null;
    const overrideStep = overrideSteps[index] || {};
    const previousStep = steps[steps.length - 1];
    const candidateGrantItems = normalizeItems(candidateStep?.grantItems);
    const candidateConsumeItems = normalizeItems(candidateStep?.consumeItems);

    if (
      previousStep &&
      previousStep.type === 'talk' &&
      step.type === 'talk' &&
      normalizeItems(overrideStep?.grantItems).length === 0 &&
      candidateGrantItems.length > 0 &&
      itemsEqual(candidateGrantItems, candidateConsumeItems)
    ) {
      if (!Array.isArray(previousStep.grantItems) || previousStep.grantItems.length === 0) {
        previousStep.grantItems = candidateGrantItems;
      }
      if (!Array.isArray(step.consumeItems) || step.consumeItems.length === 0) {
        step.consumeItems = candidateConsumeItems;
      }
      delete step.grantItems;
    }

    if ((taskId >>> 0) === 51 && numberOrDefault(step?.status, 0) === 3 && numberOrDefault(step?.npcId, 0) === 3023) {
      step.mapId = 103;
    }

    if ((taskId >>> 0) === 51 && numberOrDefault(step?.status, 0) === 1 && numberOrDefault(step?.npcId, 0) === 3004) {
      delete step.consumeItems;
      delete step.grantItems;
      step.description = 'Bring "Candy\'s Recommendation" to "Scholar"';
    }

    if ((taskId >>> 0) === 51 && step.type === 'kill' && numberOrDefault(step?.status, 0) === 4) {
      step.completionNpcId = 3023;
      step.completionMapId = 103;
      step.completionDescription = 'Return to "Grandpa" after defeating "Little Boar"';
      step.completeOnTalkAfterKill = true;
    }

    steps.push(step);
  }

  return steps;
}

function normalizeRuntimeStepType(type) {
  if (type === 'kill') {
    return 'kill';
  }
  return 'talk';
}

function inferNpcId(candidateStep, overrideStep) {
  if (Number.isInteger(overrideStep?.npcId)) {
    return overrideStep.npcId;
  }
  if (Number.isInteger(candidateStep?.npcId)) {
    return candidateStep.npcId;
  }
  return undefined;
}

function normalizePrerequisiteTaskIds(...values) {
  return [...new Set(
    values
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .filter((value) => Number.isInteger(value) && value > 0)
      .map((value) => value >>> 0)
  )];
}

function normalizeItems(items) {
  return Array.isArray(items)
    ? items
        .filter((item) => Number.isInteger(item?.templateId))
        .map((item) => ({
          templateId: item.templateId >>> 0,
          quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
          name: stringOrDefault(item.name) || '',
        }))
    : [];
}

function normalizeRewardItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  const flattened = [];
  for (const entry of items) {
    if (Number.isInteger(entry?.templateId)) {
      flattened.push({
        templateId: entry.templateId >>> 0,
        quantity: Math.max(1, numberOrDefault(entry.quantity, 1)),
        name: stringOrDefault(entry.name),
      });
      continue;
    }
    if (Array.isArray(entry?.items)) {
      flattened.push(...normalizeItems(entry.items));
    }
  }
  return flattened;
}

function normalizeRewardChoiceGroups(groups) {
  return Array.isArray(groups)
    ? groups
        .map((group) => ({
          awardId: Number.isInteger(group?.awardId) ? group.awardId >>> 0 : 0,
          gold: numberOrDefault(group?.gold, 0),
          experience: numberOrDefault(group?.experience, 0),
          coins: numberOrDefault(group?.coins, 0),
          renown: numberOrDefault(group?.renown, 0),
          pets: Array.isArray(group?.petTemplateIds) ? group.petTemplateIds.slice() : Array.isArray(group?.pets) ? group.pets.slice() : [],
          items: normalizeItems(group?.items),
        }))
        .filter((group) => group.items.length > 0 || group.experience > 0 || group.gold > 0 || group.coins > 0 || group.renown > 0 || group.pets.length > 0)
    : [];
}

function deriveAuxiliaryActions(taskId) {
  if (taskId === 1) {
    return [{
      type: 'grant_on_server_run',
      stepStatus: 2,
      subtype: 0x02,
      contextId: 11,
      scriptId: 10000,
      onlyIfMissingTemplateId: 21116,
      grantItems: [{
        templateId: 21116,
        quantity: 1,
        name: 'Timber',
      }],
    }];
  }

  if (taskId === 51) {
    return [
      {
        type: 'grant_on_server_run',
        stepStatus: 1,
        subtype: 0x08,
        npcId: 3004,
        mapId: 101,
        scriptId: 51,
        consumeItems: [{
          templateId: 21123,
          quantity: 1,
          name: "Candy's Recommendation",
        }],
        grantItems: [{
          templateId: 21001,
          quantity: 1,
          name: "Scholar's Letter",
        }],
      },
      {
        type: 'combat_on_server_run',
        stepStatus: 4,
        subtype: 0x02,
        mapId: 103,
        scriptId: 10001,
        monsterId: 5106,
        count: 1,
      },
    ];
  }

  return [];
}

function normalizeAuxiliaryActions(actions) {
  return Array.isArray(actions)
    ? actions
        .map((action) => {
          if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
            return null;
          }
          return {
            type: action.type,
            stepStatus: Number.isInteger(action.stepStatus) ? action.stepStatus >>> 0 : undefined,
            subtype: Number.isInteger(action.subtype) ? action.subtype & 0xff : undefined,
            npcId: Number.isInteger(action.npcId) ? action.npcId >>> 0 : undefined,
            contextId: Number.isInteger(action.contextId) ? action.contextId >>> 0 : undefined,
            extra: Number.isInteger(action.extra) ? action.extra & 0xff : undefined,
            scriptId: Number.isInteger(action.scriptId) ? action.scriptId & 0xffff : undefined,
            mapId: Number.isInteger(action.mapId) ? action.mapId >>> 0 : undefined,
            monsterId: Number.isInteger(action.monsterId) ? action.monsterId >>> 0 : undefined,
            count: Number.isInteger(action.count) ? action.count >>> 0 : undefined,
            onlyIfMissingTemplateId: Number.isInteger(action.onlyIfMissingTemplateId) ? action.onlyIfMissingTemplateId >>> 0 : undefined,
            consumeItems: normalizeItems(action.consumeItems),
            grantItems: normalizeItems(action.grantItems),
          };
        })
        .filter(Boolean)
    : [];
}

function itemsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => {
    const other = right[index];
    return item.templateId === other.templateId && item.quantity === other.quantity;
  });
}

function firstNumber(...values) {
  for (const value of values) {
    if (Number.isInteger(value) && value >= 0) {
      return value >>> 0;
    }
  }
  return undefined;
}

function numberOrDefault(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function stringOrDefault(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanQuestTitle(title) {
  return stringOrDefault(title).replace(/<[^>]+>/g, '').trim();
}

main();
