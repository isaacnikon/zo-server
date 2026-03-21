'use strict';
export {};

const fs = require('fs');
const { resolveRepoPath } = require('./runtime-paths');
type UnknownRecord = Record<string, any>;

const MAP_NPCS_FILE = resolveRepoPath('data', 'client-derived', 'map-npcs.json');
const MAP_NPCS = loadMapNpcs();

function getSceneMapNpcRecord(sceneId: number): UnknownRecord | null {
  if (!Number.isInteger(sceneId)) {
    return null;
  }
  return MAP_NPCS.scenesById.get(sceneId) || null;
}

function getSceneMapNpcs(sceneId: number): UnknownRecord[] {
  const scene = getSceneMapNpcRecord(sceneId);
  return Array.isArray(scene?.npcs) ? scene.npcs : [];
}

function getSceneMapNpc(sceneId: number, roleId: number): UnknownRecord | null {
  if (!Number.isInteger(sceneId) || !Number.isInteger(roleId)) {
    return null;
  }
  const scene = MAP_NPCS.scenesById.get(sceneId);
  if (!scene || !Array.isArray(scene.npcs)) {
    return null;
  }
  return scene.npcs.find((npc: UnknownRecord) => npc?.roleId === roleId) || null;
}

function getSceneMapNpcInfo(sceneId: number): UnknownRecord | null {
  const scene = getSceneMapNpcRecord(sceneId);
  if (!scene) {
    return null;
  }

  const npcs = getSceneMapNpcs(sceneId)
    .filter((npc) => npc?.mapInfo && typeof npc.mapInfo === 'object')
    .map((npc) => ({
      roleId: npc.roleId,
      roleName: npc.roleName,
      ...npc.mapInfo,
    }));

  return {
    sceneId: scene.sceneId,
    sceneName: scene.sceneName,
    npcScriptCount: npcs.length,
    taskEntryCount: npcs.reduce(
      (sum, npc) => sum + (Array.isArray(npc.entries) ? npc.entries.length : 0),
      0
    ),
    extraEntryCount: npcs.reduce(
      (sum, npc) => sum + (Array.isArray(npc.extraEntries) ? npc.extraEntries.length : 0),
      0
    ),
    npcs,
  };
}

function getNpcMapInfo(sceneId: number, roleId: number): UnknownRecord | null {
  const npc = getSceneMapNpc(sceneId, roleId);
  if (!npc?.mapInfo || typeof npc.mapInfo !== 'object') {
    return null;
  }
  return {
    roleId: npc.roleId,
    roleName: npc.roleName,
    ...npc.mapInfo,
  };
}

function getSceneBootstrapWorldSpawns(sceneId: number): UnknownRecord[] {
  return getSceneMapNpcs(sceneId)
    .flatMap((npc) =>
      Array.isArray(npc?.worldSpawns)
        ? npc.worldSpawns.map((spawn: UnknownRecord) => ({
            id: Number.isInteger(spawn?.spawnId) ? spawn.spawnId >>> 0 : npc.roleId >>> 0,
            entityType: Number.isInteger(spawn?.entityType) ? spawn.entityType & 0xffff : npc.roleId & 0xffff,
            templateFlags: Number.isInteger(spawn?.templateFlags) ? spawn.templateFlags & 0xffff : 0,
            x: Number.isInteger(spawn?.x) ? spawn.x : 0,
            y: Number.isInteger(spawn?.y) ? spawn.y : 0,
            dir: Number.isInteger(spawn?.dir) ? spawn.dir & 0xffff : 0,
            state: Number.isInteger(spawn?.state) ? spawn.state & 0xffff : 0,
          }))
        : []
    );
}

function loadMapNpcs(): { scenesById: Map<number, UnknownRecord>; summary: UnknownRecord } {
  try {
    const parsed = JSON.parse(fs.readFileSync(MAP_NPCS_FILE, 'utf8'));
    const scenes = parsed?.scenes && typeof parsed.scenes === 'object' ? parsed.scenes : {};
    const scenesById = new Map<number, UnknownRecord>();
    for (const [sceneId, scene] of Object.entries(scenes)) {
      const numericSceneId = Number(sceneId);
      if (!Number.isInteger(numericSceneId)) {
        continue;
      }
      scenesById.set(numericSceneId, scene as UnknownRecord);
    }
    return {
      scenesById,
      summary: parsed?.summary || {},
    };
  } catch (_err) {
    return {
      scenesById: new Map(),
      summary: {},
    };
  }
}

module.exports = {
  getSceneBootstrapWorldSpawns,
  getSceneMapNpcInfo,
  getSceneMapNpcs,
  getSceneMapNpc,
  getNpcMapInfo,
};
