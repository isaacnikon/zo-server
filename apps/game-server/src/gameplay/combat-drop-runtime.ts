'use strict';
export {};

import { getItemDefinition, grantItemToBag } from '../inventory/index.js';
import { sendGrantResultPackets, syncInventoryStateToClient } from './inventory-runtime.js';

import type { SessionPorts } from '../types.js';

type UnknownRecord = Record<string, any>;

export async function grantCombatDrops(_session: SessionPorts, enemy: UnknownRecord | null | undefined): Promise<UnknownRecord> {
  if (!enemy) {
    return { granted: [], inventoryDirty: false };
  }

  const granted: UnknownRecord[] = [];
  let inventoryDirty = false;

  for (const drop of Array.isArray(enemy?.drops) ? enemy.drops : []) {
    const chance = Math.max(0, Math.min(100, Number(drop?.chance) || 0));
    if (chance <= 0 || (Math.random() * 100) >= chance) {
      continue;
    }

    const templateId = drop.templateId >>> 0;
    const quantity = Math.max(1, Number(drop?.quantity) || 1);
    const itemName = getItemDefinition(templateId)?.name || `item ${templateId}`;
    const grantResult = grantItemToBag(_session, templateId, quantity);
    if (!grantResult.ok) {
      _session.sendGameDialogue(
        'Combat',
        `${enemy.name || `Enemy ${enemy.typeId}`} dropped ${itemName}, but your pack is full.`
      );
      _session.log(
        `Combat drop rejected enemyType=${enemy.typeId || 0} enemyName="${enemy.name || 'unknown'}" templateId=${templateId} qty=${quantity} reason=${grantResult.reason || 'grant-failed'}`
      );
      continue;
    }

    sendGrantResultPackets(_session, grantResult);
    _session.sendGameDialogue(
      'Combat',
      `${enemy.name || `Enemy ${enemy.typeId}`} dropped ${itemName} x${quantity}.`
    );
    _session.log(
      `Combat drop granted enemyType=${enemy.typeId || 0} enemyName="${enemy.name || 'unknown'}" templateId=${templateId} qty=${quantity}`
    );
    granted.push({
      templateId,
      quantity,
    });
    inventoryDirty = true;
  }

  return {
    granted,
    inventoryDirty,
  };
}

export async function grantCombatDropsForEnemies(
  session: SessionPorts,
  enemies: UnknownRecord[]
): Promise<UnknownRecord> {
  const acc: { granted: UnknownRecord[]; inventoryDirty: boolean } = { granted: [], inventoryDirty: false };
  for (const enemy of enemies) {
    const next = await grantCombatDrops(session, enemy);
    acc.granted.push(...(next.granted || []));
    acc.inventoryDirty = acc.inventoryDirty || !!next.inventoryDirty;
  }
  if (acc.inventoryDirty) {
    syncInventoryStateToClient(session);
  }
  return acc;
}
