'use strict';

const { DEFAULT_FLAGS, ENTITY_TYPE, GAME_SELF_STATE_CMD } = require('../config');
const { isFemaleRole } = require('../roleinfo');
const { buildSelfStateValueUpdatePacket } = require('../protocol/gameplay-packets');
const { grantItemToBag } = require('../inventory');
const { sendGrantResultPackets, sendInventoryFullSync } = require('./inventory-runtime');
const { applyExperienceGain } = require('./progression');

const VALUE_UPDATE_DISCRIMINATORS = Object.freeze({
  gold: '$',
  coins: 'N',
  renown: '-',
  experience: '!',
});

function sendSelfStateValueUpdate(session, kind, value) {
  const discriminator = VALUE_UPDATE_DISCRIMINATORS[kind];
  if (!discriminator) {
    return;
  }

  session.writePacket(
    buildSelfStateValueUpdatePacket({
      discriminator: discriminator.charCodeAt(0),
      value,
    }),
    DEFAULT_FLAGS,
    `Sending self-state value update cmd=0x${GAME_SELF_STATE_CMD.toString(16)} kind=${kind} value=${value}`
  );
}

function applyQuestCompletionReward(session, reward, options = {}) {
  const suppressPackets = options.suppressPackets === true;
  const suppressDialogues = options.suppressDialogues === true;
  const normalizedReward = normalizeReward(resolveQuestRewardForSession(session, reward, options.taskId));
  const rewardMessages = [];
  let statsDirty = false;
  let inventoryDirty = false;
  let requiresFullStatSync = false;
  let levelSummary = null;

  if (normalizedReward.gold > 0) {
    session.gold += normalizedReward.gold;
    statsDirty = true;
    rewardMessages.push(`${normalizedReward.gold} gold`);
    if (!suppressPackets) {
      sendSelfStateValueUpdate(session, 'gold', session.gold);
    }
  }

  if (normalizedReward.coins > 0) {
    session.coins += normalizedReward.coins;
    statsDirty = true;
    rewardMessages.push(`${normalizedReward.coins} coin`);
    if (!suppressPackets) {
      sendSelfStateValueUpdate(session, 'coins', session.coins);
    }
  }

  if (normalizedReward.renown > 0) {
    session.renown += normalizedReward.renown;
    statsDirty = true;
    rewardMessages.push(`${normalizedReward.renown} renown`);
    if (!suppressPackets) {
      sendSelfStateValueUpdate(session, 'renown', session.renown);
    }
  }

  if (normalizedReward.experience > 0) {
    const progressionResult = applyExperienceGain(session, normalizedReward.experience);
    session.level = progressionResult.level;
    session.experience = progressionResult.experience;
    session.statusPoints = progressionResult.statusPoints;
    statsDirty = true;
    requiresFullStatSync = requiresFullStatSync || progressionResult.levelsGained > 0;
    rewardMessages.push(`${normalizedReward.experience} exp`);
    if (!suppressPackets && progressionResult.levelsGained === 0) {
      sendSelfStateValueUpdate(session, 'experience', session.experience);
    }
    if (progressionResult.levelsGained > 0) {
      levelSummary = progressionResult;
    }
  }

  for (const item of normalizedReward.items) {
    const grantResult = grantItemToBag(session, item.templateId, item.quantity);
    if (!grantResult.ok) {
      if (!suppressDialogues) {
        session.sendGameDialogue('Quest', `${item.name || 'Reward item'} could not be added: ${grantResult.reason}.`);
      }
      continue;
    }

    inventoryDirty = true;
    rewardMessages.push(`${grantResult.definition.name} x${item.quantity}`);
    if (!suppressPackets) {
      sendGrantResultPackets(session, grantResult);
    }
  }

  if (inventoryDirty && !suppressPackets) {
    sendInventoryFullSync(session);
  }

  return {
    statsDirty,
    inventoryDirty,
    requiresFullStatSync,
    rewardMessages,
    levelSummary,
  };
}

function resolveQuestRewardForSession(session, reward, taskId) {
  if ((taskId >>> 0) !== 2) {
    return reward;
  }

  const normalizedReward = normalizeReward(reward);
  if (normalizedReward.items.length > 0) {
    return normalizedReward;
  }

  return {
    ...normalizedReward,
    items: resolveSpinningStarterSet(session),
  };
}

function resolveSpinningStarterSet(session) {
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

function isFemaleStarterRoleFallback(roleEntityType) {
  if (roleEntityType >= 1001 && roleEntityType <= 1024) {
    return (roleEntityType & 1) === 0;
  }

  const templateIndex = Math.max(0, roleEntityType - ENTITY_TYPE);
  return (templateIndex & 1) === 1;
}

function normalizeReward(reward) {
  return {
    gold: numberOrDefault(reward?.gold, 0),
    experience: numberOrDefault(reward?.experience, 0),
    coins: numberOrDefault(reward?.coins, 0),
    renown: numberOrDefault(reward?.renown, 0),
    items: Array.isArray(reward?.items)
      ? reward.items
          .filter((item) => Number.isInteger(item?.templateId))
          .map((item) => ({
            templateId: item.templateId >>> 0,
            quantity: Math.max(1, numberOrDefault(item.quantity, 1)),
            name: typeof item.name === 'string' ? item.name : '',
          }))
      : [],
  };
}

function numberOrDefault(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

module.exports = {
  applyQuestCompletionReward,
  sendSelfStateValueUpdate,
};
