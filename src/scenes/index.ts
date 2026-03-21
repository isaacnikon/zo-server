'use strict';
export {};

const fs = require('fs');
const { resolveRepoPath } = require('../runtime-paths');
const { buildEncounterPoolForLocation, getOrdinaryMonsterRoleIdsForLocation } = require('../roleinfo');

type UnknownRecord = Record<string, any>;

const SCENE_DATA_FILE = resolveRepoPath('data', 'scenes', 'scenes.json');

const RAW_SCENE_DATA = loadSceneData();

const SCENE_IDS: Record<string, number> = RAW_SCENE_DATA.sceneIds;

const SCENES: Record<number, UnknownRecord> = buildScenes(RAW_SCENE_DATA);

function loadSceneData(): any {
  const raw = fs.readFileSync(SCENE_DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

function buildScenes(data: any): Record<number, UnknownRecord> {
  const scenes: Record<number, UnknownRecord> = {};
  for (const [idStr, scene] of Object.entries(data.scenes) as [string, any][]) {
    const sceneId = Number(idStr);
    const encounterProfile = resolveEncounterProfile(scene.encounterProfile);
    const encounterTriggers = Array.isArray(scene.encounterTriggers) && scene.encounterTriggers.length > 0
      ? scene.encounterTriggers.map((trigger: any) => ({
          ...trigger,
          action: trigger.action?.encounterProfile
            ? {
                ...trigger.action,
                encounterProfile: resolveEncounterProfile(trigger.action.encounterProfile),
              }
            : trigger.action,
        }))
      : buildDefaultEncounterTriggers(scene, encounterProfile);
    scenes[sceneId] = {
      ...scene,
      encounterProfile,
      encounterTriggers,
    };
  }

  return scenes;
}

function resolveEncounterProfile(profile: UnknownRecord | null | undefined): UnknownRecord | null {
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const locationName =
    typeof profile.locationName === 'string' && profile.locationName.length > 0
      ? profile.locationName
      : null;
  if (!locationName) {
    return null;
  }

  const roleOverrides =
    profile.roleOverrides && typeof profile.roleOverrides === 'object'
      ? profile.roleOverrides
      : {};

  return {
    source: profile.source,
    minEnemies: profile.minEnemies,
    maxEnemies: profile.maxEnemies,
    encounterChancePercent: profile.encounterChancePercent,
    cooldownMs: profile.cooldownMs,
    locationName,
    pool: buildEncounterPoolForLocation(locationName, roleOverrides),
  };
}

function buildDefaultEncounterTriggers(scene: UnknownRecord, encounterProfile: UnknownRecord | null): UnknownRecord[] {
  if (!encounterProfile || !scene?.mapDimensions) {
    return [];
  }

  const width = Number(scene.mapDimensions.width) || 0;
  const height = Number(scene.mapDimensions.height) || 0;
  if (width <= 0 || height <= 0) {
    return [];
  }

  const excludeRects = Array.isArray(scene.worldSpawns)
    ? scene.worldSpawns.map((spawn: UnknownRecord) => ({
        minX: Math.max(0, (spawn?.x || 0) - 5),
        maxX: Math.min(width - 1, (spawn?.x || 0) + 5),
        minY: Math.max(0, (spawn?.y || 0) - 5),
        maxY: Math.min(height - 1, (spawn?.y || 0) + 5),
      }))
    : [];

  return [
    {
      id: `scene_${scene.id}_default_encounter`,
      minX: 0,
      maxX: Math.max(0, width - 1),
      minY: 0,
      maxY: Math.max(0, height - 1),
      excludeRects,
      action: {
        kind: 'encounterProbe',
        probeId: `scene${scene.id}`,
        reason: `${scene.name || `Map ${scene.id}`} encounter`,
        encounterProfile,
      },
    },
  ];
}

function getScene(sceneId: number): UnknownRecord | null {
  return SCENES[sceneId] || null;
}

function getSceneName(sceneId: number): string {
  return getScene(sceneId)?.name || `Map ${sceneId}`;
}

function getSceneWorldSpawns(sceneId: number) {
  return getScene(sceneId)?.worldSpawns || [];
}

function getSceneOrdinaryMonsterRoleIds(sceneId: number): number[] {
  const scene = getScene(sceneId);
  if (!scene) {
    return [];
  }
  return getOrdinaryMonsterRoleIdsForLocation(scene?.encounterProfile?.locationName || scene.name);
}

function positionMatches(trigger: UnknownRecord, x: number | null, y: number | null): boolean {
  if (x === null || y === null || x === undefined || y === undefined) {
    return trigger.minX === undefined &&
      trigger.maxX === undefined &&
      trigger.minY === undefined &&
      trigger.maxY === undefined;
  }

  if (trigger.minX !== undefined && x < trigger.minX) {
    return false;
  }
  if (trigger.maxX !== undefined && x > trigger.maxX) {
    return false;
  }
  if (trigger.minY !== undefined && y < trigger.minY) {
    return false;
  }
  if (trigger.maxY !== undefined && y > trigger.maxY) {
    return false;
  }

  if (Array.isArray(trigger.excludeRects)) {
    const excluded = trigger.excludeRects.some((rect: UnknownRecord) => positionMatches(rect, x, y));
    if (excluded) {
      return false;
    }
  }

  return true;
}

function resolveServerRunTrigger(
  sceneId: number,
  subtype: number,
  scriptId: number,
  mode: number | null = null,
  contextId: number | null = null,
  extra: number | null = null,
  x: number | null = null,
  y: number | null = null
) {
  const scene = getScene(sceneId);
  if (!scene) {
    return null;
  }

  return scene.triggers.find((trigger: UnknownRecord) => (
    trigger.type === 'serverRun' &&
    trigger.subtype === subtype &&
    (trigger.mode === undefined || trigger.mode === mode) &&
    (trigger.contextId === undefined || trigger.contextId === contextId) &&
    (trigger.extra === undefined || trigger.extra === extra) &&
    trigger.scriptId === scriptId &&
    positionMatches(trigger, x, y)
  )) || null;
}

function resolveTileTrigger(sceneId: number, tileSceneId: number) {
  const scene = getScene(sceneId);
  if (!scene) {
    return null;
  }

  return scene.tileTriggers.find((trigger: UnknownRecord) => trigger.sceneId === tileSceneId) || null;
}

function resolveEncounterTrigger(sceneId: number, x: number, y: number) {
  const scene = getScene(sceneId);
  if (!scene) {
    return null;
  }

  return (scene.encounterTriggers || []).find((trigger: UnknownRecord) => positionMatches(trigger, x, y)) || null;
}

function getTriggerAction(trigger: UnknownRecord | null | undefined) {
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
  getSceneOrdinaryMonsterRoleIds,
  getSceneWorldSpawns,
  getTriggerAction,
  resolveEncounterTrigger,
  resolveServerRunTrigger,
  resolveTileTrigger,
};
