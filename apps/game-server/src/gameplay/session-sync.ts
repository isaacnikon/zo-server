import type { GameSession, QuestSyncMode } from '../types.js';

import { DEFAULT_FLAGS } from '../config.js';
import { buildEnterGameProgressPacket } from '../protocol/gameplay-packets.js';
import { ensureWorldPresence } from '../world-state.js';
import { syncInventoryStateToClient } from './inventory-runtime.js';
import { syncFrogTeleporterClientState } from './frog-teleporter-service.js';
import { sendSkillStateSync } from './skill-runtime.js';

const DEFAULT_LOGIN_QUEST_SYNC_DELAY_MS = 250;

type QuestClientSyncOptions = {
  mode?: QuestSyncMode;
  mapId?: number;
  delayMs?: number;
};

type RuntimeLocationClientSyncOptions = {
  mapId?: number;
  reason?: string;
  includeMapSpawns?: boolean;
  clearPendingScene?: boolean;
};

export function clearPendingLoginQuestSync(session: GameSession, clearMapId = false): void {
  if (session.pendingLoginQuestSyncTimer) {
    clearTimeout(session.pendingLoginQuestSyncTimer);
    session.pendingLoginQuestSyncTimer = null;
  }
  if (clearMapId) {
    session.pendingLoginQuestSyncMapId = null;
  }
}

export function ensureSessionBootstrapReady(session: GameSession): void {
  clearPendingLoginQuestSync(session, true);
  session.ensureQuestStateReady();
  ensureWorldPresence(session);
}

export function sendEnterGameProgress(session: GameSession): void {
  session.writePacket(
    buildEnterGameProgressPacket({
      runtimeId: session.runtimeId >>> 0,
      roleEntityType: (session.roleEntityType || session.entityType) & 0xffff,
      roleData: session.roleData >>> 0,
      x: session.currentX,
      y: session.currentY,
      name: session.charName,
      mapId: session.currentMapId,
    }),
    DEFAULT_FLAGS,
    `Sending enter-game success char="${session.charName}" runtimeId=0x${session.runtimeId.toString(16)} entity=0x${session.entityType.toString(16)} roleEntity=0x${session.roleEntityType.toString(16)} aptitude=${session.selectedAptitude} map=${session.currentMapId} pos=${session.currentX},${session.currentY}`
  );
}

export function syncEnterGameClientState(session: GameSession, reason = 'enter-game'): void {
  session.sendSelfStateAptitudeSync();
  syncFrogTeleporterClientState(session, reason);
  sendSkillStateSync(session, reason);
  syncInventoryStateToClient(session);
  session.scheduleEquipmentReplay();
  session.sendPetStateSync(reason);
}

export function syncQuestClientState(session: GameSession, options: QuestClientSyncOptions = {}): void {
  const mode: QuestSyncMode = options.mode || 'runtime';
  if (mode === 'login') {
    const mapId = (options.mapId ?? session.currentMapId) >>> 0;
    clearPendingLoginQuestSync(session);
    session.syncQuestStateToClient({ mode: 'login' });
    session.pendingLoginQuestSyncMapId = mapId;
    session.pendingLoginQuestSyncTimer = setTimeout(() => {
      session.pendingLoginQuestSyncTimer = null;
      if (session.socket.destroyed || session.pendingLoginQuestSyncMapId === null) {
        return;
      }
      session.syncQuestStateToClient({ mode: 'login' });
      session.pendingLoginQuestSyncMapId = null;
    }, options.delayMs ?? DEFAULT_LOGIN_QUEST_SYNC_DELAY_MS);
    return;
  }

  clearPendingLoginQuestSync(session, true);
  session.syncQuestStateToClient({ mode });
}

export function completePendingLoginQuestSync(session: GameSession, mapId: number): boolean {
  if (session.pendingLoginQuestSyncMapId !== (mapId >>> 0)) {
    return false;
  }
  clearPendingLoginQuestSync(session);
  session.syncQuestStateToClient({ mode: 'login' });
  session.pendingLoginQuestSyncMapId = null;
  return true;
}

export function syncRuntimeLocationClientState(
  session: GameSession,
  options: RuntimeLocationClientSyncOptions = {}
): void {
  const mapId = (options.mapId ?? session.currentMapId) >>> 0;
  if (options.includeMapSpawns) {
    session.sendMapNpcSpawns(mapId);
  }
  session.syncQuestStateToClient({ mode: 'runtime' });
  syncFrogTeleporterClientState(session, options.reason || 'runtime');
  if (options.clearPendingScene) {
    session.pendingSceneNpcSpawnMapId = null;
  }
}

export function completePendingSceneSync(session: GameSession, mapId: number, reason: string): boolean {
  if (session.pendingSceneNpcSpawnMapId !== (mapId >>> 0)) {
    return false;
  }
  syncRuntimeLocationClientState(session, {
    mapId,
    reason,
    includeMapSpawns: true,
    clearPendingScene: true,
  });
  return true;
}

export function resetObservedWorldSyncState(session: GameSession): void {
  session.visiblePlayerRuntimeIds.clear();
  session.observedPlayerPositions.clear();
  session.observedPetStates.clear();
}
