import type { GameSession } from '../types.js';
import type { UnknownRecord } from '../utils.js';
import type { QuestDef, RequirementDef, StepDef } from './schema.js';
import type { QuestInstance, QuestState } from './state.js';

import { DEFAULT_FLAGS, GAME_QUEST_CMD } from '../config.js';
import { getMapBootstrapSpawns } from '../map-spawns.js';
import { buildQuestAcceptStatePacket, buildQuestPacket } from '../protocol/gameplay-packets.js';
import { numberOrDefault } from '../utils.js';
import { questService } from './service.js';

export type Quest2SyncState = UnknownRecord & {
  source: 'quest2';
  taskId: number;
  stepIndex: number;
  status: number;
  stepDescription: string;
  progressObjectiveId: number;
  progressCount: number;
  taskType: number;
  overNpcId: number;
  taskRoleNpcId: number;
  maxStep: number;
  maxAward: number;
  taskStep: number;
  stepMode: 'talk' | 'kill';
  markerNpcId: number;
  objectiveWords: number[];
  trackerScriptIds: number[];
  acceptedAt: number;
};

type Quest2ActiveView = {
  definition: QuestDef;
  instance: QuestInstance;
  step: StepDef;
  stepIndex: number;
};

function listQuest2ActiveViews(state: QuestState): Quest2ActiveView[] {
  const views: Quest2ActiveView[] = [];

  for (const instance of Array.isArray(state.active) ? state.active : []) {
    const definition = questService.getDefinition(instance.questId);
    if (!definition) {
      continue;
    }
    const stepIndex = definition.steps.findIndex((step) => step.id === instance.stepId);
    if (stepIndex < 0) {
      continue;
    }
    const step = definition.steps[stepIndex];
    if (!step) {
      continue;
    }
    views.push({
      definition,
      instance,
      step,
      stepIndex,
    });
  }

  views.sort((left, right) => {
    if (left.instance.acceptedAt !== right.instance.acceptedAt) {
      return left.instance.acceptedAt - right.instance.acceptedAt;
    }
    return left.definition.id - right.definition.id;
  });

  return views;
}

function buildQuest2SyncState(state: QuestState): Quest2SyncState[] {
  return listQuest2ActiveViews(state).map((view) => ({
    source: 'quest2',
    taskId: view.definition.id,
    stepIndex: view.stepIndex,
    status: resolveQuest2Status(view),
    stepDescription: resolveQuest2StepDescription(view),
    progressObjectiveId: resolveQuest2ProgressObjectiveId(view),
    progressCount: resolveQuest2ProgressCount(view),
    taskType: resolveQuest2TaskType(view),
    overNpcId: resolveQuest2OverNpcId(view),
    taskRoleNpcId: resolveQuest2TaskRoleNpcId(view),
    maxStep: Math.max(1, view.definition.steps.length),
    maxAward: resolveQuest2MaxAward(view),
    taskStep: resolveQuest2TaskStep(view),
    stepMode: resolveQuest2StepMode(view.step),
    markerNpcId: resolveQuest2MarkerNpcId(view),
    objectiveWords: buildQuest2ObjectiveWords(view),
    trackerScriptIds: resolveQuest2TrackerScriptIds(view.step),
    acceptedAt: view.instance.acceptedAt,
  }));
}

function sendQuest2AcceptWithState(session: GameSession, quest: Quest2SyncState): void {
  writeQuest2StatePacket(session, quest, 0x03, 'accept');
}

function sendQuest2UpdateWithState(session: GameSession, quest: Quest2SyncState): void {
  writeQuest2StatePacket(session, quest, 0x08, 'update');
}

function writeQuest2StatePacket(
  session: GameSession,
  quest: Quest2SyncState,
  subtype: number,
  label: string
): void {
  session.writePacket(
    buildQuestAcceptStatePacket({
      subtype,
      taskId: quest.taskId,
      currentStep: quest.stepIndex + 1,
      taskType: quest.taskType,
      maxStep: Math.max(1, numberOrDefault(quest.maxStep, quest.stepIndex + 1)),
      overNpcId: quest.overNpcId,
      taskRoleNpcId: quest.taskRoleNpcId,
      objectiveWords: Array.isArray(quest.objectiveWords) ? quest.objectiveWords : [],
    }),
    DEFAULT_FLAGS,
    `Sending quest2 ${label} cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x${subtype.toString(16)} taskId=${quest.taskId} step=${quest.stepIndex + 1} type=${quest.taskType} overNpc=${quest.overNpcId} taskRole=${quest.taskRoleNpcId}`
  );
}

function sendQuest2Marker(session: GameSession, quest: Quest2SyncState): void {
  const trackedNpcId =
    numberOrDefault((quest.taskType & 0x08) !== 0 ? quest.taskRoleNpcId : 0, 0) ||
    numberOrDefault(quest.markerNpcId, 0);
  const trackedRuntimeId =
    trackedNpcId > 0
      ? resolveTrackedNpcRuntimeId(session, session.currentMapId >>> 0, trackedNpcId)
      : 0;

  session.writePacket(
    buildQuestPacket(0x0c, trackedNpcId, trackedRuntimeId, 'u32'),
    DEFAULT_FLAGS,
    `Sending quest2 marker cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x0c questId=${quest.taskId} trackedNpc=${trackedNpcId} trackedRuntime=0x${trackedRuntimeId.toString(16)} markerNpc=${quest.markerNpcId}`
  );
}

function replayQuest2TrackerScripts(session: GameSession, quest: Quest2SyncState): void {
  if (!Array.isArray(quest.trackerScriptIds) || quest.trackerScriptIds.length < 1) {
    return;
  }
  for (const scriptId of quest.trackerScriptIds) {
    session.sendServerRunScriptImmediate?.(scriptId >>> 0);
    session.sendServerRunScriptDeferred?.(scriptId >>> 0);
  }
}

function usesQuest2TrackerMarkerPacket(quest: Quest2SyncState): boolean {
  return (numberOrDefault(quest.taskType, 0) & 0x08) !== 0;
}

function resolveTrackedNpcRuntimeId(session: GameSession, mapId: number, trackedNpcId: number): number {
  if (trackedNpcId <= 0) {
    return 0;
  }

  const staticSpawns = getMapBootstrapSpawns(mapId);
  const match = staticSpawns.find((spawn) => (spawn?.entityType & 0xffff) === (trackedNpcId & 0xffff));
  return numberOrDefault(match?.id, 0) >>> 0;
}

function resolveQuest2Status(view: Quest2ActiveView): number {
  if (isQuest2TurnInReady(view)) {
    return numberOrDefault(view.step.client?.status, 0);
  }
  if (hasQuest2TurnInRequirements(view.step)) {
    return 0;
  }
  return numberOrDefault(view.step.client?.status, 0);
}

function resolveQuest2StepDescription(view: Quest2ActiveView): string {
  if (typeof view.step.description === 'string' && view.step.description.length > 0) {
    return view.step.description;
  }

  switch (view.step.kind) {
    case 'kill':
      return `Defeat ${resolveQuest2TargetCount(view)} enemies.`;
    case 'collect':
      return 'Collect the required items.';
    case 'escort':
      return 'Escort the quest target to safety.';
    case 'turn_in':
      return 'Bring the required items to the quest NPC.';
    case 'trigger_combat':
      return 'Trigger the required combat encounter.';
    default:
      return 'Speak with the quest target.';
  }
}

function resolveQuest2ProgressObjectiveId(view: Quest2ActiveView): number {
  const monsterRequirement = findRequirement(view.step.requirements, 'monster_is');
  if (monsterRequirement) {
    return monsterRequirement.monsterId >>> 0;
  }
  return view.definition.id >>> 0;
}

function resolveQuest2ProgressCount(view: Quest2ActiveView): number {
  if (!view.step.progress) {
    return 0;
  }
  return Math.max(0, numberOrDefault(view.instance.counters?.[view.step.progress.counter], 0));
}

function resolveQuest2TaskType(view: Quest2ActiveView): number {
  if (Number.isInteger(view.step.client?.taskType)) {
    return view.step.client!.taskType! >>> 0;
  }
  switch (view.step.kind) {
    case 'kill':
    case 'collect':
      return 32;
    case 'escort':
      return 8;
    default:
      return 0;
  }
}

function resolveQuest2MarkerNpcId(view: Quest2ActiveView): number {
  if (Number.isInteger(view.step.client?.markerNpcId) && view.step.client!.markerNpcId! > 0) {
    return view.step.client!.markerNpcId! >>> 0;
  }
  const npcRequirement = findRequirement(view.step.requirements, 'npc_is');
  return npcRequirement ? (npcRequirement.npcId >>> 0) : 0;
}

function resolveQuest2OverNpcId(view: Quest2ActiveView): number {
  if (Number.isInteger(view.step.client?.overNpcId) && view.step.client!.overNpcId! > 0) {
    return view.step.client!.overNpcId! >>> 0;
  }
  return resolveQuest2MarkerNpcId(view);
}

function resolveQuest2TaskRoleNpcId(view: Quest2ActiveView): number {
  if (Number.isInteger(view.step.client?.taskRoleNpcId) && view.step.client!.taskRoleNpcId! > 0) {
    return view.step.client!.taskRoleNpcId! >>> 0;
  }
  return 0;
}

function resolveQuest2MaxAward(view: Quest2ActiveView): number {
  return Number.isInteger(view.step.client?.maxAward) ? (view.step.client!.maxAward! >>> 0) : 0;
}

function resolveQuest2TaskStep(view: Quest2ActiveView): number {
  return Number.isInteger(view.step.client?.taskStep)
    ? (view.step.client!.taskStep! >>> 0)
    : (view.stepIndex + 1);
}

function resolveQuest2TrackerScriptIds(step: StepDef): number[] {
  return Array.isArray(step.client?.trackerScriptIds)
    ? step.client!.trackerScriptIds!.filter(Number.isInteger).map((scriptId: number) => scriptId >>> 0)
    : [];
}

function resolveQuest2StepMode(step: StepDef): 'talk' | 'kill' {
  switch (step.kind) {
    case 'kill':
    case 'collect':
      return 'kill';
    default:
      return 'talk';
  }
}

function buildQuest2ObjectiveWords(view: Quest2ActiveView): number[] {
  const words = new Array<number>(10).fill(0);
  const monsterRequirement = findRequirement(view.step.requirements, 'monster_is');
  const itemRequirements = view.step.requirements.filter(
    (requirement): requirement is Extract<RequirementDef, { kind: 'item_count_at_least' }> =>
      requirement.kind === 'item_count_at_least'
  );

  if (monsterRequirement) {
    words[0] = monsterRequirement.monsterId & 0xffff;
    words[1] = resolveQuest2TargetCount(view) & 0xffff;
  }

  if (itemRequirements[0]) {
    words[4] = itemRequirements[0].templateId & 0xffff;
    words[6] = Math.max(1, itemRequirements[0].quantity) & 0xffff;
  }
  if (itemRequirements[1]) {
    words[5] = itemRequirements[1].templateId & 0xffff;
    words[7] = Math.max(1, itemRequirements[1].quantity) & 0xffff;
  }

  return words;
}

function resolveQuest2TargetCount(view: Quest2ActiveView): number {
  if (view.step.progress?.target) {
    return Math.max(1, view.step.progress.target);
  }
  const itemRequirement = findRequirement(view.step.requirements, 'item_count_at_least');
  if (itemRequirement) {
    return Math.max(1, itemRequirement.quantity);
  }
  return 1;
}

function findRequirement<K extends RequirementDef['kind']>(
  requirements: RequirementDef[],
  kind: K
): Extract<RequirementDef, { kind: K }> | null {
  for (const requirement of requirements) {
    if (requirement.kind === kind) {
      return requirement as Extract<RequirementDef, { kind: K }>;
    }
  }
  return null;
}

function hasQuest2TurnInRequirements(step: StepDef): boolean {
  return step.requirements.some(
    (requirement) => requirement.kind === 'turn_in_npc_is' || requirement.kind === 'turn_in_map_is'
  );
}

function isQuest2TurnInReady(view: Quest2ActiveView): boolean {
  return view.instance.flags[`__turn_in_ready__:${view.step.id}`] === true;
}

export {
  buildQuest2SyncState,
  replayQuest2TrackerScripts,
  sendQuest2AcceptWithState,
  sendQuest2Marker,
  sendQuest2UpdateWithState,
  usesQuest2TrackerMarkerPacket,
};
