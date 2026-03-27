import type { GameSession, QuestSyncMode } from '../types.js';

import { DEFAULT_FLAGS, LOGIN_CMD, LOGIN_SERVER_LIST_RESULT } from '../config.js';
import { PacketWriter } from '../protocol.js';
import { syncInventoryStateToClient } from '../gameplay/inventory-runtime.js';
import { sendSkillStateSync } from '../gameplay/skill-runtime.js';
import { buildMapGatheringNodes } from '../gameplay/gathering-runtime.js';
import { getMapBootstrapSpawns } from '../map-spawns.js';
import { getCurrentStep, getCurrentStepUi, getQuestDefinition } from '../quest-engine/index.js';
import { buildSceneSpawnBatchPacket } from '../protocol/gameplay-packets.js';
import { startAutoMapRotation } from '../scenes/map-rotation.js';
import { numberOrDefault } from '../character/normalize.js';
import { ensureWorldPresence, syncWorldPresence } from '../world-state.js';

type SpawnRecord = {
  id: number;
  entityType: number;
  x: number;
  y: number;
  dir: number;
  state: number;
};

export function sendEnterGameOk(session: GameSession, options: { syncMode?: QuestSyncMode } = {}): void {
  const syncMode: QuestSyncMode = options.syncMode || 'login';
  const deferLoginQuestSync = syncMode === 'login';
  if (session.pendingLoginQuestSyncTimer) {
    clearTimeout(session.pendingLoginQuestSyncTimer);
    session.pendingLoginQuestSyncTimer = null;
  }
  session.ensureQuestStateReady();
  ensureWorldPresence(session);

  const writer = new PacketWriter();
  writer.writeUint16(LOGIN_CMD);
  writer.writeUint8(LOGIN_SERVER_LIST_RESULT);
  writer.writeUint32(session.runtimeId >>> 0);
  writer.writeUint16(session.entityType & 0xffff);
  writer.writeUint32(session.roleData);
  writer.writeUint16(session.currentX);
  writer.writeUint16(session.currentY);
  writer.writeUint16(0);
  writer.writeString(`${session.charName}\0`);
  writer.writeUint8(0);
  writer.writeUint16(session.currentMapId);
  session.writePacket(
    writer.payload(),
    DEFAULT_FLAGS,
    `Sending enter-game success char="${session.charName}" runtimeId=0x${session.runtimeId.toString(16)} entity=0x${session.entityType.toString(16)} roleEntity=0x${session.roleEntityType.toString(16)} aptitude=${session.selectedAptitude} map=${session.currentMapId} pos=${session.currentX},${session.currentY}`
  );
  session.sendSelfStateAptitudeSync();
  sendSkillStateSync(session, 'enter-game');
  syncInventoryStateToClient(session);
  session.scheduleEquipmentReplay();
  session.sendPetStateSync('enter-game');
  sendStaticNpcSpawns(session, session.currentMapId);
  if (deferLoginQuestSync) {
    session.pendingLoginQuestSyncMapId = session.currentMapId;
    session.pendingLoginQuestSyncTimer = setTimeout(() => {
      session.pendingLoginQuestSyncTimer = null;
      if (session.socket.destroyed || session.pendingLoginQuestSyncMapId === null) {
        return;
      }
      session.syncQuestStateToClient({ mode: 'login' });
      session.pendingLoginQuestSyncMapId = null;
    }, 250);
  } else {
    session.pendingLoginQuestSyncMapId = null;
    session.pendingLoginQuestSyncTimer = null;
    session.syncQuestStateToClient({ mode: syncMode });
  }
  syncWorldPresence(session, 'enter-game');
  startAutoMapRotation(session);
}

function sendStaticNpcSpawns(session: GameSession, mapId: number): void {
  const staticNpcs = getMapBootstrapSpawns(mapId);
  const escortSpawns = buildEscortQuestRoleSpawns(session, mapId, staticNpcs.length);

  // Build gathering nodes for this map and store on session
  const gatheringNodes = buildMapGatheringNodes(mapId);
  session.gatheringNodes = gatheringNodes;
  session.activeGather = null;
  const gatheringSpawns: SpawnRecord[] = [...gatheringNodes.entries()].map(([runtimeId, node]) => ({
    id: runtimeId,
    entityType: node.templateId,
    x: node.x,
    y: node.y,
    dir: 0,
    state: 0,
  }));

  const allSpawns = [...staticNpcs, ...escortSpawns, ...gatheringSpawns];
  if (!Array.isArray(allSpawns) || allSpawns.length === 0) {
    return;
  }

  session.writePacket(
    buildSceneSpawnBatchPacket(allSpawns),
    DEFAULT_FLAGS,
    `Sending static NPC spawn batch cmd=0x03eb sub=0x15 map=${mapId} count=${allSpawns.length} base=${staticNpcs.length} escort=${escortSpawns.length} gather=${gatheringSpawns.length}`
  );
}

function buildEscortQuestRoleSpawns(
  session: GameSession,
  mapId: number,
  baseCount: number
): SpawnRecord[] {
  if (!Array.isArray(session.activeQuests) || session.activeQuests.length === 0) {
    return [];
  }

  const escortRoleIds = new Set<number>();
  for (const record of session.activeQuests) {
    const definition = getQuestDefinition(numberOrDefault(record?.id, 0));
    const step = getCurrentStep(definition, record as any);
    const ui = getCurrentStepUi(definition, record as any);
    if (
      !step ||
      numberOrDefault(ui?.taskType, 0) !== 8 ||
      numberOrDefault(step.mapId, 0) !== mapId
    ) {
      continue;
    }
    const roleId = numberOrDefault(ui?.taskRoleNpcId, numberOrDefault(ui?.escortNpcId, 0));
    if (roleId > 0) {
      escortRoleIds.add(roleId);
    }
  }

  let offset = 0;
  return [...escortRoleIds].map((roleId) => {
    offset += 1;
    return {
      id: (((mapId & 0xffff) << 16) | ((baseCount + offset) & 0xffff)) >>> 0,
      entityType: roleId & 0xffff,
      x: Math.max(0, (session.currentX + 1 + offset) & 0xffff),
      y: Math.max(0, session.currentY & 0xffff),
      dir: 0,
      state: 0,
    };
  });
}

export function sendMapNpcSpawns(session: GameSession, mapId: number): void {
  sendStaticNpcSpawns(session, mapId);
}
