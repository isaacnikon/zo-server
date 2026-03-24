import type { GameSession, QuestSyncMode } from '../types.js';

import { DEFAULT_FLAGS, LOGIN_CMD, LOGIN_SERVER_LIST_RESULT } from '../config.js';
import { PacketWriter } from '../protocol.js';
import { syncInventoryStateToClient } from '../gameplay/inventory-runtime.js';
import { sendSkillStateSync } from '../gameplay/skill-runtime.js';
import { getMapBootstrapSpawns } from '../map-spawns.js';
import { startAutoMapRotation } from '../scenes/map-rotation.js';


export function sendEnterGameOk(session: GameSession, options: { syncMode?: QuestSyncMode } = {}): void {
  const syncMode: QuestSyncMode = options.syncMode || 'login';
  session.ensureQuestStateReady();

  const writer = new PacketWriter();
  writer.writeUint16(LOGIN_CMD);
  writer.writeUint8(LOGIN_SERVER_LIST_RESULT);
  writer.writeUint32(session.entityType >>> 0);
  writer.writeUint16(session.entityType);
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
    `Sending enter-game success char="${session.charName}" runtimeId=0x${session.entityType.toString(16)} entity=0x${session.entityType.toString(16)} roleEntity=0x${session.roleEntityType.toString(16)} aptitude=${session.selectedAptitude} map=${session.currentMapId} pos=${session.currentX},${session.currentY}`
  );
  session.sendSelfStateAptitudeSync();
  sendSkillStateSync(session, 'enter-game');
  syncInventoryStateToClient(session);
  session.scheduleEquipmentReplay();
  session.syncQuestStateToClient({ mode: syncMode });
  session.sendPetStateSync('enter-game');
  sendStaticNpcSpawns(session, session.currentMapId);
  startAutoMapRotation(session);
}

function sendStaticNpcSpawns(session: GameSession, mapId: number): void {
  const staticNpcs = getMapBootstrapSpawns(mapId);
  if (!Array.isArray(staticNpcs) || staticNpcs.length === 0) {
    return;
  }

  const writer = new PacketWriter();
  writer.writeUint16(0x03eb);
  writer.writeUint8(0x15);
  writer.writeUint16(staticNpcs.length & 0xffff);

  for (const npc of staticNpcs) {
    writer.writeUint32((npc.id || 0) >>> 0);
    writer.writeUint16((npc.entityType || 0) & 0xffff);
    writer.writeUint16((npc.x || 0) & 0xffff);
    writer.writeUint16((npc.y || 0) & 0xffff);
    writer.writeUint16((npc.dir || 0) & 0xffff);
    writer.writeUint16((npc.state || 0) & 0xffff);
  }

  session.writePacket(
    writer.payload(),
    DEFAULT_FLAGS,
    `Sending static NPC spawn batch cmd=0x03eb sub=0x15 map=${mapId} count=${staticNpcs.length}`
  );
}

export function sendMapNpcSpawns(session: GameSession, mapId: number): void {
  sendStaticNpcSpawns(session, mapId);
}
