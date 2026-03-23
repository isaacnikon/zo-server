import type { GameSession } from '../types';

const {
  parseEquipmentState,
  parseAttributeAllocation,
  parseCombatItemUse,
  parseFightResultItemActionProbe,
  parseSharedItemUse,
  parseTargetedItemUse,
} = require('../protocol/inbound-packets');
const { FIGHT_CLIENT_ITEM_USE_SUBCMD, GAME_FIGHT_ACTION_CMD } = require('../config');
const { canEquipItem, getBagItemByReference, getItemDefinition, removeBagItemByInstanceId } = require('../inventory');
const {
  sendConsumeResultPackets,
  sendEquipmentContainerSync,
  sendInventoryFullSync,
} = require('../gameplay/inventory-runtime');
const { consumeUsableItemByInstanceId } = require('../gameplay/item-use-runtime');
const { sendSkillStateSync } = require('../gameplay/skill-runtime');
const { normalizePrimaryAttributes } = require('../character/normalize');
const { recomputeSessionMaxVitals } = require('../gameplay/session-flows');

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

  const nextEquipped = equipFlag === 1;
  if (item.equipped === nextEquipped) {
    session.log(
      `Ignoring duplicate equipment state instanceId=${instanceId} templateId=${item.templateId} equipped=${nextEquipped ? 1 : 0}`
    );
    return true;
  }

  const itemDefinition = getItemDefinition(item.templateId);
  if (nextEquipped) {
    const eligibility = canEquipItem(session, item);
    if (!eligibility.ok) {
      session.log(
        `Equipment rejected instanceId=${instanceId} templateId=${item.templateId} reason=${eligibility.reason}`
      );
      sendEquipmentContainerSync(session);
      return true;
    }
  }
  if (
    nextEquipped &&
    itemDefinition?.hasDurability === true &&
    Number.isInteger(itemDefinition?.clientTemplateFamily)
  ) {
    for (const candidate of Array.isArray(session.bagItems) ? session.bagItems : []) {
      if (
        candidate === item ||
        candidate?.equipped !== true ||
        !Number.isInteger(candidate?.templateId)
      ) {
        continue;
      }
      const candidateDefinition = getItemDefinition(candidate.templateId);
      if (
        candidateDefinition?.hasDurability === true &&
        candidateDefinition?.clientTemplateFamily === itemDefinition.clientTemplateFamily
      ) {
        candidate.equipped = false;
        session.log(
          `Auto-unequipped instanceId=${candidate.instanceId >>> 0} templateId=${candidate.templateId >>> 0} replacedBy=${instanceId}`
        );
      }
    }
  }

  item.equipped = nextEquipped;
  session.log(
    `Equipment state update instanceId=${instanceId} templateId=${item.templateId} equipped=${item.equipped ? 1 : 0}`
  );
  session.persistCurrentCharacter();
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
  recomputeSessionMaxVitals(session);
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

export function tryHandleFightResultItemActionProbe(
  session: SessionLike,
  payload: Buffer
): boolean {
  const parsed = parseFightResultItemActionProbe(payload);
  if (!parsed) {
    return false;
  }

  const rawValue = parsed.rawValue >>> 0;
  const bagItem = getBagItemByReference(session, rawValue);

  if (!bagItem) {
    session.log(
      `Ignoring non-combat 0x03ee item action sub=0x${parsed.subcmd.toString(16)} rawValue=${rawValue} reason=unknown-instance`
    );
    return true;
  }

  const removeResult = removeBagItemByInstanceId(session, bagItem.instanceId >>> 0);
  if (!removeResult.ok) {
    session.log(
      `Discard rejected instanceId=${rawValue} templateId=${bagItem.templateId >>> 0} reason=${removeResult.reason}`
    );
    return true;
  }

  sendConsumeResultPackets(session, removeResult);
  sendInventoryFullSync(session);
  sendEquipmentContainerSync(session);
  session.persistCurrentCharacter();
  if (typeof session.refreshQuestStateForItemTemplates === 'function') {
    session.refreshQuestStateForItemTemplates([bagItem.templateId >>> 0]);
  }

  session.log(
    `Discarded item instanceId=${rawValue} templateId=${bagItem.templateId >>> 0} slot=${bagItem.slot >>> 0} name="${getItemDefinition(bagItem.templateId)?.name || `item ${bagItem.templateId}`}" quantityRemoved=${removeResult.changes?.[0]?.quantityRemoved || 1}`
  );
  return true;
}

export function tryHandleItemUsePacket(session: SessionLike, cmdWord: number, payload: Buffer): boolean {
  const sharedItemUse = parseSharedItemUse(payload);
  if (cmdWord === 0x03ee && sharedItemUse) {
    const { instanceId } = sharedItemUse;
    const useResult = consumeUsableItemByInstanceId(session, instanceId);
    if (!useResult.ok) {
      session.log(`Item use rejected instanceId=${instanceId} reason=${useResult.reason}`);
      return true;
    }

    session.log(
      `Item use ok instanceId=${instanceId} templateId=${useResult.item?.templateId || 0} restored=${useResult.gained?.health || 0}/${useResult.gained?.mana || 0}/${useResult.gained?.rage || 0}`
    );
    return true;
  }

  const targetedItemUse = parseTargetedItemUse(payload);
  if (cmdWord === 0x03ee && targetedItemUse) {
    const { instanceId, targetEntityId } = targetedItemUse;
    const useResult = consumeUsableItemByInstanceId(session, instanceId, { targetEntityId });
    if (!useResult.ok) {
      session.log(
        `Targeted item use rejected instanceId=${instanceId} targetEntityId=${targetEntityId} reason=${useResult.reason}`
      );
      return true;
    }

    session.log(
      `Targeted item use ok instanceId=${instanceId} targetEntityId=${targetEntityId} targetKind=${useResult.targetKind || 'unknown'} templateId=${useResult.item?.templateId || 0} restored=${useResult.gained?.health || 0}/${useResult.gained?.mana || 0}/${useResult.gained?.rage || 0}`
    );
    return true;
  }

  if (
    cmdWord !== GAME_FIGHT_ACTION_CMD ||
    payload.length < 11 ||
    payload[2] !== FIGHT_CLIENT_ITEM_USE_SUBCMD
  ) {
    return false;
  }

  if (session.combatState?.active) {
    return false;
  }

  const { instanceId, targetEntityId } = parseCombatItemUse(payload);
  const useResult = consumeUsableItemByInstanceId(session, instanceId);
  if (!useResult.ok) {
    session.log(
      `Item use rejected instanceId=${instanceId} targetEntityId=${targetEntityId} reason=${useResult.reason}`
    );
    return true;
  }

  session.log(
    `Item use ok instanceId=${instanceId} targetEntityId=${targetEntityId} templateId=${useResult.item?.templateId || 0} restored=${useResult.gained?.health || 0}/${useResult.gained?.mana || 0}/${useResult.gained?.rage || 0}`
  );
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
