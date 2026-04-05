import { getComposeRecipeEntries } from '../crafting-data.js';
import {
  bagHasTemplateQuantity,
  consumeItemFromBag,
  getItemDefinition,
  grantItemToBag,
} from '../inventory/index.js';
import { syncInventoryStateToClient } from './inventory-runtime.js';
import { resolveStoredSkillLevel } from './skill-runtime.js';
import type { GameSession } from '../types.js';

type CraftRecipeEntry = {
  recipeId: number;
  materialTemplateId: number;
  materialQuantity: number;
  targetTemplateId: number;
  targetQuantity: number;
  stationTemplateId: number;
  stationQuantity: number;
};

type CraftRecipeGroup = {
  recipeId: number;
  requiredSkillId: number;
  requiredSkillLevel: number;
  outputs: Array<{ templateId: number; quantity: number }>;
  ingredients: Array<{ templateId: number; quantity: number }>;
};

export async function tryHandleCraftRecipePacket(session: GameSession, payload: Buffer): Promise<boolean> {
  if (!Buffer.isBuffer(payload) || payload.length < 5) {
    return false;
  }

  const subcmd = payload[2] >>> 0;
  const recipeId = payload.readUInt16LE(3) >>> 0;
  const recipe = resolveCraftRecipeGroup(recipeId);
  if (!recipe) {
    session.log(`Craft request rejected recipeId=${recipeId} subcmd=0x${subcmd.toString(16)} reason=unknown-recipe`);
    return true;
  }

  const currentSkillLevel = resolveStoredSkillLevel(session, recipe.requiredSkillId);
  if (currentSkillLevel < recipe.requiredSkillLevel) {
    session.sendGameDialogue(
      'Crafting',
      `You need ${resolveSkillName(recipe.requiredSkillId)} Lv ${recipe.requiredSkillLevel} to craft this.`
    );
    session.log(
      `Craft request rejected recipeId=${recipeId} subcmd=0x${subcmd.toString(16)} skillId=${recipe.requiredSkillId} needLevel=${recipe.requiredSkillLevel} haveLevel=${currentSkillLevel} reason=skill-too-low`
    );
    return true;
  }

  for (const ingredient of recipe.ingredients) {
    if (!bagHasTemplateQuantity(session, ingredient.templateId, ingredient.quantity)) {
      session.sendGameDialogue(
        'Crafting',
        `You need ${ingredient.quantity} ${resolveItemName(ingredient.templateId)} to craft this.`
      );
      session.log(
        `Craft request rejected recipeId=${recipeId} subcmd=0x${subcmd.toString(16)} ingredient=${ingredient.templateId} qty=${ingredient.quantity} reason=missing-material`
      );
      return true;
    }
  }

  const dryRunResult = simulateCraftExecution(session, recipe);
  if (!dryRunResult.ok) {
    session.sendGameDialogue('Crafting', dryRunResult.reason);
    session.log(
      `Craft request rejected recipeId=${recipeId} subcmd=0x${subcmd.toString(16)} reason=${dryRunResult.logReason}`
    );
    return true;
  }

  for (const ingredient of recipe.ingredients) {
    const consumeResult = consumeItemFromBag(session, ingredient.templateId, ingredient.quantity);
    if (!consumeResult.ok) {
      session.sendGameDialogue('Crafting', 'The materials could not be consumed right now.');
      session.log(
        `Craft request failed recipeId=${recipeId} ingredient=${ingredient.templateId} qty=${ingredient.quantity} reason=${consumeResult.reason || 'consume-failed'}`
      );
      return true;
    }
  }

  for (const output of recipe.outputs) {
    const grantResult = grantItemToBag(session, output.templateId, output.quantity);
    if (!grantResult.ok) {
      session.sendGameDialogue('Crafting', 'The crafted item could not be added to your pack.');
      session.log(
        `Craft request failed recipeId=${recipeId} output=${output.templateId} qty=${output.quantity} reason=${grantResult.reason || 'grant-failed'}`
      );
      return true;
    }
  }

  syncInventoryStateToClient(session);
  await session.persistCurrentCharacter();
  session.sendGameDialogue('Crafting', `Created ${formatCraftList(recipe.outputs)}.`);
  session.log(
    `Craft request ok recipeId=${recipeId} subcmd=0x${subcmd.toString(16)} skillId=${recipe.requiredSkillId} skillLevel=${currentSkillLevel} consumed=${formatCraftList(recipe.ingredients)} produced=${formatCraftList(recipe.outputs)}`
  );
  return true;
}

function resolveCraftRecipeGroup(recipeId: number): CraftRecipeGroup | null {
  const rows = getComposeRecipeEntries(recipeId)
    .filter((entry) => Number.isInteger(entry?.recipeId))
    .map((entry) => entry as CraftRecipeEntry);
  if (rows.length <= 0) {
    return null;
  }

  const first = rows[0];
  const outputs = new Map<number, number>();
  const ingredients = new Map<number, number>();
  for (const row of rows) {
    // The client combinitem table stores outputs in material* columns and inputs in target* columns.
    if (Number.isInteger(row.materialTemplateId) && Number.isInteger(row.materialQuantity) && row.materialQuantity > 0) {
      const normalizedOutputQuantity = normalizeCraftOutputQuantity(row);
      outputs.set(
        row.materialTemplateId >>> 0,
        (outputs.get(row.materialTemplateId >>> 0) || 0) + normalizedOutputQuantity
      );
    }
    if (Number.isInteger(row.targetTemplateId) && Number.isInteger(row.targetQuantity) && row.targetQuantity > 0) {
      ingredients.set(
        row.targetTemplateId >>> 0,
        (ingredients.get(row.targetTemplateId >>> 0) || 0) + (row.targetQuantity >>> 0)
      );
    }
  }

  return {
    recipeId: recipeId >>> 0,
    requiredSkillId: Number.isInteger(first.stationTemplateId) ? (first.stationTemplateId >>> 0) : 0,
    requiredSkillLevel: Math.max(1, Number.isInteger(first.stationQuantity) ? (first.stationQuantity >>> 0) : 1),
    outputs: Array.from(outputs.entries()).map(([templateId, quantity]) => ({ templateId, quantity })),
    ingredients: Array.from(ingredients.entries()).map(([templateId, quantity]) => ({ templateId, quantity })),
  };
}

function normalizeCraftOutputQuantity(row: CraftRecipeEntry): number {
  if ((row.recipeId >>> 0) === 4001 && (row.materialTemplateId >>> 0) === 29131) {
    // Iron refining is 20 Iron Ore -> 1 Iron in-game; the extracted table overstates this row as x2.
    return 1;
  }
  return row.materialQuantity >>> 0;
}

function simulateCraftExecution(
  session: GameSession,
  recipe: CraftRecipeGroup
): { ok: true } | { ok: false; reason: string; logReason: string } {
  const simulation = {
    bagItems: cloneBagItems(session.bagItems),
    bagSize: session.bagSize,
    nextItemInstanceId: session.nextItemInstanceId,
    nextBagSlot: session.nextBagSlot,
  };

  for (const ingredient of recipe.ingredients) {
    const consumeResult = consumeItemFromBag(simulation as any, ingredient.templateId, ingredient.quantity);
    if (!consumeResult.ok) {
      return {
        ok: false,
        reason: 'The materials changed before crafting could start.',
        logReason: `simulate-consume:${consumeResult.reason || ingredient.templateId}`,
      };
    }
  }

  for (const output of recipe.outputs) {
    const grantResult = grantItemToBag(simulation as any, output.templateId, output.quantity);
    if (!grantResult.ok) {
      return {
        ok: false,
        reason: 'Your pack does not have enough room for the crafted items.',
        logReason: `simulate-grant:${grantResult.reason || output.templateId}`,
      };
    }
  }

  return { ok: true };
}

function cloneBagItems(items: unknown): any[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => ({
    ...item,
    attributePairs: Array.isArray(item?.attributePairs)
      ? item.attributePairs.map((pair: Record<string, unknown>) => ({ ...pair }))
      : item?.attributePairs,
  }));
}

function resolveItemName(templateId: number): string {
  return getItemDefinition(templateId)?.name || `item ${templateId}`;
}

function resolveSkillName(skillId: number): string {
  if ((skillId >>> 0) === 9006) {
    return 'Mining';
  }
  if ((skillId >>> 0) === 9007) {
    return 'Lumbering';
  }
  if ((skillId >>> 0) === 9008) {
    return 'Herbalism';
  }
  if ((skillId >>> 0) === 9009) {
    return 'Fishing';
  }
  if ((skillId >>> 0) === 9001) {
    return 'Compose';
  }
  if ((skillId >>> 0) === 9002) {
    return 'Cooking';
  }
  if ((skillId >>> 0) === 9003) {
    return 'Decompose';
  }
  if ((skillId >>> 0) === 9004) {
    return 'Gem Machining';
  }
  if ((skillId >>> 0) === 9005) {
    return 'Alchemy';
  }
  return `skill ${skillId}`;
}

function formatCraftList(entries: Array<{ templateId: number; quantity: number }>): string {
  return entries
    .map((entry) => `${resolveItemName(entry.templateId)} x${entry.quantity}`)
    .join(', ');
}
