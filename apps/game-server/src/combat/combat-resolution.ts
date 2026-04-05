import type { CombatEnemyInstance, CombatState, GameSession } from '../types.js';
import { DEFAULT_FLAGS, FIGHT_ACTIVE_STATE_SUBCMD, FIGHT_CONTROL_RING_OPEN_SUBCMD, GAME_FIGHT_ACTION_CMD, GAME_FIGHT_STREAM_CMD } from '../config.js';
import { tryReadStaticJsonDocument } from '../db/static-json-store.js';
import { resolveRepoPath } from '../runtime-paths.js';
import { parseAttackSelection, parseCombatItemUse } from '../protocol/inbound-packets.js';
import { buildEnterGameProgressPacket } from '../protocol/gameplay-packets.js';
import { buildActionStateResetPacket, buildActionStateTableResetPacket, buildAttackPlaybackPacket, buildControlInitPacket, buildControlShowPacket, buildDefeatPacket, buildEntityHidePacket, buildRingOpenPacket, buildRoundStartPacket, buildStateModePacket, buildVictoryPacket, buildVictoryPointsPacket, buildVictoryRankPacket, buildVitalsPacket, buildActiveStatePacket } from './packets.js';
import { grantCombatDrops } from '../gameplay/combat-drop-runtime.js';
import { sendInventoryFullSync } from '../gameplay/inventory-runtime.js';
import { consumeUsableItemByInstanceId } from '../gameplay/item-use-runtime.js';
import { ensureSkillState, sendSkillStateSync } from '../gameplay/skill-runtime.js';
import {
  areAllSharedTeamCombatActionsReady,
  clearSharedTeamCombatQueuedActions,
  consumeSharedTeamCombatQueuedActions,
  endSharedTeamCombat,
  getSharedTeamCombatFollowers,
  getSharedTeamCombatOwnerSession,
  getSharedTeamCombatRoundParticipants,
  isSharedTeamCombatOwner,
  removeSharedTeamCombatParticipant,
  setSharedTeamCombatQueuedAction,
} from '../gameplay/team-runtime.js';
import { applyEffects } from '../effects/effect-executor.js';
import { PROGRESSION } from '../gameplay/progression.js';
import { handleActiveFieldEventVictory } from '../gameplay/field-event-runtime.js';
import { buildDefeatRespawnState } from '../gameplay/session-flows.js';
import { sendSelfStateVitalsUpdate } from '../gameplay/stat-sync.js';
import { getCapturePetTemplateId } from '../roleinfo/index.js';
import { getBagItemByReference, getItemDefinition } from '../inventory/index.js';
import {
  appendSkillPacketTrace,
  buildPlayerEntry,
  buildRoundStartProbeOptions,
  buildSkillPacketProbeTargets,
  buildSkillPacketProbeStage2Entries,
  computeEnemyDamage,
  computePlayerDamage,
  deriveCombatResultRankCode,
  describeEnemy,
  describeEncounterEnemies,
  describeEnemyRoster,
  describeLivingEnemies,
  dropResultPreview,
  findEnemyByEntityId,
  findFirstLivingEnemy,
  isEnemyDying,
  listLivingEnemies,
  pickRandomLivingEnemy,
  resolveCaptureTargetEnemy,
  resolvePlayerCounterattackChance,
  resolveSelectedEnemy,
  rollCapturedMonsterElementCode,
  SLAUGHTER_SKILL_ID,
  SKILL_PACKET_HYBRID_IMPACT_ENABLED,
  tickCombatStatuses,
} from './combat-formulas.js';
import { createIdleCombatState } from './combat-formulas.js';
import { handleCombatSkillUse, resolveCombatSkillUse } from './skill-resolution.js';

type CombatAction = Record<string, any>;
type EnemyTurnReason = 'normal' | 'post-kill';
type SharedCombatQueuedSelection =
  | { round: number; kind: 'attack'; attackMode: number; targetA: number; targetB: number; targetEntityId: number }
  | { round: number; kind: 'skill'; skillId: number; targetEntityId: number }
  | { round: number; kind: 'item'; instanceId: number; targetEntityId: number }
  | { round: number; kind: 'defend' };
type SharedCombatRoundEntry =
  | { actorKind: 'player'; session: GameSession; selection: SharedCombatQueuedSelection; ap: number }
  | { actorKind: 'enemy'; enemyEntityId: number; ap: number };
type ResolveCombatItemUseOptions = {
  deferSharedTeamPostResolution?: boolean;
  sharedTeamQueuedExecution?: boolean;
};
const DELAYED_SKILL_COMPLETION_TIMEOUT_MS = 1200;
const COMMAND_PHASE_AUTO_FALLBACK_DELAY_MS = 5000;
const CRANE_PASS_GUARDIAN_VICTORY_TRIGGER_PREFIX = 'npc-fight:3229:10001:';
const CRANE_PASS_GUARDIAN_VICTORY_MAP_ID = 138;
const CRANE_PASS_GUARDIAN_VICTORY_X = 80;
const CRANE_PASS_GUARDIAN_VICTORY_Y = 90;
const CRANE_PASS_GUARDIAN_RETURN_X = 90;
const CRANE_PASS_GUARDIAN_RETURN_Y = 107;
const SWAN_PASS_GUARDIAN_VICTORY_TRIGGER_PREFIX = 'npc-fight:3230:10001:';
const SWAN_PASS_GUARDIAN_VICTORY_MAP_ID = 230;
const SWAN_PASS_GUARDIAN_VICTORY_X = 75;
const SWAN_PASS_GUARDIAN_VICTORY_Y = 75;
const SWAN_PASS_GUARDIAN_RETURN_X = 55;
const SWAN_PASS_GUARDIAN_RETURN_Y = 49;
const LION_CAPTAIN_VICTORY_TRIGGER_PREFIX = 'npc-fight:3085:3001:';
const LION_CAPTAIN_VICTORY_MAP_ID = 134;
const LION_CAPTAIN_VICTORY_X = 67;
const LION_CAPTAIN_VICTORY_Y = 20;
const COMBAT_SELECTOR_TOKEN_PREFIX = 0x40000000;
const COMBAT_SELECTOR_TOKEN_LOW16_START = 0x6000;
const COMBAT_SELECTOR_TOKEN_LOW16_STEP = 0x100;
let NEXT_COMBAT_SELECTOR_TOKEN_LOW16 = COMBAT_SELECTOR_TOKEN_LOW16_START - 1;

function allocateCombatSelectorToken(): number {
  NEXT_COMBAT_SELECTOR_TOKEN_LOW16 += COMBAT_SELECTOR_TOKEN_LOW16_STEP;
  if (NEXT_COMBAT_SELECTOR_TOKEN_LOW16 > 0xffff) {
    NEXT_COMBAT_SELECTOR_TOKEN_LOW16 = COMBAT_SELECTOR_TOKEN_LOW16_START;
  }
  return (COMBAT_SELECTOR_TOKEN_PREFIX | (NEXT_COMBAT_SELECTOR_TOKEN_LOW16 & 0xffff)) >>> 0;
}

function resolveRoundStartSelectorToken(session: GameSession, activeEntityId: number): number {
  const selectorToken = session.combatState?.selectorToken;
  if (
    session.combatState?.selectorTokenSource === 'client' &&
    Number.isFinite(selectorToken) &&
    (selectorToken || 0) >= 0
  ) {
    session.combatState.selectorTokenSource = 'server';
    return (selectorToken as number) >>> 0;
  }
  const allocatedToken = allocateCombatSelectorToken();
  if (session.combatState) {
    session.combatState.selectorToken = allocatedToken;
    session.combatState.selectorTokenSource = 'server';
  }
  return allocatedToken;
}

function buildCommandRoundStartState(
  session: GameSession,
  activeEntityId: number
): {
  selectorToken: number;
  roundStartProbeOptions: Record<string, any> | null;
  roundStartPacket: Buffer;
} {
  const selectorToken = resolveRoundStartSelectorToken(session, activeEntityId);
  const roundStartProbeOptions = buildRoundStartProbeOptions(
    session.combatState.round,
    activeEntityId,
    selectorToken
  );
  const roundStartPacket = buildRoundStartPacket(
    session.combatState.round,
    activeEntityId,
    roundStartProbeOptions || { fieldB: selectorToken }
  );
  return {
    selectorToken,
    roundStartProbeOptions,
    roundStartPacket,
  };
}

function cloneCombatEnemyRoster(enemies: CombatEnemyInstance[] | null | undefined): CombatEnemyInstance[] {
  if (!Array.isArray(enemies)) {
    return [];
  }
  return enemies.map((enemy) => ({
    ...enemy,
    appearanceTypes: Array.isArray(enemy?.appearanceTypes) ? [...enemy.appearanceTypes] : [],
    appearanceVariants: Array.isArray(enemy?.appearanceVariants) ? [...enemy.appearanceVariants] : [],
    drops: Array.isArray(enemy?.drops) ? enemy.drops.map((drop) => ({ ...drop })) : [],
  }));
}

function cloneCombatEnemyStatuses(statuses: Record<number, any> | null | undefined): Record<number, any> {
  if (!statuses || typeof statuses !== 'object') {
    return {};
  }
  const cloned: Record<number, any> = {};
  for (const [rawEntityId, status] of Object.entries(statuses)) {
    const entityId = Number(rawEntityId) >>> 0;
    cloned[entityId] = status && typeof status === 'object' ? { ...status } : {};
  }
  return cloned;
}

function sendCombatEnemyHide(session: GameSession, entityId: number, reason: string): void {
  const packet = buildEntityHidePacket(entityId >>> 0);
  const owner = getSharedTeamCombatOwnerSession(session);
  const dispatcher = owner && owner.combatState?.active ? owner : session;
  dispatcher.writePacket(
    packet,
    DEFAULT_FLAGS,
    `Sending combat enemy hide entity=${entityId >>> 0} reason=${reason}`
  );
}

function syncSharedCombatEnemyRoster(owner: GameSession): void {
  const followers = getSharedTeamCombatFollowers(owner);
  for (const follower of followers) {
    if (!follower.combatState?.active) {
      continue;
    }
    follower.combatState.enemies = cloneCombatEnemyRoster(owner.combatState?.enemies);
    follower.combatState.enemyStatuses = cloneCombatEnemyStatuses(owner.combatState?.enemyStatuses);
    follower.combatState.round = owner.combatState?.round || follower.combatState.round;
  }
}

function syncSharedCombatParticipantState(owner: GameSession, participant: GameSession): void {
  if (!participant.combatState?.active) {
    return;
  }
  participant.combatState.enemies = cloneCombatEnemyRoster(owner.combatState?.enemies);
  participant.combatState.enemyStatuses = cloneCombatEnemyStatuses(owner.combatState?.enemyStatuses);
  participant.combatState.round = owner.combatState?.round || participant.combatState.round;
}

function resolveAttackPriority(session: GameSession): number {
  const persistedCharacter =
    session.persistedCharacter && typeof session.persistedCharacter === 'object'
      ? session.persistedCharacter
      : (typeof session.getPersistedCharacter === 'function' ? (session.getPersistedCharacter() || null) : null);
  const sessionRecord = session as unknown as Record<string, unknown>;
  const candidates = [
    sessionRecord.attackPriority,
    persistedCharacter ? (persistedCharacter as Record<string, unknown>).attackPriority : undefined,
    persistedCharacter ? (persistedCharacter as Record<string, unknown>).attack_priority : undefined,
    persistedCharacter ? (persistedCharacter as Record<string, unknown>).apPriority : undefined,
    persistedCharacter ? (persistedCharacter as Record<string, unknown>).ap : undefined,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return Math.max(0, numeric);
    }
  }
  return Math.max(0, Number(session.primaryAttributes?.dexterity) || 0);
}

function resolveEnemyAttackPriority(enemy: CombatEnemyInstance): number {
  const enemyRecord = enemy as unknown as Record<string, unknown>;
  const candidates = [
    enemyRecord.attackPriority,
    enemyRecord.attack_priority,
    enemyRecord.apPriority,
    enemyRecord.ap,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return Math.max(0, numeric);
    }
  }
  return Math.max(0, ((enemy.level || 1) * 10) + Math.max(0, enemy.aptitude || 0));
}

function sortSharedCombatParticipants(owner: GameSession, participants: GameSession[]): GameSession[] {
  const teamOrder = Array.isArray(owner.teamMembers) ? owner.teamMembers : [];
  return [...participants].sort((left, right) => {
    const priorityDelta = resolveAttackPriority(right) - resolveAttackPriority(left);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    const leftTeamIndex = teamOrder.findIndex((runtimeId) => (runtimeId >>> 0) === (left.runtimeId >>> 0));
    const rightTeamIndex = teamOrder.findIndex((runtimeId) => (runtimeId >>> 0) === (right.runtimeId >>> 0));
    if (leftTeamIndex !== rightTeamIndex) {
      return (leftTeamIndex >= 0 ? leftTeamIndex : Number.MAX_SAFE_INTEGER) -
        (rightTeamIndex >= 0 ? rightTeamIndex : Number.MAX_SAFE_INTEGER);
    }
    return (left.id >>> 0) - (right.id >>> 0);
  });
}

function getSharedCombatTargetSessions(owner: GameSession): GameSession[] {
  return [owner, ...getSharedTeamCombatFollowers(owner)]
    .filter((participant, index, values) =>
      Boolean(participant) &&
      participant.combatState?.active &&
      (participant.currentHealth || 0) > 0 &&
      values.findIndex((entry) => (entry.id >>> 0) === (participant.id >>> 0)) === index
    );
}

function sortSharedCombatRoundEntries(owner: GameSession, entries: SharedCombatRoundEntry[]): SharedCombatRoundEntry[] {
  const sortedParticipants = sortSharedCombatParticipants(owner, getSharedCombatTargetSessions(owner));
  const participantOrder = sortedParticipants.map((participant) => participant.id >>> 0);
  return [...entries].sort((left, right) => {
    const priorityDelta = right.ap - left.ap;
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    if (left.actorKind === 'player' && right.actorKind === 'player') {
      return participantOrder.indexOf(left.session.id >>> 0) - participantOrder.indexOf(right.session.id >>> 0);
    }
    if (left.actorKind === 'player' && right.actorKind === 'enemy') {
      return -1;
    }
    if (left.actorKind === 'enemy' && right.actorKind === 'player') {
      return 1;
    }
    const leftEnemyEntry = left as Extract<SharedCombatRoundEntry, { actorKind: 'enemy' }>;
    const rightEnemyEntry = right as Extract<SharedCombatRoundEntry, { actorKind: 'enemy' }>;
    const leftEnemy = findEnemyByEntityId(owner.combatState.enemies, leftEnemyEntry.enemyEntityId >>> 0);
    const rightEnemy = findEnemyByEntityId(owner.combatState.enemies, rightEnemyEntry.enemyEntityId >>> 0);
    const rowDelta = (leftEnemy?.row || 0) - (rightEnemy?.row || 0);
    if (rowDelta !== 0) {
      return rowDelta;
    }
    const colDelta = (leftEnemy?.col || 0) - (rightEnemy?.col || 0);
    if (colDelta !== 0) {
      return colDelta;
    }
    return (leftEnemyEntry.enemyEntityId >>> 0) - (rightEnemyEntry.enemyEntityId >>> 0);
  });
}

function buildSharedCombatRoundEntries(
  owner: GameSession,
  participants: GameSession[],
  selections: Map<number, SharedCombatQueuedSelection>
): SharedCombatRoundEntry[] {
  const entries: SharedCombatRoundEntry[] = [];
  const expectedRound = Math.max(1, owner.combatState?.round || 1) >>> 0;

  for (const participant of participants) {
    const selection = selections.get(participant.id >>> 0);
    if (
      !selection ||
      (selection.round >>> 0) !== expectedRound ||
      !participant.combatState?.active ||
      participant.socket?.destroyed ||
      (participant.currentHealth || 0) <= 0
    ) {
      continue;
    }
    entries.push({
      actorKind: 'player',
      session: participant,
      selection,
      ap: resolveAttackPriority(participant),
    });
  }

  for (const enemy of listLivingEnemies(owner.combatState?.enemies)) {
    entries.push({
      actorKind: 'enemy',
      enemyEntityId: enemy.entityId >>> 0,
      ap: resolveEnemyAttackPriority(enemy),
    });
  }

  return sortSharedCombatRoundEntries(owner, entries);
}

function finalizeSharedCombatRound(owner: GameSession): void {
  if (!owner.combatState?.active) {
    return;
  }

  const followers = getSharedTeamCombatFollowers(owner).filter((participant) => participant.combatState?.active);
  syncSharedCombatEnemyRoster(owner);

  if (!findFirstLivingEnemy(owner.combatState.enemies)) {
    for (const follower of followers) {
      if (!follower.combatState?.active) {
        continue;
      }
      follower.combatState.enemies = cloneCombatEnemyRoster(owner.combatState.enemies);
      void resolveVictory(follower);
    }
    void resolveVictory(owner);
    return;
  }

  owner.combatState.sharedActionSequenceToken = null;
  owner.combatState.sharedRoundEntries = null;
  owner.combatState.sharedRoundIndex = null;
  owner.combatState.sharedAwaitingActionReady = false;
  owner.combatState.sharedAwaitingReadySessionId = null;
  for (const follower of followers) {
    if (!follower.combatState?.active) {
      continue;
    }
      follower.combatState.phase = 'resolved';
      follower.combatState.awaitingPlayerAction = false;
      follower.combatState.awaitingClientReady = false;
      follower.combatState.pendingActionResolution = null;
      follower.combatState.sharedActionSequenceToken = null;
      follower.combatState.sharedRoundEntries = null;
      follower.combatState.sharedRoundIndex = null;
      follower.combatState.sharedAwaitingActionReady = false;
      follower.combatState.sharedAwaitingReadySessionId = null;
  }

  transitionToCommandPhase(owner, 'shared-round-complete');
}

function resolveSharedCombatEnemyTurn(owner: GameSession, enemyEntityId: number): boolean {
  if (!owner.combatState?.active) {
    return false;
  }

  const enemy = findEnemyByEntityId(owner.combatState.enemies, enemyEntityId >>> 0);
  if (!enemy || enemy.hp <= 0) {
    return false;
  }

  const enemyStatus = owner.combatState?.enemyStatuses?.[enemy.entityId >>> 0] || null;
  if ((enemyStatus?.actionDisabledRoundsRemaining || 0) > 0) {
    owner.log(
      `Combat round enemy action skipped entity=${enemy.entityId} reason=${enemyStatus?.actionDisabledReason || 'disabled'} roundsRemaining=${enemyStatus?.actionDisabledRoundsRemaining || 0}`
    );
    return false;
  }

  const targets = getSharedCombatTargetSessions(owner);
  if (targets.length <= 0) {
    return false;
  }
  const target = targets[Math.floor(Math.random() * targets.length)];
  owner.combatState.sharedAwaitingReadySessionId = target.id >>> 0;
  const enemyDamage = computeEnemyDamage(target, enemy);
  const defendedDamage = computeDefendedDamage(enemyDamage, target);
  const appliedEnemyDamage = Math.max(0, Math.min(target.currentHealth, defendedDamage));
  const nextHealth = Math.max(0, target.currentHealth - defendedDamage);
  const lethalHit = nextHealth <= 0;
  target.currentHealth = nextHealth;
  target.combatState.damageTaken = Math.max(0, (target.combatState.damageTaken || 0) + appliedEnemyDamage);
  target.writePacket(
    buildAttackPlaybackPacket(
      enemy.entityId >>> 0,
      target.runtimeId >>> 0,
      lethalHit ? FIGHT_ACTIVE_STATE_SUBCMD : FIGHT_CONTROL_RING_OPEN_SUBCMD,
      defendedDamage
    ),
    DEFAULT_FLAGS,
    `Sending combat round enemy playback attacker=${enemy.entityId >>> 0} target=${target.runtimeId >>> 0} damage=${defendedDamage} raw=${enemyDamage} defended=${defendedDamage !== enemyDamage ? 1 : 0} targetHp=${target.currentHealth} ap=${resolveEnemyAttackPriority(enemy)}`
  );

  if (target.currentHealth <= 0) {
    resolveDefeat(target);
    return false;
  }

  return true;
}

function clearRoundDefenseState(session: GameSession): void {
  const playerStatus = session.combatState?.playerStatus;
  if (!playerStatus) {
    return;
  }
  delete playerStatus.defendPending;
}

function computeDefendedDamage(rawDamage: number, session: GameSession): number {
  const normalizedDamage = Math.max(0, rawDamage | 0);
  if (session.combatState?.playerStatus?.defendPending !== true) {
    return normalizedDamage;
  }
  return Math.max(0, Math.ceil(normalizedDamage / 2));
}

function resetCommandPhaseAutoFallback(session: GameSession): void {
  if (!session.combatState) {
    return;
  }
  session.combatState.commandReadyFallbackToken = null;
  session.combatState.commandReadyFallbackRound = null;
}

function buildAutoAttackSelectionPayload(enemy: CombatEnemyInstance): Buffer {
  return Buffer.from([
    GAME_FIGHT_ACTION_CMD & 0xff,
    (GAME_FIGHT_ACTION_CMD >>> 8) & 0xff,
    0x03,
    0x01,
    enemy.row & 0xff,
    enemy.col & 0xff,
  ]);
}

function buildAutoSkillUsePayload(skillId: number, targetEntityId: number): Buffer {
  const payload = Buffer.alloc(9);
  payload.writeUInt16LE(GAME_FIGHT_ACTION_CMD, 0);
  payload[2] = 0x04;
  payload.writeUInt16LE(skillId & 0xffff, 3);
  payload.writeUInt32LE(targetEntityId >>> 0, 5);
  return payload;
}

export function scheduleCommandPhaseAutoFallback(session: GameSession, source: string): void {
  if (!session.combatState?.active || session.combatState.phase !== 'command' || !session.combatState.awaitingPlayerAction) {
    return;
  }

  const round = Math.max(1, session.combatState.round || 1);
  if ((session.combatState.commandReadyFallbackRound || 0) === round) {
    return;
  }

  const token = (((session.combatState.commandReadyFallbackToken || 0) + 1) >>> 0) || 1;
  session.combatState.commandReadyFallbackToken = token;
  session.combatState.commandReadyFallbackRound = round;
  session.log(
    `Queued combat auto fallback source=${source} round=${round} delayMs=${COMMAND_PHASE_AUTO_FALLBACK_DELAY_MS}`
  );

  setTimeout(() => {
    if (!session.combatState?.active || session.combatState.phase !== 'command' || !session.combatState.awaitingPlayerAction) {
      return;
    }
    if ((session.combatState.commandReadyFallbackToken || 0) !== token) {
      return;
    }
    if ((session.combatState.commandReadyFallbackRound || 0) !== round) {
      return;
    }

    const enemy = findFirstLivingEnemy(session.combatState.enemies);
    const skillState = ensureSkillState(session);
    const rememberedAction = skillState.lastCombatAction;
    const rememberedSkillId = Number(skillState.lastCombatSkillId || 0) >>> 0;

    if (rememberedAction === 'skill' && rememberedSkillId > 0) {
      const autoTargetEntityId = enemy?.entityId ? (enemy.entityId >>> 0) : (session.runtimeId >>> 0);
      session.log(
        `Executing combat auto fallback source=${source} round=${round} action=skill skillId=${rememberedSkillId} target=${autoTargetEntityId}`
      );
      handleCombatSkillUse(session, buildAutoSkillUsePayload(rememberedSkillId, autoTargetEntityId));
      if (!session.combatState?.active || session.combatState.phase !== 'command' || !session.combatState.awaitingPlayerAction) {
        return;
      }
      session.log(
        `Combat auto fallback skill unresolved source=${source} round=${round} skillId=${rememberedSkillId} fallback=attack`
      );
    }

    if (!enemy || enemy.hp <= 0) {
      session.log(`Skipping combat auto fallback source=${source} round=${round} reason=no-living-target`);
      resetCommandPhaseAutoFallback(session);
      return;
    }

    session.log(
      `Executing combat auto fallback source=${source} round=${round} action=attack target=${enemy.entityId >>> 0} row=${enemy.row} col=${enemy.col}`
    );
    handleAttackSelection(session, buildAutoAttackSelectionPayload(enemy));
  }, COMMAND_PHASE_AUTO_FALLBACK_DELAY_MS);
}

function continueSharedCombatRound(owner: GameSession, source: string): void {
  if (!owner.combatState?.active || (owner.combatState.sharedActionSequenceToken || 0) === 0) {
    return;
  }

  const entries = Array.isArray(owner.combatState.sharedRoundEntries)
    ? (owner.combatState.sharedRoundEntries as SharedCombatRoundEntry[])
    : [];
  const currentIndex = Number.isInteger(owner.combatState.sharedRoundIndex)
    ? Number(owner.combatState.sharedRoundIndex)
    : -1;
  owner.combatState.sharedAwaitingActionReady = false;
  owner.combatState.sharedAwaitingReadySessionId = null;
  owner.log(`Advancing combat round source=${source} nextIndex=${currentIndex + 1}`);
  resolveSharedTeamQueuedTurnStep(owner, entries, currentIndex + 1, owner.combatState.sharedActionSequenceToken || 0);
}

export function tryAdvanceSharedCombatRoundOnReady(session: GameSession): boolean {
  const owner = getSharedTeamCombatOwnerSession(session);
  if (!owner || !owner.combatState?.active) {
    return false;
  }
  if (owner.combatState.sharedAwaitingActionReady !== true) {
    return false;
  }
  const expectedReadySessionId = owner.combatState.sharedAwaitingReadySessionId;
  const normalizedExpectedReadySessionId = Number(expectedReadySessionId);
  if (Number.isInteger(normalizedExpectedReadySessionId) && (session.id >>> 0) !== (normalizedExpectedReadySessionId >>> 0)) {
    owner.log(
      `Ignoring combat round ready event from S${session.id} while waiting for S${normalizedExpectedReadySessionId >>> 0} roundIndex=${Number(owner.combatState.sharedRoundIndex ?? -1)}`
    );
    return true;
  }
  owner.log(
    `Consuming combat round ready event from S${session.id} roundIndex=${Number(owner.combatState.sharedRoundIndex ?? -1)}`
  );
  continueSharedCombatRound(owner, `client-ready:S${session.id}`);
  return true;
}

function resolveSharedTeamQueuedTurnStep(
  owner: GameSession,
  roundEntries: SharedCombatRoundEntry[],
  actionIndex: number,
  sequenceToken: number
): void {
  if (!owner.combatState?.active || (owner.combatState.sharedActionSequenceToken || 0) !== sequenceToken) {
    return;
  }

  owner.combatState.sharedRoundEntries = roundEntries as unknown as Array<Record<string, any>>;

  if (actionIndex >= roundEntries.length) {
    finalizeSharedCombatRound(owner);
    return;
  }

  const roundEntry = roundEntries[actionIndex];
  if (roundEntry.actorKind === 'enemy') {
    owner.combatState.sharedRoundIndex = actionIndex;
    owner.combatState.sharedAwaitingActionReady = true;
    owner.combatState.sharedAwaitingReadySessionId = null;
    if (!resolveSharedCombatEnemyTurn(owner, roundEntry.enemyEntityId >>> 0)) {
      owner.combatState.sharedAwaitingActionReady = false;
      owner.combatState.sharedAwaitingReadySessionId = null;
      resolveSharedTeamQueuedTurnStep(owner, roundEntries, actionIndex + 1, sequenceToken);
      return;
    }
    return;
  }

  const participant = roundEntry.session;
  const participantSelection = roundEntry.selection;
  if (!participant?.combatState?.active || participant.socket?.destroyed || (participant.currentHealth || 0) <= 0) {
    resolveSharedTeamQueuedTurnStep(owner, roundEntries, actionIndex + 1, sequenceToken);
    return;
  }

  owner.combatState.sharedRoundIndex = actionIndex;
  syncSharedCombatParticipantState(owner, participant);

  if (participantSelection.kind === 'skill') {
    const previousDamageDealt = Math.max(0, participant.combatState?.damageDealt || 0);
    participant.combatState.awaitingPlayerAction = true;
    participant.combatState.awaitingClientReady = false;
    participant.combatState.phase = 'command';
    resolveCombatSkillUse(
      participant,
      participantSelection.skillId,
      participantSelection.targetEntityId,
      'shared-team-queued-skill',
      { deferSharedTeamPostResolution: true }
    );
    if (participant.combatState.awaitingSkillResolution) {
      owner.combatState.sharedAwaitingActionReady = false;
      owner.combatState.sharedAwaitingReadySessionId = null;
      return;
    }
    const participantDamageDelta = Math.max(
      0,
      Math.max(0, participant.combatState?.damageDealt || 0) - previousDamageDealt
    );
    owner.combatState.damageDealt = Math.max(0, (owner.combatState.damageDealt || 0) + participantDamageDelta);
    owner.combatState.enemies = cloneCombatEnemyRoster(participant.combatState?.enemies);
    owner.combatState.enemyStatuses = cloneCombatEnemyStatuses(participant.combatState?.enemyStatuses);
    syncSharedCombatEnemyRoster(owner);
    continueSharedCombatRound(owner, `skill-immediate:S${participant.id}`);
    return;
  } else if (participantSelection.kind === 'item') {
    owner.combatState.sharedAwaitingActionReady = true;
    owner.combatState.sharedAwaitingReadySessionId = participant.id >>> 0;
    participant.combatState.awaitingPlayerAction = true;
    participant.combatState.awaitingClientReady = false;
    participant.combatState.phase = 'command';
    void resolveCombatItemUse(
      participant,
      participantSelection.instanceId >>> 0,
      participantSelection.targetEntityId >>> 0,
      'shared-team-queued-item',
      {
        deferSharedTeamPostResolution: true,
        sharedTeamQueuedExecution: true,
      }
    );
    if (participant.combatState.awaitingPlayerAction === true || participant.combatState.phase === 'command') {
      owner.combatState.sharedAwaitingActionReady = false;
      owner.combatState.sharedAwaitingReadySessionId = null;
      owner.log(
        `Combat round item skipped actor=${participant.runtimeId >>> 0} reason=rejected-or-reprompted ap=${resolveAttackPriority(participant)}`
      );
      continueSharedCombatRound(owner, `item-rejected:S${participant.id}`);
      return;
    }
    owner.combatState.enemies = cloneCombatEnemyRoster(participant.combatState?.enemies);
    owner.combatState.enemyStatuses = cloneCombatEnemyStatuses(participant.combatState?.enemyStatuses);
    syncSharedCombatEnemyRoster(owner);
  } else if (participantSelection.kind === 'defend') {
    const playerStatus = participant.combatState.playerStatus || (participant.combatState.playerStatus = {});
    playerStatus.defendPending = true;
    participant.log(
      `Combat round defend resolved defender=${participant.runtimeId >>> 0} ap=${resolveAttackPriority(participant)}`
    );
    continueSharedCombatRound(owner, `defend:S${participant.id}`);
  } else {
    const explicitEnemy = findEnemyByEntityId(owner.combatState.enemies, participantSelection.targetEntityId >>> 0);
    const selectedEnemy =
      explicitEnemy && explicitEnemy.hp > 0
        ? explicitEnemy
        : pickRandomLivingEnemy(owner.combatState.enemies);
    if (!selectedEnemy || selectedEnemy.hp <= 0) {
      owner.log(
        `Combat round attack skipped attacker=${participant.runtimeId >>> 0} reason=no-living-target requested=${participantSelection.targetEntityId >>> 0} roster=${describeLivingEnemies(owner.combatState.enemies)} ap=${resolveAttackPriority(participant)}`
      );
      resolveSharedTeamQueuedTurnStep(owner, roundEntries, actionIndex + 1, sequenceToken);
      return;
    }
    owner.combatState.sharedAwaitingActionReady = true;
    owner.combatState.sharedAwaitingReadySessionId = participant.id >>> 0;
    const playerDamage = computePlayerDamage(participant, selectedEnemy);
    const appliedPlayerDamage = Math.max(0, Math.min(selectedEnemy.hp, playerDamage));
    selectedEnemy.hp = Math.max(0, selectedEnemy.hp - playerDamage);
    owner.combatState.damageDealt = Math.max(0, (owner.combatState.damageDealt || 0) + appliedPlayerDamage);
    participant.combatState.damageDealt = Math.max(0, (participant.combatState.damageDealt || 0) + appliedPlayerDamage);
    owner.log(
      `Combat round attack resolved attacker=${participant.runtimeId >>> 0} target=${selectedEnemy.entityId >>> 0} damage=${playerDamage} enemyHp=${selectedEnemy.hp} ap=${resolveAttackPriority(participant)}`
    );
    participant.writePacket(
      buildAttackPlaybackPacket(
        participant.runtimeId >>> 0,
        selectedEnemy.entityId >>> 0,
        selectedEnemy.hp === 0 ? FIGHT_ACTIVE_STATE_SUBCMD : FIGHT_CONTROL_RING_OPEN_SUBCMD,
        playerDamage
      ),
      DEFAULT_FLAGS,
      `Sending combat round attack playback attacker=${participant.runtimeId} target=${selectedEnemy.entityId} damage=${playerDamage} enemyHp=${selectedEnemy.hp} ap=${resolveAttackPriority(participant)}`
    );

    if (selectedEnemy.hp <= 0) {
      sendCombatEnemyHide(participant, selectedEnemy.entityId >>> 0, 'shared-attack');
    }
  }
}

function tryHandleSharedTeamAttackSelection(session: GameSession, payload: Buffer): boolean {
  const owner = getSharedTeamCombatOwnerSession(session);
  if (!owner || !owner.combatState?.active) {
    return false;
  }

  if (!session.combatState?.active || !session.combatState.awaitingPlayerAction) {
    session.log(`Ignoring combat round attack selection without command prompt active=${session.combatState?.active ? 1 : 0}`);
    return true;
  }

  const selection = parseAttackSelection(payload);
  const enemy = resolveSelectedEnemy(owner.combatState.enemies, selection);
  if (!enemy || enemy.hp <= 0) {
    session.log('Ignoring shared combat attack selection because combat enemy is missing');
    return true;
  }

  const skillState = ensureSkillState(session);
  skillState.lastCombatAction = 'attack';
  skillState.lastCombatSkillId = null;

  session.combatState.awaitingPlayerAction = false;
  session.combatState.awaitingClientReady = false;
  session.combatState.phase = 'resolved';
  setSharedTeamCombatQueuedAction(owner, session, {
    round: Math.max(1, owner.combatState.round || 1),
    kind: 'attack',
    attackMode: selection.attackMode,
    targetA: selection.targetA,
    targetB: selection.targetB,
    targetEntityId: enemy.entityId >>> 0,
  });
  session.log(
    `Queued combat round attack selection round=${owner.combatState.round} mode=${selection.attackMode} target=${selection.targetA},${selection.targetB} targetEntityId=${enemy.entityId >>> 0} ownerSession=${owner.id >>> 0}`
  );

  if (!areAllSharedTeamCombatActionsReady(owner)) {
    return true;
  }

  resolveSharedTeamQueuedTurn(owner);
  return true;
}

function tryHandleSharedTeamItemSelection(
  session: GameSession,
  instanceId: number,
  targetEntityId: number
): boolean {
  const owner = getSharedTeamCombatOwnerSession(session);
  if (!owner || !owner.combatState?.active) {
    return false;
  }

  if (!session.combatState?.active || !session.combatState.awaitingPlayerAction) {
    session.log(`Ignoring combat round item selection without command prompt active=${session.combatState?.active ? 1 : 0}`);
    return true;
  }

  session.combatState.awaitingPlayerAction = false;
  session.combatState.awaitingClientReady = false;
  session.combatState.phase = 'resolved';
  setSharedTeamCombatQueuedAction(owner, session, {
    round: Math.max(1, owner.combatState.round || 1),
    kind: 'item',
    instanceId: instanceId >>> 0,
    targetEntityId: targetEntityId >>> 0,
  });
  session.log(
    `Queued combat round item selection round=${owner.combatState.round} instanceId=${instanceId >>> 0} targetEntityId=${targetEntityId >>> 0} ownerSession=${owner.id >>> 0}`
  );

  if (!areAllSharedTeamCombatActionsReady(owner)) {
    return true;
  }

  resolveSharedTeamQueuedTurn(owner);
  return true;
}

function tryHandleSharedTeamDefendSelection(session: GameSession): boolean {
  const owner = getSharedTeamCombatOwnerSession(session);
  if (!owner || !owner.combatState?.active) {
    return false;
  }

  if (!session.combatState?.active || !session.combatState.awaitingPlayerAction) {
    session.log(`Ignoring combat round defend selection without command prompt active=${session.combatState?.active ? 1 : 0}`);
    return true;
  }

  session.combatState.awaitingPlayerAction = false;
  session.combatState.awaitingClientReady = false;
  session.combatState.phase = 'resolved';
  setSharedTeamCombatQueuedAction(owner, session, {
    round: Math.max(1, owner.combatState.round || 1),
    kind: 'defend',
  });
  session.log(`Queued combat round defend selection round=${owner.combatState.round} ownerSession=${owner.id >>> 0}`);

  if (!areAllSharedTeamCombatActionsReady(owner)) {
    return true;
  }

  resolveSharedTeamQueuedTurn(owner);
  return true;
}

export function resolveSharedTeamQueuedTurn(owner: GameSession): void {
  if (!owner.combatState?.active) {
    return;
  }

  if (
    (owner.combatState.sharedActionSequenceToken || 0) !== 0 ||
    Array.isArray(owner.combatState.sharedRoundEntries)
  ) {
    owner.log(
      `Ignoring duplicate combat round resolve round=${owner.combatState.round} phase=${owner.combatState.phase}`
    );
    return;
  }

  const selections = consumeSharedTeamCombatQueuedActions(owner);
  const participants = sortSharedCombatParticipants(owner, getSharedTeamCombatRoundParticipants(owner));
  const roundEntries = buildSharedCombatRoundEntries(owner, participants, selections);
  const sequenceToken = ((owner.combatState.sharedActionSequenceToken || 0) + 1) >>> 0;
  owner.combatState.sharedActionSequenceToken = sequenceToken;
  owner.combatState.sharedRoundEntries = roundEntries as unknown as Array<Record<string, any>>;
  owner.combatState.sharedRoundIndex = -1;
  owner.combatState.sharedAwaitingActionReady = false;
  owner.combatState.sharedAwaitingReadySessionId = null;
  for (const participant of participants) {
    if (!participant.combatState?.active) {
      continue;
    }
    participant.combatState.sharedActionSequenceToken = sequenceToken;
  }
  owner.log(
    `Resolving combat round order round=${owner.combatState.round} ${roundEntries.map((entry) =>
      entry.actorKind === 'player'
        ? `${entry.session.charName}:${entry.ap}:${entry.selection.kind}`
        : `${findEnemyByEntityId(owner.combatState.enemies, entry.enemyEntityId >>> 0)?.name || 'enemy'}#${entry.enemyEntityId >>> 0}:${entry.ap}:enemy`
    ).join(' -> ')}`
  );
  resolveSharedTeamQueuedTurnStep(owner, roundEntries, 0, sequenceToken);
}

export function handleSharedCombatParticipantDisposed(session: GameSession): void {
  const owner = getSharedTeamCombatOwnerSession(session);
  if (!owner || !owner.combatState?.active) {
    return;
  }

  if ((owner.id >>> 0) === (session.id >>> 0)) {
    for (const follower of getSharedTeamCombatFollowers(owner)) {
      if (!follower.combatState?.active) {
        continue;
      }
      void clearCombatState(follower, false);
    }
    owner.combatState = createIdleCombatState();
    endSharedTeamCombat(owner);
    return;
  }

  const updatedOwner = removeSharedTeamCombatParticipant(session);
  if (!updatedOwner || !updatedOwner.combatState?.active) {
    return;
  }

  const awaitingReadySessionId = Number(updatedOwner.combatState.sharedAwaitingReadySessionId);
  if (
    updatedOwner.combatState.sharedAwaitingActionReady === true &&
    Number.isInteger(awaitingReadySessionId) &&
    (awaitingReadySessionId >>> 0) === (session.id >>> 0)
  ) {
    continueSharedCombatRound(updatedOwner, `participant-disconnect:S${session.id}`);
    return;
  }

  if (areAllSharedTeamCombatActionsReady(updatedOwner)) {
    resolveSharedTeamQueuedTurn(updatedOwner);
  }
}

export function resolveCombatDefend(
  session: GameSession,
  sourceLabel: string
): void {
  if (!session.combatState?.active || !session.combatState.awaitingPlayerAction) {
    session.log(`Ignoring combat defend without command prompt active=${session.combatState?.active ? 1 : 0}`);
    return;
  }

  if (tryHandleSharedTeamDefendSelection(session)) {
    return;
  }

  const playerStatus = session.combatState.playerStatus || (session.combatState.playerStatus = {});
  playerStatus.defendPending = true;
  session.combatState.awaitingPlayerAction = false;
  session.combatState.phase = 'resolved';
  session.log(`Combat defend source=${sourceLabel} trigger=${session.combatState.triggerId} round=${session.combatState.round}`);
  session.combatState.pendingActionResolution = { reason: 'normal' };
  session.combatState.awaitingClientReady = true;
}

function loadCombatTips(): string[] {
  const parsed = tryReadStaticJsonDocument<{ tips?: unknown }>(
    resolveRepoPath('data', 'client-verified', 'combat-tips.json')
  );
  return Array.isArray(parsed?.tips) ? parsed.tips.filter((t): t is string => typeof t === 'string') : [];
}
const COMBAT_TIPS = loadCombatTips();

function sendCombatActionStateReset(session: GameSession, reason: string): void {
  session.writePacket(
    buildActionStateResetPacket(session.runtimeId >>> 0),
    DEFAULT_FLAGS,
    `Sending combat action-state reset cmd=0x040d entity=${session.runtimeId} reason=${reason}`
  );
  session.writePacket(
    buildActionStateTableResetPacket(session.runtimeId >>> 0),
    DEFAULT_FLAGS,
    `Sending combat action-state table reset cmd=0x040d entity=${session.runtimeId} reason=${reason} entries=11`
  );
}

function sendCombatExitRestorePacket(session: GameSession, reason: string): void {
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
    `Sending combat exit restore cmd=0x03e9 sub=0x03 reason=${reason} runtimeId=${session.runtimeId >>> 0} map=${session.currentMapId} pos=${session.currentX},${session.currentY}`
  );
}

function sendCombatExitClientCleanup(session: GameSession, reason: string): void {
  if (!session.socket || session.socket.destroyed) {
    return;
  }
  sendCombatActionStateReset(session, reason);
  // Keep the full runtime bootstrap on normal combat exit. Reducing this to only
  // restore+self-state caused the client to retain stale combat/runtime state and
  // visibly compound attack values after battles. If this ever changes, replace it
  // with an equivalent full out-of-combat resync, not a partial packet subset.
  if (typeof session.sendEnterGameOk === 'function') {
    session.log(`Sending combat exit runtime bootstrap reason=${reason}`);
    session.sendEnterGameOk({ syncMode: 'runtime' });
    return;
  }
  sendCombatExitRestorePacket(session, reason);
  session.sendSelfStateAptitudeSync();
  sendSkillStateSync(session, `combat-exit:${reason}`);
  session.scheduleEquipmentReplay(0);
  session.sendPetStateSync(`combat-exit:${reason}`);
}

// --- Intro / Command prompt ---

export function sendIntroSequence(session: GameSession): void {
  const entityId = session.runtimeId >>> 0;
  if (COMBAT_TIPS.length > 0) {
    const tip = COMBAT_TIPS[Math.floor(Math.random() * COMBAT_TIPS.length)];
    session.sendGameDialogue('Tip', tip);
  }
  sendCombatActionStateReset(session, `intro trigger=${session.combatState.triggerId}`);
  session.writePacket(buildRingOpenPacket(), DEFAULT_FLAGS, `Sending combat ring-open trigger=${session.combatState.triggerId}`);
  session.writePacket(buildStateModePacket(), DEFAULT_FLAGS, `Sending combat mode trigger=${session.combatState.triggerId}`);
  session.writePacket(buildControlInitPacket(), DEFAULT_FLAGS, `Sending combat control init trigger=${session.combatState.triggerId}`);
  session.writePacket(buildActiveStatePacket(entityId), DEFAULT_FLAGS, `Sending combat active state trigger=${session.combatState.triggerId} active=${entityId}`);
  session.writePacket(buildEntityHidePacket(entityId), DEFAULT_FLAGS, `Sending combat entity hide trigger=${session.combatState.triggerId} active=${entityId}`);
  session.writePacket(buildControlShowPacket(entityId), DEFAULT_FLAGS, `Sending combat control show trigger=${session.combatState.triggerId} active=${entityId}`);
}

export function sendCommandPrompt(session: GameSession, reason: string): void {
  const entityId = session.runtimeId >>> 0;
  const { selectorToken, roundStartProbeOptions, roundStartPacket } = buildCommandRoundStartState(session, entityId);
  sendCombatActionStateReset(session, `command reason=${reason}`);
  session.writePacket(buildRingOpenPacket(), DEFAULT_FLAGS, `Sending combat ring-open refresh reason=${reason}`);
  session.writePacket(
    roundStartPacket,
    DEFAULT_FLAGS,
    `Sending combat round start reason=${reason} round=${session.combatState.round} active=${entityId}` +
    ` selectorToken=${selectorToken}` +
    `${roundStartProbeOptions ? ` probe=${JSON.stringify(roundStartProbeOptions)}` : ''}` +
    ` hex=${roundStartPacket.toString('hex')}`
  );
  appendSkillPacketTrace({
    kind: 'round-start-outbound',
    ts: new Date().toISOString(),
    sessionId: session.id,
    round: session.combatState.round,
    activeEntityId: entityId >>> 0,
    selectorToken,
    probeEnabled: roundStartProbeOptions !== null,
    probe: roundStartProbeOptions,
    packetHex: roundStartPacket.toString('hex'),
  });
  session.writePacket(buildControlShowPacket(entityId), DEFAULT_FLAGS, `Sending combat control refresh reason=${reason} active=${entityId}`);
}

export function transitionToCommandPhase(session: GameSession, reason: string): void {
  session.combatState.awaitingClientReady = false;
  session.combatState.awaitingPlayerAction = true;
  session.combatState.phase = 'command';
  session.combatState.pendingActionResolution = null;
  session.combatState.round = Math.max(1, (session.combatState.round || 0) + 1);
  resetCommandPhaseAutoFallback(session);
  clearRoundDefenseState(session);
  sendCommandPrompt(session, reason);
  if (isSharedTeamCombatOwner(session)) {
    clearSharedTeamCombatQueuedActions(session);
    syncSharedCombatEnemyRoster(session);
    session.combatState.sharedAwaitingReadySessionId = null;
    for (const follower of getSharedTeamCombatFollowers(session)) {
      if (!follower.combatState?.active) {
        continue;
      }
      follower.combatState.awaitingClientReady = false;
      follower.combatState.awaitingPlayerAction = true;
      follower.combatState.phase = 'command';
      follower.combatState.pendingActionResolution = null;
      follower.combatState.round = session.combatState.round;
      follower.combatState.sharedAwaitingReadySessionId = null;
      resetCommandPhaseAutoFallback(follower);
      clearRoundDefenseState(follower);
      sendCommandPrompt(follower, `${reason}:shared`);
    }
  }
}

export function resendCombatCommandPrompt(session: GameSession, reason: string): void {
  if (!session.combatState?.active) {
    return;
  }
  session.combatState.awaitingPlayerAction = true;
  session.combatState.phase = 'command';
  sendCommandPrompt(session, reason);
}

export function handleCombatSelectorToken(session: GameSession, selectorToken: number, sourceLabel: string): void {
  if (!session.combatState?.active) {
    return;
  }

  const normalizedToken = selectorToken >>> 0;
  const previousToken = Number.isFinite(session.combatState.selectorToken)
    ? ((session.combatState.selectorToken as number) >>> 0)
    : null;
  session.combatState.selectorToken = normalizedToken;
  session.combatState.selectorTokenSource = 'client';
  appendSkillPacketTrace({
    kind: 'fight-selector-token',
    ts: new Date().toISOString(),
    sessionId: session.id,
    token: normalizedToken,
    previousToken,
    phase: session.combatState.phase || 'unknown',
    awaitingPlayerAction: session.combatState.awaitingPlayerAction === true,
    round: session.combatState.round,
    source: sourceLabel,
  });
  session.log(
    `Received combat selector token source=${sourceLabel} token=${normalizedToken} previous=${previousToken ?? 'none'} ` +
    `phase=${session.combatState.phase || 'unknown'} round=${session.combatState.round}`
  );

  if (
    session.combatState.phase === 'command' &&
    session.combatState.awaitingPlayerAction === true &&
    previousToken !== normalizedToken
  ) {
    resendCombatCommandPrompt(session, 'selector-token');
  }
}

export function resolveCombatFlee(session: GameSession, sourceLabel: string): void {
  if (!session.combatState?.active || !session.combatState.awaitingPlayerAction) {
    session.log(`Ignoring combat flee without command prompt active=${session.combatState?.active ? 1 : 0}`);
    return;
  }

  session.combatState.awaitingPlayerAction = false;
  session.combatState.awaitingClientReady = false;
  session.combatState.phase = 'resolved';
  session.combatState.pendingEnemyTurnQueue = [];
  session.combatState.pendingPostKillCounterattack = false;
  session.combatState.pendingCounterattack = null;
  session.combatState.pendingActionResolution = null;
  session.combatState.enemyTurnReason = null;
  session.combatState.awaitingSkillResolution = false;
  session.combatState.skillResolutionPhase = null;
  session.combatState.pendingSkillOutcomes = null;
  session.combatState.pendingSkillContext = null;
  session.log(`Combat flee source=${sourceLabel} trigger=${session.combatState.triggerId} round=${session.combatState.round}`);
  session.writePacket(
    buildVictoryPacket(session.currentHealth, session.currentMana, session.currentRage, {
      characterExperience: 0,
      petExperience: 0,
      coins: 0,
      items: [],
    }),
    DEFAULT_FLAGS,
    `Sending combat flee result hp=${session.currentHealth} mp=${session.currentMana} rage=${session.currentRage}`
  );
  void clearCombatState(session, false);
}

// --- Attack handling ---

export function handleAttackSelection(session: GameSession, payload: Buffer): void {
  if (tryHandleSharedTeamAttackSelection(session, payload)) {
    return;
  }

  if (!session.combatState?.active || !session.combatState.awaitingPlayerAction) {
    session.log(`Ignoring attack selection without command prompt active=${session.combatState?.active ? 1 : 0}`);
    return;
  }

  const selection = parseAttackSelection(payload);
  const enemy = resolveSelectedEnemy(session.combatState.enemies, selection);
  if (!enemy || enemy.hp <= 0) {
    session.log('Ignoring attack selection because combat enemy is missing');
    return;
  }

  const skillState = ensureSkillState(session);
  skillState.lastCombatAction = 'attack';
  skillState.lastCombatSkillId = null;

  session.combatState.awaitingPlayerAction = false;
  session.combatState.phase = 'resolved';
  session.log(`Combat attack selected mode=${selection.attackMode} target=${selection.targetA},${selection.targetB} enemy=${describeEnemy(enemy)} living=${describeLivingEnemies(session.combatState.enemies)}`);

  const playerDamage = computePlayerDamage(session, enemy);
  const appliedPlayerDamage = Math.max(0, Math.min(enemy.hp, playerDamage));
  enemy.hp = Math.max(0, enemy.hp - playerDamage);
  session.combatState.damageDealt = Math.max(0, (session.combatState.damageDealt || 0) + appliedPlayerDamage);
  session.writePacket(
    buildAttackPlaybackPacket(
      session.runtimeId >>> 0,
      enemy.entityId >>> 0,
      enemy.hp === 0 ? FIGHT_ACTIVE_STATE_SUBCMD : FIGHT_CONTROL_RING_OPEN_SUBCMD,
      playerDamage
    ),
    DEFAULT_FLAGS,
    `Sending combat attack playback attacker=${session.runtimeId} target=${enemy.entityId} damage=${playerDamage} enemyHp=${enemy.hp}`
  );

  if (enemy.hp <= 0) {
    session.writePacket(
      buildEntityHidePacket(enemy.entityId >>> 0),
      DEFAULT_FLAGS,
      `Sending combat enemy hide entity=${enemy.entityId}`
    );
    session.log(`Combat enemy defeated entity=${enemy.entityId} remaining=${describeLivingEnemies(session.combatState.enemies)}`);
    if (findFirstLivingEnemy(session.combatState.enemies)) {
      session.combatState.pendingPostKillCounterattack = false;
      session.combatState.pendingActionResolution = { reason: 'post-kill' };
      session.combatState.phase = 'resolved';
      session.combatState.awaitingPlayerAction = false;
      session.combatState.awaitingClientReady = true;
      return;
    }
    session.combatState.pendingActionResolution = { reason: 'victory' };
    session.combatState.phase = 'resolved';
    session.combatState.awaitingPlayerAction = false;
    session.combatState.awaitingClientReady = true;
    return;
  }

  session.combatState.pendingActionResolution = { reason: 'normal' };
  session.combatState.phase = 'resolved';
  session.combatState.awaitingPlayerAction = false;
  session.combatState.awaitingClientReady = true;
}

// --- Item use ---

export async function resolveCombatItemUse(
  session: GameSession,
  instanceId: number,
  targetEntityId: number,
  sourceLabel: string,
  options: ResolveCombatItemUseOptions = {}
): Promise<void> {
  if (
    options.sharedTeamQueuedExecution !== true &&
    tryHandleSharedTeamItemSelection(session, instanceId >>> 0, targetEntityId >>> 0)
  ) {
    return;
  }

  if (!session.combatState?.active || !session.combatState.awaitingPlayerAction) {
    session.log(`Ignoring combat item use without command prompt active=${session.combatState?.active ? 1 : 0}`);
    return;
  }

  const bagItem = getBagItemByReference(session, instanceId);
  const definition = getItemDefinition(bagItem?.templateId || 0);
  if (definition?.captureProfile && bagItem) {
    await resolveCombatCaptureItemUse(session, bagItem, definition, targetEntityId, sourceLabel, options);
    return;
  }

  const useResult = await consumeUsableItemByInstanceId(session, instanceId, {
    targetEntityId,
    suppressVitalSync: true,
    suppressPersist: true,
  });
  if (!useResult.ok) {
    session.log(
      `Combat item use rejected source=${sourceLabel} instanceId=${instanceId} targetEntityId=${targetEntityId} reason=${useResult.reason}`
    );
    resendCombatCommandPrompt(session, 'item-use-rejected');
    return;
  }

  session.combatState.awaitingPlayerAction = false;
  session.combatState.phase = 'resolved';
  sendCombatItemPlayback(session, useResult.gained || {});
  sendSelfStateVitalsUpdate(session, {
    health: Math.max(0, session.currentHealth || 0),
    mana: Math.max(0, session.currentMana || 0),
    rage: Math.max(0, session.currentRage || 0),
  });
  session.log(
    `Combat item use ok source=${sourceLabel} instanceId=${instanceId} targetEntityId=${targetEntityId} templateId=${useResult.item?.templateId || 0} restored=${useResult.gained?.health || 0}/${useResult.gained?.mana || 0}/${useResult.gained?.rage || 0} hp/mp/rage=${session.currentHealth}/${session.currentMana}/${session.currentRage}`
  );
  if (options.deferSharedTeamPostResolution === true) {
    session.combatState.pendingActionResolution = null;
    session.combatState.awaitingClientReady = false;
    return;
  }
  session.combatState.pendingActionResolution = { reason: 'normal' };
  session.combatState.awaitingClientReady = true;
}

function sendCombatItemPlayback(
  session: GameSession,
  gained: { health?: number; mana?: number; rage?: number }
): void {
  const primaryAmount = Math.max(
    0,
    Number(gained?.health || 0),
    Number(gained?.mana || 0),
    Number(gained?.rage || 0)
  ) >>> 0;

  if (primaryAmount <= 0) {
    return;
  }

  session.writePacket(
    buildAttackPlaybackPacket(
      session.runtimeId >>> 0,
      session.runtimeId >>> 0,
      FIGHT_ACTIVE_STATE_SUBCMD,
      primaryAmount
    ),
    DEFAULT_FLAGS,
    `Sending combat item playback active=${session.runtimeId} restored=${primaryAmount}`
  );
}

export async function resolveCombatCaptureItemUse(
  session: GameSession,
  bagItem: Record<string, any>,
  definition: Record<string, any>,
  targetEntityId: number,
  sourceLabel: string,
  options: ResolveCombatItemUseOptions = {}
): Promise<void> {
  const profile = definition?.captureProfile || {};
  const targetEnemy = resolveCaptureTargetEnemy(session, targetEntityId);
  if (!targetEnemy) {
    session.log(
      `Combat capture rejected source=${sourceLabel} instanceId=${bagItem.instanceId} targetEntityId=${targetEntityId} reason=no-target`
    );
    if (typeof session.sendGameDialogue === 'function') {
      session.sendGameDialogue('Combat', `${definition?.name || 'Mob Flask'} could not find a target.`);
    }
    resendCombatCommandPrompt(session, 'capture-rejected-no-target');
    return;
  }

  if ((targetEnemy.level || 0) > (profile.maxTargetLevel || 0)) {
    session.log(
      `Combat capture rejected source=${sourceLabel} instanceId=${bagItem.instanceId} targetEntityId=${targetEnemy.entityId} reason=level-cap targetLevel=${targetEnemy.level} max=${profile.maxTargetLevel}`
    );
    if (typeof session.sendGameDialogue === 'function') {
      session.sendGameDialogue('Combat', `${targetEnemy.name || 'Target'} is too strong for ${definition?.name || 'this flask'}.`);
    }
    resendCombatCommandPrompt(session, 'capture-rejected-level');
    return;
  }

  if (profile.requiresDying === true && !isEnemyDying(targetEnemy)) {
    session.log(
      `Combat capture rejected source=${sourceLabel} instanceId=${bagItem.instanceId} targetEntityId=${targetEnemy.entityId} reason=not-dying hp=${targetEnemy.hp}/${targetEnemy.maxHp}`
    );
    if (typeof session.sendGameDialogue === 'function') {
      session.sendGameDialogue('Combat', `${targetEnemy.name || 'Target'} must be weakened before capture.`);
    }
    resendCombatCommandPrompt(session, 'capture-rejected-not-dying');
    return;
  }

  const petTemplateId = getCapturePetTemplateId(targetEnemy.typeId >>> 0);
  if (!petTemplateId) {
    session.log(
      `Combat capture rejected source=${sourceLabel} instanceId=${bagItem.instanceId} targetEntityId=${targetEnemy.entityId} reason=no-pet-template enemyType=${targetEnemy.typeId}`
    );
    if (typeof session.sendGameDialogue === 'function') {
      session.sendGameDialogue('Combat', `${targetEnemy.name || 'Target'} cannot be captured yet.`);
    }
    resendCombatCommandPrompt(session, 'capture-rejected-no-map');
    return;
  }

  const flaskAttributePairs = Array.isArray(bagItem.attributePairs) ? bagItem.attributePairs : [];
  const occupiedMonsterId = Number.isInteger(flaskAttributePairs[0]?.value)
    ? (flaskAttributePairs[0].value & 0xffff)
    : (bagItem.extraValue || 0);
  if ((bagItem.stateCode || 0) !== 0 || occupiedMonsterId !== 0) {
    session.log(
      `Combat capture rejected source=${sourceLabel} instanceId=${bagItem.instanceId} targetEntityId=${targetEnemy.entityId} reason=flask-not-empty state=${bagItem.stateCode || 0} extra=${bagItem.extraValue || 0} ext0=${occupiedMonsterId}`
    );
    if (typeof session.sendGameDialogue === 'function') {
      session.sendGameDialogue('Combat', `${definition?.name || 'Mob Flask'} is already occupied.`);
    }
    resendCombatCommandPrompt(session, 'capture-rejected-occupied');
    return;
  }

  const capturedMonsterLevel = Math.max(1, targetEnemy.level || 1) >>> 0;
  const capturedMonsterElementCode = rollCapturedMonsterElementCode() >>> 0;
  bagItem.stateCode = 1;
  bagItem.extraValue = targetEnemy.typeId >>> 0;
  bagItem.attributePairs = [
    { value: targetEnemy.typeId >>> 0 },
    { value: capturedMonsterLevel },
    { value: capturedMonsterElementCode },
  ];
  sendInventoryFullSync(session);

  targetEnemy.hp = 0;
  session.combatState.awaitingPlayerAction = false;
  session.combatState.phase = 'resolved';
  sendCombatEnemyHide(session, targetEnemy.entityId >>> 0, 'capture');
  session.log(
    `Combat capture ok source=${sourceLabel} instanceId=${bagItem.instanceId} targetEntityId=${targetEnemy.entityId} enemyType=${targetEnemy.typeId} enemyName=${targetEnemy.name || 'unknown'} petTemplateId=${petTemplateId} capturedLevel=${capturedMonsterLevel} capturedElement=${capturedMonsterElementCode} flaskState=${bagItem.stateCode || 0} flaskExtra=${bagItem.extraValue || 0} ext=${JSON.stringify(bagItem.attributePairs || [])}`
  );
  if (typeof session.sendGameDialogue === 'function') {
    session.sendGameDialogue('Combat', `Monster ${targetEnemy.name || 'Unknown'} was captured!`);
  }

  if (!findFirstLivingEnemy(session.combatState.enemies)) {
    await session.persistCurrentCharacter();
    session.combatState.pendingActionResolution = null;
    session.combatState.awaitingClientReady = false;
    if (options.deferSharedTeamPostResolution === true) {
      return;
    }
    await resolveVictory(session);
    return;
  }

  await session.persistCurrentCharacter();
  session.combatState.pendingActionResolution = null;
  session.combatState.awaitingClientReady = false;
  if (options.deferSharedTeamPostResolution === true) {
    return;
  }
  resolveEnemyCounterattack(session, 'normal');
}

// --- Enemy turns ---

export function resolveEnemyCounterattack(session: GameSession, reason: EnemyTurnReason): void {
  const enemies = listLivingEnemies(session.combatState.enemies);
  if (enemies.length === 0) {
    void resolveVictory(session);
    return;
  }
  if ((session.combatState?.playerStatus?.hasteRoundsRemaining || 0) > 0) {
    session.log(
      `Combat enemy turn skipped reason=haste roundsRemaining=${session.combatState.playerStatus?.hasteRoundsRemaining || 0}`
    );
    finishEnemyTurn(session, reason);
    return;
  }
  if ((session.combatState?.playerStatus?.concealRoundsRemaining || 0) > 0) {
    session.log(
      `Combat enemy turn skipped reason=conceal roundsRemaining=${session.combatState.playerStatus?.concealRoundsRemaining || 0}`
    );
    finishEnemyTurn(session, reason);
    return;
  }

  session.combatState.awaitingClientReady = false;
  session.combatState.pendingActionResolution = null;
  session.combatState.phase = 'enemy-turn';
  session.combatState.awaitingPlayerAction = false;
  session.combatState.enemyTurnReason = reason;
  session.combatState.pendingEnemyTurnQueue = enemies.map((enemy) => enemy.entityId >>> 0);
  processNextEnemyTurnAttack(session, reason);
}

export function processNextEnemyTurnAttack(session: GameSession, reason: EnemyTurnReason): void {
  if (session.combatState?.pendingCounterattack) {
    if (session.combatState.pendingCounterattack.played) {
      session.combatState.pendingCounterattack = null;
    } else {
      playPendingPlayerCounterattack(session);
      return;
    }
  }

  const queue = Array.isArray(session.combatState?.pendingEnemyTurnQueue)
    ? session.combatState.pendingEnemyTurnQueue
    : [];
  if (queue.length === 0) {
    finishEnemyTurn(session, reason);
    return;
  }

  const enemyEntityId = queue.shift()!;
  const enemy = findEnemyByEntityId(session.combatState.enemies, enemyEntityId);
  if (!enemy || enemy.hp <= 0) {
    processNextEnemyTurnAttack(session, reason);
    return;
  }
  const enemyStatus = session.combatState?.enemyStatuses?.[enemy.entityId >>> 0] || null;
  if ((enemyStatus?.actionDisabledRoundsRemaining || 0) > 0) {
    session.log(
      `Combat enemy action skipped entity=${enemy.entityId} reason=${enemyStatus?.actionDisabledReason || 'disabled'} roundsRemaining=${enemyStatus?.actionDisabledRoundsRemaining || 0}`
    );
    processNextEnemyTurnAttack(session, reason);
    return;
  }

  const enemyDamage = computeEnemyDamage(session, enemy);
  const defendedDamage = computeDefendedDamage(enemyDamage, session);
  const appliedEnemyDamage = Math.max(0, Math.min(session.currentHealth, defendedDamage));
  const nextHealth = Math.max(0, session.currentHealth - defendedDamage);
  const lethalHit = nextHealth <= 0;
  session.currentHealth = nextHealth;
  session.combatState.damageTaken = Math.max(0, (session.combatState.damageTaken || 0) + appliedEnemyDamage);
  session.writePacket(
    buildAttackPlaybackPacket(
      enemy.entityId >>> 0,
      session.runtimeId >>> 0,
      lethalHit ? FIGHT_ACTIVE_STATE_SUBCMD : FIGHT_CONTROL_RING_OPEN_SUBCMD,
      defendedDamage
    ),
    DEFAULT_FLAGS,
    `Sending combat enemy playback attacker=${enemy.entityId} target=${session.runtimeId} damage=${defendedDamage} raw=${enemyDamage} defended=${defendedDamage !== enemyDamage ? 1 : 0} playerHp=${session.currentHealth} remaining=${describeLivingEnemies(session.combatState.enemies)} reason=${reason}`
  );

  if (session.currentHealth <= 0) {
    resolveDefeat(session);
    return;
  }

  if (enemyDamage === 0) {
    queuePlayerCounterattack(session, enemy, reason);
  }
}

function queuePlayerCounterattack(session: GameSession, enemy: Record<string, any>, reason: EnemyTurnReason): void {
  const chancePercent = resolvePlayerCounterattackChance(session);
  const roll = Math.floor(Math.random() * 100);
  if (roll >= chancePercent) {
    session.log(
      `Combat counterattack skipped attacker=${enemy.entityId} chance=${chancePercent}% roll=${roll} reason=${reason}`
    );
    return;
  }

  session.combatState.pendingCounterattack = {
    enemyEntityId: enemy.entityId >>> 0,
    reason,
    played: false,
  };
  session.log(
    `Combat counterattack queued attacker=${session.runtimeId} target=${enemy.entityId} chance=${chancePercent}% roll=${roll} reason=${reason}`
  );
}

function playPendingPlayerCounterattack(session: GameSession): void {
  const pending = session.combatState?.pendingCounterattack;
  if (!pending) {
    return;
  }

  const enemy = findEnemyByEntityId(session.combatState.enemies, pending.enemyEntityId >>> 0);
  if (!enemy || enemy.hp <= 0) {
    session.combatState.pendingCounterattack = null;
    return;
  }

  const playerDamage = computePlayerDamage(session, enemy);
  const appliedPlayerDamage = Math.max(0, Math.min(enemy.hp, playerDamage));
  enemy.hp = Math.max(0, enemy.hp - playerDamage);
  session.combatState.damageDealt = Math.max(0, (session.combatState.damageDealt || 0) + appliedPlayerDamage);
  session.writePacket(
    buildAttackPlaybackPacket(
      session.runtimeId >>> 0,
      enemy.entityId >>> 0,
      enemy.hp === 0 ? FIGHT_ACTIVE_STATE_SUBCMD : FIGHT_CONTROL_RING_OPEN_SUBCMD,
      playerDamage
    ),
    DEFAULT_FLAGS,
    `Sending player counterattack playback attacker=${session.runtimeId} target=${enemy.entityId} damage=${playerDamage} enemyHp=${enemy.hp} reason=${pending.reason}`
  );
  session.combatState.pendingCounterattack = {
    ...pending,
    played: true,
  };

  if (enemy.hp <= 0) {
    sendCombatEnemyHide(session, enemy.entityId >>> 0, 'counterattack');
    session.log(`Combat enemy defeated by counterattack entity=${enemy.entityId} remaining=${describeLivingEnemies(session.combatState.enemies)}`);
    if (!findFirstLivingEnemy(session.combatState.enemies)) {
      session.combatState.pendingCounterattack = null;
      void resolveVictory(session);
    }
  }
}

export function finishEnemyTurn(session: GameSession, reason: EnemyTurnReason): void {
  session.combatState.pendingEnemyTurnQueue = [];
  session.combatState.enemyTurnReason = null;
  const livingBeforeTick = new Set(
    Array.isArray(session.combatState?.enemies)
      ? session.combatState.enemies
          .filter((enemy) => (enemy?.hp || 0) > 0)
          .map((enemy) => enemy.entityId >>> 0)
      : []
  );
  tickCombatStatuses(session);
  const defeatedByStatus = Array.isArray(session.combatState?.enemies)
    ? session.combatState.enemies.filter((enemy) => (enemy?.hp || 0) <= 0 && livingBeforeTick.has(enemy.entityId >>> 0))
    : [];
  for (const enemy of defeatedByStatus) {
    sendCombatEnemyHide(session, enemy.entityId >>> 0, 'status-tick');
  }
  if (defeatedByStatus.length > 0) {
    session.log(
      `Combat status tick resolved hidden=${defeatedByStatus.map((enemy) => enemy.entityId >>> 0).join(',')} remaining=${describeLivingEnemies(session.combatState.enemies)}`
    );
  }
  if (!findFirstLivingEnemy(session.combatState.enemies)) {
    void resolveVictory(session);
    return;
  }

  session.writePacket(
    buildVitalsPacket(FIGHT_CONTROL_RING_OPEN_SUBCMD, session.currentHealth, session.currentMana, session.currentRage),
    DEFAULT_FLAGS,
    `Sending combat vitals refresh hp=${session.currentHealth} mp=${session.currentMana} rage=${session.currentRage}`
  );
  transitionToCommandPhase(session, `enemy-counterattack-${reason} remaining=${describeLivingEnemies(session.combatState.enemies)}`);
}

// --- Victory / Defeat ---

export async function resolveVictory(session: GameSession): Promise<void> {
  if (isSharedTeamCombatOwner(session)) {
    const followers = getSharedTeamCombatFollowers(session);
    for (const follower of followers) {
      if (!follower.combatState?.active) {
        continue;
      }
      follower.combatState.enemies = cloneCombatEnemyRoster(session.combatState?.enemies);
      follower.combatState.round = session.combatState?.round || follower.combatState.round;
      await resolveVictory(follower);
    }
  }

  const defeatedEnemies = Array.isArray(session.combatState?.enemies)
    ? session.combatState.enemies.filter((enemy: Record<string, any>) => (enemy.maxHp || 0) > 0)
    : [];
  const questGrantedItems: Record<number, { templateId: number; quantity: number }> = {};
  for (const enemy of defeatedEnemies) {
    const questResult = await session.handleQuestMonsterDefeat(enemy.typeId, 1);
    for (const item of Array.isArray(questResult?.grantedItems) ? questResult.grantedItems : []) {
      const templateId = Number.isInteger(item?.templateId) ? (item.templateId >>> 0) : 0;
      const quantity = Math.max(1, Number.isInteger(item?.quantity) ? item.quantity : 1);
      if (templateId <= 0) {
        continue;
      }
      const existing = questGrantedItems[templateId] || { templateId, quantity: 0 };
      existing.quantity += quantity;
      questGrantedItems[templateId] = existing;
    }
  }
  const combatRewards = buildCombatVictoryRewards(
    defeatedEnemies,
    dropResultPreview(defeatedEnemies),
    Math.max(1, session.combatState?.round || 1),
    {
      playerStartHealth: session.combatState?.playerStartHealth || session.currentHealth,
      playerMaxHealthAtStart: session.combatState?.playerMaxHealthAtStart || session.maxHealth,
      totalEnemyMaxHp: session.combatState?.totalEnemyMaxHp || 0,
      averageEnemyLevel: session.combatState?.averageEnemyLevel || 0,
      damageDealt: session.combatState?.damageDealt || 0,
      damageTaken: session.combatState?.damageTaken || 0,
    },
    session.level
  );
  await applyEffects(
    session,
    [
      { kind: 'update-stat', stat: 'experience', delta: combatRewards.characterExperience },
      { kind: 'update-stat', stat: 'coins', delta: combatRewards.coins },
    ],
    {
      suppressDialogues: true,
      suppressPersist: true,
      suppressStatSync: true,
    }
  );
  const dropResult = await grantCombatDropsForEnemies(session, defeatedEnemies);
  if (dropResult.inventoryDirty) {
    await session.refreshQuestStateForItemTemplates(
      dropResult.granted.map((drop: Record<string, any>) => drop.templateId).filter(Number.isInteger)
    );
  }
  const combinedDrops = [...dropResult.granted];
  for (const item of Object.values(questGrantedItems)) {
    const existing = combinedDrops.find((drop: Record<string, any>) => Number.isInteger(drop?.templateId) && (drop.templateId >>> 0) === (item.templateId >>> 0));
    if (existing) {
      existing.quantity = Math.max(1, Number(existing.quantity) || 1) + item.quantity;
      continue;
    }
    combinedDrops.push({ templateId: item.templateId >>> 0, quantity: item.quantity });
  }

  const rankCode = deriveCombatResultRankCode(combatRewards.totalScore, combatRewards.maxScore);
  const visibleVictoryExperience =
    Math.max(1, Number(session.level) || 1) >= PROGRESSION.maxLevel ? 0 : combatRewards.characterExperience;

  session.writePacket(
    buildVictoryPointsPacket(combatRewards.totalScore),
    DEFAULT_FLAGS,
    `Sending combat victory points currentPoints=${combatRewards.totalScore}`
  );
  session.writePacket(
    buildVictoryRankPacket(rankCode),
    DEFAULT_FLAGS,
    `Sending combat victory rank rankCode=${rankCode} score=${combatRewards.totalScore}/${combatRewards.maxScore}`
  );
  session.writePacket(
    buildVictoryPacket(session.currentHealth, session.currentMana, session.currentRage, {
      characterExperience: visibleVictoryExperience,
      petExperience: 0,
      coins: combatRewards.coins,
      items: combinedDrops,
    }),
    DEFAULT_FLAGS,
    `Sending combat victory enemies=${defeatedEnemies.map((enemy: Record<string, any>) => `${enemy.typeId}@${enemy.entityId}`).join('|') || 'none'} exp=${visibleVictoryExperience} petExp=0 coins=${combatRewards.coins} score=${combatRewards.totalScore}/${combatRewards.maxScore} drops=${combinedDrops.length}`
  );
  const triggerId = typeof session.combatState?.triggerId === 'string' ? session.combatState.triggerId : '';
  const isCranePassGuardianVictory = triggerId.startsWith(CRANE_PASS_GUARDIAN_VICTORY_TRIGGER_PREFIX);
  const isSwanPassGuardianVictory = triggerId.startsWith(SWAN_PASS_GUARDIAN_VICTORY_TRIGGER_PREFIX);
  const isLionCaptainVictory = triggerId.startsWith(LION_CAPTAIN_VICTORY_TRIGGER_PREFIX);
  const shouldRepositionAfterVictory = isCranePassGuardianVictory || isSwanPassGuardianVictory || isLionCaptainVictory;
  const encounterAction = session.combatState?.encounterAction || null;
  session.log(`Combat victory trigger=${session.combatState.triggerId} enemies=${defeatedEnemies.map((enemy: Record<string, any>) => `${enemy.typeId}@${enemy.entityId}`).join('|') || 'none'} exp=${combatRewards.characterExperience} petExp=0 coins=${combatRewards.coins} score=${combatRewards.totalScore}/${combatRewards.maxScore} drops=${combinedDrops.map((drop: Record<string, any>) => `${drop.templateId}x${drop.quantity}`).join(',') || 'none'}`);
  await clearCombatState(session, dropResult.inventoryDirty, !shouldRepositionAfterVictory);
  handleActiveFieldEventVictory(session, encounterAction);
  if (
    !shouldRepositionAfterVictory ||
    (!isLionCaptainVictory && typeof session.sendEnterGameOk !== 'function') ||
    (isLionCaptainVictory && typeof session.sendSceneEnter !== 'function')
  ) {
    return;
  }

  if (isLionCaptainVictory) {
    session.log(
      `Sending Lion Captain victory scene-enter map=${LION_CAPTAIN_VICTORY_MAP_ID} pos=${LION_CAPTAIN_VICTORY_X},${LION_CAPTAIN_VICTORY_Y}`
    );
    session.sendSceneEnter(LION_CAPTAIN_VICTORY_MAP_ID, LION_CAPTAIN_VICTORY_X, LION_CAPTAIN_VICTORY_Y);
    return;
  }

  if (isSwanPassGuardianVictory) {
    const guardianApproachSide = typeof encounterAction?.guardianApproachSide === 'string'
      ? encounterAction.guardianApproachSide
      : 'swan-pass';
    const targetX = guardianApproachSide === 'za2' ? SWAN_PASS_GUARDIAN_RETURN_X : SWAN_PASS_GUARDIAN_VICTORY_X;
    const targetY = guardianApproachSide === 'za2' ? SWAN_PASS_GUARDIAN_RETURN_Y : SWAN_PASS_GUARDIAN_VICTORY_Y;
    session.currentMapId = SWAN_PASS_GUARDIAN_VICTORY_MAP_ID;
    session.currentX = targetX;
    session.currentY = targetY;
    session.log(
      `Sending Swan Pass Guardian victory reposition side=${guardianApproachSide} map=${SWAN_PASS_GUARDIAN_VICTORY_MAP_ID} pos=${targetX},${targetY}`
    );
    session.sendEnterGameOk({ syncMode: 'runtime' });
    await session.persistCurrentCharacter({
      mapId: SWAN_PASS_GUARDIAN_VICTORY_MAP_ID,
      x: targetX,
      y: targetY,
    });
    return;
  }

  const originMapId = Number.isInteger(encounterAction?.originMapId)
    ? ((encounterAction!.originMapId as number) >>> 0)
    : CRANE_PASS_GUARDIAN_VICTORY_MAP_ID;
  const originX = Number.isInteger(encounterAction?.originX)
    ? ((encounterAction!.originX as number) >>> 0)
    : session.currentX;
  const originY = Number.isInteger(encounterAction?.originY)
    ? ((encounterAction!.originY as number) >>> 0)
    : session.currentY;
  const guardianApproachSide = typeof encounterAction?.guardianApproachSide === 'string'
    ? encounterAction.guardianApproachSide
    : 'crane-pass';
  const targetMapId = CRANE_PASS_GUARDIAN_VICTORY_MAP_ID;
  const targetX = guardianApproachSide === 'za2' ? CRANE_PASS_GUARDIAN_RETURN_X : CRANE_PASS_GUARDIAN_VICTORY_X;
  const targetY = guardianApproachSide === 'za2' ? CRANE_PASS_GUARDIAN_RETURN_Y : CRANE_PASS_GUARDIAN_VICTORY_Y;

  session.currentMapId = targetMapId;
  session.currentX = targetX;
  session.currentY = targetY;
  session.log(
    `Sending Crane Pass Guardian victory reposition side=${guardianApproachSide} map=${targetMapId} pos=${targetX},${targetY}`
  );
  session.sendEnterGameOk({ syncMode: 'runtime' });
  await session.persistCurrentCharacter({
    mapId: targetMapId,
    x: targetX,
    y: targetY,
  });
}

export function buildCombatVictoryRewards(
  enemies: Record<string, any>[],
  preview: { dropCount: number },
  roundCount: number,
  performance: {
    playerStartHealth: number;
    playerMaxHealthAtStart: number;
    totalEnemyMaxHp: number;
    averageEnemyLevel: number;
    damageDealt: number;
    damageTaken: number;
  },
  playerLevel: number
): { characterExperience: number; coins: number; totalScore: number; maxScore: number } {
  const enemyCount = Math.max(1, enemies.length);
  const totals = enemies.reduce((acc, enemy) => {
    const level = Math.max(1, enemy?.level || 1);
    const aptitude = Math.max(0, enemy?.aptitude || 0);
    acc.characterExperience += (level * 12) + 18 + aptitude;
    acc.coins += Math.max(1, level * 3);
    return acc;
  }, { characterExperience: 0, coins: 0 });
  const characterExperience = Math.max(1, totals.characterExperience);
  const coins = Math.max(1, totals.coins);
  const normalizedRoundCount = Math.max(1, roundCount);
  const playerStartHealth = Math.max(1, performance.playerStartHealth || 1);
  const playerMaxHealthAtStart = Math.max(playerStartHealth, performance.playerMaxHealthAtStart || playerStartHealth);
  const totalEnemyMaxHp = Math.max(1, performance.totalEnemyMaxHp || enemies.reduce((sum, enemy) => sum + Math.max(0, enemy?.maxHp || 0), 0));
  const damageDealt = Math.max(0, performance.damageDealt || totalEnemyMaxHp);
  const damageTaken = Math.max(0, performance.damageTaken || 0);
  const currentHealth = Math.max(0, playerStartHealth - damageTaken);
  const hpLost = Math.max(0, playerStartHealth - currentHealth);
  const averageEnemyLevel = Math.max(1, performance.averageEnemyLevel || 1);
  const expectedRoundBudget = Math.max(1, Math.ceil(enemyCount / 2));
  const roundScore = 250 * Math.min(1, expectedRoundBudget / normalizedRoundCount);
  const exchangeScore = 200 * (damageDealt / Math.max(1, damageDealt + damageTaken));
  const damageTakenBudget = Math.max(1, playerMaxHealthAtStart * expectedRoundBudget);
  const damageTakenScore = 150 * Math.max(0, 1 - (damageTaken / damageTakenBudget));
  const hpPreservationScore = 200 * Math.max(0, 1 - (hpLost / playerStartHealth));
  const challengeScore = 200 * Math.min(1, averageEnemyLevel / Math.max(1, playerLevel || 1));
  const rewardScore = 50 * Math.min(1, Math.max(0, preview.dropCount) / Math.max(1, enemyCount));
  const maxScore = 1000;
  const totalScore = Math.max(
    1,
    Math.floor(
      roundScore +
      exchangeScore +
      damageTakenScore +
      hpPreservationScore +
      challengeScore +
      rewardScore
    )
  );
  return {
    characterExperience,
    coins,
    totalScore,
    maxScore,
  };
}

export function resolveDefeat(session: GameSession): void {
  const persisted = session.getPersistedCharacter();
  const state = buildDefeatRespawnState({
    persistedCharacter: persisted,
    currentMapId: session.currentMapId,
    currentX: session.currentX,
    currentY: session.currentY,
    player: { maxHp: session.maxHealth, mp: session.currentMana, rage: session.currentRage },
    currentMana: session.currentMana,
    currentRage: session.currentRage,
  });

  session.writePacket(
    buildDefeatPacket(1, state.vitals.mana, state.vitals.rage),
    DEFAULT_FLAGS,
    `Sending combat defeat respawnMap=${state.respawn.mapId} pos=${state.respawn.x},${state.respawn.y}`
  );

  void clearCombatState(session, false, false);
  session.defeatRespawnPending = true;
  session.combatDefeatTimer = setTimeout(() => {
    session.combatDefeatTimer = null;
    if (session.socket.destroyed) {
      return;
    }
    session.currentHealth = state.vitals.health;
    session.currentMana = state.vitals.mana;
    session.currentRage = state.vitals.rage;
    session.defeatRespawnPending = false;
    session.currentMapId = state.respawn.mapId;
    session.currentX = state.respawn.x;
    session.currentY = state.respawn.y;
    session.sendEnterGameOk({ syncMode: 'runtime' });
    void session.persistCurrentCharacter({
      currentHealth: state.vitals.health,
      currentMana: state.vitals.mana,
      currentRage: state.vitals.rage,
      mapId: state.respawn.mapId,
      x: state.respawn.x,
      y: state.respawn.y,
    });
  }, 900);
}

export async function grantCombatDropsForEnemies(session: GameSession, enemies: Record<string, any>[]): Promise<Record<string, any>> {
  const acc: { granted: Record<string, any>[]; inventoryDirty: boolean } = { granted: [], inventoryDirty: false };
  for (const enemy of enemies) {
    const next = await grantCombatDrops(session, enemy);
    acc.granted.push(...(next.granted || []));
    acc.inventoryDirty = acc.inventoryDirty || !!next.inventoryDirty;
  }
  return acc;
}

export async function clearCombatState(
  session: GameSession,
  persist = false,
  sendClientCleanup = true
): Promise<void> {
  disposeCombatTimers(session);
  const cleanupTargets: Array<{ session: GameSession; reason: string }> = [];
  if (sendClientCleanup) {
    cleanupTargets.push({ session, reason: 'combat-clear' });
  }
  const sharedCombatOwner = getSharedTeamCombatOwnerSession(session);
  if (isSharedTeamCombatOwner(session)) {
    for (const follower of getSharedTeamCombatFollowers(session)) {
      disposeCombatTimers(follower);
      if (sendClientCleanup) {
        cleanupTargets.push({ session: follower, reason: 'combat-clear:shared' });
      }
      follower.combatState = createIdleCombatState();
    }
  } else if (sharedCombatOwner) {
    removeSharedTeamCombatParticipant(session);
  }
  session.combatState = createIdleCombatState();
  if (isSharedTeamCombatOwner(session) || !sharedCombatOwner) {
    endSharedTeamCombat(session);
  }
  for (const cleanupTarget of cleanupTargets) {
    sendCombatExitClientCleanup(cleanupTarget.session, cleanupTarget.reason);
  }
  if (persist) {
    await session.persistCurrentCharacter();
  }
}

export function disposeCombatTimers(session: GameSession): void {
  if (session.combatDefeatTimer) {
    clearTimeout(session.combatDefeatTimer);
    session.combatDefeatTimer = null;
  }
  if (session.combatSkillResolutionTimer) {
    clearTimeout(session.combatSkillResolutionTimer);
    session.combatSkillResolutionTimer = null;
  }
}

// --- Skill resolution finalization ---

export function finalizeSkillResolutionAndEnemyTurn(session: GameSession, source: string): void {
  if (!session.combatState?.active) {
    return;
  }
  const pendingOutcomes = Array.isArray(session.combatState.pendingSkillOutcomes)
    ? session.combatState.pendingSkillOutcomes
    : [];
  const pendingSkillContext = session.combatState.pendingSkillContext || null;
  session.combatState.pendingSkillOutcomes = null;
  session.combatState.pendingSkillContext = null;
  session.combatState.awaitingSkillResolution = false;
  const startedAt = session.combatState.skillResolutionStartedAt || 0;
  const elapsed = startedAt > 0 ? Math.max(0, Date.now() - startedAt) : 0;
  session.combatState.skillResolutionStartedAt = 0;
  session.combatState.skillResolutionReason = null;
  session.combatState.skillResolutionPhase = null;
  if (session.combatSkillResolutionTimer) {
    clearTimeout(session.combatSkillResolutionTimer);
    session.combatSkillResolutionTimer = null;
  }
  sendSelfStateVitalsUpdate(session, {
    health: Math.max(0, session.currentHealth || 0),
    mana: Math.max(0, session.currentMana || 0),
    rage: Math.max(0, session.currentRage || 0),
  });
  session.log(
    `Skill resolution complete source=${source} elapsedMs=${elapsed} pendingSkillCount=${pendingOutcomes.length}`
  );

  if (SKILL_PACKET_HYBRID_IMPACT_ENABLED) {
    for (const pendingOutcome of pendingOutcomes) {
      if (!pendingOutcome?.targetEntityId || !pendingOutcome?.playerDamage) {
        continue;
      }
      const resultCode = pendingOutcome.targetDied ? 3 : 1;
      const impactPacket = buildAttackPlaybackPacket(
        session.runtimeId >>> 0,
        pendingOutcome.targetEntityId >>> 0,
        resultCode,
        Math.max(1, pendingOutcome.playerDamage || 1)
      );
      appendSkillPacketTrace({
        kind: 'skill-impact-outbound',
        ts: new Date().toISOString(),
        sessionId: session.id,
        source,
        attackerEntityId: session.runtimeId >>> 0,
        targetEntityId: pendingOutcome.targetEntityId >>> 0,
        resultCode,
        damage: Math.max(1, pendingOutcome.playerDamage || 1),
        packetHex: impactPacket.toString('hex'),
      });
      session.writePacket(
        impactPacket,
        DEFAULT_FLAGS,
        `Sending hybrid combat skill impact attacker=${session.runtimeId} target=${pendingOutcome.targetEntityId} result=${resultCode} damage=${Math.max(1, pendingOutcome.playerDamage || 1)} source=${source}`
      );
    }
  }

  let killedAny = false;
  const killedEntities: number[] = [];
  for (const pendingOutcome of pendingOutcomes) {
    if (!pendingOutcome?.targetDied) {
      continue;
    }
    const targetEnemy = findEnemyByEntityId(session.combatState.enemies, pendingOutcome.targetEntityId >>> 0);
    if (!targetEnemy) {
      continue;
    }
    killedAny = true;
    killedEntities.push(targetEnemy.entityId >>> 0);
    sendCombatEnemyHide(session, targetEnemy.entityId >>> 0, 'skill');
  }
  if (killedEntities.length > 0) {
    session.log(
      `Combat skill kill-resolution source=${source} hidden=${killedEntities.join(',')} rosterAfter=${describeEnemyRoster(session.combatState?.enemies)}`
    );
  }

  if (pendingSkillContext?.deferSharedTeamPostResolution === true) {
    session.log(`Skill resolution complete source=${source} mode=shared-team-deferred`);
    const owner = getSharedTeamCombatOwnerSession(session);
    if (owner) {
      owner.combatState.enemies = cloneCombatEnemyRoster(session.combatState?.enemies);
      owner.combatState.enemyStatuses = cloneCombatEnemyStatuses(session.combatState?.enemyStatuses);
      syncSharedCombatEnemyRoster(owner);
      if (!findFirstLivingEnemy(owner.combatState.enemies)) {
        void resolveVictory(owner);
        return;
      }
      continueSharedCombatRound(owner, `skill-resolution-complete:S${session.id}`);
      return;
    }
  }

  if (!findFirstLivingEnemy(session.combatState.enemies)) {
    void resolveVictory(session);
    return;
  }

  if (pendingSkillContext?.allowEnemyCounterattack === false) {
    transitionToCommandPhase(session, `skill-complete-no-counterattack source=${source}`);
    return;
  }

  resolveEnemyCounterattack(session, killedAny ? 'post-kill' : 'normal');
}

export function advanceSkillResolutionEvent(session: GameSession, source: string): void {
  if (!session.combatState?.active || !session.combatState.awaitingSkillResolution) {
    return;
  }
  const pendingOutcomes = Array.isArray(session.combatState.pendingSkillOutcomes)
    ? session.combatState.pendingSkillOutcomes
    : [];
  const phase = session.combatState.skillResolutionPhase || 'await-cast-ready';
  if (
    session.combatState.skillResolutionReason === 'skill-post-resolution-delayed-cast' &&
    phase === 'await-cast-ready' &&
    pendingOutcomes.length > 0
  ) {
    sendSelfStateVitalsUpdate(session, {
      health: Math.max(0, session.currentHealth || 0),
      mana: Math.max(0, session.currentMana || 0),
      rage: Math.max(0, session.currentRage || 0),
    });
    session.combatState.skillResolutionPhase = 'await-impact-ready';
    session.combatState.skillResolutionReason = 'skill-impact-playback';
    if (session.combatSkillResolutionTimer) {
      clearTimeout(session.combatSkillResolutionTimer);
      session.combatSkillResolutionTimer = null;
    }
    session.combatSkillResolutionTimer = setTimeout(() => {
      session.combatSkillResolutionTimer = null;
      if (!session.combatState?.active || !session.combatState.awaitingSkillResolution) {
        return;
      }
      if (session.combatState.skillResolutionPhase !== 'await-impact-ready') {
        return;
      }
      session.log(
        `Delayed skill completion timeout reached; finalizing skill resolution timeoutMs=${DELAYED_SKILL_COMPLETION_TIMEOUT_MS}`
      );
      finalizeSkillResolutionAndEnemyTurn(session, 'delayed-skill-timeout');
    }, DELAYED_SKILL_COMPLETION_TIMEOUT_MS);
    session.log(
      `Skill resolution advanced source=${source} phase=await-impact-ready mode=delayed-cast pendingSkillCount=${pendingOutcomes.length} timeoutMs=${DELAYED_SKILL_COMPLETION_TIMEOUT_MS}`
    );
    return;
  }
  finalizeSkillResolutionAndEnemyTurn(session, source);
}
