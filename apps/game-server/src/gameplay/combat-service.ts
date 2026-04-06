import type { CombatEnemyInstance, GameSession, SessionPorts } from '../types.js';
import { COMBAT_ENABLED, DEFAULT_FLAGS, GAME_FIGHT_STREAM_CMD } from '../config.js';
import {
  buildAllyPlayerEntry,
  buildPlayerEntry,
  describeEncounterEnemies,
  resolveCombatPartyOrder,
  resolveSharedPartySlots,
} from '../combat/combat-formulas.js';
import { buildEncounterEnemies, cloneEncounterEnemies } from '../combat/encounter-builder.js';
import { buildEncounterPacket } from '../combat/packets.js';
import { sendIntroSequence } from './combat-resolution.js';

type CombatAction = Record<string, any>;
type SendCombatEncounterOptions = {
  enemies?: CombatEnemyInstance[] | null;
  allies?: GameSession[] | null;
};

export function sendCombatEncounterProbe(
  session: GameSession,
  action: CombatAction,
  options: SendCombatEncounterOptions = {}
): void {
  if (!COMBAT_ENABLED) {
    session.log(`Ignoring encounter trigger while combat is disabled trigger=${action?.probeId || 'unknown'}`);
    return;
  }
  if (session.combatState?.active) {
    session.log(`Ignoring encounter trigger while combat is already active trigger=${session.combatState.triggerId}`);
    return;
  }

  const enemies = Array.isArray(options.enemies) && options.enemies.length > 0
    ? cloneEncounterEnemies(options.enemies as CombatEnemyInstance[])
    : buildEncounterEnemies(action, session.currentMapId) as CombatEnemyInstance[];
  if (enemies.length === 0) {
    session.log(`Skipping encounter probe with empty pool trigger=${action?.probeId || 'unknown'}`);
    return;
  }
  const partyOrder = resolveCombatPartyOrder(session, options.allies || []);
  const partySlots = resolveSharedPartySlots(partyOrder.length);
  const playerPartyIndex = Math.max(0, partyOrder.findIndex((member) => (member.id >>> 0) === (session.id >>> 0)));
  const player = buildPlayerEntry(session, partySlots[playerPartyIndex] || { row: 1, col: 2 });
  const allies = partyOrder
    .filter((member) => (member.id >>> 0) !== (session.id >>> 0))
    .map((ally) => {
      const allyPartyIndex = Math.max(0, partyOrder.findIndex((member) => (member.id >>> 0) === (ally.id >>> 0)));
      return buildAllyPlayerEntry(ally, partySlots[allyPartyIndex] || { row: 1, col: 2 });
    });

  session.combatState = {
    active: true,
    phase: 'intro',
    round: 0,
    triggerId: action.probeId || 'field-combat',
    encounterAction: action,
    enemies,
    awaitingClientReady: true,
    awaitingPlayerAction: false,
    startedAt: Date.now(),
    playerStartHealth: session.currentHealth,
    playerMaxHealthAtStart: session.maxHealth,
    totalEnemyMaxHp: enemies.reduce((sum: number, enemy: CombatEnemyInstance) => sum + Math.max(0, enemy?.maxHp || 0), 0),
    averageEnemyLevel:
      enemies.length > 0
        ? enemies.reduce((sum: number, enemy: CombatEnemyInstance) => sum + Math.max(1, enemy?.level || 1), 0) / enemies.length
        : 0,
    damageDealt: 0,
    damageTaken: 0,
    awaitingSkillResolution: false,
    skillResolutionStartedAt: 0,
    skillResolutionReason: null,
    skillResolutionPhase: null,
    pendingSkillOutcomes: null,
    pendingSkillContext: null,
    pendingEnemyTurnQueue: [],
    pendingPostKillCounterattack: false,
    enemyTurnReason: null,
    pendingActionResolution: null,
    selectorToken: null,
    selectorTokenSource: null,
    playerStatus: {},
    enemyStatuses: {},
  };

  session.writePacket(
    buildEncounterPacket(player, enemies, allies),
    DEFAULT_FLAGS,
    `Sending combat encounter cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x65 trigger=${session.combatState.triggerId} allies=${allies.map((ally) => `${Number(ally.entityId) >>> 0}@${Number(ally.row) & 0xff},${Number(ally.col) & 0xff}`).join('|') || 'none'} enemies=${describeEncounterEnemies(enemies)}`
  );
  sendIntroSequence(session);
}

export function startCombatEncounter(session: SessionPorts, action: Record<string, unknown>): void {
  sendCombatEncounterProbe(session as unknown as GameSession, action);
}
