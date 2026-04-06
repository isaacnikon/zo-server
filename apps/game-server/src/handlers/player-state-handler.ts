import type { GameSession } from '../types.js';

import { parseEquipmentState, parseAttributeAllocation, parseClientMaxVitalsSync, parseCombatItemUse, parseFightResultItemActionProbe, parseItemContainerAction, parseItemStackCombineRequest, parseItemStackSplitRequest, parseSharedItemUse, parseTargetedItemUse, } from '../protocol/inbound-packets.js';
import { FIGHT_CLIENT_ITEM_USE_SUBCMD, GAME_FIGHT_ACTION_CMD } from '../config.js';
import { BAG_CONTAINER_TYPE, canEquipItem, combineBagItemsByInstanceId, getBagItemByInstanceId, getBagItemByReference, getItemDefinition, moveBagItemToSlot, removeBagItemByInstanceId, splitBagItemByInstanceId, splitMovedBagItemByInstanceId } from '../inventory/index.js';
import { sendConsumeResultPackets, sendEquipmentContainerSync, sendInventoryFullSync, } from '../gameplay/inventory-runtime.js';
import { consumeUsableItemByInstanceId } from '../gameplay/item-use-runtime.js';
import { sendSelfStateVitalsUpdate } from '../gameplay/stat-sync.js';
import { normalizePrimaryAttributes } from '../character/normalize.js';
import { clampSessionVitalsToMax, recomputeSessionMaxVitals } from '../gameplay/session-flows.js';

const PENDING_BAG_SPLIT_WINDOW_MS = 5000;

type ItemUseAttempt = {
  instanceId: number;
  label: string;
  targetEntityId?: number;
  consumeTargetEntityId?: number;
  includeTargetKind?: boolean;
};

export async function tryHandleEquipmentStatePacket(session: GameSession, payload: Buffer): Promise<boolean> {
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
  await session.persistCurrentCharacter();
  return true;
}

export async function tryHandleAttributeAllocationPacket(
  session: GameSession,
  payload: Buffer
): Promise<boolean> {
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

  await session.persistCurrentCharacter({
    primaryAttributes: session.primaryAttributes,
    statusPoints: session.statusPoints,
  });
  session.sendSelfStateAptitudeSync();
  return true;
}

export async function tryHandleClientMaxVitalsSyncPacket(
  session: GameSession,
  payload: Buffer
): Promise<boolean> {
  const vitals = parseClientMaxVitalsSync(payload);
  if (!vitals) {
    return false;
  }

  const observedMaxHealth = Math.max(1, vitals.maxHealth >>> 0);
  const observedMaxMana = Math.max(0, vitals.maxMana >>> 0);
  session.clientObservedMaxHealth = observedMaxHealth;
  session.clientObservedMaxMana = observedMaxMana;
  recomputeSessionMaxVitals(session, {
    currentHealth: session.currentHealth,
    currentMana: session.currentMana,
    currentRage: session.currentRage,
  });
  const clampedVitals = clampSessionVitalsToMax(session);

  await session.persistCurrentCharacter({
    currentHealth: session.currentHealth,
    currentMana: session.currentMana,
    maxHealth: session.derivedMaxHealth || session.maxHealth,
    maxMana: session.derivedMaxMana || session.maxMana,
  });
  if (clampedVitals) {
    sendSelfStateVitalsUpdate(session, {
      health: session.currentHealth,
      mana: session.currentMana,
      rage: Math.max(0, session.currentRage || 0),
    });
  }
  session.log(
    `Client max-vitals sync sub=0x2f observed=${observedMaxHealth}/${observedMaxMana} derived=${session.derivedMaxHealth || session.maxHealth}/${session.derivedMaxMana || session.maxMana} effective=${session.maxHealth}/${session.maxMana} current=${session.currentHealth}/${session.currentMana}`
  );
  return true;
}

export async function tryHandleFightResultItemActionProbe(
  session: GameSession,
  payload: Buffer
): Promise<boolean> {
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
  await session.persistCurrentCharacter();
  if (typeof session.refreshQuestStateForItemTemplates === 'function') {
    await session.refreshQuestStateForItemTemplates([bagItem.templateId >>> 0]);
  }

  session.log(
    `Discarded item instanceId=${rawValue} templateId=${bagItem.templateId >>> 0} slot=${bagItem.slot >>> 0} name="${getItemDefinition(bagItem.templateId)?.name || `item ${bagItem.templateId}`}" quantityRemoved=${removeResult.changes?.[0]?.quantityRemoved || 1}`
  );
  return true;
}

export async function tryHandleItemContainerPacket(session: GameSession, payload: Buffer): Promise<boolean> {
  const parsed = parseItemContainerAction(payload);
  if (!parsed) {
    return false;
  }

  if (parsed.containerType !== BAG_CONTAINER_TYPE) {
    session.pendingBagSplitMove = null;
    session.log(
      `Ignoring item-container packet container=${parsed.containerType} sub=0x${parsed.subcmd.toString(16)} len=${payload.length}`
    );
    return true;
  }

  if (parsed.subcmd === 0x17 && typeof parsed.instanceId === 'number' && typeof parsed.slotIndex === 'number') {
    const moveResult = moveBagItemToSlot(session, parsed.instanceId, parsed.slotIndex);
    if (!moveResult.ok) {
      session.pendingBagSplitMove = null;
      session.log(
        `Bag move rejected instanceId=${parsed.instanceId} slot=${parsed.slotIndex} reason=${moveResult.reason}`
      );
      sendInventoryFullSync(session);
      return true;
    }

    const movedItem = getBagItemByInstanceId(session, parsed.instanceId);
    const movedDefinition = movedItem ? getItemDefinition(movedItem.templateId) : null;
    const splitEligible =
      moveResult.action === 'moved' &&
      moveResult.targetWasEmpty === true &&
      movedItem != null &&
      movedDefinition != null &&
      movedDefinition.maxStack > 1 &&
      movedItem.quantity > 1;

    session.pendingBagSplitMove = splitEligible
      ? {
          instanceId: parsed.instanceId >>> 0,
          fromSlot: moveResult.fromSlot >>> 0,
          toSlot: moveResult.toSlot >>> 0,
          createdAt: Date.now(),
        }
      : null;

    sendInventoryFullSync(session);
    await session.persistCurrentCharacter();
    session.log(
      `Bag move ok instanceId=${parsed.instanceId} action=${moveResult.action} from=${moveResult.fromSlot >>> 0} to=${moveResult.toSlot >>> 0}${typeof moveResult.quantityMoved === 'number' ? ` qtyMoved=${moveResult.quantityMoved >>> 0}` : ''}${splitEligible ? ' splitEligible=1' : ''}`
    );
    return true;
  }

  if (parsed.subcmd === 0x14 && typeof parsed.instanceId === 'number' && typeof parsed.quantity === 'number') {
    const bagItem = getBagItemByInstanceId(session, parsed.instanceId);
    if (!bagItem) {
      session.pendingBagSplitMove = null;
      session.log(
        `Bag split rejected instanceId=${parsed.instanceId} quantity=${parsed.quantity} reason=unknown-instance`
      );
      sendInventoryFullSync(session);
      return true;
    }

    const pendingSplit = isPendingBagSplitActive(session, parsed.instanceId) ? session.pendingBagSplitMove : null;
    const splitResult = pendingSplit
      ? splitMovedBagItemByInstanceId(session, parsed.instanceId, parsed.quantity, pendingSplit.fromSlot)
      : splitBagItemByInstanceId(session, parsed.instanceId, parsed.quantity);

    session.pendingBagSplitMove = null;

    if (!splitResult.ok) {
      session.log(
        `Bag split rejected instanceId=${parsed.instanceId} quantity=${parsed.quantity} reason=${splitResult.reason}`
      );
      sendInventoryFullSync(session);
      return true;
    }

    sendInventoryFullSync(session);
    await session.persistCurrentCharacter();
    session.log(
      `Bag split ok instanceId=${parsed.instanceId} templateId=${bagItem.templateId >>> 0} quantity=${parsed.quantity >>> 0} newInstanceId=${splitResult.newItem?.instanceId || 0} newSlot=${splitResult.newItem?.slot || 0}${pendingSplit ? ` remainderSlot=${pendingSplit.fromSlot >>> 0}` : ''}${splitResult.noop ? ' noop=1' : ''}`
    );
    return true;
  }

  session.pendingBagSplitMove = null;
  session.log(
    `Unhandled item-container packet container=${parsed.containerType} sub=0x${parsed.subcmd.toString(16)} len=${payload.length} hex=${payload.toString('hex')}`
  );
  return true;
}

export async function tryHandleItemStackSplitPacket(session: GameSession, payload: Buffer): Promise<boolean> {
  const parsed = parseItemStackSplitRequest(payload);
  if (!parsed) {
    return false;
  }

  const bagItem = getBagItemByInstanceId(session, parsed.instanceId);
  const definition = bagItem ? getItemDefinition(bagItem.templateId) : null;
  if (!bagItem || !definition || definition.maxStack <= 1 || bagItem.equipped === true) {
    return false;
  }

  const splitResult = splitBagItemByInstanceId(session, parsed.instanceId, parsed.quantity);
  if (!splitResult.ok) {
    session.log(
      `Bag split rejected cmd=0x400 sub=0x${parsed.subcmd.toString(16)} mode=0x${parsed.mode.toString(16)} instanceId=${parsed.instanceId} quantity=${parsed.quantity} reason=${splitResult.reason}`
    );
    sendInventoryFullSync(session);
    return true;
  }

  sendInventoryFullSync(session);
  await session.persistCurrentCharacter();
  session.log(
    `Bag split ok cmd=0x400 sub=0x${parsed.subcmd.toString(16)} mode=0x${parsed.mode.toString(16)} instanceId=${parsed.instanceId} templateId=${bagItem.templateId >>> 0} quantity=${parsed.quantity} newInstanceId=${splitResult.newItem?.instanceId || 0} newSlot=${splitResult.newItem?.slot || 0}${splitResult.noop ? ' noop=1' : ''}`
  );
  return true;
}

export async function tryHandleItemStackCombinePacket(session: GameSession, payload: Buffer): Promise<boolean> {
  const parsed = parseItemStackCombineRequest(payload);
  if (!parsed) {
    return false;
  }

  const sourceItem = getBagItemByInstanceId(session, parsed.sourceInstanceId);
  const targetItem = getBagItemByInstanceId(session, parsed.targetInstanceId);
  const sourceDefinition = sourceItem ? getItemDefinition(sourceItem.templateId) : null;
  const targetDefinition = targetItem ? getItemDefinition(targetItem.templateId) : null;
  if (
    !sourceItem ||
    !targetItem ||
    !sourceDefinition ||
    !targetDefinition ||
    sourceDefinition.maxStack <= 1 ||
    targetDefinition.maxStack <= 1
  ) {
    return false;
  }

  const combineResult = combineBagItemsByInstanceId(session, parsed.sourceInstanceId, parsed.targetInstanceId);
  if (!combineResult.ok) {
    session.log(
      `Bag combine rejected cmd=0x3ee sub=0x${parsed.subcmd.toString(16)} sourceInstanceId=${parsed.sourceInstanceId} targetInstanceId=${parsed.targetInstanceId} reason=${combineResult.reason}`
    );
    sendInventoryFullSync(session);
    return true;
  }

  sendInventoryFullSync(session);
  await session.persistCurrentCharacter();
  session.log(
    `Bag combine ok cmd=0x3ee sub=0x${parsed.subcmd.toString(16)} sourceInstanceId=${parsed.sourceInstanceId} targetInstanceId=${parsed.targetInstanceId} templateId=${targetItem.templateId >>> 0} quantityMoved=${combineResult.quantityMoved || 0}${combineResult.sourceRemoved ? ' sourceRemoved=1' : ''}${combineResult.noop ? ' noop=1' : ''}`
  );
  return true;
}

export async function tryHandleItemUsePacket(session: GameSession, cmdWord: number, payload: Buffer): Promise<boolean> {
  const sharedItemUse = parseSharedItemUse(payload);
  if (cmdWord === 0x03ee && sharedItemUse) {
    return await completeItemUse(session, {
      instanceId: sharedItemUse.instanceId,
      label: 'Item use',
    });
  }

  const targetedItemUse = parseTargetedItemUse(payload);
  if (cmdWord === 0x03ee && targetedItemUse) {
    return await completeItemUse(session, {
      instanceId: targetedItemUse.instanceId,
      label: 'Targeted item use',
      targetEntityId: targetedItemUse.targetEntityId,
      consumeTargetEntityId: targetedItemUse.targetEntityId,
      includeTargetKind: true,
    });
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
  return await completeItemUse(session, {
    instanceId,
    label: 'Item use',
    targetEntityId,
  });
}

export function scheduleEquipmentReplay(session: GameSession, delayMs = 300): void {
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

function isPendingBagSplitActive(session: GameSession, instanceId: number): boolean {
  const pending = session.pendingBagSplitMove;
  if (
    !pending ||
    (pending.instanceId >>> 0) !== (instanceId >>> 0) ||
    Date.now() - pending.createdAt > PENDING_BAG_SPLIT_WINDOW_MS
  ) {
    return false;
  }
  return true;
}

async function completeItemUse(session: GameSession, attempt: ItemUseAttempt): Promise<boolean> {
  const consumeOptions =
    typeof attempt.consumeTargetEntityId === 'number'
      ? { targetEntityId: attempt.consumeTargetEntityId }
      : undefined;
  const useResult = await consumeUsableItemByInstanceId(session, attempt.instanceId, consumeOptions);
  if (!useResult.ok) {
    session.log(
      `${attempt.label} rejected instanceId=${attempt.instanceId}${formatItemUseTargetLog(attempt)} reason=${useResult.reason}`
    );
    return true;
  }

  if (useResult.petSyncNeeded) {
    session.sendPetStateSync('item-use');
  }

  const targetKindSegment =
    attempt.includeTargetKind === true ? ` targetKind=${useResult.targetKind || 'unknown'}` : '';
  session.log(
    `${attempt.label} ok instanceId=${attempt.instanceId}${formatItemUseTargetLog(attempt)}${targetKindSegment} templateId=${useResult.item?.templateId || 0} restored=${useResult.gained?.health || 0}/${useResult.gained?.mana || 0}/${useResult.gained?.rage || 0}`
  );
  return true;
}

function formatItemUseTargetLog(attempt: ItemUseAttempt): string {
  return typeof attempt.targetEntityId === 'number'
    ? ` targetEntityId=${attempt.targetEntityId}`
    : '';
}
