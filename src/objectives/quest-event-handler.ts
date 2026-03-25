import { applyInventoryQuestEvent, sendConsumeResultPackets, sendInventoryFullSync, } from '../gameplay/inventory-runtime.js';
import { consumeItemFromBag, getBagQuantityByTemplateId, getItemDefinition, } from '../inventory/index.js';
import { applyQuestCompletionReward } from '../gameplay/reward-runtime.js';
import { normalizePets } from '../pet-runtime.js';
import { numberOrDefault } from '../character/normalize.js';

import type { DirtyFlags, DispatchOptions, ObjectiveEventHandler } from './objective-dispatcher.js';
import type { GameSession, QuestEvent, QuestSyncMode } from '../types.js';

type QuestEventHandlerDeps = {
  sendQuestAccept(session: GameSession, taskId: number): void;
  sendQuestUpdate(session: GameSession, taskId: number, status: number): void;
  sendQuestMarker(session: GameSession, taskId: number, npcId: number): void;
  sendQuestProgress(session: GameSession, objectiveId: number, status: number): void;
  sendQuestComplete(session: GameSession, taskId: number): void;
  sendQuestAbandon(session: GameSession, taskId: number): void;
  sendQuestHistory(session: GameSession, taskId: number, historyLevel?: number): void;
  syncQuestStateToClient(session: GameSession, options?: { mode?: QuestSyncMode }): void;
};

function createQuestEventHandler(deps: QuestEventHandlerDeps): ObjectiveEventHandler<QuestEvent> {
  return {
    describeEvent(event: QuestEvent, source: string): string {
      const statusText = 'status' in event && typeof event.status === 'number' ? ` status=${event.status}` : '';
      const stepText = 'stepDescription' in event && event.stepDescription ? ` step="${event.stepDescription}"` : '';
      return `Quest event source=${source} type=${event.type} taskId=${numberOrDefault(event.taskId, 0)}${statusText}${stepText}`;
    },

    dispatch(session: GameSession, event: QuestEvent, source: string, options: DispatchOptions): DirtyFlags {
      const suppressPackets = options.suppressPackets === true;
      const suppressDialogues = options.suppressDialogues === true;

      const inventoryEventResult = applyInventoryQuestEvent(session, event, { suppressPackets, suppressDialogues });
      if (inventoryEventResult.handled) {
        return { inventoryDirty: inventoryEventResult.dirty };
      }

      if (event.type === 'accepted') {
        if (!suppressPackets) {
          deps.syncQuestStateToClient(session, { mode: 'runtime' });
          deps.sendQuestAccept(session, event.taskId);
          deps.sendQuestUpdate(session, event.taskId, 1);
          if (numberOrDefault(event.markerNpcId, 0) > 0) {
            deps.sendQuestMarker(session, event.taskId, numberOrDefault(event.markerNpcId, 0));
          }
        }
        if (!suppressDialogues) {
          session.sendGameDialogue('Quest', `${event.definition.acceptMessage || `${event.definition.name} accepted.`}${event.stepDescription ? ` Objective: ${event.stepDescription}` : ''}`);
        }
        return { stateDirty: true };
      }

      if (event.type === 'progress' || event.type === 'advanced') {
        if (!suppressPackets) {
          if (event.type === 'advanced') {
            deps.sendQuestUpdate(session, event.taskId, event.status);
          } else if (event.type === 'progress') {
            if (typeof event.reason === 'string' && event.reason === 'kill-ready-to-turn-in') {
              deps.sendQuestUpdate(session, event.taskId, event.status);
            }
            deps.sendQuestProgress(
              session,
              numberOrDefault(event.progressObjectiveId, event.taskId),
              numberOrDefault(event.progressCount, event.status)
            );
          }
          if (numberOrDefault(event.markerNpcId, 0) > 0) {
            deps.sendQuestMarker(session, event.taskId, numberOrDefault(event.markerNpcId, 0));
          }
        }
        if (!suppressDialogues) {
          const progressText = event.type === 'progress'
            ? ` Progress: ${numberOrDefault(event.progressCount, event.status)}.`
            : '';
          session.sendGameDialogue('Quest', `Quest updated: ${event.definition.name}.${event.stepDescription ? ` ${event.stepDescription}` : ''}${progressText}`);
        }
        return { stateDirty: true };
      }

      if (event.type === 'completed') {
        const rewardResult = applyQuestCompletionReward(session, event.reward, {
          suppressPackets,
          suppressDialogues,
          taskId: event.taskId,
          selectedAwardId: numberOrDefault(options?.selectedAwardId, 0),
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

      return {};
    },
  };
}

export {
  createQuestEventHandler,
};
