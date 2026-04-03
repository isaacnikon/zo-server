import { tryReadStaticJsonDocument } from '../db/static-json-store.js';
import { resolveRepoPath } from '../runtime-paths.js';
import { numberOrDefault, type UnknownRecord } from '../utils.js';

const QUEST_CATALOG_FILE = resolveRepoPath('data', 'quests', 'catalog.json');
const QUEST_OVERRIDE_FILE = resolveRepoPath('data', 'quests', 'main-story.overrides.json');
const CLIENT_TASKLIST_FILE = resolveRepoPath('data', 'client-derived', 'quests.json');

type QuestCategory =
  | 'main'
  | 'branch'
  | 'zodiac'
  | 'event'
  | 'holiday'
  | 'guild'
  | 'recycle'
  | 'marriage'
  | 'card'
  | 'daily'
  | 'roleplay'
  | 'unknown';

type QuestActionKind = 'consume-item' | 'grant-item' | 'set-progress-flag';
type QuestObjectiveKind = 'npc-interaction' | 'monster-defeat' | 'item-collect' | 'escort';
type QuestTriggerEvent = 'npc-interact' | 'monster-defeat';
type QuestInteractionTriggerKind = 'server-run';

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

interface QuestActionRecord {
  kind: QuestActionKind;
  item?: GrantedItem;
  flag?: string;
}

interface QuestObjectiveRecord {
  kind: QuestObjectiveKind;
  triggerEvent: QuestTriggerEvent;
  targetNpcId?: number;
  targetMonsterId?: number;
  targetCount: number;
  handInNpcId?: number;
  autoAdvance: boolean;
  requiredItems: GrantedItem[];
  requiredProgressFlag?: string;
  progressKey: string;
  grantItem?: GrantedItem;
  escortNpcId?: number;
}

interface QuestTrackerRecord {
  status: number;
  progressObjectiveId: number;
  markerNpcId: number;
}

interface QuestStepUiRecord {
  taskType: number;
  overNpcId: number;
  escortNpcId: number;
  taskRoleNpcId: number;
  maxAward: number;
  taskStep: number;
  trackerScriptIds?: number[];
}

interface QuestInteractionTriggerRecord {
  kind: QuestInteractionTriggerKind;
  stepStatus?: number;
  subtype?: number;
  npcId?: number;
  scriptId?: number;
  mapId?: number;
  contextId?: number;
  grantItems: GrantedItem[];
  consumeItems: GrantedItem[];
  setProgressFlag?: string;
  onlyIfMissingTemplateId?: number;
  combat?: {
    monsterId: number;
    count: number;
  } | null;
}

interface QuestStep {
  id: number;
  mapId?: number;
  description: string;
  completionDescription: string;
  objective: QuestObjectiveRecord;
  actions: QuestActionRecord[];
  tracker: QuestTrackerRecord;
  ui: QuestStepUiRecord;
}

interface QuestRewards {
  [key: string]: unknown;
  gold: number;
  experience: number;
  coins: number;
  renown: number;
  choiceGroups: RewardChoiceGroup[];
  items: GrantedItem[];
}

interface QuestDefinitionRecord {
  [key: string]: unknown;
  id: number;
  name: string;
  category: QuestCategory;
  acceptNpcId?: number;
  acceptSubtype?: number;
  acceptMessage: string;
  completionMessage: string;
  autoAccept: boolean;
  prerequisiteTaskIds: number[];
  exclusiveTaskIds: number[];
  minLevel: number;
  repeatable: boolean;
  acceptGrantItems?: GrantedItem[];
  nextQuestId?: number;
  rewards: QuestRewards;
  interactionTriggers: QuestInteractionTriggerRecord[];
  steps: QuestStep[];
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

interface ClientTasklistEntry {
  taskId: number;
  startNpcId: number;
  title: string;
  field11: number;
}

const QUEST_DEFINITIONS: readonly QuestDefinitionRecord[] = Object.freeze(loadQuestDefinitions());
const QUESTS_BY_ID = new Map<number, QuestDefinitionRecord>(
  QUEST_DEFINITIONS.map((quest) => [quest.id, quest])
);
const CLIENT_TASKLIST_ENTRIES: readonly ClientTasklistEntry[] = Object.freeze(loadClientTasklistEntries());
const CLIENT_TASKLIST_BY_ID = new Map<number, ClientTasklistEntry>(
  CLIENT_TASKLIST_ENTRIES.map((entry) => [entry.taskId, entry])
);

function loadQuestDefinitions(): QuestDefinitionRecord[] {
  const combinedSources = [
    ...loadQuestSourceFile(QUEST_CATALOG_FILE),
    ...loadQuestSourceFile(QUEST_OVERRIDE_FILE),
  ];
  const normalized = combinedSources
    .map((quest) => normalizeQuestDefinition(quest))
    .filter((quest): quest is QuestDefinitionRecord => Boolean(quest));

  const mergedById = new Map<number, QuestDefinitionRecord>();
  for (const quest of normalized) {
    mergedById.set(quest.id, quest);
  }
  return [...mergedById.values()].sort((left, right) => left.id - right.id);
}

function loadQuestSourceFile(filePath: string): UnknownRecord[] {
  const parsed = tryReadStaticJsonDocument<UnknownRecord>(filePath);
  return Array.isArray(parsed?.quests) ? parsed.quests : [];
}

function loadClientTasklistEntries(): ClientTasklistEntry[] {
  const parsed = tryReadStaticJsonDocument<UnknownRecord>(CLIENT_TASKLIST_FILE);
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  return entries
    .map((entry: UnknownRecord) => normalizeClientTasklistEntry(entry))
    .filter((entry: ClientTasklistEntry | null): entry is ClientTasklistEntry => Boolean(entry));
}

function normalizeClientTasklistEntry(source: UnknownRecord): ClientTasklistEntry | null {
  if (!Number.isInteger(source?.taskId) || source.taskId <= 0) {
    return null;
  }
  return {
    taskId: source.taskId >>> 0,
    startNpcId: Number.isInteger(source?.startNpcId) ? (source.startNpcId >>> 0) : 0,
    title: typeof source?.title === 'string' ? source.title : '',
    field11: Number.isInteger(source?.field11) ? (source.field11 >>> 0) : 0,
  };
}

function normalizeQuestDefinition(source: UnknownRecord): QuestDefinitionRecord | null {
  if (!Number.isInteger(source?.id) || !Array.isArray(source?.steps) || source.steps.length < 1) {
    return null;
  }

  const steps = source.steps
    .map((step: UnknownRecord, index: number) => normalizeQuestStep(step, index))
    .filter((step: QuestStep | null): step is QuestStep => Boolean(step));
  if (steps.length < 1) {
    return null;
  }

  const taskId = source.id >>> 0;
  const acceptGrantItems = normalizeGrantedItems(source?.acceptGrantItems);
  const normalizedDefinition: QuestDefinitionRecord = {
    id: taskId,
    name: typeof source?.name === 'string' ? source.name : `Quest ${source.id}`,
    category: normalizeQuestCategory(source?.category),
    acceptNpcId: Number.isInteger(source?.acceptNpcId) ? (source.acceptNpcId >>> 0) : undefined,
    acceptSubtype: Number.isInteger(source?.acceptSubtype) ? (source.acceptSubtype >>> 0) : undefined,
    acceptMessage: typeof source?.acceptMessage === 'string' ? source.acceptMessage : '',
    completionMessage: typeof source?.completionMessage === 'string' ? source.completionMessage : '',
    autoAccept: source?.autoAccept === true,
    prerequisiteTaskIds: normalizeTaskIdList(source?.prerequisiteTaskIds),
    exclusiveTaskIds: normalizeTaskIdList(source?.exclusiveTaskIds),
    minLevel: Math.max(1, numberOrDefault(source?.minLevel, 1)),
    repeatable: source?.repeatable === true,
    acceptGrantItems,
    nextQuestId: Number.isInteger(source?.nextQuestId) && source.nextQuestId > 0
      ? (source.nextQuestId >>> 0)
      : undefined,
    rewards: normalizeQuestRewards(source?.rewards),
    interactionTriggers: Array.isArray(source?.interactionTriggers)
      ? source.interactionTriggers
          .map((trigger: UnknownRecord) => normalizeInteractionTrigger(trigger))
          .filter((trigger: QuestInteractionTriggerRecord | null): trigger is QuestInteractionTriggerRecord => Boolean(trigger))
      : [],
    steps,
  };

  // Client scripts gate the Outcast renown interaction on quest item 21052.
  if (taskId === 811 && (!acceptGrantItems || acceptGrantItems.length < 1)) {
    normalizedDefinition.acceptGrantItems = [
      {
        templateId: 21052,
        quantity: 1,
        name: 'Info on Outcast',
      },
    ];
  }

  return normalizedDefinition;
}

function normalizeQuestCategory(value: unknown): QuestCategory {
  switch (value) {
    case 'main':
    case 'branch':
    case 'zodiac':
    case 'event':
    case 'holiday':
    case 'guild':
    case 'recycle':
    case 'marriage':
    case 'card':
    case 'daily':
    case 'roleplay':
      return value;
    default:
      return 'unknown';
  }
}

function normalizeGrantedItems(value: unknown): GrantedItem[] | undefined {
  const items = Array.isArray(value)
    ? value
        .map((item: UnknownRecord) => normalizeGrantedItem(item))
        .filter((item: GrantedItem | null): item is GrantedItem => Boolean(item))
    : [];
  return items.length > 0 ? items : undefined;
}

function normalizeGrantedItem(source: UnknownRecord): GrantedItem | null {
  if (!Number.isInteger(source?.templateId) || source.templateId <= 0) {
    return null;
  }

  return {
    templateId: source.templateId >>> 0,
    quantity: Math.max(1, numberOrDefault(source?.quantity, 1)),
    name: typeof source?.name === 'string' ? source.name : '',
    capturedMonsterId: Number.isInteger(source?.capturedMonsterId) && source.capturedMonsterId > 0
      ? (source.capturedMonsterId >>> 0)
      : undefined,
  };
}

function normalizeRewardChoiceGroup(source: UnknownRecord): RewardChoiceGroup | null {
  if (!source || typeof source !== 'object') {
    return null;
  }
  return {
    awardId: Number.isInteger(source?.awardId) ? (source.awardId >>> 0) : 0,
    gold: numberOrDefault(source?.gold, 0),
    experience: numberOrDefault(source?.experience, 0),
    coins: numberOrDefault(source?.coins, 0),
    renown: numberOrDefault(source?.renown, 0),
    pets: Array.isArray(source?.pets) ? source.pets.slice() : [],
    items: Array.isArray(source?.items)
      ? source.items
          .map((item: UnknownRecord) => normalizeGrantedItem(item))
          .filter((item: GrantedItem | null): item is GrantedItem => Boolean(item))
      : [],
  };
}

function normalizeQuestRewards(source: UnknownRecord): QuestRewards {
  return {
    gold: numberOrDefault(source?.gold, 0),
    experience: numberOrDefault(source?.experience, 0),
    coins: numberOrDefault(source?.coins, 0),
    renown: numberOrDefault(source?.renown, 0),
    choiceGroups: Array.isArray(source?.choiceGroups)
      ? source.choiceGroups
          .map((group: UnknownRecord) => normalizeRewardChoiceGroup(group))
          .filter((group: RewardChoiceGroup | null): group is RewardChoiceGroup => Boolean(group))
      : [],
    items: Array.isArray(source?.items)
      ? source.items
          .map((item: UnknownRecord) => normalizeGrantedItem(item))
          .filter((item: GrantedItem | null): item is GrantedItem => Boolean(item))
      : [],
  };
}

function normalizeQuestStep(source: UnknownRecord, index: number): QuestStep | null {
  const objective = normalizeQuestObjective(source?.objective);
  const tracker = normalizeQuestTracker(source?.tracker, objective);
  const ui = normalizeQuestStepUi(source?.ui, tracker, index + 1);
  if (!objective || !tracker || !ui) {
    return null;
  }

  return {
    id: Number.isInteger(source?.id) ? (source.id >>> 0) : index + 1,
    mapId: Number.isInteger(source?.mapId) ? (source.mapId >>> 0) : undefined,
    description: typeof source?.description === 'string' ? source.description : '',
    completionDescription: typeof source?.completionDescription === 'string' ? source.completionDescription : '',
    objective,
    actions: Array.isArray(source?.actions)
      ? source.actions
          .map((action: UnknownRecord) => normalizeQuestAction(action))
          .filter((action: QuestActionRecord | null): action is QuestActionRecord => Boolean(action))
      : [],
    tracker,
    ui,
  };
}

function normalizeQuestAction(source: UnknownRecord): QuestActionRecord | null {
  const kind = source?.kind;
  if (kind !== 'consume-item' && kind !== 'grant-item' && kind !== 'set-progress-flag') {
    return null;
  }
  const record: QuestActionRecord = { kind };
  if (kind === 'set-progress-flag') {
    record.flag = typeof source?.flag === 'string' ? source.flag : '';
    return record.flag ? record : null;
  }
  const item = normalizeGrantedItem(source?.item || source);
  if (!item) {
    return null;
  }
  record.item = item;
  return record;
}

function normalizeQuestObjective(source: UnknownRecord): QuestObjectiveRecord | null {
  const kind = source?.kind;
  if (
    kind !== 'npc-interaction' &&
    kind !== 'monster-defeat' &&
    kind !== 'item-collect' &&
    kind !== 'escort'
  ) {
    return null;
  }

  const requiredItems = Array.isArray(source?.requiredItems)
    ? source.requiredItems
        .map((item: UnknownRecord) => normalizeGrantedItem(item))
        .filter((item: GrantedItem | null): item is GrantedItem => Boolean(item))
    : [];

  return {
    kind,
    triggerEvent: source?.triggerEvent === 'monster-defeat' ? 'monster-defeat' : 'npc-interact',
    targetNpcId: Number.isInteger(source?.targetNpcId) ? (source.targetNpcId >>> 0) : undefined,
    targetMonsterId: Number.isInteger(source?.targetMonsterId) ? (source.targetMonsterId >>> 0) : undefined,
    targetCount: Math.max(1, numberOrDefault(source?.targetCount, 1)),
    handInNpcId: Number.isInteger(source?.handInNpcId) ? (source.handInNpcId >>> 0) : undefined,
    autoAdvance: source?.autoAdvance === true,
    requiredItems,
    requiredProgressFlag:
      typeof source?.requiredProgressFlag === 'string' && source.requiredProgressFlag.length > 0
        ? source.requiredProgressFlag
        : undefined,
    progressKey:
      typeof source?.progressKey === 'string' && source.progressKey.length > 0
        ? source.progressKey
        : 'count',
    grantItem: normalizeGrantedItem(source?.grantItem || null) || undefined,
    escortNpcId: Number.isInteger(source?.escortNpcId) ? (source.escortNpcId >>> 0) : undefined,
  };
}

function normalizeQuestTracker(
  source: UnknownRecord,
  objective: QuestObjectiveRecord | null
): QuestTrackerRecord | null {
  if (!objective) {
    return null;
  }
  return {
    status: Math.max(0, numberOrDefault(source?.status, 0)),
    progressObjectiveId:
      Number.isInteger(source?.progressObjectiveId) && source.progressObjectiveId > 0
        ? (source.progressObjectiveId >>> 0)
        : numberOrDefault(objective.targetMonsterId, 0),
    markerNpcId:
      Number.isInteger(source?.markerNpcId) && source.markerNpcId > 0
        ? (source.markerNpcId >>> 0)
        : numberOrDefault(objective.handInNpcId, numberOrDefault(objective.targetNpcId, 0)),
  };
}

function normalizeQuestStepUi(
  source: UnknownRecord,
  tracker: QuestTrackerRecord | null,
  fallbackStepIndex: number
): QuestStepUiRecord | null {
  if (!tracker) {
    return null;
  }
  return {
    taskType: Math.max(0, numberOrDefault(source?.taskType, 0)),
    overNpcId: Math.max(0, numberOrDefault(source?.overNpcId, numberOrDefault(tracker.markerNpcId, 0))),
    escortNpcId: Math.max(0, numberOrDefault(source?.escortNpcId, 0)),
    taskRoleNpcId: Math.max(0, numberOrDefault(source?.taskRoleNpcId, 0)),
    maxAward: Math.max(0, numberOrDefault(source?.maxAward, 0)),
    taskStep: Math.max(1, numberOrDefault(source?.taskStep, fallbackStepIndex)),
    trackerScriptIds: normalizeTaskIdList(source?.trackerScriptIds),
  };
}

function normalizeInteractionTrigger(source: UnknownRecord): QuestInteractionTriggerRecord | null {
  if (source?.kind !== 'server-run') {
    return null;
  }
  return {
    kind: 'server-run',
    stepStatus:
      Number.isInteger(source?.stepStatus) && source.stepStatus > 0
        ? (source.stepStatus >>> 0)
        : undefined,
    subtype:
      Number.isInteger(source?.subtype) && source.subtype > 0
        ? (source.subtype >>> 0)
        : undefined,
    npcId:
      Number.isInteger(source?.npcId) && source.npcId > 0
        ? (source.npcId >>> 0)
        : undefined,
    scriptId:
      Number.isInteger(source?.scriptId) && source.scriptId > 0
        ? (source.scriptId >>> 0)
        : undefined,
    mapId:
      Number.isInteger(source?.mapId) && source.mapId > 0
        ? (source.mapId >>> 0)
        : undefined,
    contextId:
      Number.isInteger(source?.contextId) && source.contextId > 0
        ? (source.contextId >>> 0)
        : undefined,
    grantItems: normalizeGrantedItems(source?.grantItems) || [],
    consumeItems: normalizeGrantedItems(source?.consumeItems) || [],
    setProgressFlag:
      typeof source?.setProgressFlag === 'string' && source.setProgressFlag.length > 0
        ? source.setProgressFlag
        : undefined,
    onlyIfMissingTemplateId:
      Number.isInteger(source?.onlyIfMissingTemplateId) && source.onlyIfMissingTemplateId > 0
        ? (source.onlyIfMissingTemplateId >>> 0)
        : undefined,
    combat:
      source?.combat &&
      Number.isInteger(source.combat?.monsterId) &&
      source.combat.monsterId > 0
        ? {
            monsterId: source.combat.monsterId >>> 0,
            count: Math.max(1, numberOrDefault(source.combat?.count, 1)),
          }
        : null,
  };
}

function normalizeTaskIdList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter(Number.isInteger).map((entry: number) => entry >>> 0))];
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

function getCurrentObjective(
  definition: QuestDefinitionRecord | null,
  record: QuestRecord | null
): QuestObjectiveRecord | null {
  return getCurrentStep(definition, record)?.objective || null;
}

function getCurrentStepUi(
  definition: QuestDefinitionRecord | null,
  record: QuestRecord | null
): QuestStepUiRecord | null {
  return getCurrentStep(definition, record)?.ui || null;
}

function getQuestTrackerStatus(definition: QuestDefinitionRecord | null, record: QuestRecord | null): number {
  const step = getCurrentStep(definition, record);
  if (!step) {
    return 0;
  }
  return numberOrDefault(step.tracker?.status, 0);
}

function getQuestStatus(definition: QuestDefinitionRecord | null, record: QuestRecord | null): number {
  if (!definition || !record) {
    return 0;
  }
  return numberOrDefault(record.status, 0);
}

function getQuestStepDescription(definition: QuestDefinitionRecord | null, record: QuestRecord | null): string {
  const step = getCurrentStep(definition, record);
  const objective = getCurrentObjective(definition, record);
  if (!step || !objective) {
    return '';
  }
  if (step.description) {
    return step.description;
  }
  switch (objective.kind) {
    case 'monster-defeat':
      return `Defeat ${objective.targetCount} enemies.`;
    case 'item-collect':
      return `Collect ${objective.targetCount} quest items.`;
    case 'escort':
      return 'Escort the quest target to safety.';
    default:
      return 'Speak with the quest target.';
  }
}

function getQuestProgressObjectiveId(definition: QuestDefinitionRecord | null, record?: QuestRecord | null): number {
  const step = getCurrentStep(definition, record || null);
  if (step?.tracker?.progressObjectiveId) {
    return numberOrDefault(step.tracker.progressObjectiveId, 0);
  }
  const objective = getCurrentObjective(definition, record || null);
  if (objective && (objective.kind === 'monster-defeat' || objective.kind === 'item-collect')) {
    return numberOrDefault(objective.targetMonsterId, 0);
  }
  return numberOrDefault(definition?.id, 0);
}

function getQuestProgressCount(definition: QuestDefinitionRecord | null, record: QuestRecord | null): number {
  const objective = getCurrentObjective(definition, record);
  if (!objective || !record) {
    return 0;
  }
  if (
    objective.kind !== 'monster-defeat' &&
    objective.kind !== 'item-collect'
  ) {
    return 0;
  }
  return Math.max(0, numberOrDefault(record.progress?.[objective.progressKey], 0));
}

function getQuestMarkerNpcId(definition: QuestDefinitionRecord | null, record: QuestRecord | null): number {
  const step = getCurrentStep(definition, record);
  if (!step) {
    return 0;
  }
  return numberOrDefault(step.tracker?.markerNpcId, 0);
}

function getClientTasklistEntry(taskId: number): ClientTasklistEntry | null {
  const normalizedTaskId = numberOrDefault(taskId, 0);
  if (normalizedTaskId <= 0) {
    return null;
  }
  return CLIENT_TASKLIST_BY_ID.get(normalizedTaskId) || null;
}

function isClientTasklistFamilyTask(taskId: number): boolean {
  const normalizedTaskId = numberOrDefault(taskId, 0);
  if (normalizedTaskId <= 0) {
    return false;
  }
  const entry = getClientTasklistEntry(normalizedTaskId);
  return entry !== null && entry.field11 > 0 && entry.field11 === normalizedTaskId;
}

export type {
  GrantedItem,
  RewardChoiceGroup,
  QuestActionRecord,
  QuestActionKind,
  QuestObjectiveRecord,
  QuestObjectiveKind,
  QuestInteractionTriggerRecord,
  QuestStepUiRecord,
  QuestTrackerRecord,
  QuestStep,
  QuestRewards,
  QuestDefinitionRecord,
  QuestRecord,
  QuestState,
  ClientTasklistEntry,
};

export {
  QUEST_CATALOG_FILE,
  QUEST_DEFINITIONS,
  QUESTS_BY_ID,
  loadQuestDefinitions,
  normalizeQuestDefinition,
  getQuestDefinition,
  getCurrentStep,
  getCurrentObjective,
  getCurrentStepUi,
  getQuestTrackerStatus,
  getQuestStatus,
  getQuestStepDescription,
  getQuestProgressObjectiveId,
  getQuestProgressCount,
  getQuestMarkerNpcId,
  getClientTasklistEntry,
  isClientTasklistFamilyTask,
};
