'use strict';

const { parseQuestPacket } = require('../protocol/inbound-packets');
const {
  DEFAULT_FLAGS,
  GAME_QUEST_CMD,
} = require('../config');
const {
  abandonQuest,
  applyMonsterDefeat,
  applySceneTransition,
  buildQuestSyncState,
  getQuestDefinition,
  normalizeQuestState,
  reconcileAutoAccept,
} = require('../quest-engine');
const {
  applyInventoryQuestEvent,
  sendConsumeResultPackets,
  sendInventoryFullSync,
} = require('../gameplay/inventory-runtime');
const {
  consumeItemFromBag,
  getBagQuantityByTemplateId,
  getItemDefinition,
  normalizeInventoryState,
} = require('../inventory');
const {
  applyQuestCompletionReward,
} = require('../gameplay/reward-runtime');
const { normalizePets } = require('../pet-runtime');
const { buildQuestPacket } = require('../protocol/gameplay-packets');
const { numberOrDefault } = require('../character/normalize');

function sendQuestAccept(session, taskId) {
  session.writePacket(
    buildQuestPacket(0x03, taskId),
    DEFAULT_FLAGS,
    `Sending quest accept cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x03 taskId=${taskId}`
  );
}

function sendQuestUpdate(session, taskId, status) {
  session.writePacket(
    buildQuestPacket(0x08, taskId),
    DEFAULT_FLAGS,
    `Sending quest update cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x08 taskId=${taskId} status=${status}`
  );
}

function sendQuestProgress(session, objectiveId, status) {
  session.writePacket(
    buildQuestPacket(0x0b, objectiveId),
    DEFAULT_FLAGS,
    `Sending quest progress cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x0b objectiveId=${objectiveId} status=${status}`
  );
}

function sendQuestComplete(session, taskId) {
  session.writePacket(
    buildQuestPacket(0x04, taskId),
    DEFAULT_FLAGS,
    `Sending quest complete cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x04 taskId=${taskId}`
  );
}

function sendQuestAbandon(session, taskId) {
  session.writePacket(
    buildQuestPacket(0x05, taskId),
    DEFAULT_FLAGS,
    `Sending quest abandon cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x05 taskId=${taskId}`
  );
}

function sendQuestHistory(session, taskId, historyLevel = 0) {
  session.writePacket(
    buildQuestPacket(0x0e, taskId, historyLevel & 0xff, 'u8'),
    DEFAULT_FLAGS,
    `Sending quest history cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x0e taskId=${taskId} history=${historyLevel}`
  );
}

function sendQuestFindNpc(session, taskId, npcId) {
  session.writePacket(
    buildQuestPacket(0x0c, taskId, npcId >>> 0),
    DEFAULT_FLAGS,
    `Sending quest marker cmd=0x${GAME_QUEST_CMD.toString(16)} sub=0x0c taskId=${taskId} npcId=${npcId}`
  );
}

function syncQuestStateToClient(session) {
  for (const taskId of session.completedQuests) {
    sendQuestHistory(session, taskId, 0);
  }

  const syncState = buildQuestSyncState({
    activeQuests: session.activeQuests,
    completedQuests: session.completedQuests,
  });

  for (const quest of syncState) {
    sendQuestAccept(session, quest.taskId);
    for (let index = 0; index < numberOrDefault(quest.stepIndex, 0); index += 1) {
      sendQuestUpdate(session, quest.taskId, index + 1);
    }
    if (quest.stepType === 'kill' && numberOrDefault(quest.status, 0) > 0) {
      sendQuestProgress(
        session,
        numberOrDefault(quest.progressObjectiveId, quest.taskId),
        quest.status
      );
    }
    if (quest.markerNpcId > 0) {
      sendQuestFindNpc(session, quest.taskId, quest.markerNpcId);
    }
  }

  if (!session.hasAnnouncedQuestOverview && syncState.length > 0) {
    const activeQuest = syncState[0];
    session.sendGameDialogue(
      'Quest',
      `Active quest loaded.${activeQuest.stepDescription ? ` ${activeQuest.stepDescription}` : ''}`
    );
    session.hasAnnouncedQuestOverview = true;
  }
}

function applyQuestEvents(session, events, source = 'runtime', options = {}) {
  if (!Array.isArray(events) || events.length === 0) {
    return;
  }

  const suppressPackets = options.suppressPackets === true;
  const suppressDialogues = options.suppressDialogues === true;
  const suppressStatSync = options.suppressStatSync === true;
  let statsDirty = false;
  let questStateDirty = false;
  let inventoryDirty = false;

  for (const event of events) {
    session.log(
      `Quest event source=${source} type=${event.type} taskId=${numberOrDefault(event.taskId, 0)}${typeof event.status === 'number' ? ` status=${event.status}` : ''}${typeof event.markerNpcId === 'number' ? ` markerNpcId=${event.markerNpcId}` : ''}${event.stepDescription ? ` step="${event.stepDescription}"` : ''}`
    );

    const inventoryEventResult = applyInventoryQuestEvent(session, event, {
      suppressPackets,
      suppressDialogues,
    });
    if (inventoryEventResult.handled) {
      inventoryDirty = inventoryDirty || inventoryEventResult.dirty;
      continue;
    }

    if (event.type === 'accepted') {
      questStateDirty = true;
      if (!suppressPackets) {
        sendQuestAccept(session, event.taskId);
        if (event.markerNpcId > 0) {
          sendQuestFindNpc(session, event.taskId, event.markerNpcId);
        }
      }
      if (!suppressDialogues) {
        session.sendGameDialogue(
          'Quest',
          `${event.definition.acceptMessage || `${event.definition.name} accepted.`}${event.stepDescription ? ` Objective: ${event.stepDescription}` : ''}`
        );
      }
      continue;
    }

    if (event.type === 'progress' || event.type === 'advanced') {
      questStateDirty = true;
      const isBootstrapLikeSource =
        source === 'bootstrap' ||
        source === 'bootstrap-scene' ||
        source === 'scene-transition' ||
        source === 'position-map-change';
      if (!suppressPackets) {
        if (!isBootstrapLikeSource && event.type === 'advanced') {
          sendQuestUpdate(session, event.taskId, event.status);
        } else if (!isBootstrapLikeSource && event.type === 'progress') {
          sendQuestProgress(
            session,
            numberOrDefault(event.progressObjectiveId, event.taskId),
            event.status
          );
        }
        if (event.markerNpcId > 0) {
          sendQuestFindNpc(session, event.taskId, event.markerNpcId);
        }
      }
      if (!suppressDialogues) {
        const progressText = event.type === 'progress' ? ` Progress: ${event.status}.` : '';
        session.sendGameDialogue(
          'Quest',
          `Quest updated: ${event.definition.name}.${event.stepDescription ? ` ${event.stepDescription}` : ''}${progressText}`
        );
      }
      continue;
    }

    if (event.type === 'completed') {
      questStateDirty = true;
      const rewardResult = applyQuestCompletionReward(session, event.reward, {
        suppressPackets,
        suppressDialogues,
        taskId: event.taskId,
      });
      statsDirty = statsDirty || rewardResult.statsDirty;
      inventoryDirty = inventoryDirty || rewardResult.inventoryDirty;
      if (rewardResult.petsDirty) {
        session.pets = normalizePets(session.pets);
        if (!suppressPackets) {
          session.sendPetStateSync(`quest-reward-${event.taskId}`);
        }
      }
      if (!suppressPackets) {
        sendQuestComplete(session, event.taskId);
        sendQuestHistory(session, event.taskId, 0);
      }
      if (!suppressDialogues) {
        const rewardText = rewardResult.rewardMessages.length > 0
          ? rewardResult.rewardMessages.join(', ')
          : 'no reward';
        const levelText = rewardResult.levelSummary?.levelsGained > 0
          ? ` Level up: ${rewardResult.levelSummary.levelsGained} -> level ${session.level}, status points +${rewardResult.levelSummary.statusPointsGained}.`
          : '';
        session.sendGameDialogue(
          'Quest',
          `${event.definition.completionMessage || `${event.definition.name} completed.`} Reward: ${rewardText}.${levelText}`
        );
      }
      continue;
    }

    if (event.type === 'abandoned') {
      questStateDirty = true;
      for (const templateId of Array.isArray(event.resetItemTemplateIds) ? event.resetItemTemplateIds : []) {
        const quantity = getBagQuantityByTemplateId(session, templateId);
        if (quantity <= 0) {
          continue;
        }
        const definition = getItemDefinition(templateId);
        const consumeResult = consumeItemFromBag(session, templateId, quantity);
        if (consumeResult.ok) {
          inventoryDirty = true;
          if (!suppressPackets) {
            sendConsumeResultPackets(session, consumeResult);
            sendInventoryFullSync(session);
          }
          if (!suppressDialogues) {
            session.sendGameDialogue(
              'Quest',
              `${definition?.name || 'Quest item'} was cleared after abandoning the quest.`
            );
          }
        }
      }
      if (!suppressPackets) {
        sendQuestUpdate(session, event.taskId, 0);
        sendQuestFindNpc(session, event.taskId, 0);
        sendQuestAbandon(session, event.taskId);
        syncQuestStateToClient(session);
      }
      if (!suppressDialogues) {
        session.sendGameDialogue('Quest', `${event.definition.name} abandoned.`);
      }
    }
  }

  if (statsDirty && !suppressStatSync) {
    session.sendSelfStateAptitudeSync();
  }

  if (questStateDirty || statsDirty || inventoryDirty) {
    session.persistCurrentCharacter();
  }
}

function handleQuestPacket(session, payload) {
  if (payload.length < 5) {
    session.log('Short 0x03ff payload');
    return;
  }

  const { subcmd, taskId } = parseQuestPacket(payload);
  session.log(`Quest packet sub=0x${subcmd.toString(16)} taskId=${taskId}`);

  if (subcmd === 0x05) {
    const questState = {
      activeQuests: session.activeQuests,
      completedQuests: session.completedQuests,
    };
    const events = abandonQuest(questState, taskId);
    session.activeQuests = questState.activeQuests;
    session.completedQuests = questState.completedQuests;
    if (events.length > 0) {
      applyQuestEvents(session, events, 'client-abandon');
    }
    return;
  }

  if (subcmd === 0x0c) {
    const syncState = buildQuestSyncState({
      activeQuests: session.activeQuests,
      completedQuests: session.completedQuests,
    }).find((quest) => quest.taskId === taskId);
    if (syncState?.markerNpcId) {
      sendQuestFindNpc(session, taskId, syncState.markerNpcId);
    }
    return;
  }

  session.log(`Unhandled quest subcmd=0x${subcmd.toString(16)} taskId=${taskId}`);
}

function handleQuestMonsterDefeat(session, monsterId, count = 1) {
  const events = applyMonsterDefeat(
    {
      activeQuests: session.activeQuests,
      completedQuests: session.completedQuests,
    },
    monsterId,
    count
  );
  if (events.length > 0) {
    applyQuestEvents(session, events, 'monster-defeat');
  }
}

function ensureQuestStateReady(session) {
  const persisted = session.getPersistedCharacter();
  if (persisted) {
    const questState = normalizeQuestState(persisted);
    session.activeQuests = questState.activeQuests;
    session.completedQuests = questState.completedQuests;
    session.pets = normalizePets(persisted.pets);
    session.selectedPetRuntimeId =
      typeof persisted.selectedPetRuntimeId === 'number'
        ? (persisted.selectedPetRuntimeId >>> 0)
        : null;
    session.petSummoned = persisted.petSummoned === true;
    const inventoryState = normalizeInventoryState(persisted);
    session.bagItems = inventoryState.inventory.bag;
    session.bagSize = inventoryState.inventory.bagSize;
    session.nextItemInstanceId = inventoryState.inventory.nextItemInstanceId;
    session.nextBagSlot = inventoryState.inventory.nextBagSlot;
  }

  const events = reconcileAutoAccept({
    activeQuests: session.activeQuests,
    completedQuests: session.completedQuests,
  });
  if (events.length > 0) {
    applyQuestEvents(session, events, 'bootstrap', {
      suppressPackets: true,
      suppressDialogues: true,
      suppressStatSync: true,
    });
  }

  const transitionEvents = applySceneTransition(
    {
      activeQuests: session.activeQuests,
      completedQuests: session.completedQuests,
    },
    session.currentMapId
  );
  if (transitionEvents.length > 0) {
    applyQuestEvents(session, transitionEvents, 'bootstrap-scene', {
      suppressPackets: true,
      suppressDialogues: true,
      suppressStatSync: true,
    });
  }
}

function refreshQuestStateForItemTemplates(session, templateIds) {
  if (!Array.isArray(templateIds) || templateIds.length === 0) {
    return;
  }

  const interestingTemplates = new Set(
    templateIds.filter(Number.isInteger).map((templateId) => templateId >>> 0)
  );
  if (interestingTemplates.size === 0) {
    return;
  }

  const syncStateByTaskId = new Map(
    buildQuestSyncState({
      activeQuests: session.activeQuests,
      completedQuests: session.completedQuests,
    }).map((quest) => [quest.taskId, quest])
  );

  for (const record of session.activeQuests) {
    const definition = getQuestDefinition(record?.id);
    const step = definition?.steps?.[record?.stepIndex];
    if (!step || !Array.isArray(step.consumeItems) || step.consumeItems.length === 0) {
      continue;
    }

    const matchesGrantedItem = step.consumeItems.some((item) => interestingTemplates.has(item.templateId >>> 0));
    if (!matchesGrantedItem) {
      continue;
    }

    const syncState = syncStateByTaskId.get(definition.id);
    if (!syncState) {
      continue;
    }

    if (syncState.markerNpcId > 0) {
      sendQuestFindNpc(session, definition.id, syncState.markerNpcId);
    }
    session.log(
      `Refreshed quest sync for task=${definition.id} after item grant templates=${[...interestingTemplates].join(',')}`
    );
  }
}

module.exports = {
  handleQuestPacket,
  applyQuestEvents,
  handleQuestMonsterDefeat,
  syncQuestStateToClient,
  ensureQuestStateReady,
  refreshQuestStateForItemTemplates,
  sendQuestAccept,
  sendQuestUpdate,
  sendQuestProgress,
  sendQuestComplete,
  sendQuestAbandon,
  sendQuestHistory,
  sendQuestFindNpc,
};
