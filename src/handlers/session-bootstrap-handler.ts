import type { GameSession, QuestSyncMode } from '../types';

const { DEFAULT_FLAGS, LOGIN_CMD, LOGIN_SERVER_LIST_RESULT } = require('../config');
const { PacketWriter } = require('../protocol');
const { syncInventoryStateToClient } = require('../gameplay/inventory-runtime');

type SessionLike = GameSession & Record<string, any>;

export function sendEnterGameOk(session: SessionLike, options: { syncMode?: QuestSyncMode } = {}): void {
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
  syncInventoryStateToClient(session);
  session.scheduleEquipmentReplay();
  session.syncQuestStateToClient({ mode: syncMode });
  session.sendPetStateSync('enter-game');
}
