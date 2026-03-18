import type { GameSession } from '../types';

const { parseEquipmentState, parseAttributeAllocation } = require('../protocol/inbound-packets');
const { sendEquipmentContainerSync } = require('../gameplay/inventory-runtime');
const { normalizePrimaryAttributes } = require('../character/normalize');

type SessionLike = GameSession & Record<string, any>;

export function tryHandleEquipmentStatePacket(session: SessionLike, payload: Buffer): boolean {
  const parsed = parseEquipmentState(payload);
  if (!parsed) {
    return false;
  }

  const { instanceId, equipFlag } = parsed;
  const item = Array.isArray(session.bagItems)
    ? session.bagItems.find((entry: { instanceId: number }) => (entry.instanceId >>> 0) === (instanceId >>> 0))
    : null;
  if (!item) {
    session.log(`Ignoring equipment state for unknown instanceId=${instanceId}`);
    return true;
  }

  item.equipped = equipFlag === 1;
  session.log(
    `Equipment state update instanceId=${instanceId} templateId=${item.templateId} equipped=${item.equipped ? 1 : 0}`
  );
  session.persistCurrentCharacter();
  sendEquipmentContainerSync(session);
  return true;
}

export function tryHandleAttributeAllocationPacket(
  session: SessionLike,
  payload: Buffer
): boolean {
  const allocation = parseAttributeAllocation(payload);
  if (!allocation) {
    return false;
  }

  const { strengthDelta, dexterityDelta, vitalityDelta, intelligenceDelta } = allocation;
  const requestedTotal = strengthDelta + vitalityDelta + dexterityDelta + intelligenceDelta;

  session.log(
    `Attribute allocation confirm sub=0x1e str=${strengthDelta} dex=${dexterityDelta} vit=${vitalityDelta} int=${intelligenceDelta} available=${session.statusPoints}`
  );

  if (requestedTotal <= 0) {
    session.log('Ignoring empty attribute allocation confirm');
    return true;
  }

  const spendableTotal = Math.min(requestedTotal, Math.max(0, session.statusPoints));
  if (spendableTotal <= 0) {
    session.log('Ignoring attribute allocation with no spendable status points');
    session.sendSelfStateAptitudeSync();
    return true;
  }

  let remaining = spendableTotal;
  const applied = {
    strength: Math.min(strengthDelta, remaining),
    dexterity: 0,
    vitality: 0,
    intelligence: 0,
  };
  remaining -= applied.strength;
  applied.dexterity = Math.min(dexterityDelta, remaining);
  remaining -= applied.dexterity;
  applied.vitality = Math.min(vitalityDelta, remaining);
  remaining -= applied.vitality;
  applied.intelligence = Math.min(intelligenceDelta, remaining);

  session.primaryAttributes = normalizePrimaryAttributes({
    intelligence: session.primaryAttributes.intelligence + applied.intelligence,
    vitality: session.primaryAttributes.vitality + applied.vitality,
    dexterity: session.primaryAttributes.dexterity + applied.dexterity,
    strength: session.primaryAttributes.strength + applied.strength,
  });
  session.statusPoints = Math.max(
    0,
    session.statusPoints - (applied.strength + applied.vitality + applied.dexterity + applied.intelligence)
  );

  session.persistCurrentCharacter({
    primaryAttributes: session.primaryAttributes,
    statusPoints: session.statusPoints,
  });
  session.sendSelfStateAptitudeSync();
  return true;
}

export function scheduleEquipmentReplay(session: SessionLike, delayMs = 300): void {
  if (session.equipmentReplayTimer) {
    clearTimeout(session.equipmentReplayTimer);
    session.equipmentReplayTimer = null;
  }

  session.equipmentReplayTimer = setTimeout(() => {
    session.equipmentReplayTimer = null;
    if (session.state !== 'LOGGED_IN') {
      return;
    }
    sendEquipmentContainerSync(session);
  }, Math.max(0, delayMs | 0));
}
