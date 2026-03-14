'use strict';

const SCENE_IDS = {
  BLING_ALLEY_1: 136,
  CELESTIAL_STATE: 204,
  SOUTH_GATE: 206,
  CLOUD_HALL: 207,
  COVERT_PALACE: 208,
  PEACH_GARDEN: 209,
  WEST_COUNTY_PASS: 210,
};

const SCENES = {
  [SCENE_IDS.BLING_ALLEY_1]: {
    id: SCENE_IDS.BLING_ALLEY_1,
    name: 'Bling Alley 1',
    worldSpawns: [],
    metadataNpcs: [],
    demoNpcs: [],
    tileTriggers: [],
    triggers: [],
  },
  [SCENE_IDS.CELESTIAL_STATE]: {
    id: SCENE_IDS.CELESTIAL_STATE,
    name: 'Celestial State',
    worldSpawns: [],
    metadataNpcs: [],
    demoNpcs: [],
    tileTriggers: [],
    triggers: [],
  },
  [SCENE_IDS.SOUTH_GATE]: {
    id: SCENE_IDS.SOUTH_GATE,
    name: 'South Gate',
    worldSpawns: [
      { id: 3141, entityType: 3141, x: 57, y: 88, templateFlags: 0 },
      { id: 3325, entityType: 3325, x: 62, y: 82, templateFlags: 0 },
      { id: 3325001, entityType: 3325, x: 51, y: 94, templateFlags: 0 },
      { id: 3139, entityType: 3139, x: 27, y: 146, templateFlags: 0 },
      { id: 3139001, entityType: 3139, x: 111, y: 173, templateFlags: 0 },
      { id: 3140, entityType: 3140, x: 82, y: 76, templateFlags: 0 },
      { id: 3140001, entityType: 3140, x: 120, y: 52, templateFlags: 0 },
    ],
    metadataNpcs: [],
    demoNpcs: [],
    tileTriggers: [],
    triggers: [],
  },
  [SCENE_IDS.CLOUD_HALL]: {
    id: SCENE_IDS.CLOUD_HALL,
    name: 'Cloud Hall',
    worldSpawns: [
      { id: 3141, entityType: 3141, x: 57, y: 88, templateFlags: 0 },
      { id: 3325, entityType: 3325, x: 62, y: 82, templateFlags: 0 },
      { id: 3325001, entityType: 3325, x: 51, y: 94, templateFlags: 0 },
      { id: 3139, entityType: 3139, x: 27, y: 146, templateFlags: 0 },
      { id: 3139001, entityType: 3139, x: 111, y: 173, templateFlags: 0 },
      { id: 3140, entityType: 3140, x: 82, y: 76, templateFlags: 0 },
      { id: 3140001, entityType: 3140, x: 120, y: 52, templateFlags: 0 },
    ],
    metadataNpcs: [],
    demoNpcs: [],
    tileTriggers: [
      {
        sceneId: 1,
        action: {
          kind: 'serverRunBridge',
          subtype: 0x01,
          scriptId: 1,
          reason: 'Cloud Hall tile scene 1',
        },
      },
    ],
    triggers: [
      {
        type: 'serverRun',
        subtype: 0x01,
        scriptId: 1,
        action: {
          kind: 'transition',
          targetSceneId: SCENE_IDS.PEACH_GARDEN,
          targetX: 13,
          targetY: 205,
          reason: 'Cloud Hall teleporter',
        },
      },
    ],
  },
  [SCENE_IDS.COVERT_PALACE]: {
    id: SCENE_IDS.COVERT_PALACE,
    name: 'Covert Palace',
    worldSpawns: [
      { id: 3142, entityType: 3142, x: 115, y: 98, templateFlags: 0 },
      { id: 3144, entityType: 3144, x: 88, y: 138, templateFlags: 0 },
      { id: 3103, entityType: 3103, x: 57, y: 137, templateFlags: 0 },
      { id: 3136, entityType: 3136, x: 62, y: 132, templateFlags: 0 },
      { id: 3318, entityType: 3318, x: 122, y: 137, templateFlags: 0 },
      { id: 3315, entityType: 3315, x: 58, y: 79, templateFlags: 0 },
      { id: 3314, entityType: 3314, x: 66, y: 79, templateFlags: 0 },
      { id: 3147, entityType: 3147, x: 8, y: 127, templateFlags: 0 },
      { id: 3148, entityType: 3148, x: 6, y: 130, templateFlags: 0 },
      { id: 3320, entityType: 3320, x: 67, y: 163, templateFlags: 0 },
      { id: 3323, entityType: 3323, x: 101, y: 44, templateFlags: 0 },
      { id: 3323001, entityType: 3323, x: 105, y: 48, templateFlags: 0 },
      { id: 3324, entityType: 3324, x: 34, y: 128, templateFlags: 0 },
      { id: 3137, entityType: 3137, x: 101, y: 117, templateFlags: 0 },
      { id: 3326, entityType: 3326, x: 117, y: 129, templateFlags: 0 },
    ],
    metadataNpcs: [],
    demoNpcs: [],
    tileTriggers: [],
    triggers: [],
  },
  [SCENE_IDS.PEACH_GARDEN]: {
    id: SCENE_IDS.PEACH_GARDEN,
    name: 'Peach Garden',
    worldSpawns: [
      { id: 3142, entityType: 3142, x: 115, y: 98, templateFlags: 0 },
    ],
    metadataNpcs: [],
    demoNpcs: [
      { id: 3054, entityType: 3054, x: 117, y: 127, templateFlags: 0, name: 'Apollo' },
    ],
    tileTriggers: [],
    triggers: [
      {
        type: 'serverRun',
        subtype: 0x01,
        scriptId: 1,
        action: {
          kind: 'transition',
          targetSceneId: SCENE_IDS.CLOUD_HALL,
          targetX: 112,
          targetY: 21,
          reason: 'Peach Garden teleporter',
        },
      },
    ],
  },
  [SCENE_IDS.WEST_COUNTY_PASS]: {
    id: SCENE_IDS.WEST_COUNTY_PASS,
    name: 'West County Pass',
    worldSpawns: [],
    metadataNpcs: [],
    demoNpcs: [],
    tileTriggers: [],
    triggers: [],
  },
};

function getScene(sceneId) {
  return SCENES[sceneId] || null;
}

function getSceneName(sceneId) {
  return getScene(sceneId)?.name || `Map ${sceneId}`;
}

function getSceneWorldSpawns(sceneId) {
  return getScene(sceneId)?.worldSpawns || [];
}

function resolveServerRunTrigger(sceneId, subtype, scriptId) {
  const scene = getScene(sceneId);
  if (!scene) {
    return null;
  }

  return scene.triggers.find((trigger) => (
    trigger.type === 'serverRun' &&
    trigger.subtype === subtype &&
    trigger.scriptId === scriptId
  )) || null;
}

function resolveTileTrigger(sceneId, tileSceneId) {
  const scene = getScene(sceneId);
  if (!scene) {
    return null;
  }

  return scene.tileTriggers.find((trigger) => trigger.sceneId === tileSceneId) || null;
}

function getTriggerAction(trigger) {
  if (!trigger) {
    return null;
  }

  if (trigger.action) {
    return trigger.action;
  }

  if (trigger.targetSceneId !== undefined) {
    return {
      kind: 'transition',
      targetSceneId: trigger.targetSceneId,
      targetX: trigger.targetX,
      targetY: trigger.targetY,
      reason: trigger.reason,
    };
  }

  return null;
}

module.exports = {
  SCENE_IDS,
  SCENES,
  getScene,
  getSceneName,
  getSceneWorldSpawns,
  getTriggerAction,
  resolveServerRunTrigger,
  resolveTileTrigger,
};
