'use strict';
export {};

const {
  consumeBagItemByInstanceId,
  getBagItemByReference,
  getItemDefinition,
} = require('../inventory');
const { sendConsumeResultPackets } = require('./inventory-runtime');
const { learnSkillFromBook, sendSkillStateSync } = require('./skill-runtime');
const { recomputeSessionMaxVitals } = require('./session-flows');
const { resolvePetMaxVitals } = require('./max-vitals');
const { sendPetStateSync } = require('../handlers/pet-handler');
const { sendSelfStateVitalsUpdate } = require('./stat-sync');

type UnknownRecord = Record<string, any>;
type SessionLike = Record<string, any>;

function consumeUsableItemByInstanceId(
  session: SessionLike,
  instanceId: number,
  options: UnknownRecord = {}
): UnknownRecord {
  const bagItem = getBagItemByReference(session, instanceId);
  if (!bagItem) {
    return {
      ok: false,
      reason: `Unknown instanceId=${instanceId}`,
    };
  }

  const definition = getItemDefinition(bagItem.templateId);
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
        session.persistCurrentCharacter();
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
    session.persistCurrentCharacter();
  }
  if (
    typeof session.refreshQuestStateForItemTemplates === 'function' &&
    Number.isInteger(bagItem?.templateId)
  ) {
    session.refreshQuestStateForItemTemplates([bagItem.templateId >>> 0]);
  }

  return {
    ok: true,
    item: bagItem,
    definition,
    consumeResult,
    targetKind: target.kind,
    targetEntityId: target.entityId,
    previousVitals,
    nextVitals,
    gained,
  };
}

function resolveItemUseTarget(session: SessionLike, targetEntityId: unknown): UnknownRecord | null {
  const normalizedTargetEntityId =
    typeof targetEntityId === 'number' && Number.isInteger(targetEntityId) ? targetEntityId >>> 0 : 0;
  if (normalizedTargetEntityId === 0 || normalizedTargetEntityId === (session.entityType >>> 0)) {
    return {
      kind: 'player',
      entityId: session.entityType >>> 0,
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

  return {
    kind: 'pet',
    entityId: pet.runtimeId >>> 0,
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
        sendPetStateSync(session, 'item-use');
      }
    },
  };
}

module.exports = {
  consumeUsableItemByInstanceId,
};
