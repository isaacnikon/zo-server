'use strict';
export {};

const { ENABLE_DIALOG_EXPERIMENT, FORCE_START_SCENE, MAP_ID, SPAWN_X, SPAWN_Y } = require('./config');
const {
  SCENE_IDS,
  getSceneName,
  resolveEncounterTrigger,
  getSceneWorldSpawns,
  getTriggerAction,
  resolveServerRunTrigger,
  resolveTileTrigger,
} = require('./scenes');
type UnknownRecord = Record<string, any>;
type ScenePosition = { mapId: number; x: number; y: number };
type SceneAction = Record<string, any> | null;

const TOWN_SCENE_IDS = new Set([
  SCENE_IDS.RAINBOW_VALLEY,
  SCENE_IDS.BLING_ALLEY,
  SCENE_IDS.CELESTIAL_STATE,
  SCENE_IDS.SOUTH_GATE,
  SCENE_IDS.CLOUD_HALL,
  SCENE_IDS.COVERT_PALACE,
  SCENE_IDS.PEACH_GARDEN,
]);

const TOWN_RESPAWN_POINTS = {
  // Safe anchors use a stable nearby landmark, not the player's last exact tile:
  // - `shopkeeper`: towns with a merchant / service cluster
  // - `frog`: towns that should fall back near the teleporter frog
  [SCENE_IDS.RAINBOW_VALLEY]: { mapId: SCENE_IDS.RAINBOW_VALLEY, x: 68, y: 87, anchor: 'shopkeeper' },
  [SCENE_IDS.BLING_ALLEY]: { mapId: SCENE_IDS.BLING_ALLEY, x: 74, y: 120, anchor: 'shopkeeper' },
  [SCENE_IDS.CELESTIAL_STATE]: { mapId: SCENE_IDS.CELESTIAL_STATE, x: 64, y: 64, anchor: 'frog' },
  [SCENE_IDS.SOUTH_GATE]: { mapId: SCENE_IDS.SOUTH_GATE, x: 64, y: 96, anchor: 'frog' },
  [SCENE_IDS.CLOUD_HALL]: { mapId: SCENE_IDS.CLOUD_HALL, x: 58, y: 88, anchor: 'frog' },
  [SCENE_IDS.COVERT_PALACE]: { mapId: SCENE_IDS.COVERT_PALACE, x: 64, y: 128, anchor: 'shopkeeper' },
  [SCENE_IDS.PEACH_GARDEN]: { mapId: SCENE_IDS.PEACH_GARDEN, x: 64, y: 160, anchor: 'frog' },
};

function isTownScene(mapId: number): boolean {
  return TOWN_SCENE_IDS.has(mapId);
}

function getDefaultTownRespawn(mapId: number): ScenePosition {
  return TOWN_RESPAWN_POINTS[mapId] || TOWN_RESPAWN_POINTS[SCENE_IDS.RAINBOW_VALLEY];
}

function sanitizeTownRespawn(mapId: number, x: number, y: number): ScenePosition {
  const fallback = getDefaultTownRespawn(mapId);

  // Death respawn should land on a stable town safe point, not the exact last
  // persisted town tile. The anchor is intentionally per-town:
  // near the shopkeeper where available, otherwise near the teleporter frog.
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
  return getSceneWorldSpawns(mapId);
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

  return {
    kind: 'message',
    npcId: 3142,
    msgId: scriptId === 1 ? 1 : scriptId,
  };
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
  resolveTileSceneAction,
  resolveTownRespawn,
};
