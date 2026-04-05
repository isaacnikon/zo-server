import { handleFrogTeleporterMapArrival } from './frog-teleporter-service.js';
import { persistSessionPosition } from './position-persistence.js';
import {
  completePendingLoginQuestSync,
  completePendingSceneSync,
  syncRuntimeLocationClientState,
} from './session-sync.js';
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

export async function handleClientPositionUpdate(session: GameSession, position: PositionUpdate): Promise<void> {
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
  await persistSessionPosition(session, { mapId: nextMapId, x: nextX, y: nextY });
  if (frogTeleporterUnlocks) {
    await session.persistCurrentCharacter({
      frogTeleporterUnlocks,
    });
  }

  notifyAutoMapRotationPosition(session, nextMapId);
  const mapChangeReason = `map-change:${previousMapId}->${nextMapId}`;
  if (!completePendingSceneSync(session, nextMapId, mapChangeReason) && previousMapId !== nextMapId) {
    syncRuntimeLocationClientState(session, {
      mapId: nextMapId,
      reason: mapChangeReason,
    });
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
