'use strict';

const { grantItemToBag, consumeItemFromBag, getItemDefinition } = require('../inventory');
const {
  sendGrantResultPackets,
  sendConsumeResultPackets,
  sendInventoryFullSync,
} = require('../gameplay/inventory-runtime');
const { sendSelfStateValueUpdate } = require('../gameplay/stat-sync');
const { applyExperienceGain } = require('../gameplay/progression');

/**
 * Apply a list of game effects to a session, then batch-sync dirty state.
 *
 * Effects are the shared vocabulary across quest, combat, inventory, and NPC
 * systems. Each effect is a plain object like:
 *   { kind: 'grant-item', templateId: 20001, quantity: 1 }
 *   { kind: 'update-stat', stat: 'gold', delta: 100 }
 *   { kind: 'remove-item', templateId: 21115, quantity: 3 }
 *   { kind: 'dialogue', title: 'Quest', message: 'Done!' }
 *
 * Returns { statsDirty, inventoryDirty, messages }.
 */
function applyEffects(session, effects, options = {}) {
  const suppressPackets = options.suppressPackets === true;
  const suppressStatSync = options.suppressStatSync === true;
  const suppressDialogues = options.suppressDialogues === true;
  const suppressPersist = options.suppressPersist === true;
  let statsDirty = false;
  let inventoryDirty = false;
  const messages = [];

  for (const effect of effects) {
    const handler = EFFECT_HANDLERS[effect.kind];
    if (!handler) {
      continue;
    }
    const result = handler(session, effect, { suppressPackets, suppressDialogues });
    statsDirty = statsDirty || result.statsDirty === true;
    inventoryDirty = inventoryDirty || result.inventoryDirty === true;
    if (result.message) {
      messages.push(result.message);
    }
  }

  // Batch sync: send packets ONCE after all effects applied
  if (inventoryDirty && !suppressPackets) {
    sendInventoryFullSync(session);
  }
  if (statsDirty && !suppressStatSync) {
    session.sendSelfStateAptitudeSync();
  }
  if ((statsDirty || inventoryDirty) && !suppressPersist) {
    session.persistCurrentCharacter();
  }

  return { statsDirty, inventoryDirty, messages };
}

// --- Individual effect handlers ---

function handleGrantItem(session, effect, opts) {
  const quantity = Math.max(1, effect.quantity || 1);
  const grantResult = grantItemToBag(session, effect.templateId, quantity);
  if (!grantResult.ok) {
    if (!opts.suppressDialogues && typeof session.sendGameDialogue === 'function') {
      session.sendGameDialogue('System', `Could not add item: ${grantResult.reason}.`);
    }
    return { statsDirty: false, inventoryDirty: false };
  }
  if (!opts.suppressPackets) {
    sendGrantResultPackets(session, grantResult);
  }
  const definition = grantResult.definition || getItemDefinition(effect.templateId);
  return {
    statsDirty: false,
    inventoryDirty: true,
    message: `${definition?.name || `item ${effect.templateId}`} x${quantity}`,
  };
}

function handleRemoveItem(session, effect, opts) {
  const quantity = Math.max(1, effect.quantity || 1);
  const consumeResult = consumeItemFromBag(session, effect.templateId, quantity);
  if (!consumeResult.ok) {
    return { statsDirty: false, inventoryDirty: false };
  }
  if (!opts.suppressPackets) {
    sendConsumeResultPackets(session, consumeResult);
  }
  return { statsDirty: false, inventoryDirty: true };
}

function handleUpdateStat(session, effect, opts) {
  const stat = effect.stat;
  const delta = effect.delta || 0;
  if (delta === 0) {
    return { statsDirty: false, inventoryDirty: false };
  }

  if (stat === 'experience') {
    const progressionResult = applyExperienceGain(session, delta);
    session.level = progressionResult.level;
    session.experience = progressionResult.experience;
    session.statusPoints = progressionResult.statusPoints;
    if (!opts.suppressPackets && progressionResult.levelsGained === 0) {
      sendSelfStateValueUpdate(session, 'experience', session.experience);
    }
    return {
      statsDirty: true,
      inventoryDirty: false,
      message: `${delta} exp`,
    };
  }

  if (stat === 'gold' || stat === 'coins' || stat === 'renown') {
    session[stat] = (session[stat] || 0) + delta;
    if (!opts.suppressPackets) {
      sendSelfStateValueUpdate(session, stat, session[stat]);
    }
    return {
      statsDirty: true,
      inventoryDirty: false,
      message: `${delta} ${stat}`,
    };
  }

  return { statsDirty: false, inventoryDirty: false };
}

function handleDialogue(session, effect, opts) {
  if (!opts.suppressDialogues && typeof session.sendGameDialogue === 'function') {
    session.sendGameDialogue(effect.title || 'System', effect.message || '');
  }
  return { statsDirty: false, inventoryDirty: false };
}

function handleChangeScene(session, effect, _opts) {
  if (typeof session.transitionToScene === 'function') {
    session.transitionToScene(effect.mapId, effect.x, effect.y, 'effect');
  }
  return { statsDirty: false, inventoryDirty: false };
}

function handleSendScript(session, effect, opts) {
  if (opts.suppressPackets) {
    return { statsDirty: false, inventoryDirty: false };
  }
  if (effect.mode === 'deferred' && typeof session.sendServerRunScriptDeferred === 'function') {
    session.sendServerRunScriptDeferred(effect.scriptId);
  } else if (typeof session.sendServerRunScriptImmediate === 'function') {
    session.sendServerRunScriptImmediate(effect.scriptId);
  }
  return { statsDirty: false, inventoryDirty: false };
}

const EFFECT_HANDLERS = {
  'grant-item': handleGrantItem,
  'remove-item': handleRemoveItem,
  'update-stat': handleUpdateStat,
  'change-scene': handleChangeScene,
  'dialogue': handleDialogue,
  'send-script': handleSendScript,
};

module.exports = {
  applyEffects,
  EFFECT_HANDLERS,
};
