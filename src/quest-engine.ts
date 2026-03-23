import fs from 'fs';
import type { QuestEvent } from './types';

const { resolveRepoPath } = require('./runtime-paths');

const QUEST_DATA_FILE = resolveRepoPath('data', 'quests', 'main-story.json');
const CLIENT_QUEST_METADATA_FILE = resolveRepoPath('data', 'client-derived', 'quests.json');
const CLIENT_HELP_QUESTS_FILE = resolveRepoPath('data', 'client-verified', 'quests', 'client-help-quests.json');

type UnknownRecord = Record<string, any>;

interface GrantedItem {
  templateId: number;
  quantity: number;
  name: string;
  capturedMonsterId?: number;
}

interface RewardChoiceGroup {
  awardId: number;
  gold: number;
  experience: number;
  coins: number;
  renown: number;
  pets: unknown[];
  items: GrantedItem[];
}

interface QuestStep {
  type: string;
  npcId?: number;
  mapId?: number;
  monsterId?: number;
  completionNpcId?: number;
  completionMapId?: number;
  count?: number;
  status?: number;
  description: string;
  completionDescription: string;
  completeOnTalkAfterKill: boolean;
  consumeItems?: GrantedItem[];
  grantItems?: GrantedItem[];
}

interface QuestRewards {
  gold: number;
  experience: number;
  coins: number;
  renown: number;
  choiceGroups: RewardChoiceGroup[];
  items: GrantedItem[];
  [key: string]: unknown;
}

interface QuestDefinitionRecord {
  id: number;
  name: string;
  type: string;
  acceptNpcId?: number;
  acceptSubtype?: number;
  acceptMessage: string;
  completionMessage: string;
  autoAccept: boolean;
  prerequisiteTaskIds: number[];
  minLevel: number;
  acceptGrantItems?: GrantedItem[];
  nextQuestId?: number;
  rewards: QuestRewards;
  steps: QuestStep[];
  [key: string]: unknown;
}

interface QuestRecord {
  id: number;
  stepIndex: number;
  status: number;
  progress: UnknownRecord;
  acceptedAt: number;
}

interface QuestState {
  activeQuests: QuestRecord[];
  completedQuests: number[];
  level?: number;
}

interface ClientQuestMetadata {
  taskId?: number;
  title?: string;
  prerequisiteTaskId?: number;
  minLevel?: number;
}

interface ClientHelpQuestMetadata {
  taskId?: number;
  stepIndex?: number;
  itemIds?: number[];
  targetNpcIds?: number[];
  blockPreview?: string;
}

const CLIENT_QUEST_METADATA: Map<number, ClientQuestMetadata> = loadClientQuestMetadata();
const CLIENT_HELP_QUEST_METADATA: Map<string, ClientHelpQuestMetadata> = loadClientHelpQuestMetadata();
const QUEST_DEFINITIONS: readonly QuestDefinitionRecord[] = Object.freeze(loadQuestDefinitions());
const QUESTS_BY_ID = new Map<number, QuestDefinitionRecord>(
  QUEST_DEFINITIONS.map((quest) => [quest.id, quest])
);

function loadQuestDefinitions(): QuestDefinitionRecord[] {
  const raw = fs.readFileSync(QUEST_DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw) as UnknownRecord;
  const quests = Array.isArray(parsed?.quests) ? parsed.quests : [];
  return quests
    .map((quest) => normalizeQuestDefinition(quest))
    .filter((quest): quest is QuestDefinitionRecord => Boolean(quest));
}

function loadClientQuestMetadata(): Map<number, ClientQuestMetadata> {
  try {
    const raw = fs.readFileSync(CLIENT_QUEST_METADATA_FILE, 'utf8');
    const parsed = JSON.parse(raw) as UnknownRecord;
    const quests = Array.isArray(parsed?.quests) ? parsed.quests : [];
    return new Map(
      quests
        .filter((entry: UnknownRecord) => Number.isInteger(entry?.taskId))
        .map((entry: UnknownRecord) => [entry.taskId >>> 0, entry as ClientQuestMetadata] as const)
    );
  } catch {
    return new Map();
  }
}

function loadClientHelpQuestMetadata(): Map<string, ClientHelpQuestMetadata> {
  try {
    const raw = fs.readFileSync(CLIENT_HELP_QUESTS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as UnknownRecord;
    const quests = Array.isArray(parsed?.quests) ? parsed.quests : [];
    return new Map(
      quests
        .filter(
          (entry: UnknownRecord) =>
            Number.isInteger(entry?.taskId) && Number.isInteger(entry?.stepIndex)
        )
        .map((entry: UnknownRecord) => [`${entry.taskId >>> 0}:${entry.stepIndex >>> 0}`, entry as ClientHelpQuestMetadata] as const)
    );
  } catch {
    return new Map();
  }
}

function normalizeQuestDefinition(quest: UnknownRecord): QuestDefinitionRecord | null {
  if (!Number.isInteger(quest?.id) || !Array.isArray(quest?.steps) || quest.steps.length === 0) {
    return null;
  }

  const clientMeta = CLIENT_QUEST_METADATA.get(quest.id >>> 0) || null;
  const clientMinLevel = clientMeta?.minLevel;
  const rewardOverrides = getClientRewardOverrides(quest.id >>> 0);

  return {
    id: quest.id >>> 0,
    name:
      sanitizeClientQuestTitle(clientMeta?.title) ||
      (typeof quest.name === 'string' ? quest.name : `Quest ${quest.id}`),
    type: typeof quest.type === 'string' ? quest.type : 'story',
    acceptNpcId: Number.isInteger(quest?.acceptNpcId) ? quest.acceptNpcId >>> 0 : undefined,
    acceptSubtype: Number.isInteger(quest?.acceptSubtype) ? quest.acceptSubtype >>> 0 : undefined,
    acceptMessage: typeof quest.acceptMessage === 'string' ? quest.acceptMessage : '',
    completionMessage: typeof quest.completionMessage === 'string' ? quest.completionMessage : '',
    autoAccept: quest.autoAccept === true,
    prerequisiteTaskIds: mergePrerequisiteTaskIds(
      quest.prerequisiteTaskIds,
      clientMeta?.prerequisiteTaskId
    ),
    minLevel:
      typeof clientMinLevel === 'number' && Number.isInteger(clientMinLevel) && clientMinLevel > 0
        ? clientMinLevel >>> 0
        : 1,
    acceptGrantItems: Array.isArray(quest.acceptGrantItems)
      ? quest.acceptGrantItems
          .map((item: UnknownRecord) => normalizeGrantedItem(item))
          .filter((item: GrantedItem | null): item is GrantedItem => Boolean(item))
      : undefined,
    nextQuestId: Number.isInteger(quest.nextQuestId) ? quest.nextQuestId >>> 0 : undefined,
    rewards: {
      gold: numberOrDefault(quest?.rewards?.gold, 0),
      experience: numberOrDefault(quest?.rewards?.experience, 0),
      coins: numberOrDefault(quest?.rewards?.coins, 0),
      renown: numberOrDefault(quest?.rewards?.renown, 0),
      choiceGroups: Array.isArray(quest?.rewards?.choiceGroups)
        ? quest.rewards.choiceGroups
            .map((group: UnknownRecord) => normalizeRewardChoiceGroup(group, rewardOverrides))
            .filter((group: RewardChoiceGroup | null): group is RewardChoiceGroup => Boolean(group))
        : [],
      items: Array.isArray(quest?.rewards?.items)
        ? quest.rewards.items
            .map((item: UnknownRecord) => normalizeGrantedItem(item))
            .filter((item: GrantedItem | null): item is GrantedItem => Boolean(item))
        : [],
    },
    steps: quest.steps
      .map((step: UnknownRecord, index: number) => normalizeQuestStep(quest.id >>> 0, index, step))
      .filter((step: QuestStep | null): step is QuestStep => Boolean(step)),
  };
}

function normalizeQuestStep(taskId: number, stepIndex: number, step: UnknownRecord): QuestStep | null {
  if (typeof step?.type !== 'string') {
    return null;
  }

  const normalizedConsumeItems = Array.isArray(step.consumeItems)
    ? step.consumeItems
        .map((item: UnknownRecord) => normalizeGrantedItem(item))
        .filter((item: GrantedItem | null): item is GrantedItem => Boolean(item))
    : undefined;
  const captureMetadata = getCaptureStepMetadata(taskId, stepIndex, step);
  const effectiveConsumeItems =
    captureMetadata
      ? [
          {
            templateId: captureMetadata.templateId,
            quantity: 1,
            name: '',
            capturedMonsterId: captureMetadata.monsterId,
          },
        ]
      : normalizedConsumeItems;

  return {
    type: step.type,
    npcId: Number.isInteger(step.npcId) ? step.npcId >>> 0 : undefined,
    mapId: Number.isInteger(step.mapId) ? step.mapId >>> 0 : undefined,
    monsterId: Number.isInteger(step.monsterId) ? step.monsterId >>> 0 : undefined,
    completionNpcId: Number.isInteger(step.completionNpcId) ? step.completionNpcId >>> 0 : undefined,
    completionMapId: Number.isInteger(step.completionMapId) ? step.completionMapId >>> 0 : undefined,
    count: Number.isInteger(step.count) ? step.count >>> 0 : undefined,
    status: Number.isInteger(step.status) ? step.status >>> 0 : undefined,
    description: typeof step.description === 'string' ? step.description : '',
    completionDescription:
      typeof step.completionDescription === 'string' ? step.completionDescription : '',
    completeOnTalkAfterKill: step.completeOnTalkAfterKill === true,
    consumeItems: effectiveConsumeItems,
    grantItems: Array.isArray(step.grantItems)
      ? step.grantItems
          .map((item: UnknownRecord) => normalizeGrantedItem(item))
          .filter((item: GrantedItem | null): item is GrantedItem => Boolean(item))
      : undefined,
  };
}

function getCaptureStepMetadata(
  taskId: number,
  stepIndex: number,
  step: UnknownRecord
): { templateId: number; monsterId: number } | null {
  if (typeof step?.originalType !== 'string' || step.originalType !== 'capture') {
    return null;
  }
  const helpMeta = CLIENT_HELP_QUEST_METADATA.get(`${taskId}:${stepIndex + 1}`) || null;
  const templateId = Number.isInteger(helpMeta?.itemIds?.[0]) ? (helpMeta!.itemIds![0] >>> 0) : null;
  const monsterId = Number.isInteger(helpMeta?.targetNpcIds?.[0]) ? (helpMeta!.targetNpcIds![0] >>> 0) : null;
  if (!templateId || !monsterId) {
    return null;
  }
  return { templateId, monsterId };
}

function normalizeGrantedItem(item: UnknownRecord): GrantedItem | null {
  if (!Number.isInteger(item?.templateId)) {
    return null;
  }

  return {
    templateId: item.templateId >>> 0,
    quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
    name: typeof item.name === 'string' ? item.name : '',
  };
}

function normalizeRewardChoiceGroup(
  group: UnknownRecord,
  rewardOverrides?: Map<number, number>
): RewardChoiceGroup | null {
  if (!group || typeof group !== 'object') {
    return null;
  }

  return {
    awardId: Number.isInteger(group.awardId) ? group.awardId >>> 0 : 0,
    gold: numberOrDefault(group.gold, 0),
    experience: numberOrDefault(group.experience, 0),
    coins: numberOrDefault(group.coins, 0),
    renown: numberOrDefault(group.renown, 0),
    pets: Array.isArray(group.pets) ? group.pets.slice() : [],
    items: Array.isArray(group.items)
      ? group.items
          .map((item: UnknownRecord) => normalizeGrantedItem(item))
          .map((item: GrantedItem | null) => {
            if (!item || !rewardOverrides || rewardOverrides.size === 0) {
              return item;
            }
            const overrideQuantity = rewardOverrides.get(item.templateId >>> 0);
            return overrideQuantity && overrideQuantity > 0
              ? { ...item, quantity: overrideQuantity }
              : item;
          })
          .filter((item: GrantedItem | null): item is GrantedItem => Boolean(item))
      : [],
  };
}

function getClientRewardOverrides(taskId: number): Map<number, number> {
  const overrides = new Map<number, number>();
  for (const entry of CLIENT_HELP_QUEST_METADATA.values()) {
    const entryTaskId = typeof entry?.taskId === 'number' && Number.isInteger(entry.taskId)
      ? (entry.taskId >>> 0)
      : 0;
    if (entryTaskId !== (taskId >>> 0) || typeof entry?.blockPreview !== 'string') {
      continue;
    }
    const text = entry.blockPreview;
    const mobFlaskCount = text.match(/Item:\s*Level 1 Mob Flask\s*\n(\d+)/i);
    if (mobFlaskCount) {
      overrides.set(29001, Math.max(1, numberOrDefault(Number.parseInt(mobFlaskCount[1], 10), 1)));
    }
  }
  return overrides;
}

function mergePrerequisiteTaskIds(values: unknown, extraValue?: number): number[] {
  const merged = Array.isArray(values) ? values.slice() : [];
  if (Number.isInteger(extraValue) && extraValue! > 0) {
    merged.push(extraValue);
  }
  return [...new Set(merged.filter(Number.isInteger).map((value) => (value as number) >>> 0))];
}

function sanitizeClientQuestTitle(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeQuestState(source: UnknownRecord): QuestState {
  const activeQuests = Array.isArray(source?.activeQuests)
    ? source.activeQuests
        .map((record: UnknownRecord) => normalizeQuestRecord(record))
        .filter((record: QuestRecord | null): record is QuestRecord => Boolean(record))
    : [];
  const completedQuests = Array.isArray(source?.completedQuests)
    ? source.completedQuests.filter(Number.isInteger).map((taskId: number) => taskId >>> 0)
    : [];

  return {
    activeQuests,
    completedQuests,
    level: numberOrDefault(source?.level, 1),
  };
}

function normalizeQuestRecord(record: UnknownRecord): QuestRecord | null {
  const questId = Number.isInteger(record?.id)
    ? (record.id >>> 0)
    : Number.isInteger(record?.taskId)
    ? (record.taskId >>> 0)
    : 0;
  if (questId <= 0) {
    return null;
  }
  return {
    id: questId,
    stepIndex: Math.max(0, numberOrDefault(record.stepIndex, 0)),
    status: Math.max(0, numberOrDefault(record.status, 0)),
    progress: cloneProgress(record.progress),
    acceptedAt: numberOrDefault(record.acceptedAt, Date.now()),
  };
}

function getQuestDefinition(taskId: number): QuestDefinitionRecord | null {
  if (!Number.isInteger(taskId)) {
    return null;
  }
  return QUESTS_BY_ID.get(taskId >>> 0) || null;
}

function getCurrentStep(definition: QuestDefinitionRecord | null, record: QuestRecord | null): QuestStep | null {
  if (!definition || !record || !Array.isArray(definition.steps)) {
    return null;
  }
  return definition.steps[record.stepIndex] || null;
}

function removeActiveQuest(state: QuestState, taskId: number): QuestRecord | null {
  const index = state.activeQuests.findIndex((record) => record.id === (taskId >>> 0));
  if (index < 0) {
    return null;
  }
  const [record] = state.activeQuests.splice(index, 1);
  return record || null;
}

function isQuestAccepted(state: QuestState, taskId: number): boolean {
  return state.activeQuests.some((record) => record.id === (taskId >>> 0));
}

function canAcceptQuest(state: QuestState, definition: QuestDefinitionRecord | null): boolean {
  if (!definition) {
    return false;
  }
  if (state.completedQuests.includes(definition.id) || isQuestAccepted(state, definition.id)) {
    return false;
  }
  const missingPrerequisites = definition.prerequisiteTaskIds.some(
    (prerequisiteTaskId) => !state.completedQuests.includes(prerequisiteTaskId)
  );
  if (missingPrerequisites || numberOrDefault(state.level, 1) < definition.minLevel) {
    return false;
  }
  return true;
}

function appendGrantedItemEvents(
  events: QuestEvent[],
  definition: QuestDefinitionRecord,
  items: GrantedItem[] | undefined,
  reason: string
): void {
  for (const item of Array.isArray(items) ? items : []) {
    if (!Number.isInteger(item?.templateId) || item.templateId <= 0) {
      continue;
    }
    events.push({
      type: 'item-granted',
      taskId: definition.id,
      definition,
      templateId: item.templateId >>> 0,
      quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
      itemName: item.name || '',
      reason,
    });
  }
}

function acceptQuest(state: QuestState, taskId: number, events: QuestEvent[], reason: string): boolean {
  const definition = getQuestDefinition(taskId);
  if (!canAcceptQuest(state, definition)) {
    return false;
  }
  const acceptedDefinition = definition as QuestDefinitionRecord;

  const record: QuestRecord = {
    id: acceptedDefinition.id,
    stepIndex: 0,
    status: 0,
    progress: {},
    acceptedAt: Date.now(),
  };
  state.activeQuests.push(record);

  events.push({
    type: 'accepted',
    taskId: acceptedDefinition.id,
    definition: acceptedDefinition,
    status: 0,
    stepDescription: getQuestStepDescription(acceptedDefinition, record),
    progressObjectiveId: getQuestProgressObjectiveId(acceptedDefinition, record),
    progressCount: getQuestProgressCount(acceptedDefinition, record),
    markerNpcId: getQuestMarkerNpcId(acceptedDefinition, record),
    reason,
  });
  appendGrantedItemEvents(
    events,
    acceptedDefinition,
    acceptedDefinition.acceptGrantItems,
    `${reason}-accept`
  );
  return true;
}

function getQuestStatus(definition: QuestDefinitionRecord | null, record: QuestRecord | null): number {
  const step = getCurrentStep(definition, record);
  if (!step || !record) {
    return 0;
  }
  return numberOrDefault(step.status, numberOrDefault(record.status, 0));
}

function getQuestProgressCount(definition: QuestDefinitionRecord | null, record: QuestRecord | null): number {
  const step = getCurrentStep(definition, record);
  if (!step || !record || step.type !== 'kill') {
    return 0;
  }
  return Math.max(0, numberOrDefault(record.progress?.count, 0));
}

function getQuestStepDescription(definition: QuestDefinitionRecord | null, record: QuestRecord | null): string {
  const step = getCurrentStep(definition, record);
  if (!step) {
    return '';
  }
  return typeof step.description === 'string' && step.description.length > 0
    ? step.description
    : step.type === 'kill'
      ? `Defeat ${Math.max(1, numberOrDefault(step.count, 1))} enemies.`
      : '';
}

function getQuestProgressObjectiveId(definition: QuestDefinitionRecord | null, _record?: QuestRecord | null): number {
  const step = getCurrentStep(definition, _record || null);
  if (step?.type === 'kill') {
    return numberOrDefault(step.monsterId, 0);
  }
  return numberOrDefault(definition?.id, 0);
}

function getQuestMarkerNpcId(definition: QuestDefinitionRecord | null, record: QuestRecord | null): number {
  const step = getCurrentStep(definition, record);
  if (!step) {
    return 0;
  }
  if (step.type === 'kill' && step.completeOnTalkAfterKill === true) {
    return numberOrDefault(step.completionNpcId, numberOrDefault(step.npcId, 0));
  }
  return numberOrDefault(step.npcId, 0);
}

function completeQuest(state: QuestState, record: QuestRecord, definition: QuestDefinitionRecord, events: QuestEvent[], reason: string): void {
  removeActiveQuest(state, definition.id);
  if (!state.completedQuests.includes(definition.id)) {
    state.completedQuests.push(definition.id);
  }
  events.push({
    type: 'completed',
    taskId: definition.id,
    definition,
    reward: definition.rewards,
    reason,
  });

  if (Number.isInteger(definition.nextQuestId)) {
    acceptQuest(state, definition.nextQuestId!, events, 'chain');
  }
}

function advanceQuest(state: QuestState, record: QuestRecord, definition: QuestDefinitionRecord, events: QuestEvent[], reason: string): void {
  record.stepIndex += 1;
  record.progress = {};
  record.status = 0;

  if (record.stepIndex >= definition.steps.length) {
    completeQuest(state, record, definition, events, reason);
    return;
  }

  record.status = getQuestStatus(definition, record);
  events.push({
    type: 'advanced',
    taskId: definition.id,
    definition,
    status: record.status,
    stepDescription: getQuestStepDescription(definition, record),
    progressObjectiveId: getQuestProgressObjectiveId(definition, record),
    progressCount: getQuestProgressCount(definition, record),
    markerNpcId: getQuestMarkerNpcId(definition, record),
    reason,
  });
}

function reconcileAutoAccept(_state: QuestState): QuestEvent[] {
  return [];
}

function interactWithNpc(
  state: QuestState,
  npcId: number,
  getItemQuantity?: (templateId: number) => number,
  matchItemRequirement?: (item: GrantedItem) => number
): QuestEvent[] {
  if (!Number.isInteger(npcId) || npcId <= 0) {
    return [];
  }

  const events: QuestEvent[] = [];
  const activeRecords = [...state.activeQuests].sort((left, right) => {
    const acceptedDelta = numberOrDefault(left.acceptedAt, 0) - numberOrDefault(right.acceptedAt, 0);
    if (acceptedDelta !== 0) {
      return acceptedDelta;
    }
    return left.id - right.id;
  });

  for (const record of activeRecords) {
    const definition = getQuestDefinition(record.id);
    const step = getCurrentStep(definition, record);
    if (
      definition &&
      step &&
      step.type === 'kill' &&
      step.completeOnTalkAfterKill === true &&
      numberOrDefault(step.completionNpcId, numberOrDefault(step.npcId, 0)) === (npcId >>> 0) &&
      numberOrDefault(record.progress?.count, 0) >= Math.max(1, numberOrDefault(step.count, 1))
    ) {
      advanceQuest(state, record, definition, events, 'kill-turn-in');
      return events;
    }
    if (!definition || !step || step.type !== 'talk' || numberOrDefault(step.npcId, 0) !== (npcId >>> 0)) {
      continue;
    }

    for (const item of Array.isArray(step.consumeItems) ? step.consumeItems : []) {
      const quantity = Math.max(1, numberOrDefault(item.quantity, 1));
      const ownedQuantity =
        typeof matchItemRequirement === 'function'
          ? Math.max(0, numberOrDefault(matchItemRequirement(item), 0))
          : typeof getItemQuantity === 'function'
          ? Math.max(0, numberOrDefault(getItemQuantity(item.templateId >>> 0), 0))
          : 0;
      if (ownedQuantity < quantity) {
        events.push({
          type: 'item-missing',
          taskId: definition.id,
          definition,
          templateId: item.templateId >>> 0,
          quantity,
          itemName: item.name || '',
          reason: 'talk-missing-item',
        });
        return events;
      }
    }

    for (const item of Array.isArray(step.consumeItems) ? step.consumeItems : []) {
      events.push({
        type: 'item-consumed',
        taskId: definition.id,
        definition,
        templateId: item.templateId >>> 0,
        quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
        itemName: item.name || '',
        reason: 'talk-consume-item',
      });
    }

    appendGrantedItemEvents(events, definition, step.grantItems, 'talk-step-grant');
    advanceQuest(state, record, definition, events, 'talk');
    return events;
  }

  const availableQuest = QUEST_DEFINITIONS
    .filter((definition) => numberOrDefault(definition?.acceptNpcId, 0) === (npcId >>> 0))
    .sort((left, right) => left.id - right.id)
    .find((definition) => canAcceptQuest(state, definition));
  if (!availableQuest) {
    return [];
  }

  acceptQuest(state, availableQuest.id, events, 'talk-accept');
  return events;
}

function applyMonsterDefeat(state: QuestState, monsterId: number, count = 1): QuestEvent[] {
  const events: QuestEvent[] = [];

  for (const record of [...state.activeQuests]) {
    const definition = getQuestDefinition(record.id);
    const step = getCurrentStep(definition, record);
    if (!step || step.type !== 'kill' || numberOrDefault(step.monsterId, 0) !== monsterId) {
      continue;
    }

    const targetCount = Math.max(1, numberOrDefault(step.count, 1));
    const nextCount = Math.min(targetCount, numberOrDefault(record.progress?.count, 0) + Math.max(1, count));
    record.progress = {
      ...cloneProgress(record.progress),
      count: nextCount,
    };
    record.status = getQuestStatus(definition, record);

    if (nextCount >= targetCount && step.completeOnTalkAfterKill === true) {
      events.push({
        type: 'progress',
        taskId: definition!.id,
        definition: definition!,
        status: getQuestStatus(definition, record),
        stepDescription:
          typeof step.completionDescription === 'string' && step.completionDescription.length > 0
            ? step.completionDescription
            : getQuestStepDescription(definition, record),
        progressObjectiveId: getQuestProgressObjectiveId(definition, record),
        progressCount: getQuestProgressCount(definition, record),
        markerNpcId: getQuestMarkerNpcId(definition, record),
        reason: 'kill-ready-to-turn-in',
      });
      continue;
    }

    if (nextCount >= targetCount) {
      advanceQuest(state, record, definition!, events, 'kill-complete');
      continue;
    }

    events.push({
      type: 'progress',
      taskId: definition!.id,
      definition: definition!,
      status: getQuestStatus(definition, record),
      stepDescription: getQuestStepDescription(definition, record),
      progressObjectiveId: getQuestProgressObjectiveId(definition, record),
      progressCount: getQuestProgressCount(definition, record),
      reason: 'kill',
    });
  }

  return events;
}

function abandonQuest(state: QuestState, taskId: number): QuestEvent[] {
  const definition = getQuestDefinition(taskId);
  if (!definition) {
    return [];
  }
  const hadCompleted = state.completedQuests.includes(taskId);
  state.completedQuests = state.completedQuests.filter((completedTaskId) => completedTaskId !== taskId);
  const record = removeActiveQuest(state, taskId);
  if (!record && !hadCompleted) {
    return [];
  }
  return [
    {
      type: 'abandoned',
      taskId,
      definition,
      resetItemTemplateIds: collectQuestResetItemTemplateIds(definition),
    },
  ];
}

function collectQuestResetItemTemplateIds(definition: QuestDefinitionRecord | null): number[] {
  const templateIds = new Set<number>();

  for (const item of Array.isArray(definition?.acceptGrantItems) ? definition!.acceptGrantItems! : []) {
    if (Number.isInteger(item?.templateId) && item.templateId > 0) {
      templateIds.add(item.templateId >>> 0);
    }
  }

  for (const step of Array.isArray(definition?.steps) ? definition!.steps : []) {
    for (const item of Array.isArray(step?.grantItems) ? step.grantItems : []) {
      if (Number.isInteger(item?.templateId) && item.templateId > 0) {
        templateIds.add(item.templateId >>> 0);
      }
    }
  }

  return [...templateIds];
}

function buildQuestSyncState(state: QuestState): UnknownRecord[] {
  return state.activeQuests
    .map((record) => {
      const definition = getQuestDefinition(record.id);
      if (!definition) {
        return null;
      }
      return {
        taskId: definition.id,
        stepIndex: numberOrDefault(record.stepIndex, 0),
        status: getQuestStatus(definition, record),
        stepDescription: getQuestStepDescription(definition, record),
        progressObjectiveId: getQuestProgressObjectiveId(definition, record),
        progressCount: getQuestProgressCount(definition, record),
        stepType:
          typeof definition.steps?.[record.stepIndex]?.type === 'string'
            ? definition.steps[record.stepIndex].type
            : '',
      };
    })
    .filter(Boolean) as UnknownRecord[];
}

function cloneProgress(progress: unknown): UnknownRecord {
  return progress && typeof progress === 'object' ? { ...(progress as UnknownRecord) } : {};
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export {
  QUEST_DEFINITIONS,
  buildQuestSyncState,
  normalizeQuestState,
  reconcileAutoAccept,
  interactWithNpc,
  applyMonsterDefeat,
  abandonQuest,
  getQuestDefinition,
  getQuestProgressObjectiveId,
  getQuestMarkerNpcId,
};
