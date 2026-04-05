import type { GameSession, QuestSyncMode } from '../types.js';

import { DEFAULT_FLAGS } from '../config.js';
import { buildMapFieldEventSpawns } from '../gameplay/field-event-runtime.js';
import { buildMapGatheringNodes } from '../gameplay/gathering-runtime.js';
import {
  ensureSessionBootstrapReady,
  resetObservedWorldSyncState,
  sendEnterGameProgress,
  syncEnterGameClientState,
  syncQuestClientState,
} from '../gameplay/session-sync.js';
import { scheduleTeamStateSyncToClient, syncTeamStateToClient } from '../gameplay/team-runtime.js';
import { getMapBootstrapSpawns } from '../map-spawns.js';
import { buildSceneSpawnBatchPacket } from '../protocol/gameplay-packets.js';
import { questService } from '../quest2/index.js';
import { startAutoMapRotation } from '../scenes/map-rotation.js';
import { numberOrDefault } from '../character/normalize.js';
import { syncWorldPresence } from '../world-state.js';

type SpawnRecord = {
  id: number;
  entityType: number;
  x: number;
  y: number;
  dir: number;
  state: number;
};

export function sendEnterGameOk(session: GameSession, options: { syncMode?: QuestSyncMode } = {}): void {
  const syncMode: QuestSyncMode = options.syncMode || 'login';
  const runtimeBootstrap = syncMode === 'runtime';
  ensureSessionBootstrapReady(session);
  sendEnterGameProgress(session);
  syncEnterGameClientState(session, 'enter-game');
  session.sendMapNpcSpawns(session.currentMapId >>> 0);
  syncQuestClientState(session, {
    mode: syncMode,
    mapId: session.currentMapId >>> 0,
  });

  if (runtimeBootstrap) {
    // Post-combat / respawn bootstraps behave like a partial scene reload on the
    // client. Nearby player entities can disappear locally even though the server
    // still marks them visible. Clear the viewer-side cache first so world sync
    // respawns nearby players instead of assuming they are still on screen.
    resetObservedWorldSyncState(session);
  }

  syncWorldPresence(session, 'enter-game', { skipSourceViewerAdd: !runtimeBootstrap });
  startAutoMapRotation(session);
  if (runtimeBootstrap) {
    // Combat-exit and respawn bootstraps arrive while the client is still unwinding
    // fight UI state. Delay the team replay slightly so we do not interleave roster
    // packets with the client's final combat-ready/teardown messages.
    scheduleTeamStateSyncToClient(session, `enter-game:${syncMode}`, 220);
  } else {
    syncTeamStateToClient(session, `enter-game:${syncMode}`);
  }
}

function sendStaticNpcSpawns(session: GameSession, mapId: number): void {
  const staticNpcs = getMapBootstrapSpawns(mapId);
  const escortSpawns = buildEscortQuestRoleSpawns(session, mapId, staticNpcs.length);
  const fieldEventEntries = buildMapFieldEventSpawns(
    session.sharedState,
    mapId,
    staticNpcs.length + escortSpawns.length
  );
  session.fieldEventSpawns = new Map(
    fieldEventEntries.map((spawn) => [spawn.runtimeId >>> 0, spawn])
  );
  const fieldEventSpawns: SpawnRecord[] = fieldEventEntries.map((spawn) => ({
    id: spawn.runtimeId,
    entityType: spawn.entityType,
    x: spawn.x,
    y: spawn.y,
    dir: 0,
    state: 0,
  }));

  // Build gathering nodes for this map and store on session
  const gatheringNodes = buildMapGatheringNodes(mapId);
  session.gatheringNodes = gatheringNodes;
  session.activeGather = null;
  const gatheringSpawns: SpawnRecord[] = [...gatheringNodes.entries()].map(([runtimeId, node]) => ({
    id: runtimeId,
    entityType: node.templateId,
    x: node.x,
    y: node.y,
    dir: 0,
    state: 0,
  }));

  const allSpawns = [...staticNpcs, ...escortSpawns, ...fieldEventSpawns, ...gatheringSpawns];
  if (!Array.isArray(allSpawns) || allSpawns.length === 0) {
    return;
  }

  session.writePacket(
    buildSceneSpawnBatchPacket(allSpawns),
    DEFAULT_FLAGS,
    `Sending static NPC spawn batch cmd=0x03eb sub=0x15 map=${mapId} count=${allSpawns.length} base=${staticNpcs.length} escort=${escortSpawns.length} fieldEvents=${fieldEventSpawns.length} gather=${gatheringSpawns.length}`
  );
}

function buildEscortQuestRoleSpawns(
  session: GameSession,
  mapId: number,
  baseCount: number
): SpawnRecord[] {
  const activeInstances = Array.isArray(session.questStateV2?.active) ? session.questStateV2.active : [];
  if (activeInstances.length === 0) {
    return [];
  }

  const escortRoleIds = new Set<number>();
  for (const instance of activeInstances) {
    const definition = questService.getDefinition(numberOrDefault(instance?.questId, 0));
    const step = definition?.steps.find((entry) => entry.id === instance?.stepId) || null;
    const ui = step?.client || null;
    const stepMapId = step?.requirements.find((requirement) => requirement.kind === 'map_is')?.mapId || 0;
    if (
      !step ||
      step.kind !== 'escort' ||
      numberOrDefault(ui?.taskType, 0) !== 8 ||
      numberOrDefault(stepMapId, 0) !== mapId
    ) {
      continue;
    }
    const roleId = numberOrDefault(ui?.taskRoleNpcId, 0);
    if (roleId > 0) {
      escortRoleIds.add(roleId);
    }
  }

  let offset = 0;
  return [...escortRoleIds].map((roleId) => {
    offset += 1;
    return {
      id: (((mapId & 0xffff) << 16) | ((baseCount + offset) & 0xffff)) >>> 0,
      entityType: roleId & 0xffff,
      x: Math.max(0, (session.currentX + 1 + offset) & 0xffff),
      y: Math.max(0, session.currentY & 0xffff),
      dir: 0,
      state: 0,
    };
  });
}

export function sendMapNpcSpawns(session: GameSession, mapId: number): void {
  sendStaticNpcSpawns(session, mapId);
}
