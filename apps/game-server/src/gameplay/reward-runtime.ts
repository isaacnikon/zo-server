import { ENTITY_TYPE } from '../config.js';
import { isFemaleRole } from '../roleinfo/index.js';
import { createOwnedPet } from '../pet-runtime.js';
import { applyEffects } from '../effects/effect-executor.js';
import { sendSelfStateValueUpdate } from './stat-sync.js';
import { ensureRenownTaskDailyState, RENOWN_TASK_ID, RENOWN_TASK_STREAK_TARGET } from './renown-task-runtime.js';
import { numberOrDefault, type UnknownRecord } from '../utils.js';
import type { GameSession } from '../types.js';

const BEHIND_CURTAIN_REWARD_ITEMS: Record<number, { templateId: number; name: string }[]> = {
  0: [
    { templateId: 27008, name: 'Epee Chop' },
    { templateId: 27010, name: 'Fire Ball' },
    { templateId: 27011, name: 'Frost Bolt' },
  ],
  1: [
    { templateId: 27001, name: 'Enervate' },
    { templateId: 27003, name: 'Bleed' },
    { templateId: 27009, name: 'Defiant' },
  ],
  2: [
    { templateId: 27002, name: 'Double Hit' },
    { templateId: 27004, name: 'Easy Attack' },
    { templateId: 27011, name: 'Frost Bolt' },
  ],
  3: [
    { templateId: 27006, name: 'Icy Assault' },
    { templateId: 27005, name: 'Agilely Attack' },
    { templateId: 27012, name: 'Cure' },
  ],
  4: [
    { templateId: 27002, name: 'Double Hit' },
    { templateId: 27008, name: 'Epee Chop' },
    { templateId: 27010, name: 'Fire Ball' },
  ],
  5: [
    { templateId: 27003, name: 'Bleed' },
    { templateId: 27009, name: 'Defiant' },
    { templateId: 27012, name: 'Cure' },
  ],
  6: [
    { templateId: 27004, name: 'Easy Attack' },
    { templateId: 27006, name: 'Icy Assault' },
    { templateId: 27007, name: 'Pet Healing' },
  ],
  7: [
    { templateId: 27004, name: 'Easy Attack' },
    { templateId: 27010, name: 'Fire Ball' },
    { templateId: 27011, name: 'Frost Bolt' },
  ],
  8: [
    { templateId: 27005, name: 'Agilely Attack' },
    { templateId: 27006, name: 'Icy Assault' },
    { templateId: 27007, name: 'Pet Healing' },
  ],
  9: [
    { templateId: 27007, name: 'Pet Healing' },
    { templateId: 27008, name: 'Epee Chop' },
    { templateId: 27012, name: 'Cure' },
  ],
  10: [
    { templateId: 27001, name: 'Enervate' },
    { templateId: 27002, name: 'Double Hit' },
    { templateId: 27005, name: 'Agilely Attack' },
  ],
  11: [
    { templateId: 27001, name: 'Enervate' },
    { templateId: 27003, name: 'Bleed' },
    { templateId: 27009, name: 'Defiant' },
  ],
};

async function applyQuestCompletionReward(
  session: GameSession,
  reward: UnknownRecord,
  options: UnknownRecord = {}
): Promise<UnknownRecord> {
  const suppressPackets = options.suppressPackets === true;
  const suppressDialogues = options.suppressDialogues === true;
  const normalizedReward = normalizeReward(
    resolveQuestRewardForSession(session, reward, options.taskId, options.selectedAwardId)
  );
  let petsDirty = false;
  let requiresFullStatSync = false;
  let levelSummary: UnknownRecord | null = null;

  const effects: UnknownRecord[] = [];

  if (normalizedReward.gold > 0) {
    effects.push({ kind: 'update-stat', stat: 'gold', delta: normalizedReward.gold });
  }
  if (normalizedReward.coins > 0) {
    effects.push({ kind: 'update-stat', stat: 'coins', delta: normalizedReward.coins });
  }
  if (normalizedReward.renown > 0) {
    effects.push({ kind: 'update-stat', stat: 'renown', delta: normalizedReward.renown });
  }
  if (normalizedReward.experience > 0) {
    effects.push({ kind: 'update-stat', stat: 'experience', delta: normalizedReward.experience });
  }

  for (const item of normalizedReward.items) {
    effects.push({ kind: 'grant-item', templateId: item.templateId, quantity: item.quantity });
  }

  const effectResult = await applyEffects(session, effects, {
    suppressPackets,
    suppressDialogues,
    suppressStatSync: true,
    suppressPersist: true,
  });

  if (normalizedReward.experience > 0) {
    const previousLevel = options._prevLevel || 1;
    const previousStatusPoints = options._prevStatusPoints || 0;
    if (session.level > previousLevel) {
      requiresFullStatSync = true;
      levelSummary = {
        levelsGained: session.level - previousLevel,
        statusPointsGained: session.statusPoints - previousStatusPoints,
        level: session.level,
        experience: session.experience,
        statusPoints: session.statusPoints,
      };
    }
  }

  const rewardMessages = effectResult.messages.slice();
  for (const petTemplateId of normalizedReward.pets) {
    if (!Number.isInteger(petTemplateId) || petTemplateId <= 0) {
      continue;
    }
    if (!Array.isArray(session.pets)) {
      session.pets = [];
    }
    session.pets.push(createOwnedPet(petTemplateId >>> 0, {}, session.pets.length));
    petsDirty = true;
    rewardMessages.push(resolvePetRewardName(petTemplateId));
  }

  return {
    statsDirty: effectResult.statsDirty || petsDirty,
    inventoryDirty: effectResult.inventoryDirty,
    petsDirty,
    requiresFullStatSync,
    rewardMessages,
    levelSummary,
  };
}

function resolveQuestRewardForSession(
  session: GameSession,
  reward: UnknownRecord,
  taskId: number,
  selectedAwardId = 0
): UnknownRecord {
  const normalizedTaskId = taskId >>> 0;
  const normalizedReward = normalizeReward(reward);
  let resolvedReward = normalizedReward;
  if (normalizedTaskId === 353) {
    resolvedReward = resolveBehindCurtainRewardForSession(session, normalizedReward, selectedAwardId);
  } else if (normalizedReward.choiceGroups.length > 0) {
    const selectedGroup = selectRewardChoiceGroupForSession(session, normalizedReward.choiceGroups, selectedAwardId);
    if (selectedGroup) {
      resolvedReward = {
        gold: selectedGroup.gold || normalizedReward.gold,
        experience: selectedGroup.experience || normalizedReward.experience,
        coins: selectedGroup.coins || normalizedReward.coins,
        renown: selectedGroup.renown || normalizedReward.renown,
        pets: normalizePetRewardList(session, selectedGroup.pets),
        items: selectedGroup.items.length > 0 ? selectedGroup.items : normalizedReward.items,
      };
    }
  }

  if (normalizedTaskId === RENOWN_TASK_ID) {
    const renownTaskState = ensureRenownTaskDailyState(session);
    if (renownTaskState.firstTwentyStreakToday < RENOWN_TASK_STREAK_TARGET) {
      resolvedReward = {
        ...resolvedReward,
        experience: Math.max(0, resolvedReward.experience * 2),
      };
    } else {
      resolvedReward = {
        ...resolvedReward,
        gold: 0,
        coins: 0,
        experience: resolvedReward.experience > 0 ? Math.max(0, Math.floor(resolvedReward.experience / 2)) : 0,
        renown: 0,
      };
    }
  }

  if (normalizedTaskId !== 2) {
    return resolvedReward;
  }

  if (resolvedReward.items.length > 0) {
    return resolvedReward;
  }

  return {
    ...resolvedReward,
    pets: normalizePetRewardList(session, resolvedReward.pets),
    items: resolveSpinningStarterSet(session),
  };
}

function resolveBehindCurtainRewardForSession(
  session: GameSession,
  normalizedReward: UnknownRecord,
  selectedAwardId = 0
): UnknownRecord {
  const aptitude = clampAptitudeIndex(session?.selectedAptitude);
  const rewardItems = BEHIND_CURTAIN_REWARD_ITEMS[aptitude] || BEHIND_CURTAIN_REWARD_ITEMS[0];
  const choiceGroups = rewardItems.map((item, index) => ({
    awardId: index + 1,
    gold: normalizedReward.gold,
    experience: normalizedReward.experience,
    coins: normalizedReward.coins,
    renown: normalizedReward.renown,
    pets: [],
    items: [{ ...item, quantity: 1 }],
  }));

  return {
    ...normalizedReward,
    choiceGroups,
    items:
      (choiceGroups.find((group) => numberOrDefault(group?.awardId, 0) === selectedAwardId) || choiceGroups[0])?.items ||
      [],
  };
}

function selectRewardChoiceGroupForSession(
  session: GameSession,
  choiceGroups: UnknownRecord[],
  selectedAwardId = 0
): UnknownRecord | null {
  if (!Array.isArray(choiceGroups) || choiceGroups.length === 0) {
    return null;
  }

  if (selectedAwardId > 0) {
    const explicitSelection =
      choiceGroups.find((group) => numberOrDefault(group?.awardId, 0) === selectedAwardId) || null;
    if (explicitSelection) {
      return explicitSelection;
    }
  }

  const petBearingGroup = choiceGroups.find((group) => Array.isArray(group?.pets) && group.pets.length > 0);
  if (petBearingGroup) {
    return petBearingGroup;
  }

  if (choiceGroups.length === 2) {
    const roleEntityType = (session?.roleEntityType || session?.entityType || ENTITY_TYPE) >>> 0;
    return isFemaleRole(roleEntityType) || isFemaleStarterRoleFallback(roleEntityType)
      ? choiceGroups[1]
      : choiceGroups[0];
  }

  return choiceGroups[0];
}

function normalizePetRewardList(session: GameSession, pets: unknown[]): number[] {
  if (!Array.isArray(pets) || pets.length === 0) {
    return [];
  }

  return pets
    .map((pet) => resolvePetTemplateId(session, pet))
    .filter((petTemplateId): petTemplateId is number => Number.isInteger(petTemplateId) && petTemplateId > 0);
}

function resolvePetTemplateId(session: GameSession, pet: unknown): number {
  if (Number.isInteger(pet)) {
    return (pet as number) >>> 0;
  }
  if (pet === 'i') {
    const aptitude = Math.max(1, Math.min(12, Number(session?.selectedAptitude) || 1));
    return 2000 + aptitude;
  }
  return 0;
}

function resolvePetRewardName(petTemplateId: number): string {
  const zodiacPets: Record<number, string> = {
    2001: 'Rat pet',
    2002: 'Ox pet',
    2003: 'Tiger pet',
    2004: 'Rabbit pet',
    2005: 'Dragon pet',
    2006: 'Snake pet',
    2007: 'Horse pet',
    2008: 'Sheep pet',
    2009: 'Monkey pet',
    2010: 'Rooster pet',
    2011: 'Dog pet',
    2012: 'Pig pet',
  };
  return zodiacPets[petTemplateId] || `pet ${petTemplateId}`;
}

function resolveSpinningStarterSet(session: GameSession): UnknownRecord[] {
  const roleEntityType = (session?.roleEntityType || session?.entityType || ENTITY_TYPE) >>> 0;

  if (isFemaleRole(roleEntityType) || isFemaleStarterRoleFallback(roleEntityType)) {
    return [
      { templateId: 15001, quantity: 1, name: 'Red Headband' },
      { templateId: 18001, quantity: 1, name: 'Embroidered Shoes' },
    ];
  }

  return [
    { templateId: 10001, quantity: 1, name: 'Light Headscarf' },
    { templateId: 13001, quantity: 1, name: 'Shoes' },
  ];
}

function isFemaleStarterRoleFallback(roleEntityType: number): boolean {
  if (roleEntityType >= 1001 && roleEntityType <= 1024) {
    return (roleEntityType & 1) === 0;
  }

  const templateIndex = Math.max(0, roleEntityType - ENTITY_TYPE);
  return (templateIndex & 1) === 1;
}

function normalizeReward(reward: UnknownRecord): UnknownRecord {
  return {
    gold: numberOrDefault(reward?.gold, 0),
    experience: numberOrDefault(reward?.experience, 0),
    coins: numberOrDefault(reward?.coins, 0),
    renown: numberOrDefault(reward?.renown, 0),
    pets: Array.isArray(reward?.pets) ? reward.pets.slice() : [],
    choiceGroups: Array.isArray(reward?.choiceGroups)
      ? reward.choiceGroups.map((group: UnknownRecord) => ({
          awardId: numberOrDefault(group?.awardId, 0),
          gold: numberOrDefault(group?.gold, 0),
          experience: numberOrDefault(group?.experience, 0),
          coins: numberOrDefault(group?.coins, 0),
          renown: numberOrDefault(group?.renown, 0),
          pets: Array.isArray(group?.pets) ? group.pets.slice() : [],
          items: Array.isArray(group?.items)
            ? group.items
                .filter((item: UnknownRecord) => Number.isInteger(item?.templateId))
                .map((item: UnknownRecord) => ({
                  templateId: item.templateId >>> 0,
                  quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
                  name: typeof item.name === 'string' ? item.name : '',
                }))
            : [],
        }))
      : [],
    items: Array.isArray(reward?.items)
      ? reward.items
          .filter((item: UnknownRecord) => Number.isInteger(item?.templateId))
          .map((item: UnknownRecord) => ({
            templateId: item.templateId >>> 0,
            quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
            name: typeof item.name === 'string' ? item.name : '',
          }))
      : [],
  };
}


function clampAptitudeIndex(value: unknown): number {
  if (!Number.isInteger(value)) {
    return 0;
  }
  return Math.max(0, Math.min(11, (value as number) >>> 0));
}

export {
  applyQuestCompletionReward,
  sendSelfStateValueUpdate,
};
