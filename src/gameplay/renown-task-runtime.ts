import type { GameSession, RenownTaskDailyState } from '../types.js';

import { getVerifiedOnlineMsToday } from './online-runtime.js';
import { numberOrDefault, sanitizeQuestDialogueText, type UnknownRecord } from '../utils.js';

const RENOWN_TASK_ID = 811;
const RENOWN_TASK_ACCEPT_NPC_ID = 3534;
const RENOWN_TASK_DAILY_ACCEPT_LIMIT = 90;
const RENOWN_TASK_STREAK_TARGET = 20;
const POST_TWENTY_RENOWN_INTERVAL_MS = 5 * 60 * 1000;

function buildUtcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function defaultRenownTaskDailyState(now = new Date()): RenownTaskDailyState {
  return {
    dayKey: buildUtcDayKey(now),
    takenToday: 0,
    finishedToday: 0,
    firstTwentyStreakToday: 0,
    postTwentyOnlineClaimedMsToday: 0,
  };
}

function normalizeRenownTaskDailyState(source: unknown, now = new Date()): RenownTaskDailyState {
  const record = source && typeof source === 'object' ? (source as UnknownRecord) : null;
  const defaults = defaultRenownTaskDailyState(now);
  const dayKey = typeof record?.dayKey === 'string' && record.dayKey.length > 0 ? record.dayKey : defaults.dayKey;
  if (dayKey !== defaults.dayKey) {
    return defaults;
  }

  return {
    dayKey: defaults.dayKey,
    takenToday: Math.max(0, numberOrDefault(record?.takenToday, 0)),
    finishedToday: Math.max(0, numberOrDefault(record?.finishedToday, 0)),
    firstTwentyStreakToday: Math.max(
      0,
      Math.min(
        RENOWN_TASK_STREAK_TARGET,
        numberOrDefault(record?.firstTwentyStreakToday, 0)
      )
    ),
    postTwentyOnlineClaimedMsToday: Math.max(0, numberOrDefault(record?.postTwentyOnlineClaimedMsToday, 0)),
  };
}

function ensureRenownTaskDailyState(session: GameSession, now = new Date()): RenownTaskDailyState {
  const normalized = normalizeRenownTaskDailyState(session.renownTaskDailyState, now);
  session.renownTaskDailyState = normalized;
  return normalized;
}

function recordRenownTaskAccepted(session: GameSession, now = new Date()): RenownTaskDailyState {
  const state = ensureRenownTaskDailyState(session, now);
  state.takenToday += 1;
  return state;
}

function recordRenownTaskCompleted(session: GameSession, now = new Date()): RenownTaskDailyState {
  const state = ensureRenownTaskDailyState(session, now);
  const previousStreak = state.firstTwentyStreakToday;
  state.finishedToday += 1;
  state.firstTwentyStreakToday = Math.min(RENOWN_TASK_STREAK_TARGET, state.firstTwentyStreakToday + 1);
  if (previousStreak < RENOWN_TASK_STREAK_TARGET && state.firstTwentyStreakToday >= RENOWN_TASK_STREAK_TARGET) {
    state.postTwentyOnlineClaimedMsToday = getVerifiedOnlineMsToday(session, now);
  }
  return state;
}

function recordRenownTaskAbandoned(session: GameSession, now = new Date()): RenownTaskDailyState {
  const state = ensureRenownTaskDailyState(session, now);
  if (state.firstTwentyStreakToday < RENOWN_TASK_STREAK_TARGET) {
    state.firstTwentyStreakToday = 0;
    state.postTwentyOnlineClaimedMsToday = 0;
  }
  return state;
}

function claimPostTwentyOnlineRenownReward(session: GameSession, now = new Date()): number {
  const state = ensureRenownTaskDailyState(session, now);
  if (state.firstTwentyStreakToday < RENOWN_TASK_STREAK_TARGET) {
    return 0;
  }

  const onlineMsToday = getVerifiedOnlineMsToday(session, now);
  const availableMs = Math.max(0, onlineMsToday - Math.max(0, state.postTwentyOnlineClaimedMsToday));
  const renownPoints = Math.max(0, Math.floor(availableMs / POST_TWENTY_RENOWN_INTERVAL_MS));
  state.postTwentyOnlineClaimedMsToday = onlineMsToday;
  return renownPoints;
}

function formatRenownTaskHint(session: GameSession, now = new Date()): string {
  const state = ensureRenownTaskDailyState(session, now);
  const onlineMinutesToday = Math.floor(getVerifiedOnlineMsToday(session, now) / 60000);
  const streakText =
    state.firstTwentyStreakToday >= RENOWN_TASK_STREAK_TARGET
      ? 'First-20 streak complete. Auto renown active: 1 point per 5 minutes online.'
      : `First-20 streak: ${state.firstTwentyStreakToday}/${RENOWN_TASK_STREAK_TARGET}.`;
  return sanitizeQuestDialogueText(
    `Helpful Hints: You've taken ${state.takenToday} quests today. You've finished ${state.finishedToday} quests. Verified online today: ${onlineMinutesToday} minute(s). ${streakText}`,
    220
  );
}

function appendRenownTaskHint(baseMessage: string, session: GameSession, now = new Date()): string {
  return sanitizeQuestDialogueText(`${baseMessage} ${formatRenownTaskHint(session, now)}`, 220);
}

function getRenownTaskAcceptBlocker(session: GameSession, now = new Date()): string | null {
  const state = ensureRenownTaskDailyState(session, now);
  if (state.takenToday < RENOWN_TASK_DAILY_ACCEPT_LIMIT) {
    return null;
  }
  return sanitizeQuestDialogueText(
    `No more than ${RENOWN_TASK_DAILY_ACCEPT_LIMIT} Renown Tasks can be taken per day. ${formatRenownTaskHint(session, now)}`,
    220
  );
}

export {
  RENOWN_TASK_ID,
  RENOWN_TASK_ACCEPT_NPC_ID,
  RENOWN_TASK_DAILY_ACCEPT_LIMIT,
  RENOWN_TASK_STREAK_TARGET,
  appendRenownTaskHint,
  defaultRenownTaskDailyState,
  ensureRenownTaskDailyState,
  formatRenownTaskHint,
  getRenownTaskAcceptBlocker,
  normalizeRenownTaskDailyState,
  claimPostTwentyOnlineRenownReward,
  recordRenownTaskAccepted,
  recordRenownTaskAbandoned,
  recordRenownTaskCompleted,
};
