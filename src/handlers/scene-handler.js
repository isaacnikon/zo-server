'use strict';

const { parsePositionUpdate } = require('../protocol/inbound-packets');
const { PacketWriter } = require('../protocol');
const {
  DEFAULT_FLAGS,
  GAME_POSITION_QUERY_CMD,
  GAME_SPAWN_BATCH_SUBCMD,
} = require('../config');
const {
  applySceneTransition,
} = require('../quest-engine');
const {
  describeScene,
  getBootstrapWorldSpawns,
  isTownScene,
  resolveEncounterAction,
  resolveTileSceneAction,
} = require('../scene-runtime');

function updateTownRespawnAnchor(session, mapId, x, y) {
  if (!isTownScene(mapId)) {
    return;
  }

  session.persistCurrentCharacter({
    lastTownMapId: mapId,
    lastTownX: x,
    lastTownY: y,
  });
}

function handlePositionUpdate(session, payload) {
  if (payload.length < 8) {
    session.log('Short 0x03eb payload');
    return;
  }

  if (session.defeatRespawnPending) {
    session.log('Ignoring position update while defeat respawn is pending');
    return;
  }

  const { x, y, mapId } = parsePositionUpdate(payload);
  const previousMapId = session.currentMapId;
  session.currentX = x;
  session.currentY = y;
  session.currentMapId = mapId;
  session.log(`Position update map=${mapId} pos=${x},${y}`);
  handleTileSceneTrigger(session, mapId, x, y);
  handleEncounterTrigger(session, mapId, x, y);

  session.persistCurrentCharacter({
    mapId,
    x,
    y,
  });
  updateTownRespawnAnchor(session, mapId, x, y);

  if (previousMapId !== mapId) {
    const questEvents = applySceneTransition(
      {
        activeQuests: session.activeQuests,
        completedQuests: session.completedQuests,
      },
      mapId
    );
    if (questEvents.length > 0) {
      session.applyQuestEvents(questEvents, 'position-map-change');
    }
  }
}

function handleTileSceneTrigger(session, mapId, x, y) {
  const cell = session.sharedState.mapCellStore?.getCell(mapId, x, y) || null;
  const tileSceneId = cell?.sceneId || 0;

  if (tileSceneId === session.currentTileSceneId) {
    return;
  }

  const previousTileSceneId = session.currentTileSceneId;
  session.currentTileSceneId = tileSceneId;

  if (tileSceneId === 0) {
    if (previousTileSceneId !== 0) {
      session.log(`Left tile scene trigger sceneId=${previousTileSceneId} map=${mapId} pos=${x},${y}`);
    }
    return;
  }

  session.log(
    `Entered tile scene trigger map=${mapId} (${describeScene(mapId)}) pos=${x},${y} sceneId=${tileSceneId} flags=0x${(cell.flags || 0).toString(16)} aux=${cell.auxValue || 0}`
  );

  const action = resolveTileSceneAction({
    mapId,
    tileSceneId,
  });

  if (!action) {
    return;
  }

  if (action.kind === 'transition') {
    session.currentTileSceneId = 0;
    transitionToScene(session, action.targetSceneId, action.targetX, action.targetY, action.reason);
    return;
  }

  session.log(
    `No server-side tile scene action mapped for map=${mapId} (${describeScene(mapId)}) sceneId=${tileSceneId}`
  );
}

function handleEncounterTrigger(session, mapId, x, y) {
  const action = resolveEncounterAction({
    mapId,
    x,
    y,
  });

  const triggerId = action?.probeId || null;
  if (!action) {
    session.currentEncounterTriggerId = null;
    return;
  }

  if (action.kind === 'encounterProbe') {
    if (shouldSuppressEncounterProbe(session, action, mapId)) {
      if (triggerId !== session.currentEncounterTriggerId) {
        session.log(
          `Encounter probe suppressed trigger=${triggerId} map=${mapId} pos=${x},${y} reason=active quest encounter owns this area`
        );
      }
      session.currentEncounterTriggerId = triggerId;
      return;
    }

    if (triggerId === session.currentEncounterTriggerId) {
      return;
    }

    const profile = action.encounterProfile || {};
    const cooldownMs = Math.max(0, Number.isFinite(profile.cooldownMs) ? profile.cooldownMs : 0);
    if (cooldownMs > 0) {
      const elapsedMs = Date.now() - session.lastEncounterProbeAt;
      if (elapsedMs < cooldownMs) {
        session.log(
          `Encounter cooldown active trigger=${triggerId} map=${mapId} pos=${x},${y} elapsed=${elapsedMs} cooldown=${cooldownMs}`
        );
        return;
      }
    }
    const chancePercent = Math.max(
      0,
      Math.min(100, Number.isFinite(profile.encounterChancePercent) ? profile.encounterChancePercent : 100)
    );
    if (chancePercent < 100) {
      const roll = Math.random() * 100;
      if (roll >= chancePercent) {
        session.log(
          `Encounter roll miss trigger=${triggerId} map=${mapId} pos=${x},${y} roll=${roll.toFixed(2)} chance=${chancePercent}`
        );
        return;
      }
      session.log(
        `Encounter roll hit trigger=${triggerId} map=${mapId} pos=${x},${y} roll=${roll.toFixed(2)} chance=${chancePercent}`
      );
    }

    session.currentEncounterTriggerId = triggerId;
    session.lastEncounterProbeAt = Date.now();
    session.sendCombatEncounterProbe(action);
    return;
  }

  if (action.kind === 'encounterProbeExit') {
    session.currentEncounterTriggerId = null;
    session.sendCombatExitProbe(action);
  }
}

function shouldSuppressEncounterProbe(session, action, mapId) {
  if (!action || action.kind !== 'encounterProbe') {
    return false;
  }

  if (mapId !== 103 || action.probeId !== 'blingSpringField') {
    return false;
  }

  const petQuest = Array.isArray(session.activeQuests)
    ? session.activeQuests.find((quest) => (quest?.id >>> 0) === 51)
    : null;
  if (!petQuest) {
    return false;
  }

  return (petQuest.stepIndex >>> 0) === 3;
}

function transitionToScene(session, mapId, x, y, reason) {
  session.defeatRespawnPending = false;
  session.currentMapId = mapId;
  session.currentX = x;
  session.currentY = y;
  session.currentTileSceneId = 0;
  session.currentEncounterTriggerId = null;
  session.log(`Transitioning scene reason="${reason}" map=${mapId} (${describeScene(mapId)}) pos=${x},${y}`);

  session.persistCurrentCharacter({
    mapId,
    x,
    y,
  });

  updateTownRespawnAnchor(session, mapId, x, y);
  const questEvents = applySceneTransition(
    {
      activeQuests: session.activeQuests,
      completedQuests: session.completedQuests,
    },
    mapId
  );
  if (questEvents.length > 0) {
    session.applyQuestEvents(questEvents, 'scene-transition');
  }

  session.sendEnterGameOk();
}

function sendStaticNpcSpawns(session) {
  const staticNpcs = getBootstrapWorldSpawns(session.currentMapId);
  if (!Array.isArray(staticNpcs) || staticNpcs.length === 0) {
    return;
  }

  const writer = new PacketWriter();
  writer.writeUint16(GAME_POSITION_QUERY_CMD);
  writer.writeUint8(GAME_SPAWN_BATCH_SUBCMD);
  writer.writeUint16(staticNpcs.length);

  for (const npc of staticNpcs) {
    writeNpcSpawnRecord(session, writer, npc);
  }

  session.writePacket(
    writer.payload(),
    DEFAULT_FLAGS,
    `Sending static NPC spawn batch cmd=0x${GAME_POSITION_QUERY_CMD.toString(16)} map=${session.currentMapId} (${describeScene(session.currentMapId)}) count=${staticNpcs.length}`
  );
}

function writeNpcSpawnRecord(session, writer, npc) {
  const x = (typeof npc.x === 'number' ? npc.x : session.currentX + (npc.dx || 0)) & 0xffff;
  const y = (typeof npc.y === 'number' ? npc.y : session.currentY + (npc.dy || 0)) & 0xffff;

  writer.writeUint32(npc.id >>> 0);
  writer.writeUint16(npc.entityType & 0xffff);
  writer.writeUint16(x);
  writer.writeUint16(y);
  writer.writeUint32((npc.templateFlags || 0) >>> 0);

  if (!npc.richSpawn) {
    return;
  }

  writer.writeUint32((npc.richValue || 0) >>> 0);
  writer.writeUint16((npc.level || 0) & 0xffff);
  writer.writeString(`${npc.name || ''}\0`);

  const triples = Array.isArray(npc.appearanceTriples) ? npc.appearanceTriples : [];
  for (let i = 0; i < 3; i += 1) {
    const triple = triples[i] || {};
    writer.writeUint16((triple.type || 0) & 0xffff);
    writer.writeUint8((triple.variant || 0) & 0xff);
  }

  writer.writeUint16((npc.extraFlags || 0) & 0xffff);
}

module.exports = {
  updateTownRespawnAnchor,
  handlePositionUpdate,
  handleTileSceneTrigger,
  handleEncounterTrigger,
  shouldSuppressEncounterProbe,
  transitionToScene,
  sendStaticNpcSpawns,
  writeNpcSpawnRecord,
};
