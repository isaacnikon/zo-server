'use strict';

const { getItemDefinition, grantItemToBag } = require('../inventory');
const { getRolePrimaryDrop } = require('../roleinfo');
const { sendGrantResultPackets, sendInventoryFullSync } = require('./inventory-runtime');
const { applyEffects } = require('../effects/effect-executor');

const DROP_RATE_SCALE = 100;

function rollSyntheticFightDrops(session, syntheticFight, options = {}) {
  if (!syntheticFight || !Array.isArray(syntheticFight.enemies) || syntheticFight.enemies.length === 0) {
    return emptyResult();
  }

  const suppressPackets = options.suppressPackets === true;
  const suppressDialogues = options.suppressDialogues === true;
  const roll = typeof options.random === 'function' ? options.random : Math.random;
  const effects = [];
  const dialogueEffects = [];
  const granted = [];
  const skipped = [];

  for (const enemy of syntheticFight.enemies) {
    const drops = [
      ...resolveEnemyDrops(enemy),
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
        dialogueEffects.push({
          kind: 'dialogue',
          title: 'Combat',
          message: `${enemy?.name || `Enemy ${enemy?.typeId || 0}`} dropped item ${drop.templateId}, but your pack is full.`,
        });
        continue;
      }

      const definition = grantResult.definition || getItemDefinition(drop.templateId);
      granted.push({
        enemyName: enemy?.name || `Enemy ${enemy?.typeId || 0}`,
        source: typeof drop?.source === 'string' ? drop.source : '',
        definition,
        item: grantResult.item,
        grantResult,
        quantity,
      });

      if (!suppressPackets) {
        sendGrantResultPackets(session, grantResult);
      }

      dialogueEffects.push({
        kind: 'dialogue',
        title: 'Combat',
        message: `${enemy?.name || `Enemy ${enemy?.typeId || 0}`} dropped ${definition?.name || `item ${drop.templateId}`} x${quantity}.`,
      });
    }
  }

  if (granted.length === 0 && skipped.length === 0) {
    return emptyResult();
  }

  if (granted.length > 0 && !suppressPackets) {
    sendInventoryFullSync(session);
  }

  // Apply dialogue effects via the shared executor
  if (dialogueEffects.length > 0) {
    applyEffects(session, dialogueEffects, {
      suppressPackets: true,
      suppressDialogues,
      suppressPersist: true,
    });
  }

  return {
    inventoryDirty: granted.length > 0,
    granted,
    skipped,
  };
}

function resolveEnemyDrops(enemy) {
  const explicitDrops = Array.isArray(enemy?.drops) ? enemy.drops : [];
  if (explicitDrops.length > 0) {
    return explicitDrops;
  }

  const primaryDrop = getRolePrimaryDrop(enemy?.typeId);
  return primaryDrop ? [primaryDrop] : [];
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
