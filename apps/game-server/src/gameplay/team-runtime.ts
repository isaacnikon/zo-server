import type { GameSession, TeamClientAction03FD, TeamClientAction03FE, TeamClientAction0442 } from '../types.js';

import { DEFAULT_FLAGS, SCENE_ENTER_LOAD_SUBCMD } from '../config.js';
import { persistSessionPosition } from './position-persistence.js';
import { syncRuntimeLocationClientState } from './session-sync.js';
import {
  buildEntityWalkSyncPacket,
  buildSceneEnterPacket,
  buildTeamConflictPacket,
  buildTeamCreatePacket,
  buildTeamDismissedPacket,
  buildTeamInvitePromptPacket,
  buildTeamInviteRefusedPacket,
  buildTeamJoinedNoticePacket,
  buildTeamLeaderChangedPacket,
  buildTeamLeaderRemovedMemberPacket,
  buildTeamMemberPositionPacket,
  buildTeamRemoveMemberPacket,
  buildTeamRosterSyncPacket,
} from '../protocol/gameplay-packets.js';

interface TeamRuntimeRecord {
  id: number;
  leaderSessionId: number;
  memberSessionIds: number[];
}

interface PendingTeamInvite {
  teamId: number;
  inviterSessionId: number;
  inviterActorId: number;
  inviterName: string;
  inviteeSessionId: number;
  createdAt: number;
}

interface SharedCombatQueuedActionAttack {
  round: number;
  kind: 'attack';
  attackMode: number;
  targetA: number;
  targetB: number;
  targetEntityId: number;
}

interface SharedCombatQueuedActionSkill {
  round: number;
  kind: 'skill';
  skillId: number;
  targetEntityId: number;
}

interface SharedCombatQueuedActionItem {
  round: number;
  kind: 'item';
  instanceId: number;
  targetEntityId: number;
}

interface SharedCombatQueuedActionDefend {
  round: number;
  kind: 'defend';
}

type SharedCombatQueuedAction =
  | SharedCombatQueuedActionAttack
  | SharedCombatQueuedActionSkill
  | SharedCombatQueuedActionItem
  | SharedCombatQueuedActionDefend;

interface TeamRuntimeState {
  nextTeamId: number;
  teams: Map<number, TeamRuntimeRecord>;
  teamIdBySessionId: Map<number, number>;
  pendingInvitesByInviteeSessionId: Map<number, PendingTeamInvite[]>;
  combatOwnerSessionIdByParticipantSessionId: Map<number, number>;
  combatParticipantSessionIdsByOwnerSessionId: Map<number, number[]>;
  combatPendingActionsByOwnerSessionId: Map<number, Map<number, SharedCombatQueuedAction>>;
  pendingClientResyncTimersBySessionId: Map<number, NodeJS.Timeout>;
}

const TEAM_MAX_MEMBERS = 5;
const TEAM_INVITE_FALLBACK_DISTANCE = 32;
const TEAM_FOLLOW_OFFSETS: Array<{ dx: number; dy: number }> = [
  { dx: 0, dy: 0 },
  { dx: -2, dy: 1 },
  { dx: 2, dy: 1 },
  { dx: -1, dy: -2 },
  { dx: 1, dy: -2 },
];

function getSessionsById(sharedState: Record<string, any>): Map<number, GameSession> {
  if (!(sharedState.sessionsById instanceof Map)) {
    sharedState.sessionsById = new Map<number, GameSession>();
  }
  return sharedState.sessionsById as Map<number, GameSession>;
}

function getTeamRuntimeState(sharedState: Record<string, any>): TeamRuntimeState {
  if (!(sharedState.teamRuntime instanceof Object)) {
    sharedState.teamRuntime = {
      nextTeamId: 1,
      teams: new Map<number, TeamRuntimeRecord>(),
      teamIdBySessionId: new Map<number, number>(),
      pendingInvitesByInviteeSessionId: new Map<number, PendingTeamInvite[]>(),
      combatOwnerSessionIdByParticipantSessionId: new Map<number, number>(),
      combatParticipantSessionIdsByOwnerSessionId: new Map<number, number[]>(),
      combatPendingActionsByOwnerSessionId: new Map<number, Map<number, SharedCombatQueuedAction>>(),
      pendingClientResyncTimersBySessionId: new Map<number, NodeJS.Timeout>(),
    } as TeamRuntimeState;
  }
  return sharedState.teamRuntime as TeamRuntimeState;
}

function getSessionById(sharedState: Record<string, any>, sessionId: number): GameSession | null {
  return getSessionsById(sharedState).get(sessionId >>> 0) || null;
}

function resolveSessionByActorId(sharedState: Record<string, any>, actorId: number): GameSession | null {
  const sessionsById = getSessionsById(sharedState);
  for (const candidate of sessionsById.values()) {
    if (
      (candidate.runtimeId >>> 0) === (actorId >>> 0) ||
      (candidate.roleData >>> 0) === (actorId >>> 0)
    ) {
      return candidate;
    }
  }
  return null;
}

function resolveTeamMemberIdentity(session: GameSession): number {
  const stableIdentity = session.roleData >>> 0;
  return stableIdentity !== 0 ? stableIdentity : (session.runtimeId >>> 0);
}

function getPendingFollowUpTargets(session: GameSession): number[] {
  if (!(session.sharedState.teamFollowUpTargetsBySessionId instanceof Map)) {
    return [];
  }

  const followUpTargetsBySessionId = session.sharedState.teamFollowUpTargetsBySessionId as Map<number, number[]>;
  return followUpTargetsBySessionId.get(session.id >>> 0) || [];
}

function clearPendingFollowUpTargets(sharedState: Record<string, any>, sessionId: number): void {
  if (!(sharedState.teamFollowUpTargetsBySessionId instanceof Map)) {
    return;
  }

  const followUpTargetsBySessionId = sharedState.teamFollowUpTargetsBySessionId as Map<number, number[]>;
  followUpTargetsBySessionId.delete(sessionId >>> 0);
}

function isEligibleInviteTarget(inviter: GameSession, candidate: GameSession): boolean {
  if ((candidate.id >>> 0) === (inviter.id >>> 0)) {
    return false;
  }

  if (candidate.socket?.destroyed) {
    return false;
  }

  if ((candidate.currentMapId >>> 0) !== (inviter.currentMapId >>> 0)) {
    return false;
  }

  if (getTeamForSession(candidate)) {
    return false;
  }

  return true;
}

function resolveInviteTargetFromFollowUp(session: GameSession): GameSession | null {
  for (const actorId of getPendingFollowUpTargets(session)) {
    const target = resolveSessionByActorId(session.sharedState, actorId >>> 0);
    if (target && isEligibleInviteTarget(session, target)) {
      return target;
    }
  }

  return null;
}

function resolveInviteTargetFallback(session: GameSession): GameSession | null {
  const candidates = [...getSessionsById(session.sharedState).values()].filter((candidate) => {
    if (!isEligibleInviteTarget(session, candidate)) {
      return false;
    }

    const dx = Math.abs((candidate.currentX >>> 0) - (session.currentX >>> 0));
    const dy = Math.abs((candidate.currentY >>> 0) - (session.currentY >>> 0));
    return dx + dy <= TEAM_INVITE_FALLBACK_DISTANCE;
  });

  if (candidates.length !== 1) {
    return null;
  }

  return candidates[0];
}

function getTeamForSession(session: GameSession): TeamRuntimeRecord | null {
  const state = getTeamRuntimeState(session.sharedState);
  const teamId = state.teamIdBySessionId.get(session.id >>> 0);
  if (!Number.isInteger(teamId)) {
    return null;
  }
  return state.teams.get(Number(teamId) >>> 0) || null;
}

function getTeamSessions(sharedState: Record<string, any>, team: TeamRuntimeRecord): GameSession[] {
  return team.memberSessionIds
    .map((sessionId) => getSessionById(sharedState, sessionId))
    .filter((candidate): candidate is GameSession => Boolean(candidate));
}

export function getTeamCombatParticipants(session: GameSession): GameSession[] {
  const team = getTeamForSession(session);
  if (!team || !isTeamLeader(session, team)) {
    return [session];
  }

  const participants = getTeamSessions(session.sharedState, team).filter((member) => {
    if (member.socket?.destroyed) {
      return false;
    }
    if (member.defeatRespawnPending) {
      return false;
    }
    if (member.combatState?.active) {
      return false;
    }
    return true;
  });

  return participants.length > 0 ? participants : [session];
}

export function beginSharedTeamCombat(owner: GameSession, participants: GameSession[]): void {
  const state = getTeamRuntimeState(owner.sharedState);
  const normalizedOwnerSessionId = owner.id >>> 0;
  const normalizedParticipantSessionIds = participants
    .map((participant) => participant.id >>> 0)
    .filter((sessionId, index, values) => values.indexOf(sessionId) === index);

  endSharedTeamCombat(owner);
  for (const participantSessionId of normalizedParticipantSessionIds) {
    const existingOwnerSessionId = state.combatOwnerSessionIdByParticipantSessionId.get(participantSessionId);
    if (Number.isInteger(existingOwnerSessionId)) {
      const existingOwner = getSessionById(owner.sharedState, Number(existingOwnerSessionId) >>> 0);
      if (existingOwner) {
        endSharedTeamCombat(existingOwner);
      }
    }
  }

  state.combatParticipantSessionIdsByOwnerSessionId.set(
    normalizedOwnerSessionId,
    normalizedParticipantSessionIds
  );
  state.combatPendingActionsByOwnerSessionId.set(normalizedOwnerSessionId, new Map());
  for (const participantSessionId of normalizedParticipantSessionIds) {
    state.combatOwnerSessionIdByParticipantSessionId.set(participantSessionId, normalizedOwnerSessionId);
  }
}

export function getSharedTeamCombatOwnerSession(session: GameSession): GameSession | null {
  const state = getTeamRuntimeState(session.sharedState);
  const ownerSessionId = state.combatOwnerSessionIdByParticipantSessionId.get(session.id >>> 0);
  if (!Number.isInteger(ownerSessionId)) {
    return null;
  }
  return getSessionById(session.sharedState, Number(ownerSessionId) >>> 0);
}

export function isSharedTeamCombatOwner(session: GameSession): boolean {
  const owner = getSharedTeamCombatOwnerSession(session);
  return owner !== null && (owner.id >>> 0) === (session.id >>> 0);
}

export function getSharedTeamCombatFollowers(session: GameSession): GameSession[] {
  if (!isSharedTeamCombatOwner(session)) {
    return [];
  }

  const state = getTeamRuntimeState(session.sharedState);
  const participantSessionIds = state.combatParticipantSessionIdsByOwnerSessionId.get(session.id >>> 0) || [];
  return participantSessionIds
    .map((participantSessionId) => getSessionById(session.sharedState, participantSessionId))
    .filter((participant): participant is GameSession => {
      if (!participant) {
        return false;
      }
      return (participant.id >>> 0) !== (session.id >>> 0);
    });
}

function isSharedTeamCombatRoundParticipant(participant: GameSession | null | undefined): participant is GameSession {
  if (!participant) {
    return false;
  }
  if (participant.socket?.destroyed) {
    return false;
  }
  if (!participant.combatState?.active) {
    return false;
  }
  if ((participant.currentHealth || 0) <= 0) {
    return false;
  }
  return true;
}

export function getSharedTeamCombatRoundParticipants(owner: GameSession): GameSession[] {
  if (!isSharedTeamCombatOwner(owner) || !owner.combatState?.active) {
    return [];
  }

  const state = getTeamRuntimeState(owner.sharedState);
  const participantSessionIds = state.combatParticipantSessionIdsByOwnerSessionId.get(owner.id >>> 0) || [];
  return participantSessionIds
    .map((participantSessionId) => getSessionById(owner.sharedState, participantSessionId))
    .filter(isSharedTeamCombatRoundParticipant);
}

export function endSharedTeamCombat(session: GameSession): void {
  const state = getTeamRuntimeState(session.sharedState);
  const owner = getSharedTeamCombatOwnerSession(session);
  const ownerSessionId = owner ? (owner.id >>> 0) : (session.id >>> 0);
  const participantSessionIds = state.combatParticipantSessionIdsByOwnerSessionId.get(ownerSessionId) || [];

  state.combatParticipantSessionIdsByOwnerSessionId.delete(ownerSessionId);
  state.combatPendingActionsByOwnerSessionId.delete(ownerSessionId);
  for (const participantSessionId of participantSessionIds) {
    state.combatOwnerSessionIdByParticipantSessionId.delete(participantSessionId >>> 0);
  }
}

export function removeSharedTeamCombatParticipant(session: GameSession): GameSession | null {
  const state = getTeamRuntimeState(session.sharedState);
  const owner = getSharedTeamCombatOwnerSession(session);
  if (!owner) {
    return null;
  }

  const ownerSessionId = owner.id >>> 0;
  const participantSessionIds = state.combatParticipantSessionIdsByOwnerSessionId.get(ownerSessionId) || [];

  if ((owner.id >>> 0) === (session.id >>> 0)) {
    endSharedTeamCombat(owner);
    return owner;
  }

  const filteredParticipantSessionIds = participantSessionIds.filter(
    (participantSessionId) => (participantSessionId >>> 0) !== (session.id >>> 0)
  );
  state.combatParticipantSessionIdsByOwnerSessionId.set(ownerSessionId, filteredParticipantSessionIds);
  state.combatOwnerSessionIdByParticipantSessionId.delete(session.id >>> 0);

  const actions = state.combatPendingActionsByOwnerSessionId.get(ownerSessionId);
  if (actions instanceof Map) {
    actions.delete(session.id >>> 0);
  }

  return owner;
}

export function setSharedTeamCombatQueuedAction(
  owner: GameSession,
  participant: GameSession,
  action: SharedCombatQueuedAction
): void {
  const state = getTeamRuntimeState(owner.sharedState);
  let actions = state.combatPendingActionsByOwnerSessionId.get(owner.id >>> 0);
  if (!(actions instanceof Map)) {
    actions = new Map<number, SharedCombatQueuedAction>();
    state.combatPendingActionsByOwnerSessionId.set(owner.id >>> 0, actions);
  }
  if (action.kind === 'attack') {
    actions.set(participant.id >>> 0, {
      round: Math.max(1, action.round | 0),
      kind: 'attack',
      attackMode: action.attackMode & 0xff,
      targetA: action.targetA & 0xff,
      targetB: action.targetB & 0xff,
      targetEntityId: action.targetEntityId >>> 0,
    });
    return;
  }
  if (action.kind === 'skill') {
    actions.set(participant.id >>> 0, {
      round: Math.max(1, action.round | 0),
      kind: 'skill',
      skillId: action.skillId & 0xffff,
      targetEntityId: action.targetEntityId >>> 0,
    });
    return;
  }
  if (action.kind === 'item') {
    actions.set(participant.id >>> 0, {
      round: Math.max(1, action.round | 0),
      kind: 'item',
      instanceId: action.instanceId >>> 0,
      targetEntityId: action.targetEntityId >>> 0,
    });
    return;
  }
  actions.set(participant.id >>> 0, {
    round: Math.max(1, action.round | 0),
    kind: 'defend',
  });
}

export function consumeSharedTeamCombatQueuedActions(owner: GameSession): Map<number, SharedCombatQueuedAction> {
  const state = getTeamRuntimeState(owner.sharedState);
  const actions = state.combatPendingActionsByOwnerSessionId.get(owner.id >>> 0) || new Map<number, SharedCombatQueuedAction>();
  state.combatPendingActionsByOwnerSessionId.set(owner.id >>> 0, new Map<number, SharedCombatQueuedAction>());
  return actions;
}

export function clearSharedTeamCombatQueuedActions(owner: GameSession): void {
  const state = getTeamRuntimeState(owner.sharedState);
  state.combatPendingActionsByOwnerSessionId.set(owner.id >>> 0, new Map<number, SharedCombatQueuedAction>());
}

export function areAllSharedTeamCombatActionsReady(owner: GameSession): boolean {
  if (!owner.combatState?.active) {
    return false;
  }
  const state = getTeamRuntimeState(owner.sharedState);
  const participantSessionIds = getSharedTeamCombatRoundParticipants(owner).map((participant) => participant.id >>> 0);
  const actions = state.combatPendingActionsByOwnerSessionId.get(owner.id >>> 0) || new Map<number, SharedCombatQueuedAction>();
  const expectedRound = Math.max(1, owner.combatState.round | 0);
  if (participantSessionIds.length <= 0) {
    return false;
  }
  return participantSessionIds.every((participantSessionId) => {
    const action = actions.get(participantSessionId >>> 0);
    return Boolean(action) && ((action?.round || 0) >>> 0) === (expectedRound >>> 0);
  });
}

function clampFollowCoordinate(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.min(0xffff, Math.trunc(value)));
}

function getFollowTargetPosition(leader: GameSession, followerIndex: number): { x: number; y: number } {
  const offset = TEAM_FOLLOW_OFFSETS[followerIndex] || TEAM_FOLLOW_OFFSETS[TEAM_FOLLOW_OFFSETS.length - 1];
  return {
    x: clampFollowCoordinate((leader.currentX >>> 0) + offset.dx),
    y: clampFollowCoordinate((leader.currentY >>> 0) + offset.dy),
  };
}

function updateSessionTeamSnapshot(session: GameSession): void {
  const team = getTeamForSession(session);
  if (!team) {
    session.teamId = null;
    session.teamSize = 0;
    session.teamMembers = [];
    return;
  }

  const sessions = getTeamSessions(session.sharedState, team);
  session.teamId = team.id >>> 0;
  session.teamSize = sessions.length;
  session.teamMembers = sessions.map((candidate) => candidate.runtimeId >>> 0);
}

function syncTeamSnapshots(sharedState: Record<string, any>, team: TeamRuntimeRecord | null): void {
  if (!team) {
    return;
  }
  for (const session of getTeamSessions(sharedState, team)) {
    updateSessionTeamSnapshot(session);
  }
}

function clearInviteForInvitee(sharedState: Record<string, any>, inviteeSessionId: number, inviterActorId?: number): void {
  const state = getTeamRuntimeState(sharedState);
  const pending = state.pendingInvitesByInviteeSessionId.get(inviteeSessionId >>> 0) || [];
  if (pending.length === 0) {
    return;
  }

  const filtered = typeof inviterActorId === 'number'
    ? pending.filter((entry) => (entry.inviterActorId >>> 0) !== (inviterActorId >>> 0))
    : [];

  if (filtered.length > 0) {
    state.pendingInvitesByInviteeSessionId.set(inviteeSessionId >>> 0, filtered);
    return;
  }

  state.pendingInvitesByInviteeSessionId.delete(inviteeSessionId >>> 0);
}

function getPendingInvites(session: GameSession): PendingTeamInvite[] {
  const state = getTeamRuntimeState(session.sharedState);
  return state.pendingInvitesByInviteeSessionId.get(session.id >>> 0) || [];
}

function clearFollowerSyncState(sharedState: Record<string, any>, sessionId: number): void {
  void sharedState;
  void sessionId;
}

function getPendingInvite(session: GameSession, inviterActorId: number): PendingTeamInvite | null {
  return getPendingInvites(session).find((entry) => (entry.inviterActorId >>> 0) === (inviterActorId >>> 0)) || null;
}

function appendPendingInvite(session: GameSession, invite: PendingTeamInvite): void {
  const state = getTeamRuntimeState(session.sharedState);
  const pending = state.pendingInvitesByInviteeSessionId.get(session.id >>> 0) || [];
  const deduped = pending.filter((entry) => (entry.inviterActorId >>> 0) !== (invite.inviterActorId >>> 0));
  deduped.push(invite);
  state.pendingInvitesByInviteeSessionId.set(session.id >>> 0, deduped);
}

function writeTeamPacket(session: GameSession, packet: Buffer, message: string): void {
  session.writePacket(packet, DEFAULT_FLAGS, message);
}

function sendTeamCreateState(session: GameSession, reason: string): void {
  writeTeamPacket(
    session,
    buildTeamCreatePacket(),
    `Sending team init cmd=0x402 sub=0x01 reason=${reason}`
  );
}

function buildTeamRosterPacketMembers(sharedState: Record<string, any>, team: TeamRuntimeRecord): Array<{
  actorId: number;
  roleEntityType: number;
  level: number;
  displayName: string;
  status: number;
} | null> {
  const members: Array<{
    actorId: number;
    roleEntityType: number;
    level: number;
    displayName: string;
    status: number;
  } | null> = getTeamSessions(sharedState, team).map((member) => ({
    actorId: member.runtimeId >>> 0,
    identityId: resolveTeamMemberIdentity(member),
    roleEntityType: (member.roleEntityType || member.entityType || 0) & 0xffff,
    level: member.level >>> 0,
    displayName: member.charName || '',
    status: 1,
  }));

  while (members.length < TEAM_MAX_MEMBERS) {
    members.push(null);
  }

  return members.slice(0, TEAM_MAX_MEMBERS);
}

function sendTeamRosterSync(session: GameSession, team: TeamRuntimeRecord, reason: string): void {
  const leaderSession = getSessionById(session.sharedState, team.leaderSessionId >>> 0);
  writeTeamPacket(
    session,
    buildTeamRosterSyncPacket({
      leaderIdentityId: leaderSession ? resolveTeamMemberIdentity(leaderSession) : 0,
      members: buildTeamRosterPacketMembers(session.sharedState, team),
    }),
    `Sending team roster sync cmd=0x402 sub=0x08 reason=${reason}`
  );
}

function sendTeamMemberPositionsToRecipient(session: GameSession, team: TeamRuntimeRecord, reason: string): void {
  for (const teammate of getTeamSessions(session.sharedState, team)) {
    if (session.id === teammate.id) {
      continue;
    }
    if ((session.currentMapId >>> 0) !== (teammate.currentMapId >>> 0)) {
      continue;
    }
    writeTeamPacket(
      session,
      buildTeamMemberPositionPacket(teammate.runtimeId >>> 0, teammate.currentX >>> 0, teammate.currentY >>> 0),
      `Sending team position cmd=0x402 sub=0x17 actorId=${teammate.runtimeId >>> 0} pos=${teammate.currentX >>> 0},${teammate.currentY >>> 0} reason=${reason}`
    );
  }
}

function sendFollowerSceneEnter(session: GameSession, mapId: number, x: number, y: number, reason: string): void {
  session.pendingSceneNpcSpawnMapId = mapId >>> 0;
  writeTeamPacket(
    session,
    buildSceneEnterPacket(mapId >>> 0, x >>> 0, y >>> 0, SCENE_ENTER_LOAD_SUBCMD),
    `Sending team follow scene-enter cmd=0x3e9 sub=0x${SCENE_ENTER_LOAD_SUBCMD.toString(16)} map=${mapId >>> 0} pos=${x >>> 0},${y >>> 0} reason=${reason}`
  );
  syncRuntimeLocationClientState(session, {
    mapId,
    reason: `team-follow-map:${mapId >>> 0}`,
    includeMapSpawns: true,
    clearPendingScene: true,
  });
}

function sendFollowerWalkSync(session: GameSession, x: number, y: number, reason: string): void {
  writeTeamPacket(
    session,
    buildEntityWalkSyncPacket(session.runtimeId >>> 0, x >>> 0, y >>> 0),
    `Sending team follow walk cmd=0x3ed runtimeId=${session.runtimeId >>> 0} pos=${x >>> 0},${y >>> 0} reason=${reason}`
  );
}

function persistFollowedMemberPosition(session: GameSession): void {
  if (typeof session.persistCurrentCharacter !== 'function') {
    return;
  }
  persistSessionPosition(session, {
    mapId: session.currentMapId >>> 0,
    x: session.currentX >>> 0,
    y: session.currentY >>> 0,
  });
}

function sendTeamDismissed(session: GameSession, reason: string): void {
  writeTeamPacket(
    session,
    buildTeamDismissedPacket(),
    `Sending team dismissed cmd=0x402 sub=0x07 reason=${reason}`
  );
}

function sendTeamConflict(session: GameSession, reason: string): void {
  writeTeamPacket(
    session,
    buildTeamConflictPacket(),
    `Sending team conflict cmd=0x402 sub=0x12 reason=${reason}`
  );
}

function createTeamForLeader(session: GameSession): TeamRuntimeRecord {
  const state = getTeamRuntimeState(session.sharedState);
  const existing = getTeamForSession(session);
  if (existing) {
    return existing;
  }

  const team: TeamRuntimeRecord = {
    id: state.nextTeamId >>> 0,
    leaderSessionId: session.id >>> 0,
    memberSessionIds: [session.id >>> 0],
  };

  state.nextTeamId += 1;
  state.teams.set(team.id >>> 0, team);
  state.teamIdBySessionId.set(session.id >>> 0, team.id >>> 0);
  updateSessionTeamSnapshot(session);
  sendTeamCreateState(session, 'create-team');
  return team;
}

function deleteTeam(sharedState: Record<string, any>, team: TeamRuntimeRecord): void {
  const state = getTeamRuntimeState(sharedState);
  state.teams.delete(team.id >>> 0);
  for (const memberSessionId of team.memberSessionIds) {
    state.teamIdBySessionId.delete(memberSessionId >>> 0);
  }
}

function promoteLeaderIfNeeded(team: TeamRuntimeRecord): void {
  if (team.memberSessionIds.length === 0) {
    return;
  }
  if (team.memberSessionIds.includes(team.leaderSessionId >>> 0)) {
    return;
  }
  team.leaderSessionId = team.memberSessionIds[0] >>> 0;
}

function isTeamLeader(session: GameSession, team: TeamRuntimeRecord | null = getTeamForSession(session)): boolean {
  return team !== null && (team.leaderSessionId >>> 0) === (session.id >>> 0);
}

function broadcastLeaderChanged(sharedState: Record<string, any>, team: TeamRuntimeRecord, leaderActorId: number, reason: string): void {
  for (const member of getTeamSessions(sharedState, team)) {
    writeTeamPacket(
      member,
      buildTeamLeaderChangedPacket({ actorId: leaderActorId >>> 0 }),
      `Sending team leader change cmd=0x402 sub=0x0d actorId=${leaderActorId >>> 0} reason=${reason}`
    );
  }
}

function ensureTeamForInvite(session: GameSession): TeamRuntimeRecord | null {
  const existing = getTeamForSession(session);
  if (existing) {
    return existing;
  }
  return createTeamForLeader(session);
}

function syncTeamMemberPositions(sharedState: Record<string, any>, team: TeamRuntimeRecord): void {
  const members = getTeamSessions(sharedState, team);
  for (const recipient of members) {
    for (const teammate of members) {
      if (recipient.id === teammate.id) {
        continue;
      }
      if ((recipient.currentMapId >>> 0) !== (teammate.currentMapId >>> 0)) {
        continue;
      }
      writeTeamPacket(
        recipient,
        buildTeamMemberPositionPacket(teammate.runtimeId >>> 0, teammate.currentX >>> 0, teammate.currentY >>> 0),
        `Sending team position cmd=0x402 sub=0x17 actorId=${teammate.runtimeId >>> 0} pos=${teammate.currentX >>> 0},${teammate.currentY >>> 0} reason=team-sync`
      );
    }
  }
}

function inviteTarget(session: GameSession, target: GameSession): boolean {
  if (target.id === session.id) {
    return false;
  }

  const existingTeam = getTeamForSession(session);
  if (existingTeam && !isTeamLeader(session, existingTeam)) {
    session.log(`Ignoring team invite from non-leader actorId=${session.runtimeId >>> 0}`);
    return false;
  }

  const inviterTeam = ensureTeamForInvite(session);
  if (!inviterTeam) {
    return false;
  }

  if (inviterTeam.memberSessionIds.length >= TEAM_MAX_MEMBERS) {
    sendTeamConflict(session, 'team-full');
    return false;
  }

  if (getTeamForSession(target)) {
    sendTeamConflict(session, 'target-already-in-team');
    return false;
  }

  appendPendingInvite(target, {
    teamId: inviterTeam.id >>> 0,
    inviterSessionId: session.id >>> 0,
    inviterActorId: session.runtimeId >>> 0,
    inviterName: session.charName || '',
    inviteeSessionId: target.id >>> 0,
    createdAt: Date.now(),
  });

  writeTeamPacket(
    target,
    buildTeamInvitePromptPacket({
      actorId: session.runtimeId >>> 0,
      inviterName: session.charName || '',
      requestType: 0,
    }),
    `Sending team invite prompt cmd=0x402 sub=0x02 actorId=${session.runtimeId >>> 0}`
  );

  session.log(`Team invite queued target=${target.charName} actorId=${target.runtimeId >>> 0} teamId=${inviterTeam.id >>> 0}`);
  return true;
}

function acceptInvite(session: GameSession, invite: PendingTeamInvite): boolean {
  const teamState = getTeamRuntimeState(session.sharedState);
  const team = teamState.teams.get(invite.teamId >>> 0) || null;
  if (!team) {
    clearInviteForInvitee(session.sharedState, session.id >>> 0, invite.inviterActorId >>> 0);
    return false;
  }

  if (getTeamForSession(session)) {
    sendTeamConflict(session, 'invitee-already-in-team');
    clearInviteForInvitee(session.sharedState, session.id >>> 0, invite.inviterActorId >>> 0);
    return false;
  }

  if (team.memberSessionIds.length >= TEAM_MAX_MEMBERS) {
    sendTeamConflict(session, 'team-full-on-accept');
    clearInviteForInvitee(session.sharedState, session.id >>> 0, invite.inviterActorId >>> 0);
    return false;
  }

  team.memberSessionIds.push(session.id >>> 0);
  teamState.teamIdBySessionId.set(session.id >>> 0, team.id >>> 0);
  clearInviteForInvitee(session.sharedState, session.id >>> 0);

  const sessions = getTeamSessions(session.sharedState, team);
  for (const member of sessions) {
    updateSessionTeamSnapshot(member);
    sendTeamRosterSync(member, team, member.id === session.id ? 'accept-invite' : 'member-joined');
    if ((member.id >>> 0) !== (session.id >>> 0)) {
      writeTeamPacket(
        member,
        buildTeamJoinedNoticePacket(),
        `Sending team joined notice cmd=0x402 sub=0x09 reason=member-joined actorId=${session.runtimeId >>> 0}`
      );
    }
  }
  const leaderSession = getSessionById(session.sharedState, team.leaderSessionId >>> 0);
  if (leaderSession) {
    broadcastLeaderChanged(
      session.sharedState,
      team,
      resolveTeamMemberIdentity(leaderSession),
      'accept-invite-leader-confirm'
    );
  }
  syncTeamMemberPositions(session.sharedState, team);

  return true;
}

function declineInvite(session: GameSession, inviterActorId: number): boolean {
  const invite = getPendingInvite(session, inviterActorId >>> 0);
  if (!invite) {
    return false;
  }

  const inviter = getSessionById(session.sharedState, invite.inviterSessionId >>> 0);
  clearInviteForInvitee(session.sharedState, session.id >>> 0, inviterActorId >>> 0);

  if (inviter) {
    writeTeamPacket(
      inviter,
      buildTeamInviteRefusedPacket(session.charName || ''),
      `Sending team invite refusal cmd=0x402 sub=0x04 refuser="${session.charName || ''}"`
    );
  }

  return true;
}

function removeMemberFromTeamInternal(
  session: GameSession,
  team: TeamRuntimeRecord,
  target: GameSession,
  reason: 'leave' | 'kick' | 'disconnect'
): void {
  const state = getTeamRuntimeState(session.sharedState);
  team.memberSessionIds = team.memberSessionIds.filter((sessionId) => (sessionId >>> 0) !== (target.id >>> 0));
  state.teamIdBySessionId.delete(target.id >>> 0);
  clearFollowerSyncState(session.sharedState, target.id >>> 0);
  clearInviteForInvitee(session.sharedState, target.id >>> 0);

  if (team.memberSessionIds.length === 0) {
    deleteTeam(session.sharedState, team);
    target.teamId = null;
    target.teamSize = 0;
    target.teamMembers = [];
    if (reason !== 'disconnect') {
      sendTeamDismissed(target, `remove-last:${reason}`);
    }
    return;
  }

  const leaderWasRemoved = (team.leaderSessionId >>> 0) === (target.id >>> 0);
  if (leaderWasRemoved) {
    promoteLeaderIfNeeded(team);
  }

  const leaderSession = getSessionById(session.sharedState, team.leaderSessionId >>> 0);
  const leaderActorId = leaderSession ? resolveTeamMemberIdentity(leaderSession) : 0;
  for (const member of getTeamSessions(session.sharedState, team)) {
    writeTeamPacket(
      member,
      buildTeamRemoveMemberPacket(resolveTeamMemberIdentity(target), leaderActorId),
      `Sending team remove member cmd=0x402 sub=0x05 actorId=${resolveTeamMemberIdentity(target)} reason=${reason}`
    );
  }

  if (reason !== 'disconnect') {
    sendTeamDismissed(target, `removed-from-team:${reason}`);
  }

  target.teamId = null;
  target.teamSize = 0;
  target.teamMembers = [];
  syncTeamSnapshots(session.sharedState, team);

  if (leaderWasRemoved && leaderSession) {
    broadcastLeaderChanged(
      session.sharedState,
      team,
      resolveTeamMemberIdentity(leaderSession),
      `leader-removed:${reason}`
    );
  }
}

function leaveTeam(session: GameSession, reason: 'leave' | 'kick' | 'disconnect' = 'leave'): boolean {
  const team = getTeamForSession(session);
  if (!team) {
    return false;
  }

  removeMemberFromTeamInternal(session, team, session, reason);
  return true;
}

function dismissTeamForLeader(session: GameSession, reason: string): boolean {
  const team = getTeamForSession(session);
  if (!team) {
    return false;
  }

  if ((team.leaderSessionId >>> 0) !== (session.id >>> 0)) {
    return leaveTeam(session, 'leave');
  }

  const members = getTeamSessions(session.sharedState, team);
  deleteTeam(session.sharedState, team);
  for (const member of members) {
    member.teamId = null;
    member.teamSize = 0;
    member.teamMembers = [];
    sendTeamDismissed(member, reason);
  }
  return true;
}

function kickMember(session: GameSession, actorId: number): boolean {
  const team = getTeamForSession(session);
  if (!team || !isTeamLeader(session, team)) {
    return false;
  }

  const target = resolveSessionByActorId(session.sharedState, actorId >>> 0);
  if (!target || (target.id >>> 0) === (session.id >>> 0)) {
    return false;
  }

  const targetTeam = getTeamForSession(target);
  if (!targetTeam || (targetTeam.id >>> 0) !== (team.id >>> 0)) {
    return false;
  }

  for (const member of getTeamSessions(session.sharedState, team)) {
    writeTeamPacket(
      member,
      buildTeamLeaderRemovedMemberPacket(resolveTeamMemberIdentity(target)),
      `Sending team kick notice cmd=0x402 sub=0x0a actorId=${resolveTeamMemberIdentity(target)}`
    );
  }

  removeMemberFromTeamInternal(session, team, target, 'kick');
  return true;
}

function promoteMember(session: GameSession, actorId: number): boolean {
  const team = getTeamForSession(session);
  if (!team || !isTeamLeader(session, team)) {
    return false;
  }

  const target = resolveSessionByActorId(session.sharedState, actorId >>> 0);
  if (!target) {
    return false;
  }

  const targetTeam = getTeamForSession(target);
  if (!targetTeam || (targetTeam.id >>> 0) !== (team.id >>> 0)) {
    return false;
  }

  team.leaderSessionId = target.id >>> 0;
  syncTeamSnapshots(session.sharedState, team);
  broadcastLeaderChanged(session.sharedState, team, resolveTeamMemberIdentity(target), 'promote-member');
  return true;
}

function handleInviteOrAccept(session: GameSession, targetIds: number[]): boolean {
  const actorId = Number.isInteger(targetIds[0]) ? (targetIds[0] >>> 0) : 0;
  if (!actorId) {
    const pendingInvites = getPendingInvites(session);
    if (pendingInvites.length === 1) {
      return acceptInvite(session, pendingInvites[0]);
    }

    const followUpTarget = resolveInviteTargetFromFollowUp(session);
    if (followUpTarget) {
      clearPendingFollowUpTargets(session.sharedState, session.id >>> 0);
      session.log(
        `Resolved zero-id team invite from follow-up actorId=${followUpTarget.runtimeId >>> 0} name=${followUpTarget.charName || ''}`
      );
      return inviteTarget(session, followUpTarget);
    }

    const fallbackTarget = resolveInviteTargetFallback(session);
    clearPendingFollowUpTargets(session.sharedState, session.id >>> 0);
    if (!fallbackTarget) {
      session.log('Team invite fallback could not resolve a unique nearby target');
      return false;
    }

    session.log(
      `Resolved zero-id team invite to nearby target actorId=${fallbackTarget.runtimeId >>> 0} name=${fallbackTarget.charName || ''}`
    );
    return inviteTarget(session, fallbackTarget);
  }

  const pending = getPendingInvite(session, actorId);
  if (pending) {
    return acceptInvite(session, pending);
  }

  const target = resolveSessionByActorId(session.sharedState, actorId >>> 0);
  if (!target) {
    return false;
  }

  return inviteTarget(session, target);
}

export function handleTeamActionPrimary(session: GameSession, action: TeamClientAction03FD): boolean {
  if (!action) {
    return false;
  }

  if (action.subcmd === 0x02) {
    createTeamForLeader(session);
    return true;
  }

  if (action.subcmd === 0x03) {
    return dismissTeamForLeader(session, 'primary-dismiss');
  }

  session.log(`Unhandled team primary action sub=0x${action.subcmd.toString(16)}`);
  return false;
}

export function handleTeamActionSecondary(session: GameSession, action: TeamClientAction03FE): boolean {
  if (!action) {
    return false;
  }

  if (action.subcmd === 0x02) {
    return handleInviteOrAccept(session, action.targetIds);
  }

  if (action.subcmd === 0x03) {
    return handleInviteOrAccept(session, action.targetIds);
  }

  if (action.subcmd === 0x05) {
    return leaveTeam(session, 'leave');
  }

  if (action.subcmd === 0x06) {
    const actorId = Number.isInteger(action.targetIds[0]) ? (action.targetIds[0] >>> 0) : 0;
    if (actorId) {
      return declineInvite(session, actorId);
    }
    const pendingInvites = getPendingInvites(session);
    return pendingInvites.length === 1 ? declineInvite(session, pendingInvites[0].inviterActorId >>> 0) : false;
  }

  if (action.subcmd === 0x0a) {
    const actorId = Number.isInteger(action.targetIds[0]) ? (action.targetIds[0] >>> 0) : 0;
    return actorId ? kickMember(session, actorId) : false;
  }

  if (action.subcmd === 0x0d) {
    const actorId = Number.isInteger(action.targetIds[0]) ? (action.targetIds[0] >>> 0) : 0;
    return actorId ? promoteMember(session, actorId) : false;
  }

  session.log(
    `Unhandled team secondary action sub=0x${action.subcmd.toString(16)} targets=${action.targetIds.join(',')}`
  );
  return false;
}

export function notifyTeamMemberPosition(session: GameSession): void {
  const team = getTeamForSession(session);
  if (!team || team.memberSessionIds.length <= 1) {
    return;
  }

  for (const member of getTeamSessions(session.sharedState, team)) {
    if (member.id === session.id) {
      continue;
    }
    if ((member.currentMapId >>> 0) !== (session.currentMapId >>> 0)) {
      continue;
    }
    writeTeamPacket(
      member,
      buildTeamMemberPositionPacket(session.runtimeId >>> 0, session.currentX >>> 0, session.currentY >>> 0),
      `Sending team position cmd=0x402 sub=0x17 actorId=${session.runtimeId >>> 0} pos=${session.currentX >>> 0},${session.currentY >>> 0}`
    );
  }
}

export function syncTeamStateToClient(session: GameSession, reason: string): void {
  const team = getTeamForSession(session);
  if (!team || team.memberSessionIds.length <= 1) {
    return;
  }

  // Runtime bootstraps such as combat-exit and respawn rebuild a large part of the
  // client scene state. If we do not explicitly replay the team packets afterward,
  // the client can drop the visible team even though the server runtime still has it.
  // Do not resend the team-create packet here. That packet is only used when a leader
  // creates a brand-new team. Existing team members are normally resynced through the
  // roster/leader packets, and replaying team-create during combat-exit bootstrap can
  // leave the client in a bad post-combat movement state.
  syncTeamSnapshots(session.sharedState, team);
  sendTeamRosterSync(session, team, `${reason}:team-roster`);

  const leaderSession = getSessionById(session.sharedState, team.leaderSessionId >>> 0);
  if (leaderSession) {
    writeTeamPacket(
      session,
      buildTeamLeaderChangedPacket({ actorId: resolveTeamMemberIdentity(leaderSession) }),
      `Sending team leader change cmd=0x402 sub=0x0d actorId=${resolveTeamMemberIdentity(leaderSession)} reason=${reason}:team-leader`
    );
  }

  sendTeamMemberPositionsToRecipient(session, team, `${reason}:team-positions`);
}

export function scheduleTeamStateSyncToClient(session: GameSession, reason: string, delayMs = 200): void {
  const state = getTeamRuntimeState(session.sharedState);
  const sessionId = session.id >>> 0;
  const existing = state.pendingClientResyncTimersBySessionId.get(sessionId) || null;
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    state.pendingClientResyncTimersBySessionId.delete(sessionId);
    if (session.socket?.destroyed) {
      return;
    }
    syncTeamStateToClient(session, reason);
  }, Math.max(0, delayMs | 0));

  state.pendingClientResyncTimersBySessionId.set(sessionId, timer);
}

export function shouldIgnoreClientPositionUpdateWhileFollowing(session: GameSession): boolean {
  const team = getTeamForSession(session);
  if (!team || team.memberSessionIds.length <= 1) {
    return false;
  }
  return !isTeamLeader(session, team);
}

export function rejectFollowerLocalMovement(session: GameSession, attemptedMapId: number, attemptedX: number, attemptedY: number): void {
  sendFollowerWalkSync(
    session,
    session.currentX >>> 0,
    session.currentY >>> 0,
    `reject-member-local-move attemptedMap=${attemptedMapId >>> 0} attemptedPos=${attemptedX >>> 0},${attemptedY >>> 0}`
  );
}

export function syncTeamFollowersToLeader(session: GameSession): GameSession[] {
  const team = getTeamForSession(session);
  if (!team || !isTeamLeader(session, team) || team.memberSessionIds.length <= 1) {
    return [];
  }

  const updatedFollowers: GameSession[] = [];
  const members = getTeamSessions(session.sharedState, team);
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    if (member.id === session.id) {
      continue;
    }

    const target = getFollowTargetPosition(session, index);
    const mapChanged = (member.currentMapId >>> 0) !== (session.currentMapId >>> 0);
    const deltaX = Math.abs((member.currentX >>> 0) - (target.x >>> 0));
    const deltaY = Math.abs((member.currentY >>> 0) - (target.y >>> 0));
    const positionChanged = deltaX !== 0 || deltaY !== 0;

    if (!mapChanged && !positionChanged) {
      continue;
    }

    if (mapChanged) {
      member.currentMapId = session.currentMapId >>> 0;
      member.currentX = target.x >>> 0;
      member.currentY = target.y >>> 0;
      updatedFollowers.push(member);
      sendFollowerSceneEnter(member, member.currentMapId >>> 0, member.currentX >>> 0, member.currentY >>> 0, 'leader-map-follow');
      persistFollowedMemberPosition(member);
      continue;
    }

    member.currentMapId = session.currentMapId >>> 0;
    member.currentX = target.x >>> 0;
    member.currentY = target.y >>> 0;
    updatedFollowers.push(member);
    sendFollowerWalkSync(member, member.currentX >>> 0, member.currentY >>> 0, 'leader-position-follow-step');
    persistFollowedMemberPosition(member);
  }

  return updatedFollowers;
}

export function handleTeamFollowUpAction(session: GameSession, action: TeamClientAction0442): boolean {
  if (!action) {
    return false;
  }

  if (!(session.sharedState.teamFollowUpTargetsBySessionId instanceof Map)) {
    session.sharedState.teamFollowUpTargetsBySessionId = new Map<number, number[]>();
  }

  const followUpTargetsBySessionId = session.sharedState.teamFollowUpTargetsBySessionId as Map<number, number[]>;
  followUpTargetsBySessionId.set(session.id >>> 0, [...action.targetIds]);

  session.log(
    `Handled team follow-up cmd=0x442 sub=0x${action.subcmd.toString(16)} targets=${action.targetIds.join(',') || 'none'}`
  );
  return true;
}

export function handleTeamSessionDisposed(session: GameSession): void {
  clearFollowerSyncState(session.sharedState, session.id >>> 0);
  clearInviteForInvitee(session.sharedState, session.id >>> 0);
  clearPendingFollowUpTargets(session.sharedState, session.id >>> 0);
  const state = getTeamRuntimeState(session.sharedState);
  const pendingResyncTimer = state.pendingClientResyncTimersBySessionId.get(session.id >>> 0) || null;
  if (pendingResyncTimer) {
    clearTimeout(pendingResyncTimer);
    state.pendingClientResyncTimersBySessionId.delete(session.id >>> 0);
  }
  for (const [inviteeSessionId, invites] of [...state.pendingInvitesByInviteeSessionId.entries()]) {
    const filtered = invites.filter((entry) => (entry.inviterSessionId >>> 0) !== (session.id >>> 0));
    if (filtered.length > 0) {
      state.pendingInvitesByInviteeSessionId.set(inviteeSessionId >>> 0, filtered);
    } else {
      state.pendingInvitesByInviteeSessionId.delete(inviteeSessionId >>> 0);
    }
  }
  leaveTeam(session, 'disconnect');
}
