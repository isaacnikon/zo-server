'use strict';

const { getItemDefinition, grantItemToBag } = require('../inventory');
const { sendGrantResultPackets, sendInventoryFullSync } = require('./inventory-runtime');

const DROP_RATE_SCALE = 100;

function rollSyntheticFightDrops(session, syntheticFight, options = {}) {
  if (!syntheticFight || !Array.isArray(syntheticFight.enemies) || syntheticFight.enemies.length === 0) {
    return emptyResult();
  }

  const suppressPackets = options.suppressPackets === true;
  const suppressDialogues = options.suppressDialogues === true;
  const roll = typeof options.random === 'function' ? options.random : Math.random;
  const granted = [];
  const skipped = [];

  for (const enemy of syntheticFight.enemies) {
    const drops = [
      ...(Array.isArray(enemy?.drops) ? enemy.drops : []),
      ...resolveQuestConditionalDrops(session, enemy),
    ];
    for (const drop of drops) {
      const chance = Number.isFinite(drop?.chance) ? drop.chance : 0;
      const normalizedChance = Math.max(0, Math.min(DROP_RATE_SCALE, chance));
      if (normalizedChance <= 0) {
        continue;
      }
      if ((roll() * DROP_RATE_SCALE) >= normalizedChance) {
        continue;
      }

      const quantity = Math.max(1, Number.isInteger(drop?.quantity) ? drop.quantity : 1);
      const grantResult = grantItemToBag(session, drop.templateId, quantity);
      if (!grantResult.ok) {
        skipped.push({
          enemyName: enemy?.name || `Enemy ${enemy?.typeId || 0}`,
          templateId: drop.templateId >>> 0,
          reason: grantResult.reason,
        });
        continue;
      }

      granted.push({
        enemyName: enemy?.name || `Enemy ${enemy?.typeId || 0}`,
        source: typeof drop?.source === 'string' ? drop.source : '',
        definition: grantResult.definition || getItemDefinition(drop.templateId),
        item: grantResult.item,
        grantResult,
        quantity,
      });
    }
  }

  if (granted.length === 0 && skipped.length === 0) {
    return emptyResult();
  }

  if (!suppressPackets) {
    for (const drop of granted) {
      sendGrantResultPackets(session, drop.grantResult);
    }
    sendInventoryFullSync(session);
  }

  if (!suppressDialogues) {
    for (const drop of granted) {
      session.sendGameDialogue(
        'Combat',
        `${drop.enemyName} dropped ${drop.definition?.name || `item ${drop.item.templateId}`} x${drop.quantity}.`
      );
    }
    for (const miss of skipped) {
      session.sendGameDialogue(
        'Combat',
        `${miss.enemyName} dropped item ${miss.templateId}, but your pack is full.`
      );
    }
  }

  return {
    inventoryDirty: granted.length > 0,
    granted,
    skipped,
  };
}

function emptyResult() {
  return {
    inventoryDirty: false,
    granted: [],
    skipped: [],
  };
}

function resolveQuestConditionalDrops(session, enemy) {
  if (!enemy || !session || !Array.isArray(session.activeQuests)) {
    return [];
  }

  // Spinning(II): Candy asks for 10x Dragonfly's Sting (21115) from Dragonfly.
  // Keep this separate from the generic roleinfo-backed material drops.
  const spinningDragonflyStepActive = session.activeQuests.some(
    (quest) => quest?.id === 2 && quest?.stepIndex === 1
  );
  if (!spinningDragonflyStepActive || enemy.typeId !== 5001) {
    return [];
  }

  return [
    {
      templateId: 21115,
      chance: 100,
      quantity: 1,
      source: 'Spinning(II) active quest drop -> Dragonfly\'s Sting',
    },
  ];
}

module.exports = {
  DROP_RATE_SCALE,
  rollSyntheticFightDrops,
};
