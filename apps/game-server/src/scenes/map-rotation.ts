import type { GameSession } from '../types.js';

import { tryReadStaticJsonDocument } from '../db/static-json-store.js';
import { getMapDetails } from '../map-data.js';
import { resolveRepoPath } from '../runtime-paths.js';


type RotationTarget = {
  mapId: number;
  mapName: string;
  x: number;
  y: number;
};

type MapSummaryRecord = {
  mapId: number;
  mapName: string;
  mapDetailsPath?: string | null;
  sceneScriptAreasPath?: string | null;
};

type MapSummaryFile = {
  maps?: MapSummaryRecord[];
};

const MAP_SUMMARY_PATH = resolveRepoPath('data', 'client-derived', 'maps', 'map-summary.json');
const AUTO_MAP_ROTATION_ENABLED = process.env.AUTO_MAP_ROTATION === '1';
const AUTO_MAP_ROTATION_INTERVAL_MS = Number.isFinite(Number(process.env.AUTO_MAP_ROTATION_INTERVAL_MS))
  ? Math.max(500, Number(process.env.AUTO_MAP_ROTATION_INTERVAL_MS))
  : 4000;
const AUTO_MAP_ROTATION_START_DELAY_MS = Number.isFinite(Number(process.env.AUTO_MAP_ROTATION_START_DELAY_MS))
  ? Math.max(0, Number(process.env.AUTO_MAP_ROTATION_START_DELAY_MS))
  : 2000;
const AUTO_MAP_ROTATION_STABLE_DELAY_MS = Number.isFinite(Number(process.env.AUTO_MAP_ROTATION_STABLE_DELAY_MS))
  ? Math.max(250, Number(process.env.AUTO_MAP_ROTATION_STABLE_DELAY_MS))
  : 1500;
const AUTO_MAP_ROTATION_ONLY_MISSING = process.env.AUTO_MAP_ROTATION_ONLY_MISSING_SCENE_DUMPS === '1';
const AUTO_MAP_ROTATION_SESSION_ID = Number.isFinite(Number(process.env.AUTO_MAP_ROTATION_SESSION_ID))
  ? Number(process.env.AUTO_MAP_ROTATION_SESSION_ID)
  : null;

let activeRotationSessionId: number | null = null;

function parseExplicitMapIds(): number[] {
  const raw = process.env.AUTO_MAP_ROTATION_MAP_IDS || '';
  return raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function loadMapSummaryRecords(): MapSummaryRecord[] {
  const parsed = tryReadStaticJsonDocument<MapSummaryFile>(MAP_SUMMARY_PATH);
  if (!Array.isArray(parsed?.maps)) {
    return [];
  }
  return parsed.maps.filter((record) => record && Number.isInteger(record.mapId));
}

function buildRotationTargets(): RotationTarget[] {
  const explicitMapIds = parseExplicitMapIds();
  const allowedIds = explicitMapIds.length > 0 ? new Set(explicitMapIds) : null;

  return loadMapSummaryRecords()
    .filter((record) => {
      if (allowedIds && !allowedIds.has(record.mapId)) {
        return false;
      }
      if (!record.mapDetailsPath) {
        return false;
      }
      if (AUTO_MAP_ROTATION_ONLY_MISSING && record.sceneScriptAreasPath) {
        return false;
      }
      return true;
    })
    .sort((left, right) => left.mapId - right.mapId)
    .map((record) => {
      const details = getMapDetails(record.mapId);
      const home = details?.homeInfo;
      return {
        mapId: record.mapId,
        mapName: record.mapName,
        x: Number.isInteger(home?.x) ? home!.x : 8,
        y: Number.isInteger(home?.y) ? home!.y : 8,
      };
    });
}

function clearRotationTimer(session: GameSession): void {
  if (session.mapRotationTimer) {
    clearTimeout(session.mapRotationTimer);
    session.mapRotationTimer = null;
  }
}

function stopAutoMapRotation(session: GameSession): void {
  clearRotationTimer(session);
  session.mapRotationTargets = [];
  session.mapRotationIndex = 0;
  session.mapRotationAwaitingMapId = null;
  session.mapRotationLastSentAt = null;
  if (activeRotationSessionId === session.id) {
    activeRotationSessionId = null;
  }
}

function scheduleRotationAdvance(session: GameSession, delayMs: number): void {
  clearRotationTimer(session);
  session.mapRotationTimer = setTimeout(() => {
    if (activeRotationSessionId !== session.id) {
      return;
    }
    if (typeof session.sendSceneEnter !== 'function') {
      return;
    }

    const targets = buildRotationTargets();
    if (targets.length === 0) {
      session.log('Auto map rotation finished: no remaining targets.');
      stopAutoMapRotation(session);
      return;
    }

    session.mapRotationTargets = targets;
    const currentIndex = Number.isInteger(session.mapRotationIndex) ? Number(session.mapRotationIndex) : 0;
    const nextIndex = currentIndex % targets.length;
    const target = targets[nextIndex];
    session.mapRotationIndex = nextIndex + 1;
    session.mapRotationAwaitingMapId = target.mapId;
    session.mapRotationLastSentAt = Date.now();
    session.log(
      `Auto map rotation loading map=${target.mapId} name="${target.mapName}" pos=${target.x},${target.y} index=${nextIndex + 1}/${targets.length}`
    );
    session.sendSceneEnter(target.mapId, target.x, target.y);
  }, delayMs);
}

function startAutoMapRotation(session: GameSession): void {
  if (!AUTO_MAP_ROTATION_ENABLED) {
    return;
  }
  if (AUTO_MAP_ROTATION_SESSION_ID !== null && session.id !== AUTO_MAP_ROTATION_SESSION_ID) {
    return;
  }
  if (activeRotationSessionId !== null && activeRotationSessionId !== session.id) {
    session.log(`Skipping auto map rotation because session ${activeRotationSessionId} already owns it.`);
    return;
  }

  const targets = buildRotationTargets();
  if (targets.length === 0) {
    session.log('Auto map rotation is enabled but no valid targets were built.');
    return;
  }

  stopAutoMapRotation(session);
  activeRotationSessionId = session.id;
  session.mapRotationTargets = targets;
  session.mapRotationIndex = 0;
  session.mapRotationAwaitingMapId = null;
  session.mapRotationLastSentAt = null;
  session.log(
    `Starting auto map rotation targets=${targets.length} intervalMs=${AUTO_MAP_ROTATION_INTERVAL_MS} startDelayMs=${AUTO_MAP_ROTATION_START_DELAY_MS} stableDelayMs=${AUTO_MAP_ROTATION_STABLE_DELAY_MS}`
  );
  scheduleRotationAdvance(session, AUTO_MAP_ROTATION_START_DELAY_MS);
}

function notifyAutoMapRotationPosition(session: GameSession, mapId: number): void {
  if (activeRotationSessionId !== session.id) {
    return;
  }
  if (!Number.isInteger(session.mapRotationAwaitingMapId)) {
    return;
  }
  if (session.mapRotationAwaitingMapId !== mapId) {
    return;
  }
  session.log(`Auto map rotation confirmed map=${mapId} from live position update; scheduling next advance.`);
  session.mapRotationAwaitingMapId = null;
  scheduleRotationAdvance(session, Math.max(AUTO_MAP_ROTATION_INTERVAL_MS, AUTO_MAP_ROTATION_STABLE_DELAY_MS));
}

export {
  notifyAutoMapRotationPosition,
  startAutoMapRotation,
  stopAutoMapRotation,
};
