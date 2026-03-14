'use strict';

const SCENE_IDS = {
  RAINBOW_VALLEY: 101,
  BLING_ALLEY_1: 136,
  CELESTIAL_STATE: 204,
  SOUTH_GATE: 206,
  CLOUD_HALL: 207,
  COVERT_PALACE: 208,
  PEACH_GARDEN: 209,
  WEST_COUNTY_PASS: 210,
};

const SCENES = {
  [SCENE_IDS.RAINBOW_VALLEY]: {
    id: SCENE_IDS.RAINBOW_VALLEY,
    name: 'Rainbow Valley',
    worldSpawns: [
      { id: 3277, entityType: 3277, x: 21, y: 208, templateFlags: 0 },
      { id: 3276, entityType: 3276, x: 17, y: 169, templateFlags: 0 },
      { id: 3175, entityType: 3175, x: 68, y: 87, templateFlags: 0 },
      { id: 3004, entityType: 3004, x: 96, y: 154, templateFlags: 0 },
      { id: 3005, entityType: 3005, x: 82, y: 220, templateFlags: 0 },
      { id: 3180, entityType: 3180, x: 67, y: 186, templateFlags: 0 },
      { id: 3027, entityType: 3027, x: 57, y: 124, templateFlags: 0 },
      { id: 3029, entityType: 3029, x: 45, y: 21, templateFlags: 0 },
      { id: 3054, entityType: 3054, x: 91, y: 228, templateFlags: 0 },
      { id: 3156, entityType: 3156, x: 20, y: 235, templateFlags: 0 },
      { id: 3170, entityType: 3170, x: 89, y: 24, templateFlags: 0 },
      { id: 3172, entityType: 3172, x: 95, y: 64, templateFlags: 0 },
      { id: 3232, entityType: 3232, x: 119, y: 35, templateFlags: 0 },
      { id: 3233, entityType: 3233, x: 31, y: 100, templateFlags: 0 },
      { id: 3234, entityType: 3234, x: 71, y: 160, templateFlags: 0 },
      { id: 3217, entityType: 3217, x: 120, y: 173, templateFlags: 0 },
      { id: 3074, entityType: 3074, x: 102, y: 164, templateFlags: 0 },
      { id: 3038, entityType: 3038, x: 86, y: 159, templateFlags: 0 },
    ],
    metadataNpcs: [],
    demoNpcs: [],
    tileTriggers: [],
    triggers: [],
  },
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
      {
        type: 'serverRun',
        subtype: 0x02,
        mode: 0xfe,
        scriptId: 20001,
        action: {
          kind: 'transition',
          targetSceneId: SCENE_IDS.RAINBOW_VALLEY,
          targetX: 92,
          targetY: 228,
          reason: 'Apollo movie exit',
        },
      },
    ],
  },
  [SCENE_IDS.WEST_COUNTY_PASS]: {
    id: SCENE_IDS.WEST_COUNTY_PASS,
    name: 'West County Pass',
    worldSpawns: [
      { id: 3132, entityType: 3132, x: 81, y: 134, templateFlags: 0 },
      { id: 3173, entityType: 3173, x: 69, y: 120, templateFlags: 0 },
      { id: 3210, entityType: 3210, x: 26, y: 156, templateFlags: 0 },
      { id: 3133, entityType: 3133, x: 44, y: 133, templateFlags: 0 },
      { id: 3192, entityType: 3192, x: 50, y: 101, templateFlags: 0 },
      { id: 3192001, entityType: 3192, x: 63, y: 112, templateFlags: 0 },
      { id: 3138, entityType: 3138, x: 40, y: 161, templateFlags: 0 },
      { id: 3369, entityType: 3369, x: 36, y: 73, templateFlags: 0 },
    ],
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

function resolveServerRunTrigger(sceneId, subtype, scriptId, mode = null) {
  const scene = getScene(sceneId);
  if (!scene) {
    return null;
  }

  return scene.triggers.find((trigger) => (
    trigger.type === 'serverRun' &&
    trigger.subtype === subtype &&
    (trigger.mode === undefined || trigger.mode === mode) &&
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
