import fs from 'fs';
import type { GameSession, ServerRunRequestData } from '../types';

const { resolveRepoPath } = require('../runtime-paths');

type SessionLike = GameSession & Record<string, any>;

type Rect = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type TeleportTargetCandidate = {
  mapId?: number | null;
  mapName?: string | null;
  validation?: string;
};

type TeleporterRecord = {
  sceneScriptId: number;
  bbox: Rect;
  displayLabel?: string | null;
  targetCandidates?: TeleportTargetCandidate[];
};

type MapTeleporterRecord = {
  mapId: number;
  mapName: string;
  teleporterCount: number;
  teleporters: TeleporterRecord[];
};

type MapTeleporterFile = {
  maps: MapTeleporterRecord[];
};

type TeleportInteraction = {
  kind: 'teleport';
  name: string;
  sourceMapId: number;
  trigger: Rect;
  requestSubcmd: number;
  requestArg0: number;
  targetMapId: number;
  targetX: number;
  targetY: number;
  targetMapName?: string | null;
  sourceSceneScriptId: number;
  targetSceneScriptId?: number | null;
  validation: string;
};

type SceneInteraction = TeleportInteraction;

const MAP_TELEPORTERS_PATH = resolveRepoPath('data', 'client-derived', 'maps', 'map-teleporters.json');
const MANUAL_ROUTE_TARGETS = new Map<string, { mapId: number; mapName: string; validation: string }>([
  ['102:2', { mapId: 112, mapName: 'Cloud City', validation: 'validated-manually' }],
  ['105:1', { mapId: 112, mapName: 'Cloud City', validation: 'validated-manually' }],
  ['112:2', { mapId: 102, mapName: 'Bling Alley', validation: 'validated-manually' }],
  ['112:1', { mapId: 105, mapName: 'Fall Alley', validation: 'validated-manually' }],
  ['112:3', { mapId: 117, mapName: 'Limon District', validation: 'validated-manually' }],
  ['117:1', { mapId: 112, mapName: 'Cloud City', validation: 'validated-manually' }],
]);
const MANUAL_LANDING_OVERRIDES = new Map<string, { x: number; y: number }>([
  ['101:1:103', { x: 118, y: 189 }],
  ['103:1:101', { x: 72, y: 19 }],
  ['103:2:102', { x: 118, y: 189 }],
  ['102:1:103', { x: 8, y: 188 }],
  ['102:2:112', { x: 244, y: 92 }],
  ['112:2:102', { x: 14, y: 192 }],
  ['105:1:112', { x: 24, y: 492 }],
  ['112:1:105', { x: 109, y: 192 }],
  ['112:3:117', { x: 16, y: 74 }],
  ['117:1:112', { x: 220, y: 492 }],
]);

function isInsideTriggerArea(x: number, y: number, trigger: Rect): boolean {
  return x >= trigger.minX && x <= trigger.maxX && y >= trigger.minY && y <= trigger.maxY;
}

function validationRank(validation?: string | null): number {
  switch (validation) {
    case 'validated-manually':
    case 'screenshot-validated':
      return 4;
    case 'title-identified-manually':
      return 3;
    case 'ui-inferred':
      return 1;
    case 'script-extracted':
    default:
      return 0;
  }
}

function loadTeleporterData(): Map<number, MapTeleporterRecord> {
  const byMapId = new Map<number, MapTeleporterRecord>();
  if (!fs.existsSync(MAP_TELEPORTERS_PATH)) {
    return byMapId;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(MAP_TELEPORTERS_PATH, 'utf8')) as MapTeleporterFile;
    for (const record of parsed?.maps || []) {
      if (!record || !Number.isInteger(record.mapId) || !Array.isArray(record.teleporters)) {
        continue;
      }
      byMapId.set(record.mapId, record);
    }
  } catch (_error) {
    return byMapId;
  }

  return byMapId;
}

function chooseTargetCandidate(teleporter: TeleporterRecord): TeleportTargetCandidate | null {
  const candidates = (teleporter.targetCandidates || [])
    .filter((candidate) => Number.isInteger(candidate?.mapId))
    .map((candidate) => ({
      mapId: candidate.mapId || null,
      mapName: candidate.mapName || null,
      validation: candidate.validation || 'unknown',
      rank: validationRank(candidate.validation),
    }))
    .sort((left, right) => right.rank - left.rank);

  if (!candidates.length) {
    return null;
  }

  const distinctMapIds = new Set(candidates.map((candidate) => candidate.mapId));
  const best = candidates[0];
  if (best.rank >= 3) {
    return best;
  }
  if (distinctMapIds.size === 1) {
    return best;
  }
  return null;
}

function findReciprocalTeleporter(
  maps: Map<number, MapTeleporterRecord>,
  sourceMapId: number,
  targetMapId: number
): TeleporterRecord | null {
  const targetMap = maps.get(targetMapId);
  if (!targetMap) {
    return null;
  }

  let bestMatch: { teleporter: TeleporterRecord; rank: number } | null = null;
  for (const teleporter of targetMap.teleporters || []) {
    for (const candidate of teleporter.targetCandidates || []) {
      if (candidate?.mapId !== sourceMapId) {
        continue;
      }
      const rank = validationRank(candidate.validation);
      if (!bestMatch || rank > bestMatch.rank) {
        bestMatch = { teleporter, rank };
      }
    }
  }
  return bestMatch?.teleporter || null;
}

function deriveLandingPosition(
  maps: Map<number, MapTeleporterRecord>,
  sourceMapId: number,
  sourceSceneScriptId: number,
  targetMapId: number,
  reciprocalTeleporter: TeleporterRecord | null
): { x: number; y: number; targetSceneScriptId?: number | null } | null {
  const override = MANUAL_LANDING_OVERRIDES.get(`${sourceMapId}:${sourceSceneScriptId}:${targetMapId}`);
  if (override) {
    return { x: override.x, y: override.y, targetSceneScriptId: reciprocalTeleporter?.sceneScriptId || null };
  }

  if (!reciprocalTeleporter) {
    return null;
  }

  const targetMap = maps.get(targetMapId);
  const bbox = reciprocalTeleporter.bbox;
  const centerX = Math.round((bbox.minX + bbox.maxX) / 2);
  const centerY = Math.round((bbox.minY + bbox.maxY) / 2);
  const maxXHint = Math.max(...(targetMap?.teleporters || []).map((entry) => entry.bbox.maxX), bbox.maxX);
  const maxYHint = Math.max(...(targetMap?.teleporters || []).map((entry) => entry.bbox.maxY), bbox.maxY);
  const leftThreshold = 12;
  const topThreshold = 12;
  const rightThreshold = Math.max(leftThreshold + 20, maxXHint - 12);
  const bottomThreshold = Math.max(topThreshold + 20, maxYHint - 12);

  if (bbox.minX <= leftThreshold) {
    return { x: bbox.maxX + 8, y: centerY, targetSceneScriptId: reciprocalTeleporter.sceneScriptId };
  }
  if (bbox.maxX >= rightThreshold) {
    return { x: bbox.minX - 8, y: centerY, targetSceneScriptId: reciprocalTeleporter.sceneScriptId };
  }
  if (bbox.minY <= topThreshold) {
    return { x: centerX, y: bbox.maxY + 8, targetSceneScriptId: reciprocalTeleporter.sceneScriptId };
  }
  if (bbox.maxY >= bottomThreshold) {
    return { x: centerX, y: bbox.minY - 8, targetSceneScriptId: reciprocalTeleporter.sceneScriptId };
  }
  return { x: centerX, y: bbox.maxY + 8, targetSceneScriptId: reciprocalTeleporter.sceneScriptId };
}

function buildSceneInteractions(): SceneInteraction[] {
  const maps = loadTeleporterData();
  const interactions: SceneInteraction[] = [];

  for (const sourceMap of maps.values()) {
    for (const teleporter of sourceMap.teleporters || []) {
      if (!Number.isInteger(teleporter.sceneScriptId)) {
        continue;
      }
      const manualTarget = MANUAL_ROUTE_TARGETS.get(`${sourceMap.mapId}:${teleporter.sceneScriptId}`);
      const target = manualTarget || chooseTargetCandidate(teleporter);
      if (!target || !Number.isInteger(target.mapId)) {
        continue;
      }

      const reciprocal = findReciprocalTeleporter(maps, sourceMap.mapId, target.mapId || 0);
      const landing = deriveLandingPosition(maps, sourceMap.mapId, teleporter.sceneScriptId, target.mapId || 0, reciprocal);
      if (!landing) {
        continue;
      }

      interactions.push({
        kind: 'teleport',
        name: `${sourceMap.mapName} -> ${target.mapName || `Map ${target.mapId}`}`,
        sourceMapId: sourceMap.mapId,
        trigger: teleporter.bbox,
        requestSubcmd: 0x01,
        requestArg0: teleporter.sceneScriptId,
        targetMapId: target.mapId || 0,
        targetMapName: target.mapName || null,
        targetX: landing.x,
        targetY: landing.y,
        sourceSceneScriptId: teleporter.sceneScriptId,
        targetSceneScriptId: landing.targetSceneScriptId ?? null,
        validation: target.validation || 'unknown',
      });
    }
  }

  interactions.sort((left, right) => {
    if (left.sourceMapId !== right.sourceMapId) {
      return left.sourceMapId - right.sourceMapId;
    }
    return left.sourceSceneScriptId - right.sourceSceneScriptId;
  });
  return interactions;
}

const SCENE_INTERACTIONS: SceneInteraction[] = buildSceneInteractions();

function handleSceneInteractionRequest(session: SessionLike, request: ServerRunRequestData): boolean {
  if (typeof session.sendSceneEnter !== 'function') {
    return false;
  }

  const arg0 = request.rawArgs[0];
  for (const interaction of SCENE_INTERACTIONS) {
    if (request.subcmd !== interaction.requestSubcmd) {
      continue;
    }
    if (arg0 !== interaction.requestArg0) {
      continue;
    }
    if (session.currentMapId !== interaction.sourceMapId) {
      continue;
    }
    if (!isInsideTriggerArea(session.currentX, session.currentY, interaction.trigger)) {
      continue;
    }

    session.log(
      `Sending ${interaction.name} scene-enter transition map=${interaction.targetMapId} pos=${interaction.targetX},${interaction.targetY} sourcePos=${session.currentX},${session.currentY} validation=${interaction.validation}`
    );
    session.sendSceneEnter(interaction.targetMapId, interaction.targetX, interaction.targetY);
    return true;
  }

  return false;
}

function listSceneInteractions(): SceneInteraction[] {
  return SCENE_INTERACTIONS.slice();
}

export {
  handleSceneInteractionRequest,
  isInsideTriggerArea,
  listSceneInteractions,
};
