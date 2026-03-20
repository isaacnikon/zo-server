const { GAME_DIALOG_MESSAGE_SUBCMD } = require('../config');
const { resolveInnRestVitals } = require('./session-flows');
const { executeServerRunAction, parseServerRunRequest } = require('../interactions/server-run');
const { openNpcShop } = require('./shop-runtime');
const { resolveNpcInteractionPlan } = require('./npc-interaction-registry');
const { sendSelfStateVitalsUpdate } = require('./stat-sync');
const {
  abandonQuest,
  buildServerRunQuestTrace,
} = require('../quest-engine');

type SessionLike = Record<string, any>;
type UnknownRecord = Record<string, any>;

function restoreAtInn(session: SessionLike, npcId: number): void {
  const restoredVitals = {
    health: Math.max(1, session.maxHealth || 1),
    mana: Math.max(0, session.maxMana || 0),
    rage: Math.max(0, session.maxRage || 0),
  };

  session.currentHealth = restoredVitals.health;
  session.currentMana = restoredVitals.mana;
  session.currentRage = restoredVitals.rage;

  sendSelfStateVitalsUpdate(session, restoredVitals);

  session.persistCurrentCharacter({
    currentHealth: restoredVitals.health,
    currentMana: restoredVitals.mana,
    currentRage: restoredVitals.rage,
  });

  session.sendGameDialogue('Innkeeper', 'You feel fully rested.', GAME_DIALOG_MESSAGE_SUBCMD, 0, null);
  session.log(
    `Rested at inn npcId=${npcId} restored hp/mp/rage=${restoredVitals.health}/${restoredVitals.mana}/${restoredVitals.rage}`
  );
}

function handleServerRunRequest(session: SessionLike, payload: Buffer): void {
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

  const plan = resolveNpcInteractionPlan(request);
  const action = plan.action;
  const fallbackAction = plan.fallbackAction;

  if (action?.kind === 'openShop') {
    openNpcShop(session, action.npcId || 0);
    return;
  }

  if (plan.probeNpcAction && typeof session.armNpcActionProbe === 'function') {
    session.armNpcActionProbe({
      subtype: request.subtype,
      npcId: request.npcId,
      mapId: request.mapId,
      x: request.x,
      y: request.y,
    });
  }

  if (typeof plan.logMessage === 'string' && plan.logMessage.length > 0) {
    session.log(plan.logMessage);
  }

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

  if (action) {
    executeServerRunAction(action, session.getServerRunActionHandlers());
    return;
  }

  if (!plan.continueToQuest) {
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

  const handledObjectiveEvent = session.dispatchObjectiveServerRun(questEventInput, 'server-run');
  if (handledObjectiveEvent) {
    return;
  }

  if (fallbackAction) {
    executeServerRunAction(fallbackAction, session.getServerRunActionHandlers());
  }
}

export {
  handleServerRunRequest,
  restoreAtInn,
};
