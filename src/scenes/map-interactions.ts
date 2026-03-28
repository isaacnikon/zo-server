import fs from 'node:fs';
import type { GameSession, ServerRunRequestData } from '../types.js';

import { resolveRepoPath } from '../runtime-paths.js';


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

type ManualRouteTargetOverride = {
  sourceMapId: number;
  sourceSceneScriptId: number;
  targetMapId: number;
  targetMapName: string;
  validation?: string;
};

type ManualLandingOverride = {
  sourceMapId: number;
  sourceSceneScriptId: number;
  targetMapId: number;
  x: number;
  y: number;
};

type ManualTeleportOverrideFile = {
  routeTargets?: ManualRouteTargetOverride[];
  landingOverrides?: ManualLandingOverride[];
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
const MANUAL_TELEPORT_OVERRIDES_PATH = resolveRepoPath('data', 'teleport-route-overrides.json');

let cachedSceneInteractions: SceneInteraction[] | null = null;
let cachedSceneInteractionsVersion = '';

function isInsideTriggerArea(x: number, y: number, trigger: Rect): boolean {
  const edgeTolerance = 2;
  return (
    x >= (trigger.minX - edgeTolerance) &&
    x <= (trigger.maxX + edgeTolerance) &&
    y >= (trigger.minY - edgeTolerance) &&
    y <= (trigger.maxY + edgeTolerance)
  );
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

function getFileVersionToken(path: string): string {
  try {
    const stat = fs.statSync(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch (_error) {
    return 'missing';
  }
}

function loadManualTeleportOverrides(): ManualTeleportOverrideFile {
  if (!fs.existsSync(MANUAL_TELEPORT_OVERRIDES_PATH)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(MANUAL_TELEPORT_OVERRIDES_PATH, 'utf8')) as ManualTeleportOverrideFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function buildManualRouteTargets(overrides: ManualTeleportOverrideFile): Map<string, { mapId: number; mapName: string; validation: string }> {
  const byKey = new Map<string, { mapId: number; mapName: string; validation: string }>();
  for (const entry of overrides.routeTargets || []) {
    if (
      !Number.isInteger(entry?.sourceMapId) ||
      !Number.isInteger(entry?.sourceSceneScriptId) ||
      !Number.isInteger(entry?.targetMapId) ||
      typeof entry?.targetMapName !== 'string' ||
      entry.targetMapName.length === 0
    ) {
      continue;
    }
    byKey.set(`${entry.sourceMapId}:${entry.sourceSceneScriptId}`, {
      mapId: entry.targetMapId >>> 0,
      mapName: entry.targetMapName,
      validation: entry.validation || 'validated-manually',
    });
  }
  return byKey;
}

function buildManualLandingOverrides(overrides: ManualTeleportOverrideFile): Map<string, { x: number; y: number }> {
  const byKey = new Map<string, { x: number; y: number }>();
  for (const entry of overrides.landingOverrides || []) {
    if (
      !Number.isInteger(entry?.sourceMapId) ||
      !Number.isInteger(entry?.sourceSceneScriptId) ||
      !Number.isInteger(entry?.targetMapId) ||
      !Number.isInteger(entry?.x) ||
      !Number.isInteger(entry?.y)
    ) {
      continue;
    }
    byKey.set(`${entry.sourceMapId}:${entry.sourceSceneScriptId}:${entry.targetMapId}`, {
      x: entry.x | 0,
      y: entry.y | 0,
    });
  }
  return byKey;
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
  manualLandingOverrides: Map<string, { x: number; y: number }>,
  sourceMapId: number,
  sourceSceneScriptId: number,
  targetMapId: number,
  reciprocalTeleporter: TeleporterRecord | null
): { x: number; y: number; targetSceneScriptId?: number | null } | null {
  const override = manualLandingOverrides.get(`${sourceMapId}:${sourceSceneScriptId}:${targetMapId}`);
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
  const manualOverrides = loadManualTeleportOverrides();
  const manualRouteTargets = buildManualRouteTargets(manualOverrides);
  const manualLandingOverrides = buildManualLandingOverrides(manualOverrides);
  const interactions: SceneInteraction[] = [];

  for (const sourceMap of maps.values()) {
    for (const teleporter of sourceMap.teleporters || []) {
      if (!Number.isInteger(teleporter.sceneScriptId)) {
        continue;
      }
      const manualTarget = manualRouteTargets.get(`${sourceMap.mapId}:${teleporter.sceneScriptId}`);
      const target = manualTarget || chooseTargetCandidate(teleporter);
      if (!target || !Number.isInteger(target.mapId)) {
        continue;
      }

      const reciprocal = findReciprocalTeleporter(maps, sourceMap.mapId, target.mapId || 0);
      const landing = deriveLandingPosition(
        maps,
        manualLandingOverrides,
        sourceMap.mapId,
        teleporter.sceneScriptId,
        target.mapId || 0,
        reciprocal
      );
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

function getSceneInteractions(): SceneInteraction[] {
  const version = `${getFileVersionToken(MAP_TELEPORTERS_PATH)}|${getFileVersionToken(MANUAL_TELEPORT_OVERRIDES_PATH)}`;
  if (!cachedSceneInteractions || cachedSceneInteractionsVersion !== version) {
    cachedSceneInteractions = buildSceneInteractions();
    cachedSceneInteractionsVersion = version;
  }
  return cachedSceneInteractions;
}

function tryHandleManualRouteFallback(session: GameSession, request: ServerRunRequestData): boolean {
  const arg0 = Number.isInteger(request.rawArgs?.[0]) ? (request.rawArgs[0] >>> 0) : 0;
  if ((request.subcmd >>> 0) !== 0x01 || arg0 <= 0) {
    return false;
  }

  const maps = loadTeleporterData();
  const sourceMap = maps.get(session.currentMapId >>> 0);
  if (sourceMap?.teleporters?.some((teleporter) => (teleporter.sceneScriptId >>> 0) === arg0)) {
    return false;
  }

  const overrides = loadManualTeleportOverrides();
  const manualRouteTargets = buildManualRouteTargets(overrides);
  const manualLandingOverrides = buildManualLandingOverrides(overrides);
  const target = manualRouteTargets.get(`${session.currentMapId}:${arg0}`);
  if (!target) {
    return false;
  }

  const reciprocal = findReciprocalTeleporter(maps, session.currentMapId >>> 0, target.mapId >>> 0);
  const landing = deriveLandingPosition(
    maps,
    manualLandingOverrides,
    session.currentMapId >>> 0,
    arg0,
    target.mapId >>> 0,
    reciprocal
  );
  if (!landing) {
    return false;
  }

  session.log(
    `Sending manual scene-enter fallback map=${target.mapId} pos=${landing.x},${landing.y} sourceMap=${session.currentMapId} scene=${arg0} sourcePos=${session.currentX},${session.currentY} validation=${target.validation}`
  );
  session.sendSceneEnter(target.mapId >>> 0, landing.x, landing.y);
  return true;
}

function handleSceneInteractionRequest(session: GameSession, request: ServerRunRequestData): boolean {
  if (typeof session.sendSceneEnter !== 'function') {
    return false;
  }

  const arg0 = request.rawArgs[0];
  for (const interaction of getSceneInteractions()) {
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

  if (tryHandleManualRouteFallback(session, request)) {
    return true;
  }

  return false;
}

function listSceneInteractions(): SceneInteraction[] {
  return getSceneInteractions().slice();
}

export {
  handleSceneInteractionRequest,
  isInsideTriggerArea,
  listSceneInteractions,
};
