import type { GameSession } from '../types';

const {
  DEFAULT_FLAGS,
  FIGHT_ACTIVE_STATE_SUBCMD,
  FIGHT_CLIENT_ATTACK_SELECTION_SUBCMD,
  FIGHT_CLIENT_READY_SUBCMD,
  FIGHT_CONTROL_RING_OPEN_SUBCMD,
  GAME_FIGHT_ACTION_CMD,
  GAME_FIGHT_CLIENT_CMD,
  GAME_FIGHT_MISC_CMD,
  GAME_FIGHT_RESULT_CMD,
  GAME_FIGHT_STATE_CMD,
  GAME_FIGHT_STREAM_CMD,
  GAME_FIGHT_TURN_CMD,
} = require('../config');
const { parseAttackSelection } = require('../protocol/inbound-packets');
const { buildEncounterEnemy } = require('../combat/encounter-builder');
const {
  buildActiveStatePacket,
  buildAttackPlaybackPacket,
  buildControlInitPacket,
  buildControlShowPacket,
  buildDefeatPacket,
  buildEncounterPacket,
  buildEntityHidePacket,
  buildRingOpenPacket,
  buildStateModePacket,
  buildTurnPromptPacket,
  buildVictoryPacket,
  buildVitalsPacket,
} = require('../combat/packets');
const { grantCombatDrops } = require('../gameplay/combat-drop-runtime');
const { applyEffects } = require('../effects/effect-executor');
const { buildDefeatRespawnState } = require('../gameplay/session-flows');
const { resolveTownRespawn } = require('../scene-runtime');

type SessionLike = GameSession & Record<string, any>;
type CombatAction = Record<string, any>;

function createIdleCombatState(): Record<string, any> {
  return {
    active: false,
    phase: 'idle',
    triggerId: null,
    encounterAction: null,
    enemy: null,
    awaitingClientReady: false,
    awaitingPlayerAction: false,
    startedAt: 0,
  };
}

function handleCombatPacket(session: SessionLike, cmdWord: number, payload: Buffer): void {
  if (!session.combatState?.active) {
    session.log(`Ignoring combat packet with no active combat cmd=0x${cmdWord.toString(16)}`);
    return;
  }

  if (
    cmdWord === GAME_FIGHT_ACTION_CMD &&
    payload.length >= 3 &&
    payload[2] === FIGHT_CLIENT_READY_SUBCMD &&
    session.combatState.awaitingClientReady
  ) {
    session.log(`Combat client ready trigger=${session.combatState.triggerId}`);
    session.combatState.awaitingClientReady = false;
    session.combatState.awaitingPlayerAction = true;
    session.combatState.phase = 'command';
    sendCommandPrompt(session, 'client-ready');
    return;
  }

  if (
    cmdWord === GAME_FIGHT_ACTION_CMD &&
    payload.length >= 6 &&
    payload[2] === FIGHT_CLIENT_ATTACK_SELECTION_SUBCMD
  ) {
    handleAttackSelection(session, payload);
    return;
  }

  if (
    cmdWord === GAME_FIGHT_CLIENT_CMD ||
    cmdWord === GAME_FIGHT_STATE_CMD ||
    cmdWord === GAME_FIGHT_RESULT_CMD ||
    cmdWord === GAME_FIGHT_TURN_CMD ||
    cmdWord === GAME_FIGHT_STREAM_CMD ||
    cmdWord === GAME_FIGHT_MISC_CMD
  ) {
    session.log(`Observed combat packet cmd=0x${cmdWord.toString(16)} sub=0x${(payload[2] || 0).toString(16)} len=${payload.length}`);
  }
}

function sendCombatEncounterProbe(session: SessionLike, action: CombatAction): void {
  if (session.combatState?.active) {
    session.log(`Ignoring encounter trigger while combat is already active trigger=${session.combatState.triggerId}`);
    return;
  }

  const enemy = buildEncounterEnemy(action, session.currentMapId);
  const player = buildPlayerEntry(session);

  session.combatState = {
    active: true,
    phase: 'intro',
    triggerId: action.probeId || 'field-combat',
    encounterAction: action,
    enemy,
    awaitingClientReady: true,
    awaitingPlayerAction: false,
    startedAt: Date.now(),
  };

  session.writePacket(
    buildEncounterPacket(player, enemy),
    DEFAULT_FLAGS,
    `Sending combat encounter cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x65 trigger=${session.combatState.triggerId} enemy=${enemy.typeId}@${enemy.entityId} hp=${enemy.hp} level=${enemy.level}`
  );
  sendIntroSequence(session);
}

function sendCombatExitProbe(session: SessionLike, action: CombatAction): void {
  if (!session.combatState?.active) {
    return;
  }
  session.log(`Combat exit probe trigger=${action?.probeId || 'unknown'} current=${session.combatState.triggerId}`);
  clearCombatState(session, false);
}

function disposeCombatTimers(session: SessionLike): void {
  if (session.combatDefeatTimer) {
    clearTimeout(session.combatDefeatTimer);
    session.combatDefeatTimer = null;
  }
}

function sendIntroSequence(session: SessionLike): void {
  const entityId = session.entityType >>> 0;
  session.writePacket(buildRingOpenPacket(), DEFAULT_FLAGS, `Sending combat ring-open trigger=${session.combatState.triggerId}`);
  session.writePacket(buildStateModePacket(), DEFAULT_FLAGS, `Sending combat mode trigger=${session.combatState.triggerId}`);
  session.writePacket(buildControlInitPacket(), DEFAULT_FLAGS, `Sending combat control init trigger=${session.combatState.triggerId}`);
  session.writePacket(buildActiveStatePacket(entityId), DEFAULT_FLAGS, `Sending combat active state trigger=${session.combatState.triggerId} active=${entityId}`);
  session.writePacket(buildEntityHidePacket(entityId), DEFAULT_FLAGS, `Sending combat entity hide trigger=${session.combatState.triggerId} active=${entityId}`);
  session.writePacket(buildControlShowPacket(entityId), DEFAULT_FLAGS, `Sending combat control show trigger=${session.combatState.triggerId} active=${entityId}`);
}

function sendCommandPrompt(session: SessionLike, reason: string): void {
  const entityId = session.entityType >>> 0;
  session.writePacket(buildRingOpenPacket(), DEFAULT_FLAGS, `Sending combat ring-open refresh reason=${reason}`);
  session.writePacket(buildControlShowPacket(entityId), DEFAULT_FLAGS, `Sending combat control refresh reason=${reason} active=${entityId}`);
  session.writePacket(buildTurnPromptPacket(), DEFAULT_FLAGS, `Sending combat turn prompt reason=${reason}`);
}

function handleAttackSelection(session: SessionLike, payload: Buffer): void {
  if (!session.combatState?.active || !session.combatState.awaitingPlayerAction) {
    session.log(`Ignoring attack selection without command prompt active=${session.combatState?.active ? 1 : 0}`);
    return;
  }

  const selection = parseAttackSelection(payload);
  const enemy = session.combatState.enemy;
  if (!enemy || enemy.hp <= 0) {
    session.log('Ignoring attack selection because combat enemy is missing');
    return;
  }

  session.combatState.awaitingPlayerAction = false;
  session.combatState.phase = 'resolved';
  session.log(`Combat attack selected mode=${selection.attackMode} target=${selection.targetA},${selection.targetB} enemy=${enemy.typeId}@${enemy.entityId}`);

  const playerDamage = computePlayerDamage(session, enemy);
  enemy.hp = Math.max(0, enemy.hp - playerDamage);
  session.writePacket(
    buildAttackPlaybackPacket(session.entityType >>> 0, enemy.entityId >>> 0, FIGHT_CONTROL_RING_OPEN_SUBCMD, playerDamage),
    DEFAULT_FLAGS,
    `Sending combat attack playback attacker=${session.entityType} target=${enemy.entityId} damage=${playerDamage} enemyHp=${enemy.hp}`
  );

  if (enemy.hp <= 0) {
    session.writePacket(
      buildEntityHidePacket(enemy.entityId >>> 0),
      DEFAULT_FLAGS,
      `Sending combat enemy hide entity=${enemy.entityId}`
    );
    resolveVictory(session);
    return;
  }

  const enemyDamage = computeEnemyDamage(session, enemy);
  session.currentHealth = Math.max(0, session.currentHealth - enemyDamage);
  session.writePacket(
    buildAttackPlaybackPacket(enemy.entityId >>> 0, session.entityType >>> 0, FIGHT_ACTIVE_STATE_SUBCMD, enemyDamage),
    DEFAULT_FLAGS,
    `Sending combat counterattack playback attacker=${enemy.entityId} target=${session.entityType} damage=${enemyDamage} playerHp=${session.currentHealth}`
  );

  if (session.currentHealth <= 0) {
    resolveDefeat(session);
    return;
  }

  session.writePacket(
    buildVitalsPacket(FIGHT_CONTROL_RING_OPEN_SUBCMD, session.currentHealth, session.currentMana, session.currentRage),
    DEFAULT_FLAGS,
    `Sending combat vitals refresh hp=${session.currentHealth} mp=${session.currentMana} rage=${session.currentRage}`
  );
  session.combatState.phase = 'command';
  session.combatState.awaitingPlayerAction = true;
  sendCommandPrompt(session, 'enemy-counterattack');
}

function resolveVictory(session: SessionLike): void {
  const enemy = session.combatState?.enemy;
  if (enemy) {
    session.handleQuestMonsterDefeat(enemy.typeId, 1);
  }
  const combatRewards = buildCombatVictoryRewards(enemy);
  applyEffects(
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
  const dropResult = grantCombatDrops(session, enemy);
  if (dropResult.inventoryDirty) {
    session.refreshQuestStateForItemTemplates(
      dropResult.granted.map((drop: Record<string, any>) => drop.templateId).filter(Number.isInteger)
    );
  }

  session.writePacket(
    buildVictoryPacket(session.currentHealth, session.currentMana, session.currentRage, {
      characterExperience: combatRewards.characterExperience,
      petExperience: 0,
      coins: combatRewards.coins,
      items: dropResult.granted,
    }),
    DEFAULT_FLAGS,
    `Sending combat victory enemy=${enemy?.typeId || 0} exp=${combatRewards.characterExperience} petExp=0 coins=${combatRewards.coins} drops=${dropResult.granted.length}`
  );
  session.log(`Combat victory trigger=${session.combatState.triggerId} enemy=${enemy?.typeId || 0} exp=${combatRewards.characterExperience} petExp=0 coins=${combatRewards.coins} drops=${dropResult.granted.map((drop: Record<string, any>) => `${drop.templateId}x${drop.quantity}`).join(',') || 'none'}`);
  clearCombatState(session, dropResult.inventoryDirty);
}

function buildCombatVictoryRewards(enemy: Record<string, any> | null | undefined): { characterExperience: number; coins: number } {
  const level = Math.max(1, enemy?.level || 1);
  const aptitude = Math.max(0, enemy?.aptitude || 0);
  const characterExperience = (level * 12) + 18 + aptitude;
  return {
    characterExperience,
    coins: Math.max(1, level * 3),
  };
}

function resolveDefeat(session: SessionLike): void {
  const persisted = session.getPersistedCharacter();
  const state = buildDefeatRespawnState({
    persistedCharacter: persisted,
    currentMapId: session.currentMapId,
    currentX: session.currentX,
    currentY: session.currentY,
    player: { maxHp: session.maxHealth, mp: session.currentMana, rage: session.currentRage },
    currentMana: session.currentMana,
    currentRage: session.currentRage,
    resolveTownRespawn,
  });

  session.writePacket(
    buildDefeatPacket(1, state.vitals.mana, state.vitals.rage),
    DEFAULT_FLAGS,
    `Sending combat defeat respawnMap=${state.respawn.mapId} pos=${state.respawn.x},${state.respawn.y}`
  );

  clearCombatState(session, false);
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
    session.transitionToScene(state.respawn.mapId, state.respawn.x, state.respawn.y, 'combat-defeat-respawn');
    session.persistCurrentCharacter({
      currentHealth: state.vitals.health,
      currentMana: state.vitals.mana,
      currentRage: state.vitals.rage,
      mapId: state.respawn.mapId,
      x: state.respawn.x,
      y: state.respawn.y,
      lastTownMapId: state.respawn.mapId,
      lastTownX: state.respawn.x,
      lastTownY: state.respawn.y,
    });
  }, 900);
}

function clearCombatState(session: SessionLike, persist = false): void {
  session.currentEncounterTriggerId = null;
  session.combatState = createIdleCombatState();
  if (persist) {
    session.persistCurrentCharacter();
  }
}

function buildPlayerEntry(session: SessionLike): Record<string, any> {
  return {
    side: 0xff,
    entityId: session.entityType >>> 0,
    typeId: (session.roleEntityType || session.entityType) & 0xffff,
    row: 1,
    col: 2,
    hp: Math.max(1, session.currentHealth || 1),
    mp: Math.max(0, session.currentMana || 0),
    aptitude: 0,
    level: Math.max(1, session.level || 1),
    appearanceTypes: [0, 0, 0],
    appearanceVariants: [0, 0, 0],
    name: session.charName || 'Hero',
  };
}

function computePlayerDamage(session: SessionLike, enemy: Record<string, any>): number {
  const stats = session.primaryAttributes || {};
  const base = 8 + ((stats.strength || 0) * 2) + (session.level || 1);
  const spread = 6 + (stats.dexterity || 0);
  const mitigation = Math.floor(((enemy.level || 1) * 2) + (enemy.aptitude || 0));
  return Math.max(1, base + Math.floor(Math.random() * Math.max(1, spread)) - mitigation);
}

function computeEnemyDamage(session: SessionLike, enemy: Record<string, any>): number {
  const stats = session.primaryAttributes || {};
  const defense = Math.floor(((stats.vitality || 0) * 0.8) + ((stats.dexterity || 0) * 0.4) + (session.level || 1));
  const base = 6 + ((enemy.level || 1) * 3) + (enemy.aptitude || 0);
  return Math.max(1, base + Math.floor(Math.random() * 5) - defense);
}

module.exports = {
  createIdleCombatState,
  disposeCombatTimers,
  handleCombatPacket,
  sendCombatEncounterProbe,
  sendCombatExitProbe,
};
