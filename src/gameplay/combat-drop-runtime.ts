 'use strict';
 export {};

import fs from 'node:fs';
import { resolveRepoPath } from '../runtime-paths.js';
import { applyEffects } from '../effects/effect-executor.js';

import type { GameSession } from '../types.js';
type UnknownRecord = Record<string, any>;

const CONDITIONAL_DROPS_PATH = resolveRepoPath('data', 'quests', 'conditional-drops.json');
let CONDITIONAL_DROPS: UnknownRecord[] = [];
try {
  CONDITIONAL_DROPS = JSON.parse(fs.readFileSync(CONDITIONAL_DROPS_PATH, 'utf8'));
} catch (_err) {
  CONDITIONAL_DROPS = [];
}

export function grantCombatDrops(session: GameSession, enemy: UnknownRecord | null | undefined): UnknownRecord {
  if (!enemy) {
    return { granted: [], inventoryDirty: false };
  }

  const granted: UnknownRecord[] = [];
  const effects: UnknownRecord[] = [];
  for (const drop of resolveDrops(session, enemy)) {
    const chance = Math.max(0, Math.min(100, Number(drop?.chance) || 0));
    if (chance <= 0) {
      continue;
    }
    if ((Math.random() * 100) >= chance) {
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

  const result = applyEffects(session, effects, {
    suppressStatSync: true,
  });

  return {
    granted,
    inventoryDirty: result.inventoryDirty === true,
  };
}

function resolveDrops(session: GameSession, enemy: UnknownRecord): UnknownRecord[] {
  const enemyDrops = Array.isArray(enemy?.drops) ? enemy.drops.map((drop: UnknownRecord) => ({ ...drop })) : [];
  for (const conditional of CONDITIONAL_DROPS) {
    if ((conditional.enemyTypeId >>> 0) !== (enemy.typeId >>> 0)) {
      continue;
    }
    const active = Array.isArray(session.activeQuests) && session.activeQuests.some(
      (quest: UnknownRecord) => (quest?.id >>> 0) === (conditional.questId >>> 0) && (quest?.stepIndex >>> 0) === (conditional.stepIndex >>> 0)
    );
    if (!active) {
      continue;
    }
    for (const drop of Array.isArray(conditional.drops) ? conditional.drops : []) {
      enemyDrops.push({ ...drop });
    }
  }
  return enemyDrops;
}
