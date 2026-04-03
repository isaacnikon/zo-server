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

export type MapTeleporterFile = {
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

export type ManualTeleportOverrideFile = {
  routeTargets?: ManualRouteTargetOverride[];
  landingOverrides?: ManualLandingOverride[];
};

type ResolvedTeleportTarget = {
  mapId: number;
  mapName: string;
  validation: string;
};

export type CanonicalMapRoute = {
  sourceMapId: number;
  sourceMapName: string;
  sourceSceneScriptId: number;
  displayLabel: string | null;
  trigger: Rect;
  targetMapId: number;
  targetMapName: string;
  targetSceneScriptId: number | null;
  targetX: number;
  targetY: number;
  validation: string;
};

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

function buildTeleporterIndex(document: MapTeleporterFile | null | undefined): Map<number, MapTeleporterRecord> {
  const byMapId = new Map<number, MapTeleporterRecord>();
  for (const record of document?.maps || []) {
    if (!record || !Number.isInteger(record.mapId) || !Array.isArray(record.teleporters)) {
      continue;
    }
    byMapId.set(record.mapId >>> 0, record);
  }
  return byMapId;
}

function buildManualRouteTargets(overrides: ManualTeleportOverrideFile): Map<string, ResolvedTeleportTarget> {
  const byKey = new Map<string, ResolvedTeleportTarget>();
  for (const entry of overrides.routeTargets || []) {
    if (
      !Number.isInteger(entry?.sourceMapId) ||
      !Number.isInteger(entry?.sourceSceneScriptId) ||
      !Number.isInteger(entry?.targetMapId) ||
      typeof entry?.targetMapName !== 'string' ||
      entry.targetMapName.length < 1
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

function chooseTargetCandidate(teleporter: TeleporterRecord): ResolvedTeleportTarget | null {
  const candidates = (teleporter.targetCandidates || [])
    .filter((candidate) => Number.isInteger(candidate?.mapId))
    .map((candidate) => ({
      mapId: Number(candidate.mapId) >>> 0,
      mapName:
        typeof candidate?.mapName === 'string' && candidate.mapName.length > 0
          ? candidate.mapName
          : `Map ${Number(candidate.mapId) >>> 0}`,
      validation: candidate?.validation || 'unknown',
      rank: validationRank(candidate?.validation),
    }))
    .sort((left, right) => right.rank - left.rank);

  if (candidates.length < 1) {
    return null;
  }

  const distinctMapIds = new Set(candidates.map((candidate) => candidate.mapId));
  const best = candidates[0];
  if (best.rank >= 3 || distinctMapIds.size === 1) {
    return {
      mapId: best.mapId,
      mapName: best.mapName,
      validation: best.validation,
    };
  }

  return null;
}

function findReciprocalTeleporter(
  maps: Map<number, MapTeleporterRecord>,
  sourceMapId: number,
  targetMapId: number
): TeleporterRecord | null {
  const targetMap = maps.get(targetMapId >>> 0);
  if (!targetMap) {
    return null;
  }

  let bestMatch: { teleporter: TeleporterRecord; rank: number } | null = null;
  for (const teleporter of targetMap.teleporters || []) {
    for (const candidate of teleporter.targetCandidates || []) {
      if ((Number(candidate?.mapId || 0) >>> 0) !== (sourceMapId >>> 0)) {
        continue;
      }
      const rank = validationRank(candidate?.validation);
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
): { x: number; y: number; targetSceneScriptId: number | null } | null {
  const override = manualLandingOverrides.get(`${sourceMapId}:${sourceSceneScriptId}:${targetMapId}`);
  const targetMap = maps.get(targetMapId >>> 0);
  if (override) {
    // Canonical route seeding must honor operator-chosen landing points exactly.
    // The old runtime patch layer tried to "help" by discarding overrides that
    // landed inside a target teleporter, but that mutates the intended route and
    // makes the DB diverge from the reviewed fix. Bounce prevention should be
    // handled by validating/editing the canonical DB row, not by silently
    // rewriting manual landings during import.
    return {
      x: override.x,
      y: override.y,
      targetSceneScriptId: reciprocalTeleporter?.sceneScriptId ?? null,
    };
  }

  if (!reciprocalTeleporter) {
    return null;
  }

  const bbox = reciprocalTeleporter.bbox;
  const centerX = Math.round((bbox.minX + bbox.maxX) / 2);
  const centerY = Math.round((bbox.minY + bbox.maxY) / 2);
  const targetTeleporters = targetMap?.teleporters || [];
  const maxXHint = Math.max(...targetTeleporters.map((entry) => entry.bbox.maxX), bbox.maxX);
  const maxYHint = Math.max(...targetTeleporters.map((entry) => entry.bbox.maxY), bbox.maxY);
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

export function buildCanonicalMapRoutes(
  teleporterDocument: MapTeleporterFile | null | undefined,
  manualOverrides: ManualTeleportOverrideFile | null | undefined = {}
): CanonicalMapRoute[] {
  const maps = buildTeleporterIndex(teleporterDocument);
  const routeTargets = buildManualRouteTargets(manualOverrides || {});
  const landingOverrides = buildManualLandingOverrides(manualOverrides || {});
  const routes: CanonicalMapRoute[] = [];

  for (const sourceMap of maps.values()) {
    for (const teleporter of sourceMap.teleporters || []) {
      if (!Number.isInteger(teleporter?.sceneScriptId) || !teleporter?.bbox) {
        continue;
      }

      const resolvedTarget =
        routeTargets.get(`${sourceMap.mapId}:${teleporter.sceneScriptId}`) ||
        chooseTargetCandidate(teleporter);
      if (!resolvedTarget) {
        continue;
      }

      const reciprocal = findReciprocalTeleporter(maps, sourceMap.mapId, resolvedTarget.mapId);
      const landing = deriveLandingPosition(
        maps,
        landingOverrides,
        sourceMap.mapId,
        teleporter.sceneScriptId,
        resolvedTarget.mapId,
        reciprocal
      );
      if (!landing) {
        continue;
      }

      routes.push({
        sourceMapId: sourceMap.mapId >>> 0,
        sourceMapName: sourceMap.mapName || `Map ${sourceMap.mapId >>> 0}`,
        sourceSceneScriptId: teleporter.sceneScriptId >>> 0,
        displayLabel: teleporter.displayLabel || null,
        trigger: {
          minX: teleporter.bbox.minX | 0,
          maxX: teleporter.bbox.maxX | 0,
          minY: teleporter.bbox.minY | 0,
          maxY: teleporter.bbox.maxY | 0,
        },
        targetMapId: resolvedTarget.mapId >>> 0,
        targetMapName: resolvedTarget.mapName || `Map ${resolvedTarget.mapId >>> 0}`,
        targetSceneScriptId: landing.targetSceneScriptId ?? null,
        targetX: landing.x | 0,
        targetY: landing.y | 0,
        validation: resolvedTarget.validation || 'unknown',
      });
    }
  }

  routes.sort((left, right) => {
    if (left.sourceMapId !== right.sourceMapId) {
      return left.sourceMapId - right.sourceMapId;
    }
    return left.sourceSceneScriptId - right.sourceSceneScriptId;
  });

  return routes;
}
