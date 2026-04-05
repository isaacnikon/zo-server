'use strict';
export {};

import { applyEffects } from '../effects/effect-executor.js';

import type { GameSession } from '../types.js';

type UnknownRecord = Record<string, any>;

export async function grantCombatDrops(_session: GameSession, enemy: UnknownRecord | null | undefined): Promise<UnknownRecord> {
  if (!enemy) {
    return { granted: [], inventoryDirty: false };
  }

  const granted: UnknownRecord[] = [];
  const effects: UnknownRecord[] = [];

  for (const drop of Array.isArray(enemy?.drops) ? enemy.drops : []) {
    const chance = Math.max(0, Math.min(100, Number(drop?.chance) || 0));
    if (chance <= 0 || (Math.random() * 100) >= chance) {
      continue;
    }

    const quantity = Math.max(1, Number(drop?.quantity) || 1);
    effects.push({
      kind: 'grant-item',
      templateId: drop.templateId >>> 0,
      quantity,
      dialoguePrefix: 'Combat',
      successMessage: `${enemy.name || `Enemy ${enemy.typeId}`} dropped item ${drop.templateId} x${quantity}.`,
      failureMessage: `${enemy.name || `Enemy ${enemy.typeId}`} dropped item ${drop.templateId}, but your pack is full.`,
    });
    granted.push({
      templateId: drop.templateId >>> 0,
      quantity,
    });
  }

  const result = await applyEffects(_session, effects, {
    suppressStatSync: true,
  });

  return {
    granted,
    inventoryDirty: result.inventoryDirty === true,
  };
}
