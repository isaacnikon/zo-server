'use strict';
export {};

const { ENABLE_DIALOG_EXPERIMENT, FORCE_START_SCENE, MAP_ID, SPAWN_X, SPAWN_Y } = require('./config');
const { getSceneBootstrapWorldSpawns } = require('./map-npcs');
const {
  SCENE_IDS,
  SCENES,
  getSceneName,
  resolveEncounterTrigger,
  getTriggerAction,
  resolveServerRunTrigger,
  resolveTileTrigger,
} = require('./scenes');
type UnknownRecord = Record<string, any>;
type ScenePosition = { mapId: number; x: number; y: number };
type SceneAction = Record<string, any> | null;

const TOWN_SCENE_IDS = new Set(
  (Object.values(SCENES) as UnknownRecord[])
    .filter((scene) => scene?.isTown === true)
    .map((scene) => scene.id)
);

const TOWN_RESPAWN_POINTS = Object.fromEntries(
  (Object.values(SCENES) as UnknownRecord[])
    .filter((scene) => scene?.isTown === true && scene?.respawnPoint)
    .map((scene) => [scene.id, scene.respawnPoint])
);

function isTownScene(mapId: number): boolean {
  return TOWN_SCENE_IDS.has(mapId);
}

function getDefaultTownRespawn(mapId: number): ScenePosition {
  return TOWN_RESPAWN_POINTS[mapId] || TOWN_RESPAWN_POINTS[SCENE_IDS.RAINBOW_VALLEY] || {
    mapId: SCENE_IDS.RAINBOW_VALLEY,
    x: SPAWN_X,
    y: SPAWN_Y,
  };
}

function sanitizeTownRespawn(mapId: number, _x: number, _y: number): ScenePosition {
  const fallback = getDefaultTownRespawn(mapId);

  return {
    mapId,
    x: fallback.x,
    y: fallback.y,
  };
}

function resolveTownRespawn(character: UnknownRecord | null | undefined): ScenePosition {
  const source = character || {};
  if (FORCE_START_SCENE) {
    return {
      mapId: MAP_ID,
      x: SPAWN_X,
      y: SPAWN_Y,
    };
  }

  if (isTownScene(source.lastTownMapId)) {
    return sanitizeTownRespawn(
      source.lastTownMapId,
      source.lastTownX || getDefaultTownRespawn(source.lastTownMapId).x,
      source.lastTownY || getDefaultTownRespawn(source.lastTownMapId).y
    );
  }

  if (isTownScene(source.mapId)) {
    return sanitizeTownRespawn(
      source.mapId,
      source.x || getDefaultTownRespawn(source.mapId).x,
      source.y || getDefaultTownRespawn(source.mapId).y
    );
  }

  return getDefaultTownRespawn(SCENE_IDS.RAINBOW_VALLEY);
}

function resolveCharacterScene(character: UnknownRecord | null | undefined): ScenePosition {
  if (FORCE_START_SCENE) {
    return {
      mapId: MAP_ID,
      x: SPAWN_X,
      y: SPAWN_Y,
    };
  }

  return {
    mapId: character?.mapId || MAP_ID,
    x: character?.x || SPAWN_X,
    y: character?.y || SPAWN_Y,
  };
}

function getBootstrapWorldSpawns(mapId: number) {
  return getSceneBootstrapWorldSpawns(mapId);
}

function describeScene(mapId: number): string {
  return getSceneName(mapId);
}

function expandAction(
  action: UnknownRecord | null | undefined,
  context: UnknownRecord,
  enableDialogExperiment: boolean
): SceneAction {
  if (!action) {
    return null;
  }

  if (action.kind === 'serverRunBridge') {
    return resolveServerRunAction({
      mapId: context.mapId,
      subtype: action.subtype,
      scriptId: action.scriptId,
      mode: action.mode,
      contextId: action.contextId,
      extra: action.extra,
      enableDialogExperiment,
    });
  }

  return action;
}

function resolveServerRunAction({
  mapId,
  subtype,
  scriptId,
  mode = null,
  contextId = null,
  extra = null,
  x = null,
  y = null,
  enableDialogExperiment = ENABLE_DIALOG_EXPERIMENT,
}: UnknownRecord): SceneAction {
  const trigger = resolveServerRunTrigger(mapId, subtype, scriptId, mode, contextId, extra, x, y);
  const action: SceneAction = expandAction(getTriggerAction(trigger), { mapId, subtype, scriptId }, enableDialogExperiment);
  if (action) {
    return action;
  }

  return null;
}

function buildFallbackServerRunMessageAction({ scriptId }: UnknownRecord): SceneAction {
  return {
    kind: 'message',
    npcId: 3142,
    msgId: scriptId === 1 ? 1 : scriptId,
  };
}

function resolveServerRunActionWithFallback({
  mapId,
  subtype,
  scriptId,
  mode = null,
  contextId = null,
  extra = null,
  x = null,
  y = null,
  enableDialogExperiment = ENABLE_DIALOG_EXPERIMENT,
}: UnknownRecord): SceneAction {
  const action = resolveServerRunAction({
    mapId,
    subtype,
    scriptId,
    mode,
    contextId,
    extra,
    x,
    y,
    enableDialogExperiment,
  });
  if (action) {
    return action;
  }

  return buildFallbackServerRunMessageAction({ scriptId });
}

function resolveTileSceneAction({ mapId, tileSceneId, enableDialogExperiment = ENABLE_DIALOG_EXPERIMENT }: UnknownRecord): SceneAction {
  const trigger = resolveTileTrigger(mapId, tileSceneId);
  if (!trigger) {
    return null;
  }

  const action: SceneAction = expandAction(getTriggerAction(trigger), { mapId, tileSceneId }, enableDialogExperiment);
  if (action) {
    return action.kind === 'transition'
      ? {
        ...action,
        reason: action.reason || `tile scene ${tileSceneId}`,
      }
      : action;
  }

  return null;
}

function resolveEncounterAction({ mapId, x, y, enableDialogExperiment = ENABLE_DIALOG_EXPERIMENT }: UnknownRecord): SceneAction {
  const trigger = resolveEncounterTrigger(mapId, x, y);
  if (!trigger) {
    return null;
  }

  return expandAction(getTriggerAction(trigger), { mapId, x, y }, enableDialogExperiment);
}

module.exports = {
  describeScene,
  getBootstrapWorldSpawns,
  isTownScene,
  resolveCharacterScene,
  resolveEncounterAction,
  resolveServerRunAction,
  resolveServerRunActionWithFallback,
  resolveTileSceneAction,
  resolveTownRespawn,
};
