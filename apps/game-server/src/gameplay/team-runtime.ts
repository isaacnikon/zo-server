import type { GameSession, TeamClientAction03FD, TeamClientAction03FE, TeamClientAction0442 } from '../types.js';

import { DEFAULT_FLAGS, SCENE_ENTER_LOAD_SUBCMD } from '../config.js';
import { persistSessionPosition } from './position-persistence.js';
import { syncRuntimeLocationClientState } from './session-sync.js';
import { refreshWorldPresenceForVisibleViewers } from '../world-state.js';
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
  buildTeamMemberRefreshPacket,
  buildTeamMemberPositionPacket,
  buildTeamRemoveMemberPacket,
  buildTeamRosterSyncPacket,
} from '../protocol/gameplay-packets.js';
import { isLiveWorldSession } from '../session-role.js';

interface TeamRuntimeRecord {
  id: number;
  leaderSessionId: number;
  memberSessionIds: number[];
}

type TeamRemovalReason = 'leave' | 'kick' | 'disconnect' | 'combat-flee';

type PendingTeamInteractionKind = 'invite' | 'join-request';

interface PendingTeamInteraction {
  kind: PendingTeamInteractionKind;
  teamId: number;
  actorSessionId: number;
  actorRuntimeId: number;
  actorIdentityId: number;
  actorName: string;
  recipientSessionId: number;
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

interface SharedCombatQueuedActionFlee {
  round: number;
  kind: 'flee';
}

type SharedCombatQueuedAction =
  | SharedCombatQueuedActionAttack
  | SharedCombatQueuedActionSkill
  | SharedCombatQueuedActionItem
  | SharedCombatQueuedActionDefend
  | SharedCombatQueuedActionFlee;

interface TeamRuntimeState {
  nextTeamId: number;
  teams: Map<number, TeamRuntimeRecord>;
  teamIdBySessionId: Map<number, number>;
  pendingInteractionsByRecipientSessionId: Map<number, PendingTeamInteraction[]>;
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
      pendingInteractionsByRecipientSessionId: new Map<number, PendingTeamInteraction[]>(),
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

function isLiveGameSession(candidate: GameSession | null | undefined): candidate is GameSession {
  return isLiveWorldSession(candidate);
}

function resolveSessionByActorId(sharedState: Record<string, any>, actorId: number): GameSession | null {
  const sessionsById = getSessionsById(sharedState);
  const normalizedActorId = actorId >>> 0;
  let identityMatch: GameSession | null = null;

  for (const candidate of sessionsById.values()) {
    if (!isLiveGameSession(candidate)) {
      continue;
    }
    if ((candidate.runtimeId >>> 0) === normalizedActorId) {
      return candidate;
    }
    if ((candidate.roleData >>> 0) !== normalizedActorId) {
      continue;
    }
    if (!identityMatch || (candidate.id >>> 0) > (identityMatch.id >>> 0)) {
      identityMatch = candidate;
    }
  }

  return identityMatch;
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

function isEligibleSocialTarget(session: GameSession, candidate: GameSession): boolean {
  if ((candidate.id >>> 0) === (session.id >>> 0)) {
    return false;
  }

  if (candidate.socket?.destroyed) {
    return false;
  }

  if ((candidate.currentMapId >>> 0) !== (session.currentMapId >>> 0)) {
    return false;
  }

  return true;
}

function resolveInviteTargetFromFollowUpActorIds(session: GameSession, actorIds: number[]): GameSession | null {
  for (const actorId of actorIds) {
    const target = resolveSessionByActorId(session.sharedState, actorId >>> 0);
    if (target && isEligibleSocialTarget(session, target)) {
      return target;
    }
  }

  return null;
}

function resolveInviteTargetFallback(session: GameSession): GameSession | null {
  const candidates = [...getSessionsById(session.sharedState).values()].filter((candidate) => {
    if (!isEligibleSocialTarget(session, candidate)) {
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
  const team = state.teams.get(Number(teamId) >>> 0) || null;
  if (!team) {
    state.teamIdBySessionId.delete(session.id >>> 0);
    return null;
  }

  const members = compactTeamMembers(session.sharedState, team);
  if (members.length < 1 || !members.some((member) => (member.id >>> 0) === (session.id >>> 0))) {
    state.teamIdBySessionId.delete(session.id >>> 0);
    return null;
  }

  return team;
}

function getMappedTeamForSessionId(sharedState: Record<string, any>, sessionId: number): TeamRuntimeRecord | null {
  const state = getTeamRuntimeState(sharedState);
  const normalizedSessionId = sessionId >>> 0;
  const teamId = state.teamIdBySessionId.get(normalizedSessionId);
  if (!Number.isInteger(teamId)) {
    return null;
  }

  const team = state.teams.get(Number(teamId) >>> 0) || null;
  if (!team) {
    state.teamIdBySessionId.delete(normalizedSessionId);
    return null;
  }

  if (!team.memberSessionIds.some((memberSessionId) => (memberSessionId >>> 0) === normalizedSessionId)) {
    state.teamIdBySessionId.delete(normalizedSessionId);
    return null;
  }

  return team;
}

function areSessionsInSameTeam(left: GameSession, right: GameSession): boolean {
  const leftTeam = getTeamForSession(left);
  const rightTeam = getTeamForSession(right);
  return (
    leftTeam !== null &&
    rightTeam !== null &&
    (leftTeam.id >>> 0) === (rightTeam.id >>> 0)
  );
}

function compactTeamMembers(sharedState: Record<string, any>, team: TeamRuntimeRecord): GameSession[] {
  const state = getTeamRuntimeState(sharedState);
  const compactedMemberSessionIds: number[] = [];
  const members: GameSession[] = [];
  const seenSessionIds = new Set<number>();
  const teamId = team.id >>> 0;

  for (const memberSessionId of team.memberSessionIds) {
    const normalizedSessionId = memberSessionId >>> 0;
    if (seenSessionIds.has(normalizedSessionId)) {
      continue;
    }
    seenSessionIds.add(normalizedSessionId);

    const member = getSessionById(sharedState, normalizedSessionId);
    const mappedTeamId = state.teamIdBySessionId.get(normalizedSessionId);
    if (!isLiveGameSession(member) || !Number.isInteger(mappedTeamId) || ((mappedTeamId as number) >>> 0) !== teamId) {
      state.teamIdBySessionId.delete(normalizedSessionId);
      continue;
    }

    compactedMemberSessionIds.push(normalizedSessionId);
    members.push(member);
    state.teamIdBySessionId.set(normalizedSessionId, teamId);
  }

  if (
    compactedMemberSessionIds.length !== team.memberSessionIds.length ||
    compactedMemberSessionIds.some((memberSessionId, index) => memberSessionId !== (team.memberSessionIds[index] >>> 0))
  ) {
    team.memberSessionIds = compactedMemberSessionIds;
  }

  if (compactedMemberSessionIds.length < 1) {
    state.teams.delete(teamId);
    return [];
  }

  if (!compactedMemberSessionIds.includes(team.leaderSessionId >>> 0)) {
    team.leaderSessionId = compactedMemberSessionIds[0] >>> 0;
  }

  return members;
}

function getTeamSessions(sharedState: Record<string, any>, team: TeamRuntimeRecord): GameSession[] {
  return compactTeamMembers(sharedState, team);
}

function getLiveTeamMemberCount(sharedState: Record<string, any>, team: TeamRuntimeRecord): number {
  return getTeamSessions(sharedState, team).length;
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

export function transferSharedTeamCombatOwnership(owner: GameSession, newOwner: GameSession): boolean {
  if (!owner.combatState?.active || !newOwner.combatState?.active) {
    return false;
  }
  if (!isSharedTeamCombatOwner(owner)) {
    return false;
  }

  const state = getTeamRuntimeState(owner.sharedState);
  const ownerSessionId = owner.id >>> 0;
  const newOwnerSessionId = newOwner.id >>> 0;
  if (ownerSessionId === newOwnerSessionId) {
    return true;
  }

  const participantSessionIds = state.combatParticipantSessionIdsByOwnerSessionId.get(ownerSessionId) || [];
  if (!participantSessionIds.some((participantSessionId) => (participantSessionId >>> 0) === newOwnerSessionId)) {
    return false;
  }

  const transferredParticipantSessionIds = participantSessionIds
    .filter((participantSessionId) => (participantSessionId >>> 0) !== ownerSessionId)
    .filter((participantSessionId, index, values) =>
      values.findIndex((candidate) => (candidate >>> 0) === (participantSessionId >>> 0)) === index
    );

  const transferredActions = new Map<number, SharedCombatQueuedAction>();
  const existingActions = state.combatPendingActionsByOwnerSessionId.get(ownerSessionId);
  if (existingActions instanceof Map) {
    for (const [participantSessionId, action] of existingActions.entries()) {
      if ((participantSessionId >>> 0) === ownerSessionId) {
        continue;
      }
      transferredActions.set(participantSessionId >>> 0, action);
    }
  }

  state.combatParticipantSessionIdsByOwnerSessionId.delete(ownerSessionId);
  state.combatPendingActionsByOwnerSessionId.delete(ownerSessionId);
  state.combatOwnerSessionIdByParticipantSessionId.delete(ownerSessionId);

  state.combatParticipantSessionIdsByOwnerSessionId.set(newOwnerSessionId, transferredParticipantSessionIds);
  state.combatPendingActionsByOwnerSessionId.set(newOwnerSessionId, transferredActions);
  for (const participantSessionId of transferredParticipantSessionIds) {
    state.combatOwnerSessionIdByParticipantSessionId.set(participantSessionId >>> 0, newOwnerSessionId);
  }

  return true;
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

function refreshWorldPresenceForSessions(sessions: GameSession[], reason: string): void {
  const refreshedSessionIds = new Set<number>();
  for (const session of sessions) {
    if (!session || refreshedSessionIds.has(session.id >>> 0) || !session.worldRegistered) {
      continue;
    }
    refreshedSessionIds.add(session.id >>> 0);
    refreshWorldPresenceForVisibleViewers(session, reason);
  }
}

function clearPendingInteractionForRecipient(
  sharedState: Record<string, any>,
  recipientSessionId: number,
  actorId?: number
): void {
  const state = getTeamRuntimeState(sharedState);
  const pending = state.pendingInteractionsByRecipientSessionId.get(recipientSessionId >>> 0) || [];
  if (pending.length === 0) {
    return;
  }

  const filtered = typeof actorId === 'number'
    ? pending.filter((entry) => !doesPendingInteractionMatchActorId(entry, actorId))
    : [];

  if (filtered.length > 0) {
    state.pendingInteractionsByRecipientSessionId.set(recipientSessionId >>> 0, filtered);
    return;
  }

  state.pendingInteractionsByRecipientSessionId.delete(recipientSessionId >>> 0);
}

function clearPendingInteractionsByActor(sharedState: Record<string, any>, actorSessionId: number): void {
  const state = getTeamRuntimeState(sharedState);
  for (const [recipientSessionId, pending] of [...state.pendingInteractionsByRecipientSessionId.entries()]) {
    const filtered = pending.filter((entry) => (entry.actorSessionId >>> 0) !== (actorSessionId >>> 0));
    if (filtered.length > 0) {
      state.pendingInteractionsByRecipientSessionId.set(recipientSessionId >>> 0, filtered);
    } else {
      state.pendingInteractionsByRecipientSessionId.delete(recipientSessionId >>> 0);
    }
  }
}

function getPendingInteractions(session: GameSession): PendingTeamInteraction[] {
  const state = getTeamRuntimeState(session.sharedState);
  return state.pendingInteractionsByRecipientSessionId.get(session.id >>> 0) || [];
}

function clearFollowerSyncState(sharedState: Record<string, any>, sessionId: number): void {
  void sharedState;
  void sessionId;
}

function doesPendingInteractionMatchActorId(interaction: PendingTeamInteraction, actorId: number): boolean {
  const normalizedActorId = actorId >>> 0;
  return (
    (interaction.actorRuntimeId >>> 0) === normalizedActorId ||
    (interaction.actorIdentityId >>> 0) === normalizedActorId
  );
}

function getPendingInteraction(session: GameSession, actorId: number): PendingTeamInteraction | null {
  return getPendingInteractions(session).find((entry) => doesPendingInteractionMatchActorId(entry, actorId)) || null;
}

function appendPendingInteraction(session: GameSession, interaction: PendingTeamInteraction): void {
  const state = getTeamRuntimeState(session.sharedState);
  const pending = state.pendingInteractionsByRecipientSessionId.get(session.id >>> 0) || [];
  const deduped = pending.filter((entry) => (entry.actorRuntimeId >>> 0) !== (interaction.actorRuntimeId >>> 0));
  deduped.push(interaction);
  state.pendingInteractionsByRecipientSessionId.set(session.id >>> 0, deduped);
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
  identityId: number;
  roleEntityType: number;
  level: number;
  displayName: string;
  status: number;
} | null> {
  const members = getTeamSessions(sharedState, team);
  const leader = members.find((member) => (member.id >>> 0) === (team.leaderSessionId >>> 0)) || null;
  const orderedMembers = leader
    ? [leader, ...members.filter((member) => (member.id >>> 0) !== (leader.id >>> 0))]
    : members;
  const packetMembers: Array<{
    actorId: number;
    identityId: number;
    roleEntityType: number;
    level: number;
    displayName: string;
    status: number;
  } | null> = orderedMembers.slice(0, TEAM_MAX_MEMBERS).map((member) => ({
    actorId: member.runtimeId >>> 0,
    identityId: resolveTeamMemberIdentity(member),
    roleEntityType: (member.roleEntityType || member.entityType || 0) & 0xffff,
    level: member.level >>> 0,
    displayName: member.charName || '',
    status: 1,
  }));
  return packetMembers;
}

function buildTeamMemberPacketParams(member: GameSession): {
  actorId: number;
  identityId: number;
  roleEntityType: number;
  level: number;
  displayName: string;
  status: number;
} {
  return {
    actorId: member.runtimeId >>> 0,
    identityId: resolveTeamMemberIdentity(member),
    roleEntityType: (member.roleEntityType || member.entityType || 0) & 0xffff,
    level: member.level >>> 0,
    displayName: member.charName || '',
    status: 1,
  };
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

function sendTeamJoinRequestNotice(session: GameSession, requester: GameSession, reason: string): void {
  // The client routes 0x402/0x06 through the applicant-entry UI path. Do not reuse it
  // for generic team member refreshes or it will duplicate entries in the applicants pane.
  writeTeamPacket(
    session,
    buildTeamMemberRefreshPacket(buildTeamMemberPacketParams(requester)),
    `Sending team join request cmd=0x402 sub=0x06 actorId=${requester.runtimeId >>> 0} reason=${reason}`
  );
}

function sendTeamLeaderSync(session: GameSession, team: TeamRuntimeRecord, reason: string): void {
  const leaderSession = getSessionById(session.sharedState, team.leaderSessionId >>> 0);
  if (!leaderSession) {
    return;
  }
  writeTeamPacket(
    session,
    buildTeamLeaderChangedPacket({ actorId: resolveTeamMemberIdentity(leaderSession) }),
    `Sending team leader change cmd=0x402 sub=0x0d actorId=${resolveTeamMemberIdentity(leaderSession)} reason=${reason}`
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
  const team = getTeamForSession(session);
  const memberSessionIds = team
    ? getTeamSessions(session.sharedState, team).map((member) => `${member.charName || member.id}@${member.id}`)
    : [];
  session.log(
    `Team conflict reason=${reason} teamId=${team ? (team.id >>> 0) : 0} teamSize=${memberSessionIds.length} members=${memberSessionIds.join(',') || 'none'}`
  );
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
  sendTeamRosterSync(session, team, 'create-team');
  sendTeamLeaderSync(session, team, 'create-team');
  refreshWorldPresenceForSessions([session], 'create-team:world-state');
  return team;
}

function deleteTeam(sharedState: Record<string, any>, team: TeamRuntimeRecord): void {
  const state = getTeamRuntimeState(sharedState);
  state.teams.delete(team.id >>> 0);
  for (const memberSessionId of team.memberSessionIds) {
    state.teamIdBySessionId.delete(memberSessionId >>> 0);
  }
}

function promoteLeaderIfNeeded(sharedState: Record<string, any>, team: TeamRuntimeRecord): void {
  const memberSessionIds = getTeamSessions(sharedState, team).map((member) => member.id >>> 0);
  if (memberSessionIds.length === 0) {
    return;
  }
  if (memberSessionIds.includes(team.leaderSessionId >>> 0)) {
    return;
  }
  team.leaderSessionId = memberSessionIds[0] >>> 0;
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

  const inviterTeamMemberCount = getLiveTeamMemberCount(session.sharedState, inviterTeam);
  if (inviterTeamMemberCount >= TEAM_MAX_MEMBERS) {
    session.log(
      `Invite rejected reason=team-full teamId=${inviterTeam.id >>> 0} target=${target.charName || target.id}@${target.id >>> 0} liveCount=${inviterTeamMemberCount}`
    );
    sendTeamConflict(session, 'team-full');
    return false;
  }

  if (getTeamForSession(target)) {
    session.log(
      `Invite rejected reason=target-already-in-team target=${target.charName || target.id}@${target.id >>> 0}`
    );
    sendTeamConflict(session, 'target-already-in-team');
    return false;
  }

  appendPendingInteraction(target, {
    kind: 'invite',
    teamId: inviterTeam.id >>> 0,
    actorSessionId: session.id >>> 0,
    actorRuntimeId: session.runtimeId >>> 0,
    actorIdentityId: resolveTeamMemberIdentity(session),
    actorName: session.charName || '',
    recipientSessionId: target.id >>> 0,
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

function requestJoinTeam(session: GameSession, target: GameSession): boolean {
  const requesterTeam = getTeamForSession(session);
  if (requesterTeam) {
    session.log(
      `Join request rejected reason=requester-already-in-team requesterTeamId=${requesterTeam.id >>> 0} target=${target.charName || target.id}@${target.id >>> 0}`
    );
    sendTeamConflict(session, 'requester-already-in-team');
    return false;
  }

  const targetTeam = getTeamForSession(target);
  if (!targetTeam) {
    return false;
  }

  const targetTeamMemberCount = getLiveTeamMemberCount(session.sharedState, targetTeam);
  if (targetTeamMemberCount >= TEAM_MAX_MEMBERS) {
    session.log(
      `Join request rejected reason=target-team-full targetTeamId=${targetTeam.id >>> 0} target=${target.charName || target.id}@${target.id >>> 0} liveCount=${targetTeamMemberCount}`
    );
    sendTeamConflict(session, 'target-team-full');
    return false;
  }

  const leaderSession = getSessionById(session.sharedState, targetTeam.leaderSessionId >>> 0);
  if (!leaderSession || leaderSession.socket?.destroyed) {
    return false;
  }

  if ((leaderSession.id >>> 0) === (session.id >>> 0)) {
    return false;
  }

  appendPendingInteraction(leaderSession, {
    kind: 'join-request',
    teamId: targetTeam.id >>> 0,
    actorSessionId: session.id >>> 0,
    actorRuntimeId: session.runtimeId >>> 0,
    actorIdentityId: resolveTeamMemberIdentity(session),
    actorName: session.charName || '',
    recipientSessionId: leaderSession.id >>> 0,
    createdAt: Date.now(),
  });

  sendTeamJoinRequestNotice(leaderSession, session, 'join-request');

  session.log(
    `Team join request queued leader=${leaderSession.charName || ''} actorId=${leaderSession.runtimeId >>> 0} teamId=${targetTeam.id >>> 0}`
  );
  return true;
}

function normalizeInviteIntentTarget(session: GameSession, target: GameSession | null): GameSession | null {
  if (!target) {
    return null;
  }

  if (areSessionsInSameTeam(session, target)) {
    session.log(
      `Ignoring stale invite target actorId=${target.runtimeId >>> 0} because target is already in the same team`
    );
    return null;
  }

  return target;
}

function addMemberToTeamInternal(sharedState: Record<string, any>, team: TeamRuntimeRecord, member: GameSession, reason: string): void {
  const teamState = getTeamRuntimeState(sharedState);
  if (!team.memberSessionIds.some((sessionId) => (sessionId >>> 0) === (member.id >>> 0))) {
    team.memberSessionIds.push(member.id >>> 0);
  }
  teamState.teamIdBySessionId.set(member.id >>> 0, team.id >>> 0);
  clearPendingInteractionForRecipient(sharedState, member.id >>> 0);
  clearPendingInteractionsByActor(sharedState, member.id >>> 0);

  const sessions = getTeamSessions(sharedState, team);
  for (const teammate of sessions) {
    updateSessionTeamSnapshot(teammate);
    sendTeamRosterSync(teammate, team, (teammate.id >>> 0) === (member.id >>> 0) ? reason : 'member-joined');
    if ((teammate.id >>> 0) !== (member.id >>> 0)) {
      writeTeamPacket(
        teammate,
        buildTeamJoinedNoticePacket(),
        `Sending team joined notice cmd=0x402 sub=0x09 reason=member-joined actorId=${member.runtimeId >>> 0}`
      );
    }
  }
  const leaderSession = getSessionById(sharedState, team.leaderSessionId >>> 0);
  if (leaderSession) {
    broadcastLeaderChanged(sharedState, team, resolveTeamMemberIdentity(leaderSession), `${reason}-leader-confirm`);
  }
  syncTeamMemberPositions(sharedState, team);
  refreshWorldPresenceForSessions(sessions, `${reason}:world-state`);
  for (const teammate of sessions) {
    scheduleTeamStateSyncToClient(teammate, `${reason}:delayed-team-sync`, 250);
  }
}

function acceptPendingInteraction(session: GameSession, interaction: PendingTeamInteraction): boolean {
  const teamState = getTeamRuntimeState(session.sharedState);
  const team = teamState.teams.get(interaction.teamId >>> 0) || null;
  if (!team) {
    clearPendingInteractionForRecipient(session.sharedState, session.id >>> 0, interaction.actorRuntimeId >>> 0);
    return false;
  }

  let joiningMember: GameSession | null = null;
  let acceptReason = 'accept-invite';

  if (interaction.kind === 'invite') {
    if (getTeamForSession(session)) {
      session.log(
        `Accept rejected reason=invitee-already-in-team actorId=${interaction.actorRuntimeId >>> 0}`
      );
      sendTeamConflict(session, 'invitee-already-in-team');
      clearPendingInteractionForRecipient(session.sharedState, session.id >>> 0, interaction.actorRuntimeId >>> 0);
      return false;
    }
    joiningMember = session;
  } else {
    if (!isTeamLeader(session, team)) {
      clearPendingInteractionForRecipient(session.sharedState, session.id >>> 0, interaction.actorRuntimeId >>> 0);
      return false;
    }
    joiningMember = getSessionById(session.sharedState, interaction.actorSessionId >>> 0);
    if (!joiningMember) {
      clearPendingInteractionForRecipient(session.sharedState, session.id >>> 0, interaction.actorRuntimeId >>> 0);
      return false;
    }
    if (getTeamForSession(joiningMember)) {
      session.log(
        `Accept rejected reason=requester-already-in-team requester=${joiningMember.charName || joiningMember.id}@${joiningMember.id >>> 0} actorId=${interaction.actorRuntimeId >>> 0}`
      );
      sendTeamConflict(session, 'requester-already-in-team');
      clearPendingInteractionForRecipient(session.sharedState, session.id >>> 0, interaction.actorRuntimeId >>> 0);
      return false;
    }
    acceptReason = 'accept-join-request';
  }

  const teamMemberCount = getLiveTeamMemberCount(session.sharedState, team);
  if (teamMemberCount >= TEAM_MAX_MEMBERS) {
    session.log(
      `Accept rejected reason=team-full-on-accept teamId=${team.id >>> 0} actorId=${interaction.actorRuntimeId >>> 0} liveCount=${teamMemberCount}`
    );
    sendTeamConflict(session, 'team-full-on-accept');
    clearPendingInteractionForRecipient(session.sharedState, session.id >>> 0, interaction.actorRuntimeId >>> 0);
    return false;
  }

  if (!joiningMember) {
    clearPendingInteractionForRecipient(session.sharedState, session.id >>> 0, interaction.actorRuntimeId >>> 0);
    return false;
  }

  clearPendingInteractionForRecipient(session.sharedState, session.id >>> 0, interaction.actorRuntimeId >>> 0);
  addMemberToTeamInternal(session.sharedState, team, joiningMember, acceptReason);
  return true;
}

function declinePendingInteraction(session: GameSession, actorId: number): boolean {
  const interaction = getPendingInteraction(session, actorId >>> 0);
  if (!interaction) {
    return false;
  }

  const actor = getSessionById(session.sharedState, interaction.actorSessionId >>> 0);
  clearPendingInteractionForRecipient(session.sharedState, session.id >>> 0, actorId >>> 0);

  if (actor) {
    writeTeamPacket(
      actor,
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
  reason: TeamRemovalReason
): void {
  const state = getTeamRuntimeState(session.sharedState);
  team.memberSessionIds = team.memberSessionIds.filter((sessionId) => (sessionId >>> 0) !== (target.id >>> 0));
  state.teamIdBySessionId.delete(target.id >>> 0);
  clearFollowerSyncState(session.sharedState, target.id >>> 0);
  clearPendingInteractionForRecipient(session.sharedState, target.id >>> 0);
  clearPendingInteractionsByActor(session.sharedState, target.id >>> 0);

  if (getLiveTeamMemberCount(session.sharedState, team) === 0) {
    deleteTeam(session.sharedState, team);
    target.teamId = null;
    target.teamSize = 0;
    target.teamMembers = [];
    if (reason !== 'disconnect') {
      sendTeamDismissed(target, `remove-last:${reason}`);
    }
    refreshWorldPresenceForSessions(reason === 'disconnect' ? [] : [target], `remove-last:${reason}:world-state`);
    return;
  }

  const leaderWasRemoved = (team.leaderSessionId >>> 0) === (target.id >>> 0);
  if (leaderWasRemoved) {
    promoteLeaderIfNeeded(session.sharedState, team);
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
  for (const member of getTeamSessions(session.sharedState, team)) {
    sendTeamRosterSync(member, team, `member-removed:${reason}`);
    sendTeamLeaderSync(member, team, `member-removed:${reason}`);
    scheduleTeamStateSyncToClient(member, `member-removed:${reason}:delayed-team-sync`, 250);
  }
  refreshWorldPresenceForSessions(
    reason === 'disconnect'
      ? getTeamSessions(session.sharedState, team)
      : [target, ...getTeamSessions(session.sharedState, team)],
    `member-removed:${reason}:world-state`
  );
}

function leaveTeam(session: GameSession, reason: 'leave' | 'kick' | 'disconnect' = 'leave'): boolean {
  const team =
    reason === 'disconnect'
      ? getMappedTeamForSessionId(session.sharedState, session.id) || getTeamForSession(session)
      : getTeamForSession(session) || getMappedTeamForSessionId(session.sharedState, session.id);
  if (!team) {
    return false;
  }

  removeMemberFromTeamInternal(session, team, session, reason);
  return true;
}

export function removeTeamMemberForCombatFlee(session: GameSession): GameSession | null {
  const team = getTeamForSession(session);
  if (!team) {
    return null;
  }

  removeMemberFromTeamInternal(session, team, session, 'combat-flee');
  if (getLiveTeamMemberCount(session.sharedState, team) <= 0) {
    return null;
  }

  return getSessionById(session.sharedState, team.leaderSessionId >>> 0);
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
  refreshWorldPresenceForSessions(members, `${reason}:world-state`);
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
  for (const member of getTeamSessions(session.sharedState, team)) {
    clearPendingFollowUpTargets(session.sharedState, member.id >>> 0);
    sendTeamRosterSync(member, team, 'promote-member');
    sendTeamLeaderSync(member, team, 'promote-member');
    scheduleTeamStateSyncToClient(member, 'promote-member:delayed-team-sync', 250);
  }
  refreshWorldPresenceForSessions(getTeamSessions(session.sharedState, team), 'promote-member:world-state');
  return true;
}

function handleInviteOrAccept(session: GameSession, targetIds: number[]): boolean {
  const pendingFollowUpTargetIds = getPendingFollowUpTargets(session);
  clearPendingFollowUpTargets(session.sharedState, session.id >>> 0);
  const actorId = Number.isInteger(targetIds[0]) ? (targetIds[0] >>> 0) : 0;
  if (!actorId) {
    const pendingInteractions = getPendingInteractions(session);
    if (pendingInteractions.length === 1) {
      return acceptPendingInteraction(session, pendingInteractions[0]);
    }

    const followUpTarget = normalizeInviteIntentTarget(
      session,
      resolveInviteTargetFromFollowUpActorIds(session, pendingFollowUpTargetIds)
    );
    if (followUpTarget) {
      session.log(
        `Resolved zero-id team invite from follow-up actorId=${followUpTarget.runtimeId >>> 0} name=${followUpTarget.charName || ''}`
      );
      return getTeamForSession(followUpTarget) ? requestJoinTeam(session, followUpTarget) : inviteTarget(session, followUpTarget);
    }

    const fallbackTarget = normalizeInviteIntentTarget(session, resolveInviteTargetFallback(session));
    if (!fallbackTarget) {
      session.log('Team invite fallback could not resolve a unique nearby target');
      return false;
    }

    session.log(
      `Resolved zero-id team invite to nearby target actorId=${fallbackTarget.runtimeId >>> 0} name=${fallbackTarget.charName || ''}`
    );
    return getTeamForSession(fallbackTarget) ? requestJoinTeam(session, fallbackTarget) : inviteTarget(session, fallbackTarget);
  }

  const pending = getPendingInteraction(session, actorId);
  if (pending) {
    return acceptPendingInteraction(session, pending);
  }

  const target = normalizeInviteIntentTarget(session, resolveSessionByActorId(session.sharedState, actorId >>> 0));
  if (!target) {
    return false;
  }

  return getTeamForSession(target) ? requestJoinTeam(session, target) : inviteTarget(session, target);
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
      const pending = getPendingInteraction(session, actorId);
      if (pending) {
        return declinePendingInteraction(session, actorId);
      }

      const target = normalizeInviteIntentTarget(session, resolveSessionByActorId(session.sharedState, actorId));
      if (!target) {
        return false;
      }

      // Client source of truth: right-click "apply to team" on a player who is already in a team
      // emits 0x03fe sub=0x06 with that target's runtime id.
      return getTeamForSession(target) ? requestJoinTeam(session, target) : inviteTarget(session, target);
    }
    const pendingInteractions = getPendingInteractions(session);
    return pendingInteractions.length === 1
      ? declinePendingInteraction(session, pendingInteractions[0].actorRuntimeId >>> 0)
      : false;
  }

  if (action.subcmd === 0x04) {
    const actorId = Number.isInteger(action.targetIds[0]) ? (action.targetIds[0] >>> 0) : 0;
    return actorId ? declinePendingInteraction(session, actorId) : false;
  }

  if (action.subcmd === 0x0a) {
    const actorId = Number.isInteger(action.targetIds[0]) ? (action.targetIds[0] >>> 0) : 0;
    return actorId ? kickMember(session, actorId) : false;
  }

  if (action.subcmd === 0x0d) {
    const actorId = Number.isInteger(action.targetIds[0]) ? (action.targetIds[0] >>> 0) : 0;
    return actorId ? promoteMember(session, actorId) : false;
  }

  if (action.subcmd === 0x13) {
    const actorId = Number.isInteger(action.targetIds[0]) ? (action.targetIds[0] >>> 0) : 0;
    if (!actorId) {
      return false;
    }
    const pending = getPendingInteraction(session, actorId);
    return pending ? acceptPendingInteraction(session, pending) : false;
  }

  session.log(
    `Unhandled team secondary action sub=0x${action.subcmd.toString(16)} targets=${action.targetIds.join(',')}`
  );
  return false;
}

export function notifyTeamMemberPosition(session: GameSession): void {
  const team = getTeamForSession(session);
  if (!team || getLiveTeamMemberCount(session.sharedState, team) <= 1) {
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
  if (!team) {
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
  sendTeamLeaderSync(session, team, `${reason}:team-leader`);
  if (getLiveTeamMemberCount(session.sharedState, team) > 1) {
    sendTeamMemberPositionsToRecipient(session, team, `${reason}:team-positions`);
  }
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
  if (!team || getLiveTeamMemberCount(session.sharedState, team) <= 1) {
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
  if (!team || !isTeamLeader(session, team) || getLiveTeamMemberCount(session.sharedState, team) <= 1) {
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

  if (action.subcmd === 0x0c) {
    clearPendingFollowUpTargets(session.sharedState, session.id >>> 0);
    scheduleTeamStateSyncToClient(session, 'team-follow-up-0x0c', 50);
  } else {
    if (!(session.sharedState.teamFollowUpTargetsBySessionId instanceof Map)) {
      session.sharedState.teamFollowUpTargetsBySessionId = new Map<number, number[]>();
    }

    const followUpTargetsBySessionId = session.sharedState.teamFollowUpTargetsBySessionId as Map<number, number[]>;
    followUpTargetsBySessionId.set(session.id >>> 0, [...action.targetIds]);
  }

  session.log(
    `Handled team follow-up cmd=0x442 sub=0x${action.subcmd.toString(16)} targets=${action.targetIds.join(',') || 'none'}`
  );
  return true;
}

export function handleTeamSessionDisposed(session: GameSession): void {
  clearFollowerSyncState(session.sharedState, session.id >>> 0);
  clearPendingInteractionForRecipient(session.sharedState, session.id >>> 0);
  clearPendingInteractionsByActor(session.sharedState, session.id >>> 0);
  clearPendingFollowUpTargets(session.sharedState, session.id >>> 0);
  const state = getTeamRuntimeState(session.sharedState);
  const pendingResyncTimer = state.pendingClientResyncTimersBySessionId.get(session.id >>> 0) || null;
  if (pendingResyncTimer) {
    clearTimeout(pendingResyncTimer);
    state.pendingClientResyncTimersBySessionId.delete(session.id >>> 0);
  }
  leaveTeam(session, 'disconnect');
}
