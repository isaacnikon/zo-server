const { ENTITY_TYPE } = require('../config');
const { isFemaleRole } = require('../roleinfo');
const { createOwnedPet } = require('../pet-runtime');
const { applyEffects } = require('../effects/effect-executor');
const { sendSelfStateValueUpdate } = require('./stat-sync');

type UnknownRecord = Record<string, any>;
type SessionLike = Record<string, any>;

function applyQuestCompletionReward(
  session: SessionLike,
  reward: UnknownRecord,
  options: UnknownRecord = {}
): UnknownRecord {
  const suppressPackets = options.suppressPackets === true;
  const suppressDialogues = options.suppressDialogues === true;
  const normalizedReward = normalizeReward(resolveQuestRewardForSession(session, reward, options.taskId));
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

  const effectResult = applyEffects(session, effects, {
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
    const alreadyOwned = session.pets.some((pet: UnknownRecord) => (pet?.templateId >>> 0) === (petTemplateId >>> 0));
    if (alreadyOwned) {
      rewardMessages.push(`pet ${petTemplateId}`);
      continue;
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

function resolveQuestRewardForSession(session: SessionLike, reward: UnknownRecord, taskId: number): UnknownRecord {
  const normalizedReward = normalizeReward(reward);
  if (normalizedReward.choiceGroups.length > 0) {
    const selectedGroup = selectRewardChoiceGroupForSession(session, normalizedReward.choiceGroups);
    if (selectedGroup) {
      return {
        gold: selectedGroup.gold || normalizedReward.gold,
        experience: selectedGroup.experience || normalizedReward.experience,
        coins: selectedGroup.coins || normalizedReward.coins,
        renown: selectedGroup.renown || normalizedReward.renown,
        pets: normalizePetRewardList(session, selectedGroup.pets),
        items: selectedGroup.items.length > 0 ? selectedGroup.items : normalizedReward.items,
      };
    }
  }

  if ((taskId >>> 0) !== 2) {
    return normalizedReward;
  }

  if (normalizedReward.items.length > 0) {
    return normalizedReward;
  }

  return {
    ...normalizedReward,
    pets: normalizePetRewardList(session, normalizedReward.pets),
    items: resolveSpinningStarterSet(session),
  };
}

function selectRewardChoiceGroupForSession(session: SessionLike, choiceGroups: UnknownRecord[]): UnknownRecord | null {
  if (!Array.isArray(choiceGroups) || choiceGroups.length === 0) {
    return null;
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

function normalizePetRewardList(session: SessionLike, pets: unknown[]): number[] {
  if (!Array.isArray(pets) || pets.length === 0) {
    return [];
  }

  return pets
    .map((pet) => resolvePetTemplateId(session, pet))
    .filter((petTemplateId): petTemplateId is number => Number.isInteger(petTemplateId) && petTemplateId > 0);
}

function resolvePetTemplateId(session: SessionLike, pet: unknown): number {
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

function resolveSpinningStarterSet(session: SessionLike): UnknownRecord[] {
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

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export {
  applyQuestCompletionReward,
  sendSelfStateValueUpdate,
};
