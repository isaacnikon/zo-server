import type { GameSession, ServerRunRequestData } from '../types.js';

import { queryJsonArrayPostgres } from '../db/postgres-pool.js';

type Rect = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
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

let cachedSceneInteractions: SceneInteraction[] | null = null;
let sceneInteractionsInitPromise: Promise<void> | null = null;

function normalizeInteraction(row: Partial<SceneInteraction>): SceneInteraction | null {
  if (
    !Number.isInteger(row?.sourceMapId) ||
    !Number.isInteger(row?.requestArg0) ||
    !Number.isInteger(row?.targetMapId) ||
    !Number.isInteger(row?.targetX) ||
    !Number.isInteger(row?.targetY) ||
    !row?.trigger
  ) {
    return null;
  }

  const sourceMapId = Number(row.sourceMapId);
  const requestArg0 = Number(row.requestArg0);
  const targetMapId = Number(row.targetMapId);
  const targetX = Number(row.targetX);
  const targetY = Number(row.targetY);
  const trigger = row.trigger;
  if (
    !Number.isInteger(trigger.minX) ||
    !Number.isInteger(trigger.maxX) ||
    !Number.isInteger(trigger.minY) ||
    !Number.isInteger(trigger.maxY)
  ) {
    return null;
  }

  return {
    kind: 'teleport',
    name: typeof row?.name === 'string' && row.name.length > 0 ? row.name : `Map ${sourceMapId} -> Map ${targetMapId}`,
    sourceMapId: sourceMapId >>> 0,
    trigger: {
      minX: trigger.minX | 0,
      maxX: trigger.maxX | 0,
      minY: trigger.minY | 0,
      maxY: trigger.maxY | 0,
    },
    requestSubcmd: 0x01,
    requestArg0: requestArg0 >>> 0,
    targetMapId: targetMapId >>> 0,
    targetMapName: typeof row?.targetMapName === 'string' ? row.targetMapName : null,
    targetX: targetX | 0,
    targetY: targetY | 0,
    sourceSceneScriptId: requestArg0 >>> 0,
    targetSceneScriptId: Number.isInteger(row?.targetSceneScriptId) ? (Number(row.targetSceneScriptId) >>> 0) : null,
    validation: typeof row?.validation === 'string' && row.validation.length > 0 ? row.validation : 'unknown',
  };
}

async function loadSceneInteractionsFromDatabase(): Promise<SceneInteraction[]> {
  const rows = await queryJsonArrayPostgres<Partial<SceneInteraction>>(
    `SELECT COALESCE(
       json_agg(
         json_build_object(
           'name', COALESCE(sm.map_name, 'Map ' || r.source_map_id::text) || ' -> ' || COALESCE(tm.map_name, 'Map ' || r.target_map_id::text),
           'sourceMapId', r.source_map_id,
           'requestArg0', r.source_scene_script_id,
           'trigger', json_build_object(
             'minX', r.trigger_min_x,
             'maxX', r.trigger_max_x,
             'minY', r.trigger_min_y,
             'maxY', r.trigger_max_y
           ),
           'targetMapId', r.target_map_id,
           'targetMapName', COALESCE(tm.map_name, 'Map ' || r.target_map_id::text),
           'targetSceneScriptId', r.target_scene_script_id,
           'targetX', r.target_x,
           'targetY', r.target_y,
           'validation', r.validation_status
         )
         ORDER BY r.source_map_id, r.source_scene_script_id
       ),
       '[]'::json
     )
     FROM game_map_routes r
     LEFT JOIN game_map_summaries sm
       ON sm.map_id = r.source_map_id
     LEFT JOIN game_map_summaries tm
       ON tm.map_id = r.target_map_id`
  );

  return rows
    .map((row) => normalizeInteraction(row))
    .filter((row): row is SceneInteraction => row !== null);
}

export async function initializeSceneInteractions(forceReload = false): Promise<void> {
  if (forceReload) {
    cachedSceneInteractions = null;
    sceneInteractionsInitPromise = null;
  }
  if (cachedSceneInteractions) {
    return;
  }
  if (!sceneInteractionsInitPromise) {
    sceneInteractionsInitPromise = loadSceneInteractionsFromDatabase()
      .then((interactions) => {
        cachedSceneInteractions = interactions;
      })
      .catch(() => {
        if (!cachedSceneInteractions) {
          cachedSceneInteractions = [];
        }
      })
      .finally(() => {
        sceneInteractionsInitPromise = null;
      });
  }
  await sceneInteractionsInitPromise;
}

function getSceneInteractions(): SceneInteraction[] {
  if (!cachedSceneInteractions) {
    if (!sceneInteractionsInitPromise) {
      void initializeSceneInteractions().catch(() => {
        // Keep scene interaction handling resilient if the DB snapshot is unavailable.
      });
    }
    return [];
  }
  return cachedSceneInteractions;
}

function isInsideTriggerArea(x: number, y: number, trigger: Rect): boolean {
  const edgeTolerance = 2;
  return (
    x >= (trigger.minX - edgeTolerance) &&
    x <= (trigger.maxX + edgeTolerance) &&
    y >= (trigger.minY - edgeTolerance) &&
    y <= (trigger.maxY + edgeTolerance)
  );
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
    if ((session.currentMapId >>> 0) !== (interaction.sourceMapId >>> 0)) {
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
  return getSceneInteractions().slice();
}

export {
  handleSceneInteractionRequest,
  isInsideTriggerArea,
  listSceneInteractions,
};
