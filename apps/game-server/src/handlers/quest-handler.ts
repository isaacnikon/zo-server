import { parseQuestPacket } from '../protocol/inbound-packets.js';
import { getBagQuantityByTemplateId, normalizeInventoryState } from '../inventory/index.js';
import { normalizePets } from '../pet-runtime.js';
import { isQuest2DefinitionId } from '../quest2/definitions.js';
import { dispatchQuestEventToSession } from '../quest2/runtime.js';
import { normalizeQuestState as normalizeQuestStateV2 } from '../quest2/state.js';
import type { GameSession } from '../types.js';
import type { UnknownRecord } from '../utils.js';

type QuestMonsterDefeatResult = {
  handled: boolean;
  grantedItems: Array<{ templateId: number; quantity: number }>;
};

function handleQuestAbandonRequest(session: GameSession, taskId: number, source = 'client-abandon'): boolean {
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return false;
  }
  if (!isQuest2DefinitionId(taskId)) {
    session.log(`Ignoring non-quest2 abandon taskId=${taskId} source=${source}`);
    return false;
  }
  return dispatchQuestEventToSession(session, {
    type: 'quest_abandon',
    questId: taskId >>> 0,
  }).handled;
}

function handleQuestPacket(session: GameSession, payload: Buffer): void {
  if (payload.length < 5) {
    session.log('Short 0x03ff payload');
    return;
  }

  const { subcmd, taskId } = parseQuestPacket(payload);
  if (subcmd === 0x04) {
    session.log(
      `Quest packet sub=0x${subcmd.toString(16)} taskId=${taskId} len=${payload.length} hex=${payload.toString('hex')}`
    );
  } else {
    session.log(`Quest packet sub=0x${subcmd.toString(16)} taskId=${taskId}`);
  }

  if (subcmd === 0x05) {
    handleQuestAbandonRequest(session, taskId, 'client-abandon');
    return;
  }

  session.log(`Unhandled quest subcmd=0x${subcmd.toString(16)} taskId=${taskId}`);
}

function handleQuestMonsterDefeat(session: GameSession, monsterId: number, count = 1): QuestMonsterDefeatResult {
  const result = dispatchQuestEventToSession(session, {
    type: 'monster_defeat',
    monsterId: monsterId >>> 0,
    count: Math.max(1, count),
    mapId: session.currentMapId >>> 0,
  });

  return {
    handled: result.handled,
    grantedItems: result.grantedItems,
  };
}

function ensureQuestStateReady(session: GameSession): void {
  const persisted = session.getPersistedCharacter();
  if (!persisted) {
    return;
  }

  session.questStateV2 = normalizeQuestStateV2(
    persisted?.questStateV2 && typeof persisted.questStateV2 === 'object'
      ? persisted.questStateV2 as UnknownRecord
      : {}
  );
  session.pets = normalizePets(persisted.pets);
  session.selectedPetRuntimeId =
    typeof persisted.selectedPetRuntimeId === 'number'
      ? persisted.selectedPetRuntimeId >>> 0
      : null;
  session.petSummoned = persisted.petSummoned === true;
  const inventoryState = normalizeInventoryState(persisted);
  session.bagItems = inventoryState.inventory.bag;
  session.bagSize = inventoryState.inventory.bagSize;
  session.nextItemInstanceId = inventoryState.inventory.nextItemInstanceId;
  session.nextBagSlot = inventoryState.inventory.nextBagSlot;
}

function refreshQuestStateForItemTemplates(session: GameSession, templateIds: number[]): void {
  if (!Array.isArray(templateIds) || templateIds.length === 0) {
    return;
  }

  const interestingTemplates = new Set(
    templateIds.filter(Number.isInteger).map((templateId) => templateId >>> 0)
  );
  if (interestingTemplates.size === 0) {
    return;
  }

  for (const templateId of interestingTemplates) {
    const quantity = Math.max(0, getBagQuantityByTemplateId(session, templateId));
    const result = dispatchQuestEventToSession(session, {
      type: 'item_changed',
      templateId,
      delta: 0,
      quantity,
    });
    if (result.handled) {
      session.log(`Refreshed quest2 state for templateId=${templateId} quantity=${quantity}`);
    }
  }
}

export {
  ensureQuestStateReady,
  handleQuestAbandonRequest,
  handleQuestMonsterDefeat,
  handleQuestPacket,
  refreshQuestStateForItemTemplates,
};
