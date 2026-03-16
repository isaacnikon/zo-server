'use strict';

const { GAME_DIALOG_MESSAGE_SUBCMD } = require('../config');
const { resolveInnRestVitals } = require('./session-flows');
const {
  executeServerRunAction,
  parseServerRunRequest,
} = require('../interactions/server-run');
const { applyServerRunEvent, buildServerRunQuestTrace } = require('../quest-engine');
const { resolveServerRunAction } = require('../scene-runtime');

function restoreAtInn(session, npcId) {
  const restoredVitals = resolveInnRestVitals({
    health: session.currentHealth,
    mana: session.currentMana,
    rage: session.currentRage,
  });

  session.currentHealth = restoredVitals.health;
  session.currentMana = restoredVitals.mana;
  session.currentRage = restoredVitals.rage;

  session.persistCurrentCharacter({
    currentHealth: restoredVitals.health,
    currentMana: restoredVitals.mana,
    currentRage: restoredVitals.rage,
  });

  session.sendSelfStateAptitudeSync();
  session.sendGameDialogue(
    'Innkeeper',
    'You feel fully rested.',
    GAME_DIALOG_MESSAGE_SUBCMD,
    0,
    null
  );
  session.log(
    `Rested at inn npcId=${npcId} restored hp/mp/rage=${restoredVitals.health}/${restoredVitals.mana}/${restoredVitals.rage}`
  );
}

function handleServerRunRequest(session, payload) {
  const request = parseServerRunRequest(payload, {
    currentMapId: session.currentMapId,
    currentX: session.currentX,
    currentY: session.currentY,
  });

  if (request.kind === 'invalid') {
    session.log(request.reason);
    return;
  }

  if (request.kind === 'unhandled') {
    session.log(`Unhandled 0x03f1 subtype=0x${request.subtype.toString(16)}`);
    return;
  }

  session.log(request.logMessage);

  const action = resolveServerRunAction({
    mapId: request.mapId,
    subtype: request.subtype,
    mode: request.mode,
    scriptId: request.scriptId,
    x: request.x,
    y: request.y,
  });

  // Position-aware scene transitions reuse the same server-run family as NPC
  // callbacks. When a concrete transition matches, it must win over quest
  // script collisions in that hotspot.
  if (action?.kind === 'transition') {
    executeServerRunAction(action, session.getServerRunActionHandlers());
    return;
  }

  const questState = {
    activeQuests: session.activeQuests,
    completedQuests: session.completedQuests,
  };
  const questEventInput = {
    mapId: request.mapId,
    subtype: request.subtype,
    npcId: request.npcId,
    scriptId: request.scriptId,
    inventory: session.bagItems,
  };
  for (const line of buildServerRunQuestTrace(questState, questEventInput)) {
    session.log(line);
  }

  const questEvents = applyServerRunEvent(
    questState,
    questEventInput
  );
  if (questEvents.length > 0) {
    session.applyQuestEvents(questEvents, 'server-run');
    return;
  }

  if (request.kind === 'direct-rest') {
    restoreAtInn(session, request.npcId);
    return;
  }

  executeServerRunAction(action, session.getServerRunActionHandlers());
}

module.exports = {
  handleServerRunRequest,
  restoreAtInn,
};
