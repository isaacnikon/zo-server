'use strict';

const { GAME_DIALOG_MESSAGE_SUBCMD } = require('../config');
const { resolveInnRestVitals } = require('./session-flows');
const {
  executeServerRunAction,
  parseServerRunRequest,
} = require('../interactions/server-run');
const {
  applyServerRunEvent,
  abandonQuest,
  buildServerRunQuestTrace,
  resolveQuestServerRunAuxiliaryActions,
} = require('../quest-engine');
const { buildEncounterPoolEntry } = require('../roleinfo');
const { resolveServerRunAction } = require('../scene-runtime');

function restoreAtInn(session, npcId) {
  const player = session.getSyntheticPlayerFighter();
  const restoredVitals = resolveInnRestVitals({
    health: player?.maxHp || session.currentHealth,
    mana: player?.maxMp || session.currentMana,
    rage: player?.rage || session.currentRage,
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
  // The client sometimes lags one state refresh behind after inn callbacks.
  // A second short delayed sync makes the vitals panel rebind more reliably.
  setTimeout(() => {
    if (session.state !== 'LOGGED_IN') {
      return;
    }
    session.sendSelfStateAptitudeSync();
  }, 150);
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

  if (request.kind === 'quest-abandon') {
    const questState = {
      activeQuests: session.activeQuests,
      completedQuests: session.completedQuests,
    };
    const events = abandonQuest(questState, request.taskId);
    session.activeQuests = questState.activeQuests;
    session.completedQuests = questState.completedQuests;
    if (events.length > 0) {
      session.applyQuestEvents(events, 'server-run-abandon');
    }
    return;
  }

  const action = resolveServerRunAction({
    mapId: request.mapId,
    subtype: request.subtype,
    mode: request.mode,
    scriptId: request.scriptId,
    x: request.x,
    y: request.y,
  });

  // Concrete scene/service actions reuse the same server-run family as NPC
  // callbacks. When a concrete action matches, it must win over quest-script
  // collisions in that hotspot.
  if (action?.kind === 'transition' || action?.kind === 'rest') {
    executeServerRunAction(action, session.getServerRunActionHandlers());
    return;
  }

  const questState = {
    activeQuests: session.activeQuests,
    completedQuests: session.completedQuests,
    level: session.level,
  };
  const questEventInput = {
    mapId: request.mapId,
    subtype: request.subtype,
    contextId: request.contextId,
    extra: request.extra,
    npcId: request.npcId,
    scriptId: request.scriptId,
    inventory: session.bagItems,
  };
  for (const line of buildServerRunQuestTrace(questState, questEventInput)) {
    session.log(line);
  }

  const auxiliaryQuestEvents = resolveQuestServerRunAuxiliaryActions(
    questState,
    questEventInput
  );

  const immediateAuxiliaryEvents = [];
  let deferredQuestCombatTrigger = null;
  for (const event of auxiliaryQuestEvents) {
    if (event.type === 'quest-combat-trigger') {
      deferredQuestCombatTrigger = event;
      continue;
    }
    immediateAuxiliaryEvents.push(event);
  }

  if (immediateAuxiliaryEvents.length > 0) {
    session.applyQuestEvents(immediateAuxiliaryEvents, 'server-run-aux');
  }

  const questEvents = applyServerRunEvent(
    questState,
    questEventInput
  );
  if (questEvents.length > 0) {
    session.applyQuestEvents(questEvents, 'server-run');
    return;
  }

  if (deferredQuestCombatTrigger) {
    startQuestCombat(session, deferredQuestCombatTrigger);
    return;
  }

  executeServerRunAction(action, session.getServerRunActionHandlers());
}

function startQuestCombat(session, event) {
  const monsterId = event.monsterId >>> 0;
  session.sendCombatEncounterProbe({
    kind: 'encounterProbe',
    probeId: `quest-${event.taskId}-${monsterId}`,
    reason: `Quest scripted encounter task=${event.taskId}`,
    encounterProfile: {
      minEnemies: 1,
      maxEnemies: 1,
      encounterChancePercent: 100,
      pool: [
        buildEncounterPoolEntry(monsterId, {
          logicalId: monsterId,
          levelMin: 10,
          levelMax: 10,
          hpBase: 160,
          hpPerLevel: 8,
          weight: 1,
        }),
      ],
    },
    entityId: session.entityType,
  });
}

module.exports = {
  handleServerRunRequest,
  restoreAtInn,
};
