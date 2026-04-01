import { handleFrogTeleporterMapArrival, syncFrogTeleporterClientState } from './frog-teleporter-service.js';
import { persistSessionPosition } from './position-persistence.js';
import {
  notifyTeamMemberPosition,
  rejectFollowerLocalMovement,
  shouldIgnoreClientPositionUpdateWhileFollowing,
  syncTeamFollowersToLeader,
} from './team-runtime.js';
import { notifyAutoMapRotationPosition } from '../scenes/map-rotation.js';
import { maybeTriggerFieldCombat } from '../scenes/field-combat.js';
import type { GameSession, PositionUpdate } from '../types.js';
import { syncWorldPresence } from '../world-state.js';

function clearPendingLoginQuestSyncTimer(session: GameSession): void {
  if (!session.pendingLoginQuestSyncTimer) {
    return;
  }
  clearTimeout(session.pendingLoginQuestSyncTimer);
  session.pendingLoginQuestSyncTimer = null;
}

function completePendingLoginQuestSync(session: GameSession, mapId: number): void {
  if (session.pendingLoginQuestSyncMapId !== (mapId >>> 0)) {
    return;
  }
  clearPendingLoginQuestSyncTimer(session);
  session.syncQuestStateToClient?.({ mode: 'login' });
  session.pendingLoginQuestSyncMapId = null;
}

function completePendingSceneSync(session: GameSession, mapId: number, reason: string): boolean {
  if (session.pendingSceneNpcSpawnMapId !== (mapId >>> 0)) {
    return false;
  }
  session.sendMapNpcSpawns?.(mapId >>> 0);
  session.syncQuestStateToClient?.({ mode: 'runtime' });
  syncFrogTeleporterClientState(session, reason);
  session.pendingSceneNpcSpawnMapId = null;
  return true;
}

export function handleClientPositionUpdate(session: GameSession, position: PositionUpdate): void {
  const nextMapId = position.mapId >>> 0;
  const nextX = position.x >>> 0;
  const nextY = position.y >>> 0;

  if (shouldIgnoreClientPositionUpdateWhileFollowing(session)) {
    rejectFollowerLocalMovement(session, nextMapId, nextX, nextY);
    completePendingSceneSync(session, session.currentMapId >>> 0, `team-follow-map:${session.currentMapId >>> 0}`);
    completePendingLoginQuestSync(session, session.currentMapId >>> 0);
    session.log(
      `Ignoring follower-reported position map=${nextMapId} pos=${nextX},${nextY} authoritative=${session.currentMapId >>> 0},${session.currentX >>> 0},${session.currentY >>> 0}`
    );
    return;
  }

  const previousMapId = session.currentMapId >>> 0;
  session.currentMapId = nextMapId;
  session.currentX = nextX;
  session.currentY = nextY;

  const frogTeleporterUnlocks = handleFrogTeleporterMapArrival(session, previousMapId, nextMapId);
  persistSessionPosition(session, { mapId: nextMapId, x: nextX, y: nextY });
  if (frogTeleporterUnlocks) {
    session.persistCurrentCharacter({
      frogTeleporterUnlocks,
    });
  }

  notifyAutoMapRotationPosition(session, nextMapId);
  const mapChangeReason = `map-change:${previousMapId}->${nextMapId}`;
  if (!completePendingSceneSync(session, nextMapId, mapChangeReason) && previousMapId !== nextMapId) {
    session.syncQuestStateToClient?.({ mode: 'runtime' });
    syncFrogTeleporterClientState(session, mapChangeReason);
  }
  completePendingLoginQuestSync(session, nextMapId);

  syncWorldPresence(
    session,
    previousMapId === nextMapId ? 'position-update' : mapChangeReason
  );
  const followedMembers = syncTeamFollowersToLeader(session);
  for (const follower of followedMembers) {
    syncWorldPresence(
      follower,
      previousMapId === nextMapId ? 'team-follow-position' : `team-follow-map:${previousMapId}->${nextMapId}`
    );
    notifyTeamMemberPosition(follower);
  }
  notifyTeamMemberPosition(session);
  session.log(`Position update map=${nextMapId} pos=${nextX},${nextY}`);
  maybeTriggerFieldCombat(session, nextMapId, nextX, nextY);
}
