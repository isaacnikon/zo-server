'use strict';

const { ENABLE_DIALOG_EXPERIMENT, FORCE_START_SCENE, MAP_ID, SPAWN_X, SPAWN_Y } = require('./config');
const { getSceneName, getSceneWorldSpawns, resolveServerRunTrigger, resolveTileTrigger } = require('./scenes');

function resolveCharacterScene(character) {
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

function getBootstrapWorldSpawns(mapId) {
  return getSceneWorldSpawns(mapId);
}

function describeScene(mapId) {
  return getSceneName(mapId);
}

function resolveServerRunAction({ mapId, subtype, scriptId, enableDialogExperiment = ENABLE_DIALOG_EXPERIMENT }) {
  const transition = resolveServerRunTrigger(mapId, subtype, scriptId);
  if (transition) {
    return {
      kind: 'transition',
      targetSceneId: transition.targetSceneId,
      targetX: transition.targetX,
      targetY: transition.targetY,
      reason: transition.reason,
    };
  }

  if (enableDialogExperiment && mapId === 209 && scriptId === 1000) {
    return {
      kind: 'dialogue',
      speaker: 'Jade Emperor',
      message: 'Apollo will take you to the human world.',
      subtype: 0x05,
      flags: 0,
      extraText: '#0<00>Apollo will take you to the human world.\n\n#2<08><1000><0>\nGo to human world',
    };
  }

  return {
    kind: 'message',
    npcId: 3142,
    msgId: scriptId === 1 ? 1 : scriptId,
  };
}

function resolveTileSceneAction({ mapId, tileSceneId }) {
  const transition = resolveTileTrigger(mapId, tileSceneId);
  if (transition) {
    return {
      kind: 'transition',
      targetSceneId: transition.targetSceneId,
      targetX: transition.targetX,
      targetY: transition.targetY,
      reason: transition.reason || `tile scene ${tileSceneId}`,
    };
  }

  return {
    kind: 'unhandled',
    tileSceneId,
  };
}

module.exports = {
  describeScene,
  getBootstrapWorldSpawns,
  resolveCharacterScene,
  resolveServerRunAction,
  resolveTileSceneAction,
};
