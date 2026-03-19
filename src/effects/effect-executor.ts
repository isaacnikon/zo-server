const { bagHasTemplateQuantity, grantItemToBag, consumeItemFromBag, getItemDefinition } = require('../inventory');
const {
  sendGrantResultPackets,
  sendConsumeResultPackets,
  sendInventoryFullSync,
} = require('../gameplay/inventory-runtime');
const { sendSelfStateValueUpdate } = require('../gameplay/stat-sync');
const { applyExperienceGain } = require('../gameplay/progression');
const { recomputeSessionMaxVitals } = require('../gameplay/session-flows');

type UnknownRecord = Record<string, any>;
type SessionLike = Record<string, any>;

function applyEffects(session: SessionLike, effects: UnknownRecord[], options: UnknownRecord = {}): UnknownRecord {
  const suppressPackets = options.suppressPackets === true;
  const suppressInventorySync = options.suppressInventorySync === true;
  const suppressStatSync = options.suppressStatSync === true;
  const suppressDialogues = options.suppressDialogues === true;
  const suppressPersist = options.suppressPersist === true;
  let statsDirty = false;
  let inventoryDirty = false;
  const messages: string[] = [];

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

  if (inventoryDirty && !suppressPackets && !suppressInventorySync) {
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

function handleGrantItem(session: SessionLike, effect: UnknownRecord, opts: UnknownRecord): UnknownRecord {
  const quantity = Math.max(1, effect.quantity || 1);
  if (effect.idempotent === true && bagHasTemplateQuantity(session, effect.templateId, quantity)) {
    return { statsDirty: false, inventoryDirty: false };
  }
  const grantResult = grantItemToBag(session, effect.templateId, quantity);
  if (!grantResult.ok) {
    if (!opts.suppressDialogues && typeof session.sendGameDialogue === 'function' && effect.dialoguePrefix) {
      session.sendGameDialogue(
        effect.dialoguePrefix,
        effect.failureMessage || `${effect.itemName || 'Item'} could not be added: ${grantResult.reason}.`
      );
    }
    return { statsDirty: false, inventoryDirty: false };
  }
  if (!opts.suppressPackets) {
    sendGrantResultPackets(session, grantResult);
  }
  const definition = grantResult.definition || getItemDefinition(effect.templateId);
  if (!opts.suppressDialogues && typeof session.sendGameDialogue === 'function' && effect.dialoguePrefix) {
    session.sendGameDialogue(
      effect.dialoguePrefix,
      effect.successMessage || `${effect.itemName || definition?.name || `item ${effect.templateId}`} was added to your pack.`
    );
  }
  return {
    statsDirty: false,
    inventoryDirty: true,
    message: `${definition?.name || `item ${effect.templateId}`} x${quantity}`,
  };
}

function handleRemoveItem(session: SessionLike, effect: UnknownRecord, opts: UnknownRecord): UnknownRecord {
  const quantity = Math.max(1, effect.quantity || 1);
  const consumeResult = consumeItemFromBag(session, effect.templateId, quantity);
  if (!consumeResult.ok) {
    if (!opts.suppressDialogues && typeof session.sendGameDialogue === 'function' && effect.dialoguePrefix) {
      session.sendGameDialogue(
        effect.dialoguePrefix,
        effect.failureMessage || `${effect.itemName || 'Item'} is required to continue.`
      );
    }
    return { statsDirty: false, inventoryDirty: false };
  }
  if (!opts.suppressPackets) {
    sendConsumeResultPackets(session, consumeResult);
  }
  if (!opts.suppressDialogues && typeof session.sendGameDialogue === 'function' && effect.dialoguePrefix) {
    session.sendGameDialogue(
      effect.dialoguePrefix,
      effect.successMessage || `${effect.itemName || 'Item'} was removed.`
    );
  }
  return { statsDirty: false, inventoryDirty: true };
}

function handleItemMissing(session: SessionLike, effect: UnknownRecord, opts: UnknownRecord): UnknownRecord {
  if (!opts.suppressDialogues && typeof session.sendGameDialogue === 'function' && effect.dialoguePrefix) {
    session.sendGameDialogue(
      effect.dialoguePrefix,
      effect.failureMessage || `${effect.itemName || 'Item'} is required to continue.`
    );
  }
  return { statsDirty: false, inventoryDirty: false };
}

function handleUpdateStat(session: SessionLike, effect: UnknownRecord, opts: UnknownRecord): UnknownRecord {
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
    recomputeSessionMaxVitals(session);
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

function handleDialogue(session: SessionLike, effect: UnknownRecord, opts: UnknownRecord): UnknownRecord {
  if (!opts.suppressDialogues && typeof session.sendGameDialogue === 'function') {
    session.sendGameDialogue(effect.title || 'System', effect.message || '');
  }
  return { statsDirty: false, inventoryDirty: false };
}

function handleChangeScene(session: SessionLike, effect: UnknownRecord): UnknownRecord {
  if (typeof session.transitionToScene === 'function') {
    session.transitionToScene(effect.mapId, effect.x, effect.y, 'effect');
  }
  return { statsDirty: false, inventoryDirty: false };
}

function handleSendScript(session: SessionLike, effect: UnknownRecord, opts: UnknownRecord): UnknownRecord {
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

const EFFECT_HANDLERS: Record<string, (session: SessionLike, effect: UnknownRecord, opts: UnknownRecord) => UnknownRecord> = {
  'grant-item': handleGrantItem,
  'remove-item': handleRemoveItem,
  'item-missing': handleItemMissing,
  'update-stat': handleUpdateStat,
  'change-scene': handleChangeScene,
  dialogue: handleDialogue,
  'send-script': handleSendScript,
};

export {
  applyEffects,
  EFFECT_HANDLERS,
};
