import type { GameSession, SessionKind } from './types.js';

function getSessionsById(sharedState: Record<string, any>): Map<number, GameSession> | null {
  return sharedState?.sessionsById instanceof Map
    ? sharedState.sessionsById as Map<number, GameSession>
    : null;
}

export function setSessionKind(session: GameSession, kind: SessionKind): void {
  session.sessionKind = kind;
  session.isGame = kind === 'world';
}

export function isLoginSession(session: Pick<GameSession, 'sessionKind'> | null | undefined): boolean {
  return session != null && session.sessionKind === 'login';
}

export function isWorldSession(session: Pick<GameSession, 'sessionKind'> | null | undefined): boolean {
  return session != null && session.sessionKind === 'world';
}

export function isLiveWorldSession(session: GameSession | null | undefined): session is GameSession {
  if (session == null || !isWorldSession(session)) {
    return false;
  }
  if (session.socket?.destroyed) {
    return false;
  }
  return session.state === 'LOGGED_IN';
}

export function getPairedSession(session: GameSession): GameSession | null {
  const pairedSessionId = Number.isInteger(session.pairedSessionId) ? (session.pairedSessionId as number) >>> 0 : 0;
  if (pairedSessionId <= 0) {
    return null;
  }
  return getSessionsById(session.sharedState)?.get(pairedSessionId) || null;
}

function unlinkSession(session: GameSession, counterpart: GameSession | null): void {
  session.pairedSessionId = null;
  if (counterpart && (Number(counterpart.pairedSessionId) >>> 0) === (session.id >>> 0)) {
    counterpart.pairedSessionId = null;
  }
}

export function clearSessionPair(session: GameSession): void {
  unlinkSession(session, getPairedSession(session));
}

export function pairSessions(left: GameSession, right: GameSession): void {
  if ((left.id >>> 0) === (right.id >>> 0)) {
    return;
  }
  clearSessionPair(left);
  clearSessionPair(right);
  left.pairedSessionId = right.id >>> 0;
  right.pairedSessionId = left.id >>> 0;
}

export function blockNextWorldEntry(session: GameSession, reason: string): void {
  session.blockNextWorldEntry = true;
  session.blockWorldEntryUntilMs = null;
  session.blockNextWorldEntryReason = reason;
}

export function blockWorldEntryFor(session: GameSession, durationMs: number, reason: string): void {
  session.blockNextWorldEntry = true;
  session.blockWorldEntryUntilMs = Date.now() + Math.max(0, durationMs | 0);
  session.blockNextWorldEntryReason = reason;
}

export function consumeBlockedWorldEntry(session: GameSession): string | null {
  if (session.blockNextWorldEntry !== true) {
    return null;
  }
  const blockUntilMs = Number.isFinite(Number(session.blockWorldEntryUntilMs))
    ? Math.max(0, Number(session.blockWorldEntryUntilMs))
    : 0;
  if (blockUntilMs > Date.now()) {
    return session.blockNextWorldEntryReason || 'blocked';
  }
  const reason = session.blockNextWorldEntryReason || 'blocked';
  session.blockNextWorldEntry = false;
  session.blockWorldEntryUntilMs = null;
  session.blockNextWorldEntryReason = null;
  return blockUntilMs > 0 ? null : reason;
}
