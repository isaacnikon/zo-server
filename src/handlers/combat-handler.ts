import type { GameSession } from '../types';

const {
  FIGHT_ACTIVE_STATE_SUBCMD,
  FIGHT_CLIENT_ATTACK_SELECTION_SUBCMD,
  FIGHT_CLIENT_READY_SUBCMD,
  FIGHT_CONTROL_INIT_SUBCMD,
  FIGHT_CONTROL_RING_OPEN_SUBCMD,
  FIGHT_CONTROL_SHOW_SUBCMD,
  FIGHT_ENCOUNTER_PROBE_SUBCMD,
  FIGHT_ENTITY_FLAG_HIDE_SUBCMD,
  FIGHT_RESULT_DEFEAT_SUBCMD,
  FIGHT_RESULT_VICTORY_SUBCMD,
  FIGHT_STATE_MODE_SUBCMD,
  GAME_FIGHT_ACTION_CMD,
  GAME_FIGHT_CLIENT_CMD,
  GAME_FIGHT_MISC_CMD,
  GAME_FIGHT_RESULT_CMD,
  GAME_FIGHT_STATE_CMD,
  GAME_FIGHT_STREAM_CMD,
  GAME_FIGHT_TURN_CMD,
  DEFAULT_FLAGS,
} = require('../config');
const {
  createCombatState,
  describeCombatCommand,
  parseCombatPacket,
  recordInboundCombatPacket,
} = require('../combat-runtime');
const { parseAttackSelection } = require('../protocol/inbound-packets');
const { rollSyntheticFightDrops } = require('../gameplay/combat-drop-runtime');
const { buildDefeatRespawnState, resolveCurrentPlayerVitals } = require('../gameplay/session-flows');
const { dispatchAttackResult, dispatchTurnResult } = require('../combat/combat-dispatch');
const {
  computeSyntheticDamage,
  createSyntheticFightState,
  findSyntheticEnemyTarget,
  getSyntheticPlayerFighter,
  hasLivingSyntheticAllies,
  initializeSyntheticEnemyTurnQueue,
  selectSyntheticEnemyAttacker,
} = require('../combat/synthetic-fight');
const {
  finalizeSyntheticFightState,
  resolvePlayerAttackSelection,
  resolveQueuedEnemyTurn,
} = require('../combat/synthetic-fight-flow');
const {
  buildCombatEncounterProbePacket,
  buildCombatTurnProbePacket,
  buildFightActiveStateProbePacket,
  buildFightControlInitProbePacket,
  buildFightControlShowProbePacket,
  buildFightEntityFlagProbePacket,
  buildFightRingOpenProbePacket,
  buildFightStateModeProbe64Packet,
} = require('../combat/synthetic-fight-packets');
const {
  buildSyntheticAttackMirrorUpdatePacket,
  buildSyntheticAttackPlaybackPacket,
  buildSyntheticFightVictoryClosePacket,
} = require('../protocol/gameplay-packets');
const { buildSyntheticEncounterEnemies } = require('../combat/encounter-builder');
const { selectCombatTurnProbeProfile } = require('../combat/combat-probe');
const { resolveTownRespawn } = require('../scene-runtime');

type SessionLike = GameSession & Record<string, any>;
type CombatAction = Record<string, any>;
type CombatPacket = Record<string, any>;
type RecordedCombatState = { state: unknown; snapshot: { inFight: boolean; stateChanged: boolean } };

function pushCombatTrace(
  session: SessionLike,
  direction: 'inbound' | 'outbound',
  packet: CombatPacket,
  recorded: RecordedCombatState
): void {
  if (!Array.isArray(session.sharedState.combatTrace)) {
    return;
  }

  session.sharedState.combatTrace.push({
    sessionId: session.id,
    timestamp: Date.now(),
    direction,
    inFight: recorded.snapshot.inFight,
    stateChanged: recorded.snapshot.stateChanged,
    ...packet,
  });
  if (session.sharedState.combatTrace.length > 200) {
    session.sharedState.combatTrace.shift();
  }
}

function logCombatPacket(
  session: SessionLike,
  prefix: string,
  cmdWord: number,
  packet: CombatPacket,
  recorded: RecordedCombatState
): void {
  const pieces = [`${prefix}=${describeCombatCommand(cmdWord)}`, `cmd=0x${cmdWord.toString(16)}`];
  if (packet.subcmd !== null) {
    pieces.push(`sub=0x${packet.subcmd.toString(16)}`);
  }
  if (packet.detail16 !== null) {
    pieces.push(`detail16=${packet.detail16}`);
  }
  if (packet.detail32 !== null) {
    pieces.push(`detail32=${packet.detail32}`);
  }
  pieces.push(`len=${packet.payloadLength}`);
  pieces.push(`inFight=${recorded.snapshot.inFight ? 1 : 0}`);
  if (recorded.snapshot.stateChanged) {
    pieces.push('stateChanged=1');
  }
  session.log(pieces.join(' '));
}

export function handleCombatPacket(session: SessionLike, cmdWord: number, payload: Buffer): void {
  const packet = parseCombatPacket(cmdWord, payload);
  const recorded = recordInboundCombatPacket(session.combatState, packet);
  session.combatState = recorded.state;

  pushCombatTrace(session, 'inbound', packet, recorded);
  logCombatPacket(session, 'Combat packet kind', cmdWord, packet, recorded);

  if (
    cmdWord === GAME_FIGHT_ACTION_CMD &&
    packet.subcmd === FIGHT_CLIENT_READY_SUBCMD &&
    session.awaitingCombatTurnHandshake &&
    session.pendingCombatTurnProbe
  ) {
    const action = session.pendingCombatTurnProbe;
    session.awaitingCombatTurnHandshake = false;
    session.pendingCombatTurnProbe = null;
    if (session.syntheticFight) {
      session.syntheticFight.phase = 'command';
    }
    sendCombatCommandRefresh(session, action, `client-03ed-${FIGHT_CLIENT_READY_SUBCMD.toString(16)}`);
    return;
  }

  if (
    session.defeatRespawnPending &&
    (cmdWord === GAME_FIGHT_ACTION_CMD ||
      cmdWord === GAME_FIGHT_STREAM_CMD ||
      cmdWord === GAME_FIGHT_RESULT_CMD ||
      cmdWord === GAME_FIGHT_STATE_CMD ||
      cmdWord === GAME_FIGHT_TURN_CMD ||
      cmdWord === GAME_FIGHT_CLIENT_CMD ||
      cmdWord === GAME_FIGHT_MISC_CMD)
  ) {
    session.log(`Ignoring lingering combat packet cmd=0x${cmdWord.toString(16)} during defeat respawn`);
    return;
  }

  if (
    cmdWord === GAME_FIGHT_ACTION_CMD &&
    packet.subcmd === FIGHT_CLIENT_READY_SUBCMD &&
    session.syntheticFight &&
    !session.awaitingCombatTurnHandshake
  ) {
    if (session.syntheticFight.phase === 'finished') {
      session.log(
        `Ignoring client 0x03ed/0x${FIGHT_CLIENT_READY_SUBCMD.toString(16)} because synthetic fight is finished`
      );
      return;
    }
    if (session.syntheticFight.suppressNextReadyRepeat) {
      session.syntheticFight.suppressNextReadyRepeat = false;
      session.log(
        `Ignoring duplicate client 0x03ed/0x${FIGHT_CLIENT_READY_SUBCMD.toString(16)} immediately after command refresh`
      );
      return;
    }
    if (session.syntheticFight.phase === 'command' && session.syntheticFight.awaitingPlayerAction) {
      session.log(
        `Ignoring client 0x03ed/0x${FIGHT_CLIENT_READY_SUBCMD.toString(16)} while waiting for player action`
      );
      return;
    }
    if (session.syntheticFight.turnQueue.length > 0) {
      resolveSyntheticQueuedTurn(session, { probeId: 'client-ready-repeat' });
      return;
    }
    session.syntheticFight.phase = 'command';
    sendCombatCommandRefresh(
      session,
      { probeId: 'client-ready-repeat' },
      `client-03ed-${FIGHT_CLIENT_READY_SUBCMD.toString(16)}-repeat`
    );
    return;
  }

  if (cmdWord === GAME_FIGHT_ACTION_CMD && packet.subcmd === FIGHT_CLIENT_ATTACK_SELECTION_SUBCMD) {
    if (session.syntheticFight?.phase === 'finished') {
      session.log(
        `Ignoring client 0x03ed/0x${FIGHT_CLIENT_ATTACK_SELECTION_SUBCMD.toString(16)} because synthetic fight is finished`
      );
      return;
    }
    handleSyntheticAttackSelection(session, payload);
  }
}

function handleSyntheticAttackSelection(session: SessionLike, payload: Buffer): void {
  if (!session.syntheticFight || payload.length < 6) {
    return;
  }

  const { attackMode, targetA, targetB } = parseAttackSelection(payload);
  const resolution = resolvePlayerAttackSelection({
    syntheticFight: session.syntheticFight,
    attackMode,
    targetA,
    targetB,
    charName: session.charName,
    findSyntheticEnemyTarget,
    computeSyntheticDamage,
    initializeSyntheticEnemyTurnQueue,
  });

  session.log(
    `Synthetic attack selection mode=${attackMode} targetA=${targetA} targetB=${targetB} targetMatches=${resolution.enemy ? 1 : 0} retargeted=${resolution.retargeted ? 1 : 0} enemy=${resolution.enemy?.name || 'none'} hp=${resolution.enemy?.hp || 0}`
  );

  if (resolution.kind === 'noop') {
    return;
  }

  if (resolution.kind !== 'invalid-target') {
    session.log(
      `Synthetic combat resolved attack damage=${resolution.damage} enemy=${resolution.enemy.name} remainingHp=${resolution.enemy.hp}`
    );

    sendSyntheticAttackPlayback(session, {
      attackerEntityId: resolution.player.entityId,
      targetEntityId: resolution.enemy.entityId,
      resultCode:
        resolution.enemy.hp === 0 ? FIGHT_ACTIVE_STATE_SUBCMD : FIGHT_CONTROL_RING_OPEN_SUBCMD,
      damage: resolution.damage,
    });

    if (resolution.enemy.hp === 0) {
      sendCombatCommandHide(
        session,
        {
          probeId: 'enemy-defeated',
          entityId: resolution.enemy.entityId,
        },
        'enemy-defeated'
      );
      session.handleQuestMonsterDefeat(resolution.enemy.typeId, 1);
    }
  }

  dispatchAttackResult(session, resolution, {
    finishSyntheticFight,
    sendCombatCommandHide,
    sendCombatTurnProbe,
    sendSyntheticFightVictoryClose,
  });
}

function resolveSyntheticQueuedTurn(session: SessionLike, action: CombatAction): void {
  const resolution = resolveQueuedEnemyTurn({
    syntheticFight: session.syntheticFight,
    selectSyntheticEnemyAttacker,
    computeSyntheticDamage,
    hasLivingSyntheticAllies,
  });

  if (resolution.kind !== 'missing-turn' && resolution.kind !== 'skipped') {
    session.currentHealth = resolution.player.hp;
    session.log(
      `Synthetic enemy turn attacker=${resolution.attacker.name} damage=${resolution.damage} playerHp=${resolution.player.hp}`
    );

    sendSyntheticAttackPlayback(session, {
      attackerEntityId: resolution.attacker.entityId,
      targetEntityId: resolution.player.entityId,
      resultCode:
        resolution.player.hp === 0 ? FIGHT_ACTIVE_STATE_SUBCMD : FIGHT_CONTROL_RING_OPEN_SUBCMD,
      damage: resolution.damage,
    });
  }

  dispatchTurnResult(session, action, resolution, {
    FIGHT_RESULT_DEFEAT_SUBCMD,
    finishSyntheticFight,
    scheduleSyntheticCommandRefresh,
    sendCombatCommandHide,
    sendCombatCommandRefresh,
    sendSyntheticAttackMirrorUpdate,
  });
}

function finishSyntheticFight(session: SessionLike, outcome: 'victory' | 'defeat', message?: string): void {
  if (!session.syntheticFight) {
    return;
  }

  clearSyntheticCommandRefreshTimer(session);
  let dropResult = null;
  if (outcome === 'victory') {
    dropResult = rollSyntheticFightDrops(session, session.syntheticFight);
    if (dropResult?.granted?.length > 0) {
      session.refreshQuestStateForItemTemplates(
        dropResult.granted
          .map((drop: Record<string, any>) => drop.item?.templateId || drop.definition?.templateId)
          .filter(Number.isInteger)
      );
    }
  }
  const finished = finalizeSyntheticFightState(session.syntheticFight, outcome);
  const player = finished.player;
  session.awaitingCombatTurnHandshake = false;
  session.pendingCombatTurnProbe = null;
  session.combatState = createCombatState();
  session.log(`Synthetic fight finished outcome=${outcome}`);
  if (dropResult?.granted?.length > 0 || dropResult?.skipped?.length > 0) {
    const dropText = [
      ...dropResult.granted.map(
        (drop: Record<string, any>) => `${drop.definition?.name || drop.item.templateId} x${drop.quantity}`
      ),
      ...dropResult.skipped.map(
        (drop: Record<string, any>) => `${drop.templateId} skipped (${drop.reason})`
      ),
    ].join(', ');
    session.log(`Synthetic fight drops outcome=${outcome} ${dropText}`);
  }
  if (message && outcome !== 'defeat') {
    session.sendGameDialogue('Combat', message);
  }
  if (outcome === 'defeat') {
    const persisted = session.getPersistedCharacter();
    const defeatRespawn = buildDefeatRespawnState({
      persistedCharacter: persisted,
      currentMapId: session.currentMapId,
      currentX: session.currentX,
      currentY: session.currentY,
      player,
      currentMana: session.currentMana,
      currentRage: session.currentRage,
      resolveTownRespawn,
    });
    const { respawn, vitals } = defeatRespawn;

    session.currentHealth = 0;
    session.currentMana = Math.max(0, player?.mp || session.currentMana || 0);
    session.currentRage = Math.max(0, player?.rage || session.currentRage || 0);
    session.currentEncounterTriggerId = null;
    session.syntheticFight = null;
    session.defeatRespawnPending = true;
    setTimeout(() => {
      if (session.socket.destroyed) {
        return;
      }
      session.currentHealth = vitals.health;
      session.currentMana = vitals.mana;
      session.currentRage = vitals.rage;
      session.persistCurrentCharacter({
        currentHealth: vitals.health,
        currentMana: vitals.mana,
        currentRage: vitals.rage,
        mapId: respawn.mapId,
        x: respawn.x,
        y: respawn.y,
        lastTownMapId: respawn.mapId,
        lastTownX: respawn.x,
        lastTownY: respawn.y,
      });
      session.currentMapId = respawn.mapId;
      session.currentX = respawn.x;
      session.currentY = respawn.y;
      session.currentTileSceneId = 0;
      session.currentEncounterTriggerId = null;
      session.transitionToScene(respawn.mapId, respawn.x, respawn.y, 'defeat-respawn');
    }, 900);
    return;
  }
  if (dropResult?.inventoryDirty) {
    session.persistCurrentCharacter();
  }
  session.currentEncounterTriggerId = null;
  session.syntheticFight = null;
}

function createSyntheticFight(session: SessionLike, action: CombatAction, enemies: unknown[]) {
  clearSyntheticCommandRefreshTimer(session);
  return createSyntheticFightState({
    action,
    entityType: session.entityType,
    roleEntityType: session.roleEntityType,
    currentHealth: session.currentHealth,
    maxHealth: session.maxHealth,
    currentMana: session.currentMana,
    maxMana: session.maxMana,
    currentRage: session.currentRage,
    maxRage: session.maxRage,
    primaryAttributes: session.primaryAttributes,
    level: session.level,
    charName: session.charName,
    enemies,
    turnProfile: selectCombatTurnProbeProfile(),
  });
}

function clearSyntheticCommandRefreshTimer(session: SessionLike): void {
  if (session.syntheticCommandRefreshTimer) {
    clearTimeout(session.syntheticCommandRefreshTimer);
    session.syntheticCommandRefreshTimer = null;
  }
}

function scheduleSyntheticCommandRefresh(
  session: SessionLike,
  action: CombatAction,
  reason: string,
  delayMs: number
): void {
  clearSyntheticCommandRefreshTimer(session);
  session.syntheticCommandRefreshTimer = setTimeout(() => {
    session.syntheticCommandRefreshTimer = null;
    if (!session.syntheticFight || session.syntheticFight.phase === 'finished') {
      return;
    }
    sendCombatCommandRefresh(session, action, reason);
  }, Math.max(0, delayMs | 0));
}

function sendSyntheticAttackPlayback(
  session: SessionLike,
  details: {
    attackerEntityId: number;
    targetEntityId: number;
    resultCode: number;
    damage: number;
  }
): void {
  session.writePacket(
    buildSyntheticAttackPlaybackPacket(details),
    DEFAULT_FLAGS,
    `Sending synthetic fight playback cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x03 attacker=${details.attackerEntityId} target=${details.targetEntityId} result=${details.resultCode} damage=${details.damage}`
  );
}

function sendSyntheticAttackMirrorUpdate(
  session: SessionLike,
  details: { actionMode: number }
): void {
  const player = getSyntheticPlayerFighter(session.syntheticFight);
  const vitals = resolveCurrentPlayerVitals(session, player);

  session.writePacket(
    buildSyntheticAttackMirrorUpdatePacket({
      actionMode: details.actionMode,
      playerVitals: vitals,
    }),
    DEFAULT_FLAGS,
    `Sending synthetic fight mirror update cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${details.actionMode.toString(16)} hp=${vitals.health} mp=${vitals.mana} rage=${vitals.rage}`
  );
}

function sendSyntheticFightVictoryClose(session: SessionLike): void {
  const player = getSyntheticPlayerFighter(session.syntheticFight);
  const vitals = resolveCurrentPlayerVitals(session, player);

  session.writePacket(
    buildSyntheticFightVictoryClosePacket({
      playerVitals: vitals,
    }),
    DEFAULT_FLAGS,
    `Sending synthetic fight victory close cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_RESULT_VICTORY_SUBCMD.toString(16)} hp=${vitals.health} mp=${vitals.mana} rage=${vitals.rage}`
  );
}

export function sendCombatEncounterProbe(session: SessionLike, action: CombatAction): void {
  const enemies = buildSyntheticEncounterEnemies(action, session.currentMapId);
  const syntheticFight = createSyntheticFight(session, action, enemies);
  const player = syntheticFight.fighters[0];
  const playerEntry = {
    side: player.side,
    entityId: player.entityId,
    typeId: player.typeId,
    row: player.row,
    col: player.col,
    hpLike: player.hp,
    mpLike: player.mp,
    aptitude: player.aptitude,
    levelLike: player.level,
    appearanceTypes: player.appearanceTypes,
    appearanceVariants: player.appearanceVariants,
    name: player.name,
    extended: true,
  };
  session.writePacket(
    buildCombatEncounterProbePacket({
      activeEntityId: session.entityType,
      playerEntry,
      enemies,
    }),
    DEFAULT_FLAGS,
    `Sending experimental combat encounter probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_ENCOUNTER_PROBE_SUBCMD.toString(16)} trigger=${action.probeId} active=${session.entityType} enemies=${enemies.map((enemy: Record<string, any>) => `${enemy.typeId}@${enemy.entityId}`).join('/')} count=${enemies.length} map=${session.currentMapId} pos=${session.currentX},${session.currentY} referenceCommands=${session.combatReference.fightCommands.map((command: Record<string, any>) => command.id).join('/') || 'none'} referenceSkills=${session.combatReference.skills.slice(0, 6).map((skill: Record<string, any>) => skill.id).join('/') || 'none'}`
  );
  session.syntheticFight = syntheticFight;
  sendReducedFightStartup(session, action);
  session.pendingCombatTurnProbe = action;
  session.awaitingCombatTurnHandshake = true;
  session.log(
    `Deferring combat turn probe until client readiness handshake trigger=${action.probeId} expected=0x${GAME_FIGHT_ACTION_CMD.toString(16)}/0x${FIGHT_CLIENT_READY_SUBCMD.toString(16)}`
  );
}

function sendReducedFightStartup(session: SessionLike, action: CombatAction): void {
  sendFightRingOpenProbe(session, action);
  sendFightStateModeProbe64(session, action);
  sendFightControlInitProbe(session, action);
  sendFightActiveStateProbe(session, action);
  sendFightEntityFlagProbe(session, action, FIGHT_ENTITY_FLAG_HIDE_SUBCMD);
  sendFightControlShowProbe(session, action);
}

function sendFightControlInitProbe(session: SessionLike, action: CombatAction): void {
  session.writePacket(
    buildFightControlInitProbePacket(),
    DEFAULT_FLAGS,
    `Sending experimental fight control init probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_CONTROL_INIT_SUBCMD.toString(16)} trigger=${action.probeId}`
  );
}

function sendFightRingOpenProbe(session: SessionLike, action: CombatAction): void {
  session.writePacket(
    buildFightRingOpenProbePacket(),
    DEFAULT_FLAGS,
    `Sending experimental fight ring-open probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_CONTROL_RING_OPEN_SUBCMD.toString(16)} trigger=${action.probeId}`
  );
}

function sendFightStateModeProbe64(session: SessionLike, action: CombatAction): void {
  session.writePacket(
    buildFightStateModeProbe64Packet(),
    DEFAULT_FLAGS,
    `Sending experimental fight mode probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_STATE_MODE_SUBCMD.toString(16)} trigger=${action.probeId} stateA=-1 stateB=0 stateC=0`
  );
}

function sendFightActiveStateProbe(session: SessionLike, action: CombatAction): void {
  session.writePacket(
    buildFightActiveStateProbePacket(session.entityType),
    DEFAULT_FLAGS,
    `Sending experimental fight active-state probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_ACTIVE_STATE_SUBCMD.toString(16)} trigger=${action.probeId} active=${session.entityType} enabled=1 state=0,0,0 linked=0`
  );
}

function sendFightEntityFlagProbe(
  session: SessionLike,
  action: CombatAction,
  subcommand: number
): void {
  const activeEntityId =
    typeof action?.entityId === 'number' ? action.entityId >>> 0 : session.entityType >>> 0;
  session.writePacket(
    buildFightEntityFlagProbePacket(activeEntityId, subcommand),
    DEFAULT_FLAGS,
    `Sending experimental fight entity flag probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${subcommand.toString(16)} trigger=${action.probeId} active=${activeEntityId}`
  );
}

function sendFightControlShowProbe(session: SessionLike, action: CombatAction): void {
  const activeEntityId =
    typeof action?.entityId === 'number' ? action.entityId >>> 0 : session.entityType >>> 0;
  session.writePacket(
    buildFightControlShowProbePacket(activeEntityId),
    DEFAULT_FLAGS,
    `Sending experimental fight control probe cmd=0x${GAME_FIGHT_STREAM_CMD.toString(16)} sub=0x${FIGHT_CONTROL_SHOW_SUBCMD.toString(16)} trigger=${action.probeId} active=${activeEntityId}`
  );
}

function sendCombatTurnProbe(
  session: SessionLike,
  action: CombatAction,
  reason = 'startup-sequence'
): void {
  const activeTurnProfile = session.syntheticFight?.turnProfile || selectCombatTurnProbeProfile();
  const probeIndex = activeTurnProfile.index;
  const probeProfile = activeTurnProfile.profile;
  if (session.syntheticFight) {
    session.syntheticFight.phase = 'command';
  }

  session.writePacket(
    buildCombatTurnProbePacket(probeProfile),
    DEFAULT_FLAGS,
    `Sending experimental combat turn probe cmd=0x${GAME_FIGHT_TURN_CMD.toString(16)} trigger=${action.probeId} reason=${reason} count=${probeProfile.rows.length} probeIndex=${probeIndex} profile=${probeProfile.profile} rows=${probeProfile.rows.map((row: Record<string, number>) => `${row.fieldA}/${row.fieldB}/${row.fieldC}`).join(',')}`
  );
}

function sendCombatCommandRefresh(session: SessionLike, action: CombatAction, reason: string): void {
  if (session.syntheticFight) {
    session.syntheticFight.phase = 'command';
    session.syntheticFight.awaitingPlayerAction = true;
    session.syntheticFight.suppressNextReadyRepeat = true;
  }
  const playerEntityId = getSyntheticPlayerFighter(session.syntheticFight)?.entityId || session.entityType;
  sendFightRingOpenProbe(session, {
    ...action,
    probeId: `${action.probeId || 'refresh'}:${reason}`,
  });
  sendFightControlShowProbe(session, {
    ...action,
    probeId: `${action.probeId || 'refresh'}:${reason}`,
    entityId: playerEntityId,
  });
  sendCombatTurnProbe(session, action, reason);
}

function sendCombatCommandHide(session: SessionLike, action: CombatAction, reason: string): void {
  sendFightEntityFlagProbe(
    session,
    {
      ...action,
      probeId: `${action.probeId || 'hide'}:${reason}`,
    },
    FIGHT_ENTITY_FLAG_HIDE_SUBCMD
  );
}

export function sendCombatExitProbe(session: SessionLike, action: CombatAction): void {
  session.log(
    `Ignoring synthetic combat-exit probe trigger=${action.probeId} map=${session.currentMapId} pos=${session.currentX},${session.currentY}`
  );
}

export function disposeCombatTimers(session: SessionLike): void {
  clearSyntheticCommandRefreshTimer(session);
}
