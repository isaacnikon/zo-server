import type { GameSession, SessionPorts } from '../types.js';
import type { UnknownRecord } from '../utils.js';
import type { QuestEvent } from './events.js';
import type { QuestDef, QuestEffectDef, RequirementDef, StepDef, StepReactionDef } from './schema.js';
import type { QuestInstance } from './state.js';

import { applyEffects } from '../effects/effect-executor.js';
import { consumeBagItemByInstanceId, consumeItemFromBag, getBagQuantityByTemplateId } from '../inventory/index.js';
import { getMapEncounterLevelRange, getMapSummary } from '../map-data.js';
import { createOwnedPet } from '../pet-runtime.js';
import { buildEncounterPoolEntry } from '../roleinfo/index.js';
import { sanitizeQuestDialogueText } from '../utils.js';
import { sendConsumeResultPackets } from '../gameplay/inventory-runtime.js';
import { startCombatEncounter } from '../gameplay/combat-service.js';
import { questService } from './service.js';

type QuestRuntimeDispatchResult = {
  handled: boolean;
  changed: boolean;
  transitionCount: number;
  grantedItems: Array<{ templateId: number; quantity: number }>;
  persistNeeded: boolean;
};

async function dispatchQuestEventToSession(
  session: SessionPorts,
  event: QuestEvent
): Promise<QuestRuntimeDispatchResult> {
  const abandonedQuestId = event.type === 'quest_abandon' ? (event.questId >>> 0) : 0;
  const abandonedInstance =
    abandonedQuestId > 0
      ? session.questStateV2.active.find((instance) => instance.questId === abandonedQuestId) || null
      : null;
  const abandonedDefinition =
    abandonedInstance && abandonedQuestId > 0
      ? questService.getDefinition(abandonedQuestId)
      : null;
  const result = questService.dispatch(session.questStateV2, event, {
    now: Date.now(),
    level: session.level,
    mapId: session.currentMapId,
    selectedAptitude: session.selectedAptitude,
    inventoryCounts: buildInventoryCounts(session),
    capturedMonsterCounts: buildCapturedMonsterCounts(session),
  });

  if (!result.changed && result.effects.length < 1 && result.transitions.length < 1) {
    return {
      handled: false,
      changed: false,
      transitionCount: 0,
      grantedItems: [],
      persistNeeded: false,
    };
  }

  session.questStateV2 = result.state;

  const effectResult = await applyQuest2Effects(session, result.effects);
  const abandonCleanupResult =
    event.type === 'quest_abandon' && abandonedDefinition && abandonedInstance
      ? cleanupQuestAbortItems(session, abandonedDefinition, abandonedInstance)
      : { inventoryDirty: false, cleanedTemplateIds: [] as number[] };
  emitQuestTransitionDialogues(session, result.transitions);

  if (abandonCleanupResult.cleanedTemplateIds.length > 0) {
    session.refreshQuestStateForItemTemplates(abandonCleanupResult.cleanedTemplateIds);
  }

  const persistNeeded =
    result.changed ||
    effectResult.inventoryDirty ||
    effectResult.statsDirty ||
    effectResult.petsDirty ||
    abandonCleanupResult.inventoryDirty;

  if (persistNeeded) {
    session.syncQuestStateToClient({ mode: 'quest' });
  }

  return {
    handled: true,
    changed: result.changed,
    transitionCount: result.transitions.length,
    grantedItems: collectGrantedItems(result.effects),
    persistNeeded,
  };
}

function buildInventoryCounts(session: SessionPorts): Record<number, number> {
  const counts: Record<number, number> = {};
  const bagItems = Array.isArray(session.bagItems) ? session.bagItems : [];
  for (const item of bagItems) {
    const templateId =
      Number.isInteger(item?.templateId) && item.templateId > 0
        ? (item.templateId >>> 0)
        : 0;
    if (templateId <= 0 || item?.equipped === true) {
      continue;
    }
    const quantity = Math.max(1, Number.isInteger(item?.quantity) ? item.quantity : 1);
    counts[templateId] = (counts[templateId] || 0) + quantity;
  }
  return counts;
}

function buildCapturedMonsterCounts(session: SessionPorts): Record<number, number> {
  const counts: Record<number, number> = {};
  const bagItems = Array.isArray(session.bagItems) ? session.bagItems : [];
  for (const item of bagItems) {
    if (item?.equipped === true) {
      continue;
    }
    const capturedMonsterId = Number.isInteger(item?.attributePairs?.[0]?.value)
      ? (item.attributePairs[0].value >>> 0)
      : (Number.isInteger(item?.extraValue) ? (item.extraValue >>> 0) : 0);
    if (capturedMonsterId <= 0) {
      continue;
    }
    const quantity = Math.max(1, Number.isInteger(item?.quantity) ? item.quantity : 1);
    counts[capturedMonsterId] = (counts[capturedMonsterId] || 0) + quantity;
  }
  return counts;
}

function cleanupQuestAbortItems(
  session: SessionPorts,
  definition: QuestDef,
  instance: QuestInstance
): { inventoryDirty: boolean; cleanedTemplateIds: number[] } {
  const cleanupQuantities = collectQuestAbortCleanupQuantities(definition, instance);
  const cleanedTemplateIds: number[] = [];
  let inventoryDirty = false;

  for (const [templateId, maxQuantity] of cleanupQuantities.entries()) {
    const bagQuantity = Math.max(0, getBagQuantityByTemplateId(session, templateId));
    const cleanupQuantity = Math.min(Math.max(1, maxQuantity), bagQuantity);
    if (cleanupQuantity <= 0) {
      continue;
    }

    const consumeResult = consumeItemFromBag(session, templateId, cleanupQuantity);
    if (!consumeResult.ok) {
      continue;
    }

    sendConsumeResultPackets(session, consumeResult);
    inventoryDirty = true;
    cleanedTemplateIds.push(templateId);
    session.log(
      `Quest abort cleanup questId=${definition.id} templateId=${templateId} quantity=${cleanupQuantity}`
    );
  }

  return {
    inventoryDirty,
    cleanedTemplateIds,
  };
}

function collectQuestAbortCleanupQuantities(
  definition: QuestDef,
  instance: QuestInstance
): Map<number, number> {
  const referencedTemplateIds = collectQuestReferencedItemTemplateIds(definition);
  if (referencedTemplateIds.size < 1) {
    return new Map<number, number>();
  }

  const currentStepIndex = definition.steps.findIndex((step) => step.id === instance.stepId);
  if (currentStepIndex < 0) {
    return new Map<number, number>();
  }

  const issuedTemplateQuantities = new Map<number, number>();
  accumulateGrantedItemQuantities(issuedTemplateQuantities, definition.accept.effects);

  for (let index = 0; index < currentStepIndex; index += 1) {
    const step = definition.steps[index];
    if (!step) {
      continue;
    }
    accumulateGrantedItemQuantities(issuedTemplateQuantities, step.eventEffects || []);
    accumulateGrantedItemQuantities(issuedTemplateQuantities, step.effects);
    for (const reaction of step.reactions || []) {
      accumulateGrantedItemQuantities(issuedTemplateQuantities, reaction.effects);
    }
  }

  const currentStep = definition.steps[currentStepIndex];
  if (currentStep) {
    if (didCurrentStepTriggerGrantItems(instance, currentStep)) {
      accumulateGrantedItemQuantities(issuedTemplateQuantities, currentStep.eventEffects || []);
    }
    for (const reaction of currentStep.reactions || []) {
      if (didCurrentStepReactionGrantItems(instance, reaction)) {
        accumulateGrantedItemQuantities(issuedTemplateQuantities, reaction.effects);
      }
    }
  }

  return new Map(
    [...issuedTemplateQuantities.entries()].filter(
      ([templateId, quantity]) => referencedTemplateIds.has(templateId) && quantity > 0
    )
  );
}

function collectQuestReferencedItemTemplateIds(definition: QuestDef): Set<number> {
  const templateIds = new Set<number>();

  for (const step of definition.steps) {
    collectItemTemplateIdsFromRequirements(step.requirements).forEach((templateId) => {
      templateIds.add(templateId);
    });
    collectItemTemplateIdsFromEffects(step.eventEffects || []).forEach((templateId) => {
      templateIds.add(templateId);
    });
    collectItemTemplateIdsFromEffects(step.effects).forEach((templateId) => {
      templateIds.add(templateId);
    });
    for (const reaction of step.reactions || []) {
      collectItemTemplateIdsFromRequirements(reaction.requirements).forEach((templateId) => {
        templateIds.add(templateId);
      });
      collectItemTemplateIdsFromEffects(reaction.effects).forEach((templateId) => {
        templateIds.add(templateId);
      });
    }
  }

  return templateIds;
}

function collectItemTemplateIdsFromRequirements(requirements: RequirementDef[]): number[] {
  return requirements
    .filter(
      (requirement): requirement is Extract<RequirementDef, { kind: 'item_is' | 'item_count_at_least' }> =>
        requirement.kind === 'item_is' || requirement.kind === 'item_count_at_least'
    )
    .map((requirement) => requirement.templateId >>> 0)
    .filter((templateId) => templateId > 0);
}

function collectItemTemplateIdsFromEffects(effects: QuestEffectDef[]): number[] {
  return effects
    .filter((effect): effect is Extract<QuestEffectDef, { kind: 'remove_item' }> => effect.kind === 'remove_item')
    .map((effect) => effect.item.templateId >>> 0)
    .filter((templateId) => templateId > 0);
}

function accumulateGrantedItemQuantities(
  quantities: Map<number, number>,
  effects: QuestEffectDef[]
): void {
  for (const effect of effects) {
    if (effect.kind !== 'grant_item') {
      continue;
    }
    const templateId = effect.item.templateId >>> 0;
    if (templateId <= 0) {
      continue;
    }
    quantities.set(templateId, (quantities.get(templateId) || 0) + Math.max(1, effect.item.quantity));
  }
}

function didCurrentStepTriggerGrantItems(instance: QuestInstance, step: StepDef): boolean {
  if (!step.progress) {
    return false;
  }
  return Math.max(0, Number(instance.counters?.[step.progress.counter] || 0)) > 0;
}

function didCurrentStepReactionGrantItems(
  instance: QuestInstance,
  reaction: StepReactionDef
): boolean {
  if (!reaction.effects.some((effect) => effect.kind === 'grant_item')) {
    return false;
  }

  let matched = false;

  for (const effect of reaction.effects) {
    switch (effect.kind) {
      case 'set_flag':
        matched = true;
        if (instance.flags?.[effect.flag] !== (effect.value !== false)) {
          return false;
        }
        break;
      case 'increment_counter':
        matched = true;
        if ((instance.counters?.[effect.counter] || 0) < Math.max(1, effect.amount || 1)) {
          return false;
        }
        break;
      case 'select_reward_choice':
        matched = true;
        if ((instance.selectedRewardChoiceId || 0) !== (effect.rewardChoiceId >>> 0)) {
          return false;
        }
        break;
      default:
        break;
    }
  }

  return matched;
}

function collectGrantedItems(effects: QuestEffectDef[]): Array<{ templateId: number; quantity: number }> {
  return effects
    .filter((effect): effect is Extract<QuestEffectDef, { kind: 'grant_item' }> => effect.kind === 'grant_item')
    .map((effect) => ({
      templateId: effect.item.templateId >>> 0,
      quantity: Math.max(1, effect.item.quantity),
    }))
    .filter((item) => item.templateId > 0);
}

async function applyQuest2Effects(
  session: SessionPorts,
  effects: QuestEffectDef[]
): Promise<{ inventoryDirty: boolean; statsDirty: boolean; petsDirty: boolean }> {
  const mappedEffects: UnknownRecord[] = [];
  let petsDirty = false;
  let inventoryDirty = false;

  for (const effect of effects) {
    switch (effect.kind) {
      case 'grant_item':
        mappedEffects.push({
          kind: 'grant-item',
          templateId: effect.item.templateId,
          quantity: effect.item.quantity,
          idempotent: effect.idempotent === true,
          dialoguePrefix: 'Quest',
          itemName: effect.item.name,
          successMessage: `${effect.item.name || 'Quest item'} was added to your pack.`,
        });
        break;
      case 'remove_item':
        mappedEffects.push({
          kind: 'remove-item',
          templateId: effect.item.templateId,
          quantity: effect.item.quantity,
          dialoguePrefix: 'Quest',
          itemName: effect.item.name,
          successMessage: `${effect.item.name || 'Quest item'} was handed over.`,
          failureMessage: `${effect.item.name || 'Quest item'} is required to continue.`,
        });
        break;
      case 'remove_captured_monster_item': {
        const consumeResult = consumeCapturedMonsterItem(session, effect.monsterId, effect.quantity, effect.templateId);
        if (!consumeResult.ok) {
          session.sendGameDialogue(
            'Quest',
            `${effect.name || 'Captured monster'} is required to continue.`
          );
          break;
        }
        sendConsumeResultPackets(session, consumeResult);
        inventoryDirty = true;
        session.sendGameDialogue(
          'Quest',
          `${effect.name || 'Captured monster'} was handed over.`
        );
        break;
      }
      case 'update_stat':
        mappedEffects.push({
          kind: 'update-stat',
          stat: effect.stat,
          delta: effect.delta,
        });
        break;
      case 'show_dialogue':
        mappedEffects.push({
          kind: 'dialogue',
          title: effect.title,
          message: sanitizeQuestDialogueText(effect.message),
        });
        break;
      case 'grant_pet': {
        if (!Array.isArray(session.pets)) {
          session.pets = [];
        }
        const pet = createOwnedPet(effect.petTemplateId >>> 0, {}, session.pets.length);
        if (!pet) {
          break;
        }
        session.pets.push(pet);
        petsDirty = true;
        break;
      }
      case 'start_combat':
        triggerQuestCombat(session, effect.monsterId, effect.count || 1);
        break;
      default:
        break;
    }
  }

  const effectResult = await applyEffects(session, mappedEffects, {});
  if (petsDirty) {
    session.sendPetStateSync('quest2-effect');
  }

  return {
    inventoryDirty: inventoryDirty || effectResult.inventoryDirty === true,
    statsDirty: effectResult.statsDirty === true,
    petsDirty,
  };
}

function consumeCapturedMonsterItem(
  session: SessionPorts,
  monsterId: number,
  quantity: number,
  templateId?: number
): UnknownRecord {
  const bagItems = Array.isArray(session.bagItems) ? session.bagItems : [];
  const requiredTemplateId = typeof templateId === 'number' && Number.isInteger(templateId) ? (templateId >>> 0) : 0;
  const matchingItems = bagItems
    .filter((item: Record<string, unknown>) => {
      if (item?.equipped === true) {
        return false;
      }
      const capturedMonsterId = resolveCapturedMonsterId(item);
      if (capturedMonsterId !== (monsterId >>> 0)) {
        return false;
      }
      const itemTemplateId = Number.isInteger(item?.templateId) ? (Number(item.templateId) >>> 0) : 0;
      return requiredTemplateId <= 0 || itemTemplateId === requiredTemplateId;
    })
    .sort((left: Record<string, unknown>, right: Record<string, unknown>) => ((left.slot as number) >>> 0) - ((right.slot as number) >>> 0));

  let remainingQuantity = Math.max(1, quantity | 0);
  const changes: UnknownRecord[] = [];
  const removedItems: UnknownRecord[] = [];

  for (const item of matchingItems) {
    if (remainingQuantity <= 0) {
      break;
    }
    const itemQuantity = Math.max(1, Number(item.quantity || 1));
    const consumeResult = consumeBagItemByInstanceId(
      session,
      Number(item.instanceId || 0) >>> 0,
      Math.min(itemQuantity, remainingQuantity)
    );
    if (!consumeResult.ok) {
      return consumeResult;
    }
    remainingQuantity -= Math.min(itemQuantity, remainingQuantity);
    changes.push(...(Array.isArray(consumeResult.changes) ? consumeResult.changes : []));
    removedItems.push(...(Array.isArray(consumeResult.removedItems) ? consumeResult.removedItems : []));
  }

  if (remainingQuantity > 0) {
    return {
      ok: false,
      reason: `Missing captured monster ${monsterId}`,
    };
  }

  return {
    ok: true,
    item: changes[changes.length - 1]?.item || null,
    removed: removedItems.length > 0,
    changes,
    removedItems,
  };
}

function resolveCapturedMonsterId(item: Record<string, unknown>): number {
  const attributePairs = Array.isArray(item.attributePairs)
    ? (item.attributePairs as Array<Record<string, unknown>>)
    : [];
  const firstPairValue = attributePairs[0]?.value;
  if (Number.isInteger(firstPairValue)) {
    return (Number(firstPairValue) >>> 0);
  }
  return Number.isInteger(item.extraValue) ? (Number(item.extraValue) >>> 0) : 0;
}

function triggerQuestCombat(session: SessionPorts, monsterId: number, count: number): void {
  if (session.combatState?.active) {
    return;
  }

  const encounterLevelRange = getMapEncounterLevelRange(session.currentMapId);
  const mapName = getMapSummary(session.currentMapId)?.mapName || `Map ${session.currentMapId}`;
  const enemyCount = Math.max(1, count);

  startCombatEncounter(session, {
    probeId: `quest2:${monsterId}:${enemyCount}:${Date.now()}`,
    encounterProfile: {
      minEnemies: enemyCount,
      maxEnemies: enemyCount,
      locationName: mapName,
      pool: [
        buildEncounterPoolEntry(monsterId >>> 0, {
          levelMin: encounterLevelRange?.min || 1,
          levelMax: encounterLevelRange?.max || encounterLevelRange?.min || 1,
          weight: 1,
        }),
      ],
    },
  });
}

function emitQuestTransitionDialogues(
  session: SessionPorts,
  transitions: Array<{ type: string; questId: number; [key: string]: unknown }>
): void {
  for (const transition of transitions) {
    const definition = questService.getDefinition(transition.questId);
    if (!definition) {
      continue;
    }

    switch (transition.type) {
      case 'quest_accepted': {
        const acceptedStep = getStep(definition, String(transition.stepId || ''));
        session.sendGameDialogue(
          'Quest',
          buildQuestTransitionMessage(
            `${definition.name} accepted.`,
            acceptedStep ? `Objective: ${formatStepSummary(acceptedStep)}.` : ''
          )
        );
        break;
      }
      case 'quest_progressed':
        session.sendGameDialogue(
          'Quest',
          buildQuestTransitionMessage(
            `${definition.name} updated.`,
            `${Number(transition.value || 0)}/${Number(transition.target || 0)} complete.`
          )
        );
        break;
      case 'quest_advanced': {
        const nextStep = getStep(definition, String(transition.toStepId || ''));
        session.sendGameDialogue(
          'Quest',
          buildQuestTransitionMessage(
            `${definition.name} advanced.`,
            nextStep ? `Objective: ${formatStepSummary(nextStep)}.` : ''
          )
        );
        break;
      }
      case 'quest_completed':
        session.sendGameDialogue(
          'Quest',
          buildQuestTransitionMessage(`${definition.name} completed.`, '')
        );
        break;
      case 'quest_abandoned':
        session.sendGameDialogue(
          'Quest',
          buildQuestTransitionMessage(`${definition.name} abandoned.`, '')
        );
        break;
      default:
        break;
    }
  }
}

function buildQuestTransitionMessage(primary: string, secondary: string): string {
  return sanitizeQuestDialogueText(`${primary} ${secondary}`.trim());
}

function getStep(definition: QuestDef, stepId: string): StepDef | null {
  return definition.steps.find((step) => step.id === stepId) || null;
}

function formatStepSummary(step: StepDef): string {
  switch (step.kind) {
    case 'talk':
      return 'Talk to the target NPC';
    case 'kill':
      return 'Defeat the required monsters';
    case 'collect':
      return 'Collect the required items';
    case 'turn_in':
      return 'Return to the target NPC';
    case 'trigger_combat':
      return 'Trigger the encounter';
    case 'escort':
      return 'Escort the target';
    default:
      return `Complete ${step.id}`;
  }
}

export {
  dispatchQuestEventToSession,
};
