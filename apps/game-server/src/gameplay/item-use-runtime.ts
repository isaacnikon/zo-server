import { consumeBagItemByInstanceId, getBagItemByReference, getItemDefinition, } from '../inventory/index.js';
import { sendConsumeResultPackets } from './inventory-runtime.js';
import { learnSkillFromBook, sendSkillStateSync } from './skill-runtime.js';
import { recomputeSessionMaxVitals, resolveTownRespawn } from './session-flows.js';
import { resolvePetMaxVitals } from './max-vitals.js';
import { sendSelfStateVitalsUpdate } from './stat-sync.js';
import type { UnknownRecord } from '../utils.js';
import type { GameSession } from '../types.js';

const PORTAL_STONE_TEMPLATE_IDS = new Set([26009, 26143]);
const FIELD_COMBAT_WARD_AMULET_TEMPLATE_ID = 26039;
const FIELD_COMBAT_WARD_DURATION_MS = 20 * 60 * 1000;

export async function consumeUsableItemByInstanceId(
  session: GameSession,
  instanceId: number,
  options: UnknownRecord = {}
): Promise<UnknownRecord> {
  const bagItem = getBagItemByReference(session, instanceId);
  if (!bagItem) {
    return {
      ok: false,
      reason: `Unknown instanceId=${instanceId}`,
    };
  }

  const definition = getItemDefinition(bagItem.templateId);
  if (PORTAL_STONE_TEMPLATE_IDS.has(bagItem.templateId >>> 0)) {
    return await consumePortalStone(session, bagItem, definition, options);
  }
  if ((bagItem.templateId >>> 0) === FIELD_COMBAT_WARD_AMULET_TEMPLATE_ID) {
    return await consumeFieldCombatWardAmulet(session, bagItem, definition, options);
  }
  const effect = definition?.consumableEffect;
  if (!effect || (!effect.health && !effect.mana && !effect.rage)) {
    const learnResult = learnSkillFromBook(session, bagItem);
    if (learnResult.ok) {
      const consumeResult = consumeBagItemByInstanceId(session, bagItem.instanceId >>> 0, 1);
      if (!consumeResult.ok) {
        return {
          ok: false,
          reason: consumeResult.reason || `Failed to consume skill book instanceId=${instanceId}`,
          item: bagItem,
          definition,
          learnedSkill: learnResult.learnedSkill,
        };
      }

      if (options.suppressInventoryPackets !== true) {
        sendConsumeResultPackets(session, consumeResult);
      }
      sendSkillStateSync(session, 'learn-skill');
      if (typeof session.sendGameDialogue === 'function') {
        const hotbarSuffix =
          Number.isInteger(learnResult.autoAssignedHotbarSlot) && learnResult.autoAssignedHotbarSlot >= 0
            ? ` Added to hotbar slot ${learnResult.autoAssignedHotbarSlot + 1}.`
            : '';
        session.sendGameDialogue('Skill', `Learned ${learnResult.learnedSkill?.name || 'a skill'}.${hotbarSuffix}`);
      }
      if (options.suppressPersist !== true && typeof session.persistCurrentCharacter === 'function') {
        await session.persistCurrentCharacter();
      }
      return {
        ok: true,
        item: bagItem,
        definition,
        consumeResult,
        learnedSkill: learnResult.learnedSkill,
        useKind: 'skill-book',
        gained: {
          health: 0,
          mana: 0,
          rage: 0,
        },
      };
    }
    if (learnResult.skillBook) {
      if (typeof session.sendGameDialogue === 'function') {
        session.sendGameDialogue('Skill', learnResult.reason || `Could not learn ${learnResult.skillBook.name || 'that skill'}.`);
      }
      if (typeof session.log === 'function') {
        session.log(
          `Skill book learn rejected templateId=${bagItem.templateId >>> 0} skillId=${learnResult.skillBook.skillId >>> 0} reason=${learnResult.reason || 'unknown'}`
        );
      }
      return {
        ok: false,
        reason: learnResult.reason || `Skill book templateId=${bagItem.templateId} could not be learned`,
        item: bagItem,
        definition,
      };
    }
  }
  if (!effect || (!effect.health && !effect.mana && !effect.rage)) {
    return {
      ok: false,
      reason: `Item templateId=${bagItem.templateId} is not usable`,
      item: bagItem,
      definition,
    };
  }

  const target = resolveItemUseTarget(session, options.targetEntityId);
  if (!target) {
    return {
      ok: false,
      reason: options.targetEntityId ? `Unknown targetEntityId=${options.targetEntityId}` : 'Unknown item-use target',
      item: bagItem,
      definition,
    };
  }

  const previousVitals = target.getVitals();
  const nextVitals = target.applyEffect(effect);
  const gained = {
    health: Math.max(0, nextVitals.health - previousVitals.health),
    mana: Math.max(0, nextVitals.mana - previousVitals.mana),
    rage: Math.max(0, nextVitals.rage - previousVitals.rage),
  };

  const consumeResult = consumeBagItemByInstanceId(session, bagItem.instanceId >>> 0, 1);
  if (!consumeResult.ok) {
    return {
      ok: false,
      reason: consumeResult.reason || `Failed to consume instanceId=${instanceId}`,
      item: bagItem,
      definition,
    };
  }

  if (options.suppressInventoryPackets !== true) {
    sendConsumeResultPackets(session, consumeResult);
  }
  if (gained.health > 0 || gained.mana > 0 || gained.rage > 0) {
    target.sync(options);
  }
  if (options.suppressPersist !== true && typeof session.persistCurrentCharacter === 'function') {
    await session.persistCurrentCharacter();
  }
  if (
    typeof session.refreshQuestStateForItemTemplates === 'function' &&
    Number.isInteger(bagItem?.templateId)
  ) {
    await session.refreshQuestStateForItemTemplates([bagItem.templateId >>> 0]);
  }

  return {
    ok: true,
    item: bagItem,
    definition,
    consumeResult,
    targetKind: target.kind,
    targetEntityId: target.entityId,
    petSyncNeeded: target.petSyncNeeded || false,
    previousVitals,
    nextVitals,
    gained,
  };
}

async function consumeFieldCombatWardAmulet(
  session: GameSession,
  bagItem: UnknownRecord,
  definition: UnknownRecord | null,
  options: UnknownRecord
): Promise<UnknownRecord> {
  const consumeResult = consumeBagItemByInstanceId(session, bagItem.instanceId >>> 0, 1);
  if (!consumeResult.ok) {
    return {
      ok: false,
      reason: consumeResult.reason || `Failed to consume instanceId=${bagItem.instanceId >>> 0}`,
      item: bagItem,
      definition,
    };
  }

  const suppressionUntil = Date.now() + FIELD_COMBAT_WARD_DURATION_MS;
  session.fieldCombatCooldownUntil = Math.max(session.fieldCombatCooldownUntil || 0, suppressionUntil);

  if (options.suppressInventoryPackets !== true) {
    sendConsumeResultPackets(session, consumeResult);
  }
  if (typeof session.sendGameDialogue === 'function') {
    session.sendGameDialogue('Item', 'Amulet used. Field combats are suppressed for 20 minutes.');
  }
  if (typeof session.log === 'function') {
    session.log(
      `Field-combat ward activated templateId=${bagItem.templateId >>> 0} instanceId=${bagItem.instanceId >>> 0} durationMs=${FIELD_COMBAT_WARD_DURATION_MS} until=${session.fieldCombatCooldownUntil}`
    );
  }
  if (options.suppressPersist !== true && typeof session.persistCurrentCharacter === 'function') {
    await session.persistCurrentCharacter();
  }
  if (
    typeof session.refreshQuestStateForItemTemplates === 'function' &&
    Number.isInteger(bagItem?.templateId)
  ) {
    await session.refreshQuestStateForItemTemplates([bagItem.templateId >>> 0]);
  }

  return {
    ok: true,
    item: bagItem,
    definition,
    consumeResult,
    useKind: 'field-combat-ward',
    suppressionUntil,
    gained: {
      health: 0,
      mana: 0,
      rage: 0,
    },
  };
}

async function consumePortalStone(
  session: GameSession,
  bagItem: UnknownRecord,
  definition: UnknownRecord | null,
  options: UnknownRecord
): Promise<UnknownRecord> {
  if (isSessionInTeam(session)) {
    if (typeof session.sendGameDialogue === 'function') {
      session.sendGameDialogue('Portal Stone', 'You cannot use Portal Stone while in a team.');
    }
    return {
      ok: false,
      reason: 'Portal Stone cannot be used while in a team',
      item: bagItem,
      definition,
    };
  }

  if (typeof session.sendSceneEnter !== 'function') {
    return {
      ok: false,
      reason: 'Portal Stone teleport is unavailable',
      item: bagItem,
      definition,
    };
  }

  const destination = resolveTownRespawn({
    persistedCharacter: session.getPersistedCharacter?.() || null,
    currentMapId: session.currentMapId,
    currentX: session.currentX,
    currentY: session.currentY,
  });

  const consumeResult = consumeBagItemByInstanceId(session, bagItem.instanceId >>> 0, 1);
  if (!consumeResult.ok) {
    return {
      ok: false,
      reason: consumeResult.reason || `Failed to consume instanceId=${bagItem.instanceId >>> 0}`,
      item: bagItem,
      definition,
    };
  }

  if (options.suppressInventoryPackets !== true) {
    sendConsumeResultPackets(session, consumeResult);
  }
  session.sendSceneEnter(destination.mapId >>> 0, destination.x >>> 0, destination.y >>> 0);
  if (options.suppressPersist !== true && typeof session.persistCurrentCharacter === 'function') {
    await session.persistCurrentCharacter();
  }
  if (
    typeof session.refreshQuestStateForItemTemplates === 'function' &&
    Number.isInteger(bagItem?.templateId)
  ) {
    await session.refreshQuestStateForItemTemplates([bagItem.templateId >>> 0]);
  }

  return {
    ok: true,
    item: bagItem,
    definition,
    consumeResult,
    useKind: 'portal-stone',
    destination,
    gained: {
      health: 0,
      mana: 0,
      rage: 0,
    },
  };
}

function isSessionInTeam(session: GameSession): boolean {
  const candidateArrays = [
    (session as unknown as Record<string, unknown>)?.teamMembers,
    (session as unknown as Record<string, unknown>)?.partyMembers,
    session.sharedState?.teamMembers,
    session.sharedState?.partyMembers,
  ];
  for (const value of candidateArrays) {
    if (Array.isArray(value) && value.length > 1) {
      return true;
    }
  }

  const candidateCounts = [
    (session as unknown as Record<string, unknown>)?.teamSize,
    (session as unknown as Record<string, unknown>)?.partySize,
    session.sharedState?.teamSize,
    session.sharedState?.partySize,
  ];
  for (const value of candidateCounts) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 1) {
      return true;
    }
  }

  const candidateIds = [
    (session as unknown as Record<string, unknown>)?.teamId,
    (session as unknown as Record<string, unknown>)?.partyId,
    session.sharedState?.teamId,
    session.sharedState?.partyId,
  ];
  for (const value of candidateIds) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return true;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return true;
    }
  }

  return session.sharedState?.inTeam === true || session.sharedState?.inParty === true;
}

function resolveItemUseTarget(session: GameSession, targetEntityId: unknown): UnknownRecord | null {
  const normalizedTargetEntityId =
    typeof targetEntityId === 'number' && Number.isInteger(targetEntityId) ? targetEntityId >>> 0 : 0;
  if (normalizedTargetEntityId === 0 || normalizedTargetEntityId === (session.runtimeId >>> 0)) {
    return {
      kind: 'player',
      entityId: session.runtimeId >>> 0,
      getVitals: () => ({
        health: Math.max(0, session.currentHealth || 0),
        mana: Math.max(0, session.currentMana || 0),
        rage: Math.max(0, session.currentRage || 0),
      }),
      applyEffect: (effect: { health: number; mana: number; rage: number }) => {
        const maxVitals = recomputeSessionMaxVitals(session);
        const previousVitals = {
          health: Math.max(0, session.currentHealth || 0),
          mana: Math.max(0, session.currentMana || 0),
          rage: Math.max(0, session.currentRage || 0),
        };
        const nextVitals = {
          health: Math.min(maxVitals.health, previousVitals.health + Math.max(0, effect.health || 0)),
          mana: Math.min(maxVitals.mana, previousVitals.mana + Math.max(0, effect.mana || 0)),
          rage: Math.min(maxVitals.rage, previousVitals.rage + Math.max(0, effect.rage || 0)),
        };
        session.currentHealth = nextVitals.health;
        session.currentMana = nextVitals.mana;
        session.currentRage = nextVitals.rage;
        return nextVitals;
      },
      sync: (options: UnknownRecord) => {
        if (options.suppressVitalSync === true) {
          return;
        }
        sendSelfStateVitalsUpdate(session, {
          health: Math.max(0, session.currentHealth || 0),
          mana: Math.max(0, session.currentMana || 0),
          rage: Math.max(0, session.currentRage || 0),
        });
      },
    };
  }

  const pet = Array.isArray(session.pets)
    ? session.pets.find((entry: UnknownRecord) => (entry?.runtimeId >>> 0) === normalizedTargetEntityId) || null
    : null;
  if (!pet) {
    return null;
  }

  const target: UnknownRecord = {
    kind: 'pet',
    entityId: pet.runtimeId >>> 0,
    petSyncNeeded: false,
    getVitals: () => ({
      health: Math.max(0, pet.currentHealth || 0),
      mana: Math.max(0, pet.currentMana || 0),
      rage: 0,
    }),
    applyEffect: (effect: { health: number; mana: number; rage: number }) => {
      const maxVitals = resolvePetMaxVitals(pet);
      const nextVitals = {
        health: Math.min(
          maxVitals.health,
          Math.max(0, (pet.currentHealth || 0) + Math.max(0, effect.health || 0))
        ),
        mana: Math.min(
          maxVitals.mana,
          Math.max(0, (pet.currentMana || 0) + Math.max(0, effect.mana || 0))
        ),
        rage: 0,
      };
      pet.currentHealth = nextVitals.health;
      pet.currentMana = nextVitals.mana;
      return nextVitals;
    },
    sync: (options: UnknownRecord) => {
      if (options.suppressVitalSync !== true) {
        session.selectedPetRuntimeId = pet.runtimeId >>> 0;
        target.petSyncNeeded = true;
      }
    },
  };
  return target;
}
