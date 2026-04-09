import type { GameSession, OnlineActivityState } from '../types.js';

import { numberOrDefault, type UnknownRecord } from '../utils.js';
import { isWorldSession } from '../session-role.js';

const ONLINE_PERSIST_INTERVAL_MS = Number.isFinite(Number(process.env.ONLINE_PERSIST_INTERVAL_MS))
  ? Math.max(1000, Number(process.env.ONLINE_PERSIST_INTERVAL_MS))
  : 30000;
const ONLINE_HEARTBEAT_TIMEOUT_MS = Number.isFinite(Number(process.env.ONLINE_HEARTBEAT_TIMEOUT_MS))
  ? Math.max(5000, Number(process.env.ONLINE_HEARTBEAT_TIMEOUT_MS))
  : 65000;

function buildUtcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function getUtcDayStartMs(timestampMs: number): number {
  const now = new Date(timestampMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function defaultOnlineState(now = new Date()): OnlineActivityState {
  return {
    dayKey: buildUtcDayKey(now),
    accumulatedTodayMs: 0,
    accumulatedTotalMs: 0,
  };
}

function normalizeOnlineState(source: unknown, now = new Date()): OnlineActivityState {
  const record = source && typeof source === 'object' ? (source as UnknownRecord) : null;
  const defaults = defaultOnlineState(now);
  const sourceDayKey = typeof record?.dayKey === 'string' && record.dayKey.length > 0 ? record.dayKey : defaults.dayKey;
  return {
    dayKey: defaults.dayKey,
    accumulatedTodayMs:
      sourceDayKey === defaults.dayKey
        ? Math.max(0, numberOrDefault(record?.accumulatedTodayMs, 0))
        : 0,
    accumulatedTotalMs: Math.max(0, numberOrDefault(record?.accumulatedTotalMs, 0)),
  };
}

function ensureOnlineState(session: GameSession, now = new Date()): OnlineActivityState {
  const normalized = normalizeOnlineState(session.onlineState, now);
  session.onlineState = normalized;
  return normalized;
}

function resolveEffectiveOnlineNowMs(session: GameSession, nowMs: number): number {
  const lastSeenAt = Number.isFinite(Number(session.lastHeartbeatAt))
    ? Math.max(0, Number(session.lastHeartbeatAt))
    : 0;
  if (lastSeenAt <= 0) {
    return nowMs;
  }
  return Math.min(nowMs, lastSeenAt + ONLINE_HEARTBEAT_TIMEOUT_MS);
}

function initializeOnlineTracking(session: GameSession, nowMs = Date.now()): void {
  if (!isWorldSession(session)) {
    return;
  }
  ensureOnlineState(session, new Date(nowMs));
  session.onlineCreditCursorAt = nowMs;
  session.onlineLastPersistAt = nowMs;
}

function creditOnlinePresence(session: GameSession, nowMs = Date.now()): number {
  if (!isWorldSession(session)) {
    return 0;
  }

  const state = ensureOnlineState(session, new Date(nowMs));
  const effectiveNowMs = resolveEffectiveOnlineNowMs(session, nowMs);
  const cursorAt = Number.isFinite(Number(session.onlineCreditCursorAt))
    ? Math.max(0, Number(session.onlineCreditCursorAt))
    : 0;
  if (cursorAt <= 0) {
    session.onlineCreditCursorAt = effectiveNowMs;
    return 0;
  }
  if (effectiveNowMs <= cursorAt) {
    session.onlineCreditCursorAt = effectiveNowMs;
    return 0;
  }

  const delta = effectiveNowMs - cursorAt;
  state.accumulatedTotalMs += delta;

  const utcDayStartMs = getUtcDayStartMs(effectiveNowMs);
  const todayCreditStartMs = Math.max(cursorAt, utcDayStartMs);
  if (effectiveNowMs > todayCreditStartMs) {
    state.accumulatedTodayMs += effectiveNowMs - todayCreditStartMs;
  }

  session.onlineCreditCursorAt = effectiveNowMs;
  return delta;
}

async function touchOnlinePresence(
  session: GameSession,
  options: {
    nowMs?: number;
    isHeartbeat?: boolean;
    forcePersist?: boolean;
  } = {}
): Promise<number> {
  if (!isWorldSession(session)) {
    return 0;
  }

  const nowMs = Number.isFinite(Number(options.nowMs)) ? Math.max(0, Number(options.nowMs)) : Date.now();
  session.lastHeartbeatAt = nowMs;
  const creditedMs = creditOnlinePresence(session, nowMs);

  const lastPersistAt = Number.isFinite(Number(session.onlineLastPersistAt))
    ? Math.max(0, Number(session.onlineLastPersistAt))
    : 0;
  if (options.forcePersist === true || lastPersistAt <= 0 || nowMs - lastPersistAt >= ONLINE_PERSIST_INTERVAL_MS) {
    await session.persistCurrentCharacter();
    session.onlineLastPersistAt = nowMs;
  }

  return creditedMs;
}

async function flushOnlinePresence(session: GameSession, nowMs = Date.now()): Promise<void> {
  if (!isWorldSession(session)) {
    return;
  }
  creditOnlinePresence(session, nowMs);
  ensureOnlineState(session, new Date(nowMs));
  await session.persistCurrentCharacter();
  session.onlineLastPersistAt = nowMs;
}

function getVerifiedOnlineMsToday(session: GameSession, now = new Date()): number {
  return ensureOnlineState(session, now).accumulatedTodayMs;
}

export {
  buildUtcDayKey,
  defaultOnlineState,
  ensureOnlineState,
  flushOnlinePresence,
  getVerifiedOnlineMsToday,
  initializeOnlineTracking,
  normalizeOnlineState,
  resolveEffectiveOnlineNowMs,
  touchOnlinePresence,
};
