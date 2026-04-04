import type { GameSession } from '../types.js';
import type { UnknownRecord } from '../utils.js';
import type { QuestEvent } from './events.js';
import type { QuestDef, QuestEffectDef, StepDef } from './schema.js';

import { applyEffects } from '../effects/effect-executor.js';
import { consumeBagItemByInstanceId } from '../inventory/index.js';
import { getMapEncounterLevelRange, getMapSummary } from '../map-data.js';
import { createOwnedPet } from '../pet-runtime.js';
import { buildEncounterPoolEntry } from '../roleinfo/index.js';
import { sanitizeQuestDialogueText } from '../utils.js';
import { sendConsumeResultPackets } from '../gameplay/inventory-runtime.js';
import { questService } from './service.js';

type QuestRuntimeDispatchResult = {
  handled: boolean;
  changed: boolean;
  transitionCount: number;
  grantedItems: Array<{ templateId: number; quantity: number }>;
};

function dispatchQuestEventToSession(
  session: GameSession,
  event: QuestEvent
): QuestRuntimeDispatchResult {
  const result = questService.dispatch(session.questStateV2, event, {
    now: Date.now(),
    level: session.level,
    mapId: session.currentMapId,
    inventoryCounts: buildInventoryCounts(session),
    capturedMonsterCounts: buildCapturedMonsterCounts(session),
  });

  if (!result.changed && result.effects.length < 1 && result.transitions.length < 1) {
    return {
      handled: false,
      changed: false,
      transitionCount: 0,
      grantedItems: [],
    };
  }

  session.questStateV2 = result.state;

  const effectResult = applyQuest2Effects(session, result.effects);
  emitQuestTransitionDialogues(session, result.transitions);

  if (result.changed || effectResult.inventoryDirty || effectResult.statsDirty || effectResult.petsDirty) {
    session.syncQuestStateToClient({ mode: 'runtime' });
    session.persistCurrentCharacter();
  }

  return {
    handled: true,
    changed: result.changed,
    transitionCount: result.transitions.length,
    grantedItems: collectGrantedItems(result.effects),
  };
}

function buildInventoryCounts(session: GameSession): Record<number, number> {
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

function buildCapturedMonsterCounts(session: GameSession): Record<number, number> {
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

function collectGrantedItems(effects: QuestEffectDef[]): Array<{ templateId: number; quantity: number }> {
  return effects
    .filter((effect): effect is Extract<QuestEffectDef, { kind: 'grant_item' }> => effect.kind === 'grant_item')
    .map((effect) => ({
      templateId: effect.item.templateId >>> 0,
      quantity: Math.max(1, effect.item.quantity),
    }))
    .filter((item) => item.templateId > 0);
}

function applyQuest2Effects(
  session: GameSession,
  effects: QuestEffectDef[]
): { inventoryDirty: boolean; statsDirty: boolean; petsDirty: boolean } {
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
        const alreadyOwned = session.pets.some(
          (pet: Record<string, unknown>) =>
            Number.isInteger(pet?.templateId) && ((pet.templateId as number) >>> 0) === (effect.petTemplateId >>> 0)
        );
        if (alreadyOwned) {
          break;
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

  const effectResult = applyEffects(session, mappedEffects, {
    suppressPersist: true,
  });
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
  session: GameSession,
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

function triggerQuestCombat(session: GameSession, monsterId: number, count: number): void {
  if (typeof session.sendCombatEncounterProbe !== 'function' || session.combatState?.active) {
    return;
  }

  const encounterLevelRange = getMapEncounterLevelRange(session.currentMapId);
  const mapName = getMapSummary(session.currentMapId)?.mapName || `Map ${session.currentMapId}`;
  const enemyCount = Math.max(1, count);

  session.sendCombatEncounterProbe({
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
  session: GameSession,
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
