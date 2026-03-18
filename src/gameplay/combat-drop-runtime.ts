const fs = require('fs');
const { resolveRepoPath } = require('../runtime-paths');
const { getItemDefinition, grantItemToBag } = require('../inventory');
const { getRolePrimaryDrop } = require('../roleinfo');
const { sendGrantResultPackets, sendInventoryFullSync } = require('./inventory-runtime');
const { applyEffects } = require('../effects/effect-executor');

const DROP_RATE_SCALE = 100;

const CONDITIONAL_DROPS_PATH = resolveRepoPath('data', 'quests', 'conditional-drops.json');
let QUEST_CONDITIONAL_DROPS: Record<string, any>[] = [];
try {
  QUEST_CONDITIONAL_DROPS = JSON.parse(fs.readFileSync(CONDITIONAL_DROPS_PATH, 'utf8'));
} catch (_err) {
  QUEST_CONDITIONAL_DROPS = [];
}

type UnknownRecord = Record<string, any>;
type SessionLike = Record<string, any>;

function rollSyntheticFightDrops(
  session: SessionLike,
  syntheticFight: UnknownRecord,
  options: UnknownRecord = {}
): UnknownRecord {
  if (!syntheticFight || !Array.isArray(syntheticFight.enemies) || syntheticFight.enemies.length === 0) {
    return emptyResult();
  }

  const suppressPackets = options.suppressPackets === true;
  const suppressDialogues = options.suppressDialogues === true;
  const roll = typeof options.random === 'function' ? options.random : Math.random;
  const dialogueEffects: UnknownRecord[] = [];
  const granted: UnknownRecord[] = [];
  const skipped: UnknownRecord[] = [];

  for (const enemy of syntheticFight.enemies) {
    const drops = [...resolveEnemyDrops(enemy), ...resolveQuestConditionalDrops(session, enemy)];
    for (const drop of drops) {
      const chance = Number.isFinite(drop?.chance) ? drop.chance : 0;
      const normalizedChance = Math.max(0, Math.min(DROP_RATE_SCALE, chance));
      if (normalizedChance <= 0) {
        continue;
      }
      if (roll() * DROP_RATE_SCALE >= normalizedChance) {
        continue;
      }

      const quantity = Math.max(1, Number.isInteger(drop?.quantity) ? drop.quantity : 1);
      const grantResult = grantItemToBag(session, drop.templateId, quantity);
      if (!grantResult.ok) {
        skipped.push({
          enemyName: enemy?.name || `Enemy ${enemy?.typeId || 0}`,
          templateId: drop.templateId >>> 0,
          reason: grantResult.reason,
        });
        dialogueEffects.push({
          kind: 'dialogue',
          title: 'Combat',
          message: `${enemy?.name || `Enemy ${enemy?.typeId || 0}`} dropped item ${drop.templateId}, but your pack is full.`,
        });
        continue;
      }

      const definition = grantResult.definition || getItemDefinition(drop.templateId);
      granted.push({
        enemyName: enemy?.name || `Enemy ${enemy?.typeId || 0}`,
        source: typeof drop?.source === 'string' ? drop.source : '',
        definition,
        item: grantResult.item,
        grantResult,
        quantity,
      });

      if (!suppressPackets) {
        sendGrantResultPackets(session, grantResult);
      }

      dialogueEffects.push({
        kind: 'dialogue',
        title: 'Combat',
        message: `${enemy?.name || `Enemy ${enemy?.typeId || 0}`} dropped ${definition?.name || `item ${drop.templateId}`} x${quantity}.`,
      });
    }
  }

  if (granted.length === 0 && skipped.length === 0) {
    return emptyResult();
  }

  if (granted.length > 0 && !suppressPackets) {
    sendInventoryFullSync(session);
  }

  if (dialogueEffects.length > 0) {
    applyEffects(session, dialogueEffects, {
      suppressPackets: true,
      suppressDialogues,
      suppressPersist: true,
    });
  }

  return {
    inventoryDirty: granted.length > 0,
    granted,
    skipped,
  };
}

function resolveEnemyDrops(enemy: UnknownRecord): UnknownRecord[] {
  const explicitDrops = Array.isArray(enemy?.drops) ? enemy.drops : [];
  if (explicitDrops.length > 0) {
    return explicitDrops;
  }

  const primaryDrop = getRolePrimaryDrop(enemy?.typeId);
  return primaryDrop ? [primaryDrop] : [];
}

function emptyResult(): UnknownRecord {
  return {
    inventoryDirty: false,
    granted: [],
    skipped: [],
  };
}

function resolveQuestConditionalDrops(session: SessionLike, enemy: UnknownRecord): UnknownRecord[] {
  if (!enemy || !session || !Array.isArray(session.activeQuests)) {
    return [];
  }

  const result: UnknownRecord[] = [];
  for (const rule of QUEST_CONDITIONAL_DROPS) {
    if (rule.enemyTypeId !== enemy.typeId) {
      continue;
    }
    const matchesQuest = session.activeQuests.some(
      (quest: UnknownRecord) => quest?.id === rule.questId && quest?.stepIndex === rule.stepIndex
    );
    if (!matchesQuest) {
      continue;
    }
    for (const drop of Array.isArray(rule.drops) ? rule.drops : []) {
      result.push({ ...drop });
    }
  }
  return result;
}

export {
  DROP_RATE_SCALE,
  rollSyntheticFightDrops,
};
