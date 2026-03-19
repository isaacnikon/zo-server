const {
  applyInventoryQuestEvent,
  sendConsumeResultPackets,
  sendInventoryFullSync,
} = require('../gameplay/inventory-runtime');
const {
  consumeItemFromBag,
  getBagQuantityByTemplateId,
  getItemDefinition,
} = require('../inventory');
const { applyQuestCompletionReward } = require('../gameplay/reward-runtime');
const { normalizePets } = require('../pet-runtime');
const { numberOrDefault } = require('../character/normalize');
const { buildEncounterPoolEntry } = require('../roleinfo');

import type { DirtyFlags, DispatchOptions, ObjectiveEventHandler } from './objective-dispatcher';
import type { QuestEvent, QuestSyncMode } from '../types';

type SessionLike = Record<string, any>;

type QuestEventHandlerDeps = {
  sendQuestAccept(session: SessionLike, taskId: number): void;
  sendQuestUpdate(session: SessionLike, taskId: number, status: number): void;
  sendQuestProgress(session: SessionLike, objectiveId: number, status: number): void;
  sendQuestComplete(session: SessionLike, taskId: number): void;
  sendQuestAbandon(session: SessionLike, taskId: number): void;
  sendQuestHistory(session: SessionLike, taskId: number, historyLevel?: number): void;
  sendQuestFindNpc(session: SessionLike, taskId: number, npcId: number): void;
  syncQuestStateToClient(session: SessionLike, options?: { mode?: QuestSyncMode }): void;
};

function createQuestEventHandler(deps: QuestEventHandlerDeps): ObjectiveEventHandler<QuestEvent> {
  return {
    describeEvent(event: QuestEvent, source: string): string {
      const statusText = 'status' in event && typeof event.status === 'number' ? ` status=${event.status}` : '';
      const markerText = 'markerNpcId' in event && typeof event.markerNpcId === 'number'
        ? ` markerNpcId=${event.markerNpcId}`
        : '';
      const stepText = 'stepDescription' in event && event.stepDescription ? ` step="${event.stepDescription}"` : '';
      return `Quest event source=${source} type=${event.type} taskId=${numberOrDefault(event.taskId, 0)}${statusText}${markerText}${stepText}`;
    },

    dispatch(session: SessionLike, event: QuestEvent, source: string, options: DispatchOptions): DirtyFlags {
      const suppressPackets = options.suppressPackets === true;
      const suppressDialogues = options.suppressDialogues === true;

      const inventoryEventResult = applyInventoryQuestEvent(session, event, { suppressPackets, suppressDialogues });
      if (inventoryEventResult.handled) {
        return { inventoryDirty: inventoryEventResult.dirty };
      }

      if (event.type === 'accepted') {
        if (!suppressPackets) {
          deps.sendQuestAccept(session, event.taskId);
          if (event.markerNpcId > 0) {
            deps.sendQuestFindNpc(session, event.taskId, event.markerNpcId);
          }
        }
        if (!suppressDialogues) {
          session.sendGameDialogue('Quest', `${event.definition.acceptMessage || `${event.definition.name} accepted.`}${event.stepDescription ? ` Objective: ${event.stepDescription}` : ''}`);
        }
        return { stateDirty: true };
      }

      if (event.type === 'progress' || event.type === 'advanced') {
        const isBootstrapLikeSource =
          source === 'bootstrap' ||
          source === 'bootstrap-scene' ||
          source === 'scene-transition' ||
          source === 'position-map-change';
        if (!suppressPackets) {
          if (!isBootstrapLikeSource && event.type === 'advanced') {
            deps.sendQuestUpdate(session, event.taskId, event.status);
          } else if (!isBootstrapLikeSource && event.type === 'progress') {
            deps.sendQuestProgress(session, numberOrDefault(event.progressObjectiveId, event.taskId), event.status);
          }
          if (event.markerNpcId > 0) {
            deps.sendQuestFindNpc(session, event.taskId, event.markerNpcId);
          }
        }
        if (!suppressDialogues) {
          const progressText = event.type === 'progress' ? ` Progress: ${event.status}.` : '';
          session.sendGameDialogue('Quest', `Quest updated: ${event.definition.name}.${event.stepDescription ? ` ${event.stepDescription}` : ''}${progressText}`);
        }
        return { stateDirty: true };
      }

      if (event.type === 'completed') {
        const rewardResult = applyQuestCompletionReward(session, event.reward, {
          suppressPackets,
          suppressDialogues,
          taskId: event.taskId,
        });
        if (rewardResult.petsDirty) {
          session.pets = normalizePets(session.pets);
          if (!suppressPackets) {
            session.sendPetStateSync(`quest-reward-${event.taskId}`);
          }
        }
        if (!suppressPackets) {
          deps.sendQuestComplete(session, event.taskId);
          deps.sendQuestHistory(session, event.taskId, 0);
        }
        if (!suppressDialogues) {
          const rewardText = rewardResult.rewardMessages.length > 0 ? rewardResult.rewardMessages.join(', ') : 'no reward';
          const levelText = rewardResult.levelSummary?.levelsGained > 0
            ? ` Level up: ${rewardResult.levelSummary.levelsGained} -> level ${session.level}, status points +${rewardResult.levelSummary.statusPointsGained}.`
            : '';
          session.sendGameDialogue('Quest', `${event.definition.completionMessage || `${event.definition.name} completed.`} Reward: ${rewardText}.${levelText}`);
        }
        return {
          stateDirty: true,
          statsDirty: rewardResult.statsDirty,
          inventoryDirty: rewardResult.inventoryDirty,
        };
      }

      if (event.type === 'abandoned') {
        let inventoryDirty = false;
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
              session.sendGameDialogue('Quest', `${definition?.name || 'Quest item'} was cleared after abandoning the quest.`);
            }
          }
        }
        if (!suppressPackets) {
          deps.sendQuestUpdate(session, event.taskId, 0);
          deps.sendQuestFindNpc(session, event.taskId, 0);
          deps.sendQuestAbandon(session, event.taskId);
          deps.syncQuestStateToClient(session, { mode: 'runtime' });
        }
        if (!suppressDialogues) {
          session.sendGameDialogue('Quest', `${event.definition.name} abandoned.`);
        }
        return {
          stateDirty: true,
          inventoryDirty,
        };
      }

      if (event.type === 'quest-combat-trigger') {
        session.sendCombatEncounterProbe({
          kind: 'encounterProbe',
          probeId: `quest-${event.taskId}-${event.monsterId >>> 0}`,
          reason: `Quest scripted encounter task=${event.taskId}`,
          encounterProfile: {
            minEnemies: 1,
            maxEnemies: 1,
            encounterChancePercent: 100,
            pool: [
              buildEncounterPoolEntry(event.monsterId >>> 0, {
                logicalId: event.monsterId >>> 0,
                levelMin: 10,
                levelMax: 10,
                hpBase: 160,
                hpPerLevel: 8,
                weight: 1,
              }),
            ],
          },
          entityId: session.entityType,
        });
      }

      return {};
    },
  };
}

export {
  createQuestEventHandler,
};
