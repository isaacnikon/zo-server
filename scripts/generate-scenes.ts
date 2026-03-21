#!/usr/bin/env node
'use strict';
export {};

const fs = require('fs');
const path = require('path');
const { MapCellStore } = require('../src/map-cell-store');
const { resolveRepoPath } = require('../src/runtime-paths');

type UnknownRecord = Record<string, any>;
type SceneSpawn = { id: number; entityType: number; x: number; y: number; templateFlags: number };

const SCRIPT_PATH = '/home/nikon/Data/Zodiac Online/script.gcg';
const MAPINFO_PATH = resolveMapInfoPath();
const ROLEINFO_PATH = resolveRepoPath('data', 'client-derived', 'roleinfo.json');
const SHOPS_PATH = resolveRepoPath('data', 'client-derived', 'shops.json');
const SCENES_PATH = resolveRepoPath('data', 'scenes', 'scenes.json');
const QUEST_DATA_ROOT = resolveRepoPath('data', 'quests');

const TITLE_RE = /macro_SetBigText\("¡ï([^"]+?)¡ï",3000,\s*63500\)/g;
const ADD_NPC_RE = /macro_AddMapNpc\((\d+),\s*(\d+),.*?,\s*(\d+),\s*(\d+)\)/g;
const HOME_RE = /macro_SetHomeInfo\((\d+),\s*(\d+),\s*(\d+)\)/g;
const SERVER_RUN_RE = /macro_ServerRunScript\((\d+),\s*(\d+)\)/g;
const TOWN_ATTR_RE = /macro_SetMapAttr\(\s*2\s*,\s*1\s*\)/;

function main(): void {
  const mapInfo = loadMapInfo();
  const blocksBySceneName = parseScriptBlocks();
  const roleinfoEntries = loadEntries(ROLEINFO_PATH);
  const shops = loadEntries(SHOPS_PATH);
  const legacySceneData = loadLegacySceneData();
  const shopNpcIds = new Set(
    shops.map((entry: UnknownRecord) => entry?.npcId).filter((value: unknown) => Number.isInteger(value))
  );
  const npcMapEvidence = loadNpcMapEvidenceFromQuestData();
  const serviceNpcIds = buildServiceNpcIdSet(roleinfoEntries, shopNpcIds);
  const ordinaryMonsterLocations = buildOrdinaryMonsterLocationSet(roleinfoEntries);
  const mapCellStore = new MapCellStore();
  const compatibility = buildCompatibilityOverrides(legacySceneData);

  const sceneIds = buildSceneIds(mapInfo, compatibility.sceneIds);
  const scenes: Record<string, UnknownRecord> = {};

  for (const [mapIdStr, mapName] of Object.entries(mapInfo) as [string, string][]) {
    const mapId = Number(mapIdStr);
    const scriptBlock = blocksBySceneName.get(normalizeName(mapName)) || null;
    const mapData = mapCellStore.getMap(mapId);
    const worldSpawns = buildWorldSpawns(scriptBlock?.spawns || []);
    const ordinaryMonsters = ordinaryMonsterLocations.get(normalizeName(mapName)) || [];
    const hasShopNpc = worldSpawns.some((spawn) => shopNpcIds.has(spawn.entityType));
    const hasTownFlag = Boolean(scriptBlock?.hasTownFlag);
    const homeInfo = resolveSceneHomeInfo(scriptBlock?.homeInfos || [], mapId, worldSpawns);
    const isTown = hasTownFlag || (ordinaryMonsters.length === 0 && hasShopNpc);
    const scene: UnknownRecord = {
      id: mapId,
      name: mapName,
      isTown,
      respawnPoint: resolveRespawnPoint(mapId, homeInfo, worldSpawns, hasShopNpc),
      homeInfo,
      mapDimensions: mapData
        ? { width: mapData.width, height: mapData.height }
        : null,
      worldSpawns,
      metadataNpcs: [],
      demoNpcs: [],
      serverRunScripts: scriptBlock?.serverRunScripts || [],
      tileTriggers: mapData ? buildTileTriggers(mapData) : [],
      encounterProfile: !isTown && ordinaryMonsters.length > 0
        ? {
            source: 'client roleinfo',
            minEnemies: 1,
            maxEnemies: 3,
            encounterChancePercent: 8,
            cooldownMs: 12000,
            locationName: mapName,
          }
        : null,
      encounterTriggers: [],
      triggers: [],
    };

    scenes[String(mapId)] = deepMerge(scene, compatibility.scenes[String(mapId)] || {});
  }

  applyNpcPlacementEvidenceCorrections(scenes, npcMapEvidence);
  applyTownServiceClusterInference(scenes, npcMapEvidence, serviceNpcIds);
  applyAdjacentTownClusterCarryover(scenes, npcMapEvidence);
  applyTravelInferences(scenes);
  applyReciprocalTileTransitionInference(scenes);
  applyReciprocalServerRunInference(scenes);
  applyLandingSafetyAdjustments(scenes);
  normalizeTownScenes(scenes);
  annotateUnresolvedServerRunScripts(scenes);

  const output = {
    generatedAt: new Date().toISOString(),
    source: {
      script: SCRIPT_PATH,
      mapInfo: MAPINFO_PATH,
      roleinfo: ROLEINFO_PATH,
      shops: SHOPS_PATH,
      compatibilitySeed: legacySceneData?.generatedAt
        ? `previous generated scenes.json (${legacySceneData.generatedAt})`
        : 'none',
    },
    sceneIds,
    scenes,
  };

  fs.writeFileSync(SCENES_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  process.stdout.write(`${SCENES_PATH}\n`);
}

function resolveMapInfoPath(): string {
  const manifestPath = resolveRepoPath('data', 'client-derived', 'archive', 'attrres-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entry = Array.isArray(manifest?.entries)
    ? manifest.entries.find((candidate: UnknownRecord) => candidate?.name === 'mapinfo.txt')
    : null;
  if (!entry?.outputPath) {
    throw new Error(`Could not find mapinfo.txt in ${manifestPath}`);
  }
  return resolveRepoPath('data', 'client-derived', 'archive', entry.outputPath);
}

function parseScriptBlocks(): Map<string, UnknownRecord> {
  const text = fs.readFileSync(SCRIPT_PATH, 'latin1');
  const matches = [...text.matchAll(TITLE_RE)];
  const blocks = new Map<string, UnknownRecord>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index || 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index || text.length) : text.length;
    const body = text.slice(start, end);
    const name = normalizeName(match[1]);
    const existing = blocks.get(name) || { spawns: [], homeInfos: [], serverRunScripts: [], hasTownFlag: false };
    existing.spawns.push(...parseBlockSpawns(body));
    existing.homeInfos.push(...parseBlockHomeInfos(body));
    existing.serverRunScripts.push(...parseBlockServerRuns(body));
    existing.hasTownFlag = existing.hasTownFlag || TOWN_ATTR_RE.test(body);
    blocks.set(name, existing);
  }

  return blocks;
}

function parseBlockSpawns(body: string): SceneSpawn[] {
  const spawns: SceneSpawn[] = [];
  for (const match of body.matchAll(ADD_NPC_RE)) {
    spawns.push({
      id: Number(match[1]),
      entityType: Number(match[1]),
      templateFlags: Number(match[2]),
      x: Number(match[3]),
      y: Number(match[4]),
    });
  }
  return spawns;
}

function parseBlockHomeInfos(body: string): UnknownRecord[] {
  const homeInfos: UnknownRecord[] = [];
  for (const match of body.matchAll(HOME_RE)) {
    homeInfos.push({
      mapId: Number(match[1]),
      x: Number(match[2]),
      y: Number(match[3]),
    });
  }
  return homeInfos;
}

function parseBlockServerRuns(body: string): UnknownRecord[] {
  const serverRuns: UnknownRecord[] = [];
  for (const match of body.matchAll(SERVER_RUN_RE)) {
    serverRuns.push({
      subtype: Number(match[1]),
      scriptId: Number(match[2]),
    });
  }
  return serverRuns;
}

function buildWorldSpawns(spawns: SceneSpawn[]): SceneSpawn[] {
  const seenCounts = new Map<number, number>();
  return spawns.map((spawn) => {
    const nextCount = seenCounts.get(spawn.id) || 0;
    seenCounts.set(spawn.id, nextCount + 1);
    return {
      ...spawn,
      id: nextCount === 0 ? spawn.id : (spawn.id * 1000) + nextCount,
    };
  });
}

function resolveSceneHomeInfo(homeInfos: UnknownRecord[], mapId: number, worldSpawns: SceneSpawn[]): UnknownRecord | null {
  const exactMatch = homeInfos.find((entry) => entry?.mapId === mapId) || null;
  if (exactMatch) {
    return exactMatch;
  }
  const first = homeInfos[0] || null;
  if (first) {
    return first;
  }
  const anchor = worldSpawns[0];
  return anchor ? { mapId, x: anchor.x, y: anchor.y } : null;
}

function resolveRespawnPoint(
  mapId: number,
  homeInfo: UnknownRecord | null,
  worldSpawns: SceneSpawn[],
  hasShopNpc: boolean
): UnknownRecord | null {
  if (homeInfo?.mapId === mapId) {
    return { mapId, x: homeInfo.x, y: homeInfo.y };
  }
  if (!hasShopNpc) {
    return null;
  }
  const anchor = worldSpawns[0];
  return anchor ? { mapId, x: anchor.x, y: anchor.y } : null;
}

function buildTileTriggers(mapData: UnknownRecord): UnknownRecord[] {
  const zonesBySceneId = new Map<number, UnknownRecord>();
  const width = Number(mapData?.width) || 0;
  const cells = Array.isArray(mapData?.cells) ? mapData.cells : [];
  for (let index = 0; index < cells.length; index += 1) {
    const sceneId = Number(cells[index]?.sceneId) || 0;
    if (sceneId <= 0) {
      continue;
    }
    const x = index % width;
    const y = Math.floor(index / width);
    const zone = zonesBySceneId.get(sceneId) || {
      sceneId,
      minX: x,
      maxX: x,
      minY: y,
      maxY: y,
    };
    zone.minX = Math.min(zone.minX, x);
    zone.maxX = Math.max(zone.maxX, x);
    zone.minY = Math.min(zone.minY, y);
    zone.maxY = Math.max(zone.maxY, y);
    zonesBySceneId.set(sceneId, zone);
  }
  return [...zonesBySceneId.values()].sort((left, right) => left.sceneId - right.sceneId);
}

function loadMapInfo(): Record<number, string> {
  const rows = fs.readFileSync(MAPINFO_PATH, 'utf8').split(/\r?\n/);
  const result: Record<number, string> = {};
  for (const row of rows) {
    const match = row.match(/^(\d+),"(.+)"$/);
    if (!match) {
      continue;
    }
    result[Number(match[1])] = cleanMapName(match[2]);
  }
  const mapRoot = resolveRepoPath('data', 'client', 'map');
  for (const fileName of fs.readdirSync(mapRoot)) {
    const match = fileName.match(/^(\d+)\.b$/);
    if (!match) {
      continue;
    }
    const mapId = Number(match[1]);
    if (!result[mapId]) {
      result[mapId] = `Map ${mapId}`;
    }
  }
  return result;
}

function buildSceneIds(mapInfo: Record<number, string>, overrideIds: Record<string, number>): Record<string, number> {
  const sceneIds: Record<string, number> = { ...overrideIds };
  const usedKeys = new Set(Object.keys(sceneIds));
  for (const [mapIdStr, name] of Object.entries(mapInfo) as [string, string][]) {
    const mapId = Number(mapIdStr);
    let key = buildSceneIdKey(name);
    if (!key || usedKeys.has(key)) {
      key = `${key || 'MAP'}_${mapId}`;
    }
    sceneIds[key] = mapId;
    usedKeys.add(key);
  }
  return sortObject(sceneIds);
}

function buildSceneIdKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || '';
}

function buildOrdinaryMonsterLocationSet(entries: UnknownRecord[]): Map<string, number[]> {
  const locations = new Map<string, number[]>();
  const locationRe = /\[([^\]]+)\]/g;
  for (const entry of entries) {
    if (entry?.roleClassField !== 4 || !Number.isInteger(entry?.roleId)) {
      continue;
    }
    const description = typeof entry?.description === 'string' ? entry.description : '';
    for (const match of description.matchAll(locationRe)) {
      const location = normalizeName(match[1]);
      if (!location) {
        continue;
      }
      const current = locations.get(location) || [];
      current.push(entry.roleId);
      locations.set(location, current);
    }
  }
  for (const [location, roleIds] of locations.entries()) {
    locations.set(location, [...new Set(roleIds)].sort((left, right) => left - right));
  }
  return locations;
}

function loadEntries(filePath: string): UnknownRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch (_err) {
    return [];
  }
}

function applyNpcPlacementEvidenceCorrections(
  scenes: Record<string, UnknownRecord>,
  expectedByNpcId: Map<number, Set<number>>
): void {
  for (const [npcId, expectedMapIds] of expectedByNpcId.entries()) {
    const placements = findNpcPlacements(scenes, npcId);
    if (placements.length === 0) {
      continue;
    }

    const templateSpawn = placements[0].spawn;
    for (const expectedMapId of expectedMapIds) {
      if (!Number.isInteger(expectedMapId)) {
        continue;
      }
      const targetScene = scenes[String(expectedMapId)];
      if (!targetScene) {
        continue;
      }
      if (!Array.isArray(targetScene.worldSpawns)) {
        targetScene.worldSpawns = [];
      }
      const existing = targetScene.worldSpawns.some(
        (spawn: UnknownRecord) => spawn?.entityType === npcId || spawn?.id === npcId
      );
      if (existing) {
        continue;
      }
      targetScene.worldSpawns.push(cloneSpawnForScene(templateSpawn, targetScene.worldSpawns));
    }

    if (expectedMapIds.size !== 1) {
      continue;
    }

    const [expectedMapId] = [...expectedMapIds];
    if (!Number.isInteger(expectedMapId)) {
      continue;
    }

    const expectedScene = scenes[String(expectedMapId)];
    if (!expectedScene || !Array.isArray(expectedScene.worldSpawns)) {
      continue;
    }

    const expectedHasPlacement = expectedScene.worldSpawns.some(
      (spawn: UnknownRecord) => spawn?.entityType === npcId || spawn?.id === npcId
    );
    if (!expectedHasPlacement) {
      continue;
    }

    for (const { mapId } of placements) {
      if (mapId === expectedMapId) {
        continue;
      }
      removeNpcFromScene(scenes[String(mapId)], npcId);
    }
  }

  for (const [npcId, expectedMapIds] of expectedByNpcId.entries()) {
    if (expectedMapIds.size !== 1) {
      continue;
    }
    const [expectedMapId] = [...expectedMapIds];
    const expectedScene = scenes[String(expectedMapId)];
    if (!expectedScene || !hasNpcPlacement(expectedScene, npcId)) {
      continue;
    }
    for (const [mapIdStr, scene] of Object.entries(scenes)) {
      if (Number(mapIdStr) === expectedMapId) {
        continue;
      }
      removeNpcFromScene(scene, npcId);
    }
  }
}

function applyTownServiceClusterInference(
  scenes: Record<string, UnknownRecord>,
  npcMapEvidence: Map<number, Set<number>>,
  serviceNpcIds: Set<number>
): void {
  const townEntries = Object.entries(scenes)
    .filter(([, scene]) => scene?.isTown && Array.isArray(scene?.worldSpawns));

  for (const [targetMapIdStr, targetScene] of townEntries) {
    const targetMapId = Number(targetMapIdStr);
    const targetIds = new Set<number>(
      targetScene.worldSpawns
        .map((spawn: UnknownRecord) => spawn?.entityType)
        .filter((value: unknown): value is number => Number.isInteger(value))
    );
    const targetCore = new Set<number>(
      [...targetIds].filter((npcId) => {
        const evidence = npcMapEvidence.get(npcId);
        return evidence?.has(targetMapId);
      })
    );
    if (targetCore.size < 3) {
      continue;
    }

    for (const [donorMapIdStr, donorScene] of townEntries) {
      const donorMapId = Number(donorMapIdStr);
      if (donorMapId === targetMapId) {
        continue;
      }

      const donorIds = new Set<number>(
        donorScene.worldSpawns
          .map((spawn: UnknownRecord) => spawn?.entityType)
          .filter((value: unknown): value is number => Number.isInteger(value))
      );
      const sharedCoreCount = [...targetCore].filter((npcId) => donorIds.has(npcId)).length;
      const minSharedCore = Math.abs(donorMapId - targetMapId) <= 1 ? 2 : 4;
      if (sharedCoreCount < minSharedCore) {
        continue;
      }

      for (const spawn of donorScene.worldSpawns) {
        const npcId = Number(spawn?.entityType);
        if (!Number.isInteger(npcId) || targetIds.has(npcId) || !serviceNpcIds.has(npcId)) {
          continue;
        }
        targetScene.worldSpawns.push(cloneSpawnForScene(spawn, targetScene.worldSpawns));
        targetIds.add(npcId);
      }
    }
  }
}

function applyAdjacentTownClusterCarryover(
  scenes: Record<string, UnknownRecord>,
  npcMapEvidence: Map<number, Set<number>>
): void {
  const townEntries = Object.entries(scenes)
    .filter(([, scene]) => scene?.isTown && Array.isArray(scene?.worldSpawns));

  for (const [targetMapIdStr, targetScene] of townEntries) {
    const targetIds = new Set<number>(
      targetScene.worldSpawns
        .map((spawn: UnknownRecord) => spawn?.entityType)
        .filter((value: unknown): value is number => Number.isInteger(value))
    );
    const targetMapId = Number(targetMapIdStr);

    for (const [donorMapIdStr, donorScene] of townEntries) {
      const donorMapId = Number(donorMapIdStr);
      if (donorMapId === targetMapId || Math.abs(donorMapId - targetMapId) > 1) {
        continue;
      }
      if ((targetScene.worldSpawns?.length || 0) >= (donorScene.worldSpawns?.length || 0)) {
        continue;
      }

      const donorIds = new Set<number>(
        donorScene.worldSpawns
          .map((spawn: UnknownRecord) => spawn?.entityType)
          .filter((value: unknown): value is number => Number.isInteger(value))
      );
      const sharedNpcCount = [...targetIds].filter((npcId) => donorIds.has(npcId)).length;
      if (sharedNpcCount < 4) {
        continue;
      }

      for (const spawn of donorScene.worldSpawns) {
        const npcId = Number(spawn?.entityType);
        if (!Number.isInteger(npcId) || targetIds.has(npcId)) {
          continue;
        }
        const evidence = npcMapEvidence.get(npcId);
        if (evidence?.size === 1 && !evidence.has(targetMapId)) {
          continue;
        }
        targetScene.worldSpawns.push(cloneSpawnForScene(spawn, targetScene.worldSpawns));
        targetIds.add(npcId);
      }
    }
  }
}

function buildServiceNpcIdSet(roleinfoEntries: UnknownRecord[], shopNpcIds: Set<number>): Set<number> {
  const serviceKeywords = /(blacksmith|pet curer|pub owner|grocer|teleport|teleporter|warehouse|ware house|chelyn|guild manager|escort|commander|money maker|skill mentor)/i;
  const serviceNpcIds = new Set<number>(shopNpcIds);
  for (const entry of roleinfoEntries) {
    const roleId = Number(entry?.roleId);
    if (!Number.isInteger(roleId)) {
      continue;
    }
    const haystack = `${entry?.name || ''} ${entry?.description || ''}`;
    if (serviceKeywords.test(haystack)) {
      serviceNpcIds.add(roleId);
    }
  }
  return serviceNpcIds;
}

function normalizeTownScenes(scenes: Record<string, UnknownRecord>): void {
  for (const scene of Object.values(scenes)) {
    if (!scene?.isTown) {
      continue;
    }
    scene.encounterProfile = null;
    scene.encounterTriggers = [];
  }
}

function hasNpcPlacement(scene: UnknownRecord, npcId: number): boolean {
  return Array.isArray(scene?.worldSpawns) && scene.worldSpawns.some(
    (spawn: UnknownRecord) => spawn?.entityType === npcId || spawn?.id === npcId
  );
}

function removeNpcFromScene(scene: UnknownRecord, npcId: number): void {
  if (!Array.isArray(scene?.worldSpawns)) {
    return;
  }
  scene.worldSpawns = scene.worldSpawns.filter(
    (spawn: UnknownRecord) => spawn?.entityType !== npcId && spawn?.id !== npcId
  );
}

function applyTravelInferences(scenes: Record<string, UnknownRecord>): void {
  // Some world-map exits are exposed by the client as server-run hotspots rather than
  // explicit macro_ChangeScene blocks. Keep these as generated inferences instead of
  // requiring a hand-maintained scene override file.
  ensureServerRunTransitionTrigger(
    scenes,
    102,
    {
      subtype: 1,
      scriptId: 2,
      minX: 0,
      maxX: 12,
      minY: 186,
      maxY: 193,
      action: {
        kind: 'transition',
        targetSceneId: 112,
        targetX: 234,
        targetY: 71,
        reason: 'Bling Alley west exit',
      },
    }
  );

  ensureTileTransitionTrigger(
    scenes,
    112,
    {
      sceneId: 2,
      targetSceneId: 102,
      targetX: 14,
      targetY: 191,
      reason: 'Cloud City east exit',
    }
  );
}

function applyReciprocalTileTransitionInference(scenes: Record<string, UnknownRecord>): void {
  for (const [targetMapIdStr, targetScene] of Object.entries(scenes)) {
    const targetMapId = Number(targetMapIdStr);
    if (!Array.isArray(targetScene?.tileTriggers)) {
      continue;
    }

    for (const tileTrigger of targetScene.tileTriggers) {
      if (!tileTrigger || tileTrigger.targetSceneId !== undefined) {
        continue;
      }

      const inboundMatches: UnknownRecord[] = [];
      for (const [sourceMapIdStr, sourceScene] of Object.entries(scenes)) {
        const sourceMapId = Number(sourceMapIdStr);
        for (const trigger of Array.isArray(sourceScene?.triggers) ? sourceScene.triggers : []) {
          if (trigger?.type !== 'serverRun' || trigger?.action?.kind !== 'transition') {
            continue;
          }
          if (trigger.action.targetSceneId !== targetMapId) {
            continue;
          }
          const targetX = Number(trigger.action.targetX);
          const targetY = Number(trigger.action.targetY);
          if (!positionMatchesRect(tileTrigger, targetX, targetY)) {
            continue;
          }
          inboundMatches.push({ sourceMapId, trigger });
        }
      }

      if (inboundMatches.length !== 1) {
        continue;
      }

      const inbound = inboundMatches[0];
      const returnPosition = inferReturnPositionFromSourceTrigger(inbound.trigger);
      if (!returnPosition) {
        continue;
      }

      tileTrigger.targetSceneId = inbound.sourceMapId;
      tileTrigger.targetX = returnPosition.x;
      tileTrigger.targetY = returnPosition.y;
      tileTrigger.reason = tileTrigger.reason || `${targetScene.name || `Map ${targetMapId}`} reciprocal exit`;
    }
  }
}

function applyReciprocalServerRunInference(scenes: Record<string, UnknownRecord>): void {
  for (const [targetMapIdStr, targetScene] of Object.entries(scenes)) {
    const targetMapId = Number(targetMapIdStr);
    const unresolved = (Array.isArray(targetScene?.serverRunScripts) ? targetScene.serverRunScripts : [])
      .filter((entry: UnknownRecord) => !hasServerRunTrigger(targetScene, entry.subtype, entry.scriptId));
    if (unresolved.length === 0) {
      continue;
    }

    const candidates: UnknownRecord[] = [];
    for (const [sourceMapIdStr, sourceScene] of Object.entries(scenes)) {
      const sourceMapId = Number(sourceMapIdStr);
      for (const trigger of Array.isArray(sourceScene?.triggers) ? sourceScene.triggers : []) {
        if (trigger?.type !== 'serverRun' || trigger?.action?.kind !== 'transition') {
          continue;
        }
        if (trigger.action.targetSceneId !== targetMapId) {
          continue;
        }
        if (hasTransitionToScene(targetScene, sourceMapId)) {
          continue;
        }
        const targetX = Number(trigger.action.targetX);
        const targetY = Number(trigger.action.targetY);
        if (positionCoveredByKnownTravelTrigger(targetScene, targetX, targetY)) {
          continue;
        }
        const inferredRect = inferServerRunRectFromLanding(targetScene, targetX, targetY);
        if (!inferredRect) {
          continue;
        }
        candidates.push({
          sourceMapId,
          targetX,
          targetY,
          inferredRect,
        });
      }
    }

    if (candidates.length === 0 || unresolved.length !== candidates.length) {
      continue;
    }

    const sortedUnresolved = unresolved
      .slice()
      .sort((left: UnknownRecord, right: UnknownRecord) => (left.scriptId - right.scriptId) || (left.subtype - right.subtype));
    const sortedCandidates = candidates
      .slice()
      .sort((left, right) => left.inferredRect.minX - right.inferredRect.minX || left.inferredRect.minY - right.inferredRect.minY);

    for (let index = 0; index < sortedUnresolved.length; index += 1) {
      const unresolvedScript = sortedUnresolved[index];
      const candidate = sortedCandidates[index];
      ensureServerRunTransitionTrigger(
        scenes,
        targetMapId,
        {
          type: 'serverRun',
          subtype: unresolvedScript.subtype,
          scriptId: unresolvedScript.scriptId,
          minX: candidate.inferredRect.minX,
          maxX: candidate.inferredRect.maxX,
          minY: candidate.inferredRect.minY,
          maxY: candidate.inferredRect.maxY,
          action: {
            kind: 'transition',
            targetSceneId: candidate.sourceMapId,
            targetX: inferReturnPositionFromSourceTriggerPosition(candidate.targetX, candidate.targetY).x,
            targetY: inferReturnPositionFromSourceTriggerPosition(candidate.targetX, candidate.targetY).y,
            reason: `${targetScene.name || `Map ${targetMapId}`} inferred reciprocal exit`,
          },
        }
      );
    }
  }
}

function applyLandingSafetyAdjustments(scenes: Record<string, UnknownRecord>): void {
  for (const [sourceMapIdStr, sourceScene] of Object.entries(scenes)) {
    const sourceMapId = Number(sourceMapIdStr);
    for (const collection of ['triggers', 'tileTriggers'] as const) {
      const entries = Array.isArray(sourceScene?.[collection]) ? sourceScene[collection] : [];
      for (const trigger of entries) {
        const action = collection === 'triggers' ? trigger?.action : trigger;
        if (action?.kind && action.kind !== 'transition') {
          continue;
        }
        const targetSceneId = Number(action?.targetSceneId);
        const targetX = Number(action?.targetX);
        const targetY = Number(action?.targetY);
        if (!Number.isInteger(targetSceneId) || !Number.isFinite(targetX) || !Number.isFinite(targetY)) {
          continue;
        }
        const targetScene = scenes[String(targetSceneId)];
        if (!targetScene) {
          continue;
        }
        const reciprocal = findReciprocalTravelTrigger(targetScene, sourceMapId, targetX, targetY);
        if (!reciprocal) {
          continue;
        }
        const adjusted = movePointOutsideRect(
          reciprocal.trigger,
          targetX,
          targetY,
          Number(targetScene?.mapDimensions?.width),
          Number(targetScene?.mapDimensions?.height)
        );
        if (!adjusted) {
          continue;
        }
        action.targetX = adjusted.x;
        action.targetY = adjusted.y;
      }
    }
  }
}

function annotateUnresolvedServerRunScripts(scenes: Record<string, UnknownRecord>): void {
  for (const scene of Object.values(scenes)) {
    const declared = Array.isArray(scene?.serverRunScripts) ? scene.serverRunScripts : [];
    const resolved = new Set(
      (Array.isArray(scene?.triggers) ? scene.triggers : [])
        .filter((trigger: UnknownRecord) => trigger?.type === 'serverRun')
        .map((trigger: UnknownRecord) => `${trigger.subtype}:${trigger.scriptId}`)
    );
    scene.unresolvedServerRunScripts = declared.filter(
      (entry: UnknownRecord) => !resolved.has(`${entry.subtype}:${entry.scriptId}`)
    );
  }
}

function findReciprocalTravelTrigger(
  scene: UnknownRecord,
  targetSceneId: number,
  x: number,
  y: number
): { collection: 'triggers' | 'tileTriggers'; trigger: UnknownRecord } | null {
  for (const collection of ['triggers', 'tileTriggers'] as const) {
    for (const trigger of Array.isArray(scene?.[collection]) ? scene[collection] : []) {
      const action = collection === 'triggers' ? trigger?.action : trigger;
      if (action?.kind && action.kind !== 'transition') {
        continue;
      }
      if (action?.targetSceneId !== targetSceneId) {
        continue;
      }
      if (!positionMatchesRect(trigger, x, y)) {
        continue;
      }
      return { collection, trigger };
    }
  }
  return null;
}

function hasServerRunTrigger(scene: UnknownRecord, subtype: number, scriptId: number): boolean {
  return (Array.isArray(scene?.triggers) ? scene.triggers : []).some((trigger: UnknownRecord) => (
    trigger?.type === 'serverRun' &&
    trigger?.subtype === subtype &&
    trigger?.scriptId === scriptId
  ));
}

function hasTransitionToScene(scene: UnknownRecord, targetSceneId: number): boolean {
  return (Array.isArray(scene?.triggers) ? scene.triggers : []).some((trigger: UnknownRecord) => (
    trigger?.action?.kind === 'transition' &&
    trigger?.action?.targetSceneId === targetSceneId
  )) || (Array.isArray(scene?.tileTriggers) ? scene.tileTriggers : []).some((trigger: UnknownRecord) => trigger?.targetSceneId === targetSceneId);
}

function positionCoveredByKnownTravelTrigger(scene: UnknownRecord, x: number, y: number): boolean {
  return (Array.isArray(scene?.triggers) ? scene.triggers : []).some((trigger: UnknownRecord) => (
    trigger?.type === 'serverRun' &&
    positionMatchesRect(trigger, x, y)
  )) || (Array.isArray(scene?.tileTriggers) ? scene.tileTriggers : []).some((trigger: UnknownRecord) => positionMatchesRect(trigger, x, y));
}

function movePointOutsideRect(
  rect: UnknownRecord,
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } | null {
  const minX = Number(rect?.minX);
  const maxX = Number(rect?.maxX);
  const minY = Number(rect?.minY);
  const maxY = Number(rect?.maxY);
  if (![minX, maxX, minY, maxY, x, y].every(Number.isFinite)) {
    return null;
  }

  if (minX <= 0) {
    return { x: maxX + 2, y: clamp(y, minY, maxY) };
  }
  if (Number.isFinite(width) && maxX >= width - 1) {
    return { x: Math.max(0, minX - 2), y: clamp(y, minY, maxY) };
  }
  if (minY <= 0) {
    return { x: clamp(x, minX, maxX), y: maxY + 2 };
  }
  if (Number.isFinite(height) && maxY >= height - 1) {
    return { x: clamp(x, minX, maxX), y: Math.max(0, minY - 2) };
  }

  const distances = [
    { axis: 'x', value: minX, distance: Math.abs(x - minX) },
    { axis: 'x', value: maxX, distance: Math.abs(x - maxX) },
    { axis: 'y', value: minY, distance: Math.abs(y - minY) },
    { axis: 'y', value: maxY, distance: Math.abs(y - maxY) },
  ].sort((left, right) => left.distance - right.distance);
  const edge = distances[0];
  if (!edge) {
    return null;
  }
  if (edge.axis === 'x') {
    const nextX = edge.value === minX ? minX - 2 : maxX + 2;
    return { x: Math.max(0, nextX), y: clamp(y, minY, maxY) };
  }
  const nextY = edge.value === minY ? minY - 2 : maxY + 2;
  return { x: clamp(x, minX, maxX), y: Math.max(0, nextY) };
}

function inferServerRunRectFromLanding(scene: UnknownRecord, x: number, y: number): UnknownRecord | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const width = Number(scene?.mapDimensions?.width) || 0;
  if (width > 0 && x >= width - 20) {
    return {
      minX: x + 2,
      maxX: x + 9,
      minY: y - 5,
      maxY: y + 2,
    };
  }
  if (x <= 20) {
    return {
      minX: Math.max(0, x - 14),
      maxX: Math.max(0, x - 2),
      minY: y - 5,
      maxY: y + 2,
    };
  }
  if (y <= 20) {
    return {
      minX: x - 4,
      maxX: x + 4,
      minY: Math.max(0, y - 14),
      maxY: Math.max(0, y - 2),
    };
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function ensureServerRunTransitionTrigger(
  scenes: Record<string, UnknownRecord>,
  mapId: number,
  trigger: UnknownRecord
): void {
  const scene = scenes[String(mapId)];
  if (!scene) {
    return;
  }
  if (!Array.isArray(scene.triggers)) {
    scene.triggers = [];
  }
  const match = scene.triggers.find((entry: UnknownRecord) => (
    entry?.type === 'serverRun' &&
    entry?.subtype === trigger.subtype &&
    entry?.scriptId === trigger.scriptId
  ));
  if (!match) {
    scene.triggers.push(trigger);
    return;
  }
  Object.assign(match, trigger);
}

function ensureTileTransitionTrigger(
  scenes: Record<string, UnknownRecord>,
  mapId: number,
  trigger: UnknownRecord
): void {
  const scene = scenes[String(mapId)];
  if (!scene || !Array.isArray(scene.tileTriggers)) {
    return;
  }
  const match = scene.tileTriggers.find((entry: UnknownRecord) => entry?.sceneId === trigger.sceneId);
  if (!match) {
    return;
  }
  if (match.targetSceneId === undefined) {
    match.targetSceneId = trigger.targetSceneId;
    match.targetX = trigger.targetX;
    match.targetY = trigger.targetY;
    match.reason = trigger.reason;
  }
}

function positionMatchesRect(rect: UnknownRecord, x: number, y: number): boolean {
  if (![rect?.minX, rect?.maxX, rect?.minY, rect?.maxY].every(Number.isFinite)) {
    return false;
  }
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= (rect.minX ?? x) &&
    x <= (rect.maxX ?? x) &&
    y >= (rect.minY ?? y) &&
    y <= (rect.maxY ?? y)
  );
}

function inferReturnPositionFromSourceTrigger(trigger: UnknownRecord): { x: number; y: number } | null {
  const minX = Number(trigger?.minX);
  const maxX = Number(trigger?.maxX);
  const minY = Number(trigger?.minY);
  const maxY = Number(trigger?.maxY);
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) {
    return null;
  }

  const midX = Math.round((minX + maxX) / 2);
  const midY = Math.round((minY + maxY) / 2);
  if (minX <= 0) {
    return { x: maxX + 2, y: midY };
  }
  if (maxX >= 127) {
    return { x: Math.max(0, minX - 2), y: midY };
  }
  if (minY <= 0) {
    return { x: midX, y: maxY + 2 };
  }
  return { x: midX, y: Math.max(0, minY - 2) };
}

function inferReturnPositionFromSourceTriggerPosition(x: number, y: number): { x: number; y: number } {
  return { x, y };
}

function loadNpcMapEvidenceFromQuestData(): Map<number, Set<number>> {
  const evidence = new Map<number, Set<number>>();
  let fileNames: string[] = [];
  try {
    fileNames = fs.readdirSync(QUEST_DATA_ROOT);
  } catch (_err) {
    return evidence;
  }

  for (const fileName of fileNames) {
    if (!fileName.endsWith('.json')) {
      continue;
    }
    const filePath = path.join(QUEST_DATA_ROOT, fileName);
    let parsed: UnknownRecord;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_err) {
      continue;
    }

    for (const quest of Array.isArray(parsed?.quests) ? parsed.quests : []) {
      for (const step of Array.isArray(quest?.steps) ? quest.steps : []) {
        if (step?.type !== 'talk' || !Number.isInteger(step?.npcId) || !Number.isInteger(step?.mapId)) {
          continue;
        }
        const mapIds = evidence.get(step.npcId) || new Set<number>();
        mapIds.add(step.mapId);
        evidence.set(step.npcId, mapIds);
      }
    }
  }

  return evidence;
}

function findNpcPlacements(scenes: Record<string, UnknownRecord>, npcId: number): { mapId: number; spawn: UnknownRecord }[] {
  const placements: { mapId: number; spawn: UnknownRecord }[] = [];
  for (const [mapIdStr, scene] of Object.entries(scenes)) {
    const mapId = Number(mapIdStr);
    if (!Array.isArray(scene?.worldSpawns)) {
      continue;
    }
    const spawn = scene.worldSpawns.find(
      (candidate: UnknownRecord) => candidate?.entityType === npcId || candidate?.id === npcId
    );
    if (spawn) {
      placements.push({ mapId, spawn });
    }
  }
  return placements;
}

function cloneSpawnForScene(spawn: UnknownRecord, existingSpawns: UnknownRecord[]): UnknownRecord {
  const usedIds = new Set(
    existingSpawns
      .map((entry: UnknownRecord) => entry?.id)
      .filter((value: unknown) => Number.isInteger(value))
  );
  const baseId = Number.isInteger(spawn?.id) ? spawn.id : spawn?.entityType;
  let nextId = Number.isInteger(baseId) ? baseId : 0;
  while (usedIds.has(nextId)) {
    nextId += 1000;
  }
  return {
    ...spawn,
    id: nextId,
  };
}

function loadLegacySceneData(): UnknownRecord {
  try {
    return JSON.parse(fs.readFileSync(SCENES_PATH, 'utf8'));
  } catch (_err) {
    return {};
  }
}

function buildCompatibilityOverrides(legacy: UnknownRecord): { sceneIds: Record<string, number>; scenes: Record<string, UnknownRecord> } {
  const overrides: { sceneIds: Record<string, number>; scenes: Record<string, UnknownRecord> } = {
    sceneIds: legacy?.sceneIds || {},
    scenes: {},
  };
  const encounterProfiles = legacy?.encounterProfiles || {};
  const roleOverrides = legacy?.roleOverrides || {};

  for (const [sceneId, scene] of Object.entries(legacy?.scenes || {}) as [string, UnknownRecord][]) {
    const nextScene: UnknownRecord = {};
    for (const key of ['isTown', 'respawnPoint', 'metadataNpcs', 'demoNpcs', 'tileTriggers', 'triggers']) {
      if (scene?.[key] !== undefined) {
        nextScene[key] = scene[key];
      }
    }
    if (Array.isArray(scene?.encounterTriggers) && scene.encounterTriggers.length > 0) {
      nextScene.encounterTriggers = scene.encounterTriggers.map((trigger: UnknownRecord) => {
        const profileRef = trigger?.action?.encounterProfileRef;
        if (!profileRef || !encounterProfiles[profileRef]) {
          return trigger;
        }
        const profile = encounterProfiles[profileRef];
        return {
          ...trigger,
          action: {
            ...trigger.action,
            encounterProfileRef: undefined,
          },
          encounterProfile: {
            source: profile.source,
            minEnemies: profile.minEnemies,
            maxEnemies: profile.maxEnemies,
            encounterChancePercent: profile.encounterChancePercent,
            cooldownMs: profile.cooldownMs,
            locationName: profile.locationName,
            roleOverrides: roleOverrides[profile.roleOverridesRef] || {},
          },
        };
      });
    }
    if (Object.keys(nextScene).length > 0) {
      overrides.scenes[sceneId] = nextScene;
    }
  }
  return overrides;
}

function cleanMapName(value: string): string {
  return value.replace(/\s+/g, ' ').trim() || value.trim();
}

function normalizeName(value: unknown): string {
  return typeof value === 'string'
    ? cleanMapName(value).toLowerCase()
    : '';
}

function deepMerge(base: UnknownRecord, override: UnknownRecord): UnknownRecord {
  if (Array.isArray(base) || Array.isArray(override)) {
    return Array.isArray(override) ? override.slice() : base;
  }
  const result: UnknownRecord = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value === undefined) {
      continue;
    }
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
      continue;
    }
    result[key] = Array.isArray(value) ? value.slice() : value;
  }
  return result;
}

function sortObject<T>(input: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(input).sort(([left], [right]) => left.localeCompare(right))
  );
}

main();
