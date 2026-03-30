import fs from 'node:fs';
import type { GameSession, ServerRunRequestData } from '../types.js';

import { DEFAULT_FLAGS, GAME_NPC_SHOP_CMD } from '../config.js';
import { getMapEncounterLevelRange, getMapNpcs, getMapSummary } from '../map-data.js';
import { getBagQuantityByTemplateId } from '../inventory/index.js';
import {
  getCurrentObjective,
  getCurrentStep,
  getCurrentStepUi,
  interactWithNpc,
  getQuestDefinition,
  getQuestAcceptBlocker,
} from '../quest-engine/index.js';
import { buildNpcShopOpenPacket } from '../protocol/gameplay-packets.js';
import { resolveRepoPath } from '../runtime-paths.js';
import { tryHandleConfiguredNpcInteraction } from '../gameplay/npc-interaction-rules.js';
import { recomputeSessionMaxVitals, resolveInnRestVitals } from '../gameplay/session-flows.js';
import { primeNpcServiceContext } from '../gameplay/npc-service-runtime.js';
import { sendSelfStateValueUpdate, sendSelfStateVitalsUpdate } from '../gameplay/stat-sync.js';
import { buildEncounterPoolEntry } from '../roleinfo/index.js';
import { grantSkill, sendSkillStateSync } from '../gameplay/skill-runtime.js';
import { applyEffects } from '../effects/effect-executor.js';
import { matchesTrigger } from '../triggers/trigger-matcher.js';
import { applyQuestEvents } from './quest-handler.js';

type MapNpcRecord = Record<string, any>;
type ShopCatalogItem = { templateId: number; price: number };
type ShopCatalogRecord = { speaker?: string; items?: ShopCatalogItem[] };
type ShopRegistry = {
  defaultsByNpcId?: Record<string, ShopCatalogRecord>;
  mapOverrides?: Array<{ mapId?: number; npcId?: number; speaker?: string; items?: ShopCatalogItem[] }>;
};

type QuestNpcAuxiliaryCombatTrigger = {
  taskId: number;
  monsterId: number;
  count: number;
};

type QuestNpcAuxiliaryResult = {
  events: any[];
  stateChanged: boolean;
  combatTrigger: QuestNpcAuxiliaryCombatTrigger | null;
};

const NPC_SHOP_REGISTRY_FILE = resolveRepoPath('data', 'client-derived', 'npc-shops.json');
const NPC_SHOP_REGISTRY = loadNpcShopRegistry();
const INN_REST_SCRIPT_ID = 5001;
const HOUSEWIFE_NPC_ID = 3089;
const HOUSEWIFE_LIFE_SKILL_IDS = [9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009] as const;
const HOUSEWIFE_LIFE_SKILL_NAMES: Record<number, string> = {
  9001: 'Compose',
  9002: 'Cooking',
  9003: 'Decompose',
  9004: 'Gem Machining',
  9005: 'Alchemy',
  9006: 'Mining',
  9007: 'Lumbering',
  9008: 'Herbalism',
  9009: 'Fishing',
};

function handleNpcInteractionRequest(session: GameSession, request: ServerRunRequestData): boolean {
  if (
    request.subcmd !== 0x02 &&
    request.subcmd !== 0x03 &&
    request.subcmd !== 0x04 &&
    request.subcmd !== 0x08 &&
    request.subcmd !== 0x0f
  ) {
    return false;
  }

  const npc = resolveNpcInteractionTarget(session, request);
  const npcRecordId = typeof npc?.npcId === 'number' && Number.isInteger(npc.npcId) ? (npc.npcId >>> 0) : 0;
  const npcEntityType =
    typeof npc?.resolvedSpawnEntityType === 'number' && Number.isInteger(npc.resolvedSpawnEntityType)
      ? (npc.resolvedSpawnEntityType >>> 0)
      : 0;
  const requestNpcId =
    typeof request.npcId === 'number' && Number.isInteger(request.npcId) ? (request.npcId >>> 0) : 0;
  const resolvedNpcId =
    (typeof npc?.validationStatus === 'string' && npc.validationStatus === 'alias-id-mismatch'
      ? npcRecordId
      : 0) ||
    npcEntityType ||
    npcRecordId ||
    requestNpcId ||
    0;
  if (resolvedNpcId <= 0) {
    return false;
  }

  if (handleInnRestRequest(session, resolvedNpcId, request)) {
    session.log(
      `NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId}`
    );
    return true;
  }

  if (handleHousewifeTeachingRequest(session, resolvedNpcId, request)) {
    session.log(
      `NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} housewife=1`
    );
    return true;
  }

  const configuredInteraction = tryHandleConfiguredNpcInteraction(session, resolvedNpcId, request);
  if (configuredInteraction.handled) {
    session.log(
      `NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} configuredRule=${configuredInteraction.ruleId || 'unknown'} kind=${configuredInteraction.kind || 'unknown'}${configuredInteraction.detail ? ` ${configuredInteraction.detail}` : ''}`
    );
    return true;
  }

  if (request.subcmd === 0x0f) {
    primeNpcServiceContext(
      session,
      resolvedNpcId,
      Number.isInteger(request.rawArgs?.[0]) ? (request.rawArgs[0] >>> 0) : 0
    );
    sendNpcShopOpen(session, resolvedNpcId, request);
  }

  let handledQuestEvents = false;
  if (request.subcmd === 0x02 || request.subcmd === 0x03 || request.subcmd === 0x04 || request.subcmd === 0x08) {
    const questState = {
      activeQuests: session.activeQuests,
      completedQuests: session.completedQuests,
      level: session.level,
    };
    const auxiliaryResult = applyQuestNpcAuxiliaryActions(session, questState as any, resolvedNpcId, request);
    const events = interactWithNpc(
      questState as any,
      resolvedNpcId,
      (templateId: number) => getBagQuantityByTemplateId(session, templateId),
      (item: { templateId: number; quantity: number; capturedMonsterId?: number }) =>
        countMatchingQuestItems(session, item)
    );
    const combinedEvents =
      auxiliaryResult && auxiliaryResult.events.length > 0 ? [...auxiliaryResult.events, ...events] : events;

    session.activeQuests = questState.activeQuests;
    session.completedQuests = questState.completedQuests;

    if (combinedEvents.length > 0) {
      handledQuestEvents = true;
      applyQuestEvents(session, combinedEvents, auxiliaryResult ? 'npc-talk-aux' : 'npc-talk', {
        selectedAwardId: Number.isInteger(request.awardId) ? (request.awardId! >>> 0) : 0,
      });
    } else if (auxiliaryResult?.stateChanged === true) {
      session.persistCurrentCharacter?.();
    } else {
      const blocker = getQuestAcceptBlocker(questState as any, resolvedNpcId);
      if (blocker) {
        session.sendGameDialogue('Quest', blocker);
      }
    }

    if (
      auxiliaryResult?.combatTrigger &&
      typeof session.sendCombatEncounterProbe === 'function' &&
      !session.combatState?.active
    ) {
      const encounterLevelRange = getMapEncounterLevelRange(session.currentMapId);
      const mapName = getMapSummary(session.currentMapId)?.mapName || `Map ${session.currentMapId}`;
      session.sendCombatEncounterProbe({
        probeId: `quest-aux:${auxiliaryResult.combatTrigger.taskId}:${auxiliaryResult.combatTrigger.monsterId}:${Date.now()}`,
        encounterProfile: {
          minEnemies: Math.max(1, auxiliaryResult.combatTrigger.count || 1),
          maxEnemies: Math.max(1, auxiliaryResult.combatTrigger.count || 1),
          locationName: mapName,
          pool: [
            buildEncounterPoolEntry(auxiliaryResult.combatTrigger.monsterId, {
              levelMin: encounterLevelRange?.min || 1,
              levelMax: encounterLevelRange?.max || encounterLevelRange?.min || 1,
              weight: 1,
            }),
          ],
        },
      });
      session.log(
        `NPC interaction auxiliary combat taskId=${auxiliaryResult.combatTrigger.taskId} monsterId=${auxiliaryResult.combatTrigger.monsterId} count=${auxiliaryResult.combatTrigger.count} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId}`
      );
      return true;
    }
  }

  if (
    handledQuestEvents !== true &&
    tryStartQuestKillCombat(session, resolvedNpcId, request)
  ) {
    session.log(
      `NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} questCombat=1`
    );
    return true;
  }

  if (
    handledQuestEvents !== true &&
    (request.subcmd === 0x02 || request.subcmd === 0x03 || request.subcmd === 0x04) &&
    Number.isInteger(request.scriptId) &&
    typeof session.sendServerRunScriptImmediate === 'function'
  ) {
    session.sendServerRunScriptImmediate(request.scriptId! >>> 0);
  }

  session.log(
    `NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId}`
  );
  return true;
}

function tryStartQuestKillCombat(session: GameSession, npcId: number, request: ServerRunRequestData): boolean {
  if (request.subcmd !== 0x02 || typeof session.sendCombatEncounterProbe !== 'function') {
    return false;
  }
  if (session.combatState?.active) {
    return false;
  }

  const activeQuests = Array.isArray(session.activeQuests) ? session.activeQuests : [];
  for (const record of activeQuests) {
    const taskId = Number.isInteger(record?.id) ? (record.id >>> 0) : 0;
    const stepIndex = Number.isInteger(record?.stepIndex) ? (record.stepIndex >>> 0) : 0;
    if (taskId <= 0) {
      continue;
    }

    const definition = getQuestDefinition(taskId);
    const recordForStep = { ...record, stepIndex };
    const step: any = getCurrentStep(definition as any, recordForStep as any);
    const ui: any = getCurrentStepUi(definition as any, recordForStep as any);
    const objective: any = getCurrentObjective(definition as any, recordForStep as any);
    const targetNpcId = Number.isInteger(objective?.targetNpcId) ? (objective.targetNpcId >>> 0) : 0;
    const uiNpcId = Number.isInteger(ui?.overNpcId) ? (ui.overNpcId >>> 0) : 0;
    const handInNpcId = Number.isInteger(objective?.handInNpcId) ? (objective.handInNpcId >>> 0) : 0;
    const stepNpcId = targetNpcId || uiNpcId || handInNpcId || 0;
    const monsterId = Number.isInteger(objective?.targetMonsterId) ? (objective.targetMonsterId >>> 0) : 0;
    const isCombatObjective =
      objective?.triggerEvent === 'monster-defeat' &&
      (objective?.kind === 'monster-defeat' || objective?.kind === 'item-collect');
    if (!step || !isCombatObjective || stepNpcId !== (npcId >>> 0) || monsterId <= 0) {
      continue;
    }

    const encounterLevelRange = getMapEncounterLevelRange(session.currentMapId);
    const mapName = getMapSummary(session.currentMapId)?.mapName || `Map ${session.currentMapId}`;
    session.sendCombatEncounterProbe({
      probeId: `quest-kill:${taskId}:${monsterId}:${Date.now()}`,
      encounterProfile: {
        minEnemies: 1,
        maxEnemies: 1,
        locationName: mapName,
        pool: [
          buildEncounterPoolEntry(monsterId, {
            levelMin: encounterLevelRange?.min || 1,
            levelMax: encounterLevelRange?.max || encounterLevelRange?.min || 1,
            weight: 1,
          }),
        ],
      },
    });
    return true;
  }

  return false;
}

function applyQuestNpcAuxiliaryActions(
  session: GameSession,
  questState: Record<string, any>,
  npcId: number,
  request: ServerRunRequestData
): QuestNpcAuxiliaryResult | null {
  if (!Array.isArray(questState?.activeQuests) || questState.activeQuests.length < 1) {
    return null;
  }

  const requestSubtype = Number.isInteger(request.subcmd) ? (request.subcmd >>> 0) : 0;
  const requestScriptId = Number.isInteger(request.scriptId)
    ? (request.scriptId! >>> 0)
    : (Number.isInteger(request.rawArgs?.[2]) ? (request.rawArgs[2] >>> 0) : 0);
  const requestContextId = Number.isInteger(request.rawArgs?.[1]) ? (request.rawArgs[1] >>> 0) : 0;
  const mapId = Number.isInteger(session.currentMapId) ? (session.currentMapId >>> 0) : 0;

  let stateChanged = false;
  for (const record of questState.activeQuests) {
    const taskId = Number.isInteger(record?.id) ? (record.id >>> 0) : 0;
    if (taskId <= 0) {
      continue;
    }
    const definition = getQuestDefinition(taskId) as Record<string, any> | null;
    const step = getCurrentStep(definition as any, record as any) as Record<string, any> | null;
    const stepStatus = Number.isInteger(step?.tracker?.status)
      ? (step?.tracker?.status >>> 0)
      : (Number.isInteger(record?.status) ? (record.status >>> 0) : 0);
    const interactionTriggers = Array.isArray(definition?.interactionTriggers)
      ? (definition!.interactionTriggers as Array<Record<string, any>>)
      : [];

    for (const trigger of interactionTriggers) {
      if (trigger?.kind !== 'server-run') {
        continue;
      }
      if (
        !matchesTrigger(
          {
            stepStatus: Number.isInteger(trigger?.stepStatus) ? (trigger.stepStatus >>> 0) : undefined,
            subtype: Number.isInteger(trigger?.subtype) ? (trigger.subtype >>> 0) : undefined,
            npcId: Number.isInteger(trigger?.npcId) ? (trigger.npcId >>> 0) : undefined,
            scriptId: Number.isInteger(trigger?.scriptId) ? (trigger.scriptId >>> 0) : undefined,
            mapId: Number.isInteger(trigger?.mapId) ? (trigger.mapId >>> 0) : undefined,
            contextId: Number.isInteger(trigger?.contextId) ? (trigger.contextId >>> 0) : undefined,
          },
          {
            stepStatus,
            subtype: requestSubtype,
            npcId: npcId >>> 0,
            scriptId: requestScriptId,
            mapId,
            contextId: requestContextId,
          }
        )
      ) {
        continue;
      }

      if (trigger?.combat) {
        const monsterId = Number.isInteger(trigger.combat?.monsterId) ? (trigger.combat.monsterId >>> 0) : 0;
        if (monsterId <= 0) {
          continue;
        }
        return {
          events: [],
          stateChanged,
          combatTrigger: {
            taskId,
            monsterId,
            count: Math.max(1, Number.isInteger(trigger.combat?.count) ? trigger.combat.count : 1),
          },
        };
      }

      if (typeof trigger?.setProgressFlag === 'string' && trigger.setProgressFlag.length > 0) {
        const hadFlag = record.progress?.[trigger.setProgressFlag] === true;
        record.progress = {
          ...(record.progress && typeof record.progress === 'object' ? record.progress : {}),
          [trigger.setProgressFlag]: true,
        };
        stateChanged = stateChanged || !hadFlag;
      }

      const events: any[] = [];
      for (const item of Array.isArray(trigger?.consumeItems) ? trigger.consumeItems : []) {
        const templateId = Number.isInteger(item?.templateId) ? (item.templateId >>> 0) : 0;
        const quantity = Math.max(1, Number.isInteger(item?.quantity) ? item.quantity : 1);
        if (templateId <= 0) {
          continue;
        }
        if (getBagQuantityByTemplateId(session, templateId) < quantity) {
          events.push({
            type: 'item-missing',
            taskId,
            definition,
            templateId,
            quantity,
            itemName: typeof item?.name === 'string' ? item.name : '',
            reason: 'auxiliary-consume-missing',
          });
          return { events, stateChanged, combatTrigger: null };
        }
        events.push({
          type: 'item-consumed',
          taskId,
          definition,
          templateId,
          quantity,
          itemName: typeof item?.name === 'string' ? item.name : '',
          reason: 'auxiliary-consume-item',
        });
      }

      for (const item of Array.isArray(trigger?.grantItems) ? trigger.grantItems : []) {
        const templateId = Number.isInteger(item?.templateId) ? (item.templateId >>> 0) : 0;
        const quantity = Math.max(1, Number.isInteger(item?.quantity) ? item.quantity : 1);
        if (templateId <= 0) {
          continue;
        }
        if (
          Number.isInteger(trigger?.onlyIfMissingTemplateId) &&
          (trigger.onlyIfMissingTemplateId >>> 0) === templateId &&
          getBagQuantityByTemplateId(session, templateId) > 0
        ) {
          continue;
        }
        events.push({
          type: 'item-granted',
          taskId,
          definition,
          templateId,
          quantity,
          itemName: typeof item?.name === 'string' ? item.name : '',
          reason: 'auxiliary-grant-item',
        });
      }

      return { events, stateChanged, combatTrigger: null };
    }
  }

  return null;
}

function countMatchingQuestItems(
  session: GameSession,
  item: { templateId: number; quantity: number; capturedMonsterId?: number }
): number {
  const bagItems = Array.isArray(session.bagItems) ? session.bagItems : [];
  const rawCapturedMonsterId = item?.capturedMonsterId;
  const requiredCapturedMonsterId = typeof rawCapturedMonsterId === 'number' && Number.isInteger(rawCapturedMonsterId)
    ? (rawCapturedMonsterId >>> 0)
    : 0;
  if (requiredCapturedMonsterId <= 0) {
    return getBagQuantityByTemplateId(session, item.templateId >>> 0);
  }
  return bagItems.reduce((total: number, bagItem: Record<string, any>) => {
    const bagTemplateId = bagItem?.templateId >>> 0;
    if (bagItem?.equipped === true) {
      return total;
    }
    if (isMobFlaskTemplateId(item.templateId >>> 0)) {
      if (!isMobFlaskTemplateId(bagTemplateId)) {
        return total;
      }
    } else if (bagTemplateId !== (item.templateId >>> 0)) {
      return total;
    }
    const capturedMonsterId = Number.isInteger(bagItem?.attributePairs?.[0]?.value)
      ? (bagItem.attributePairs[0].value >>> 0)
      : (Number.isInteger(bagItem?.extraValue) ? (bagItem.extraValue >>> 0) : 0);
    if (capturedMonsterId !== requiredCapturedMonsterId) {
      return total;
    }
    return total + Math.max(1, Number.isInteger(bagItem?.quantity) ? bagItem.quantity : 1);
  }, 0);
}

function isMobFlaskTemplateId(templateId: number): boolean {
  return templateId >= 29000 && templateId <= 29011;
}

function handleInnRestRequest(session: GameSession, npcId: number, request: ServerRunRequestData): boolean {
  if (
    request.subcmd !== 0x02 ||
    !Number.isInteger(request.scriptId) ||
    (request.scriptId! >>> 0) !== INN_REST_SCRIPT_ID
  ) {
    return false;
  }

  const price = resolveInnRestPrice(session);
  const currentCoins = Number.isInteger(session.coins) ? Math.max(0, session.coins) : 0;
  if (currentCoins < price) {
    session.sendGameDialogue('Waiter', `You need ${price} coins to rest here.`);
    return true;
  }

  recomputeSessionMaxVitals(session);
  const nextVitals = resolveInnRestVitals(session);
  session.coins = currentCoins - price;
  session.currentHealth = nextVitals.health;
  session.currentMana = nextVitals.mana;
  session.currentRage = nextVitals.rage;
  sendSelfStateValueUpdate(session, 'coins', session.coins);
  sendSelfStateVitalsUpdate(session, nextVitals);
  session.persistCurrentCharacter();
  const speaker = resolveInnRestSpeaker(session, npcId);
  session.sendGameDialogue(
    speaker,
    price > 0 ? `You paid ${price} coins and had a good rest.` : 'You had a good rest.'
  );
  return true;
}

function resolveInnRestPrice(session: GameSession): number {
  const level = Number.isInteger(session.level) ? session.level >>> 0 : 1;
  return level < 10 ? 0 : level * 10;
}

function resolveInnRestSpeaker(session: GameSession, npcId: number): string {
  const name = resolveNpcNameForCurrentMap(session, npcId);
  return name || 'Inn';
}

function resolveNpcNameForCurrentMap(session: GameSession, npcId: number): string {
  const mapNpcs = getMapNpcs(session.currentMapId);
  const npcs = Array.isArray(mapNpcs?.npcs) ? mapNpcs.npcs : [];
  const npc =
    npcs.find(
      (entry: MapNpcRecord) => Number.isInteger(entry?.npcId) && (entry.npcId >>> 0) === (npcId >>> 0)
    ) || null;
  return typeof npc?.name === 'string' && npc.name.length > 0 ? npc.name : '';
}

function resolveNpcInteractionTarget(session: GameSession, request: ServerRunRequestData): MapNpcRecord | null {
  const mapNpcs = getMapNpcs(session.currentMapId);
  const npcs = Array.isArray(mapNpcs?.npcs) ? mapNpcs.npcs : [];
  if (npcs.length === 0) {
    return null;
  }

  if (request.subcmd === 0x08) {
    const npcIndex = Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] >>> 0 : 0;
    if (npcIndex >= 1 && npcIndex <= npcs.length) {
      return npcs[npcIndex - 1] || null;
    }
    return null;
  }

  const npcKey =
    Number.isInteger(request.npcId)
      ? request.npcId! >>> 0
      : Number.isInteger(request.rawArgs?.[0])
        ? request.rawArgs[0] >>> 0
        : 0;
  if (npcKey <= 0) {
    return null;
  }

  const directMatch = npcs.find((npc: MapNpcRecord) => {
    if (!Number.isInteger(npc?.npcId)) {
      return false;
    }
    if ((npc.npcId >>> 0) === npcKey) {
      return true;
    }
    return Number.isInteger(npc.resolvedSpawnEntityType) && (npc.resolvedSpawnEntityType >>> 0) === npcKey;
  });
  if (directMatch) {
    return directMatch;
  }

  if (npcKey >= 1 && npcKey <= npcs.length) {
    return npcs[npcKey - 1] || null;
  }

  return null;
}

function sendNpcShopOpen(session: GameSession, npcId: number, request: ServerRunRequestData): void {
  const npc = resolveNpcInteractionTarget(session, request);
  const catalog = resolveShopCatalog(session.currentMapId, npcId);
  if (!catalog || !Array.isArray(catalog.items) || catalog.items.length < 1) {
    session.log(`NPC shop open skipped npcId=${npcId} mapId=${session.currentMapId} reason=no-catalog`);
    return;
  }

  const npcKey = Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0;
  const speaker =
    typeof npc?.name === 'string' && npc.name.length > 0
      ? npc.name
      : typeof catalog.speaker === 'string' && catalog.speaker.length > 0
        ? catalog.speaker
        : 'Shop';
  const packet = buildNpcShopOpenPacket({
    items: catalog.items.map((item) => ({
      templateId: item.templateId,
      price: item.price,
    })),
  });
  session.activeNpcShop = {
    key: `npc-shop-${session.currentMapId}-${npcId}`,
    npcId,
    npcKey,
    mapId: session.currentMapId,
    speaker,
    openedAt: Date.now(),
    items: catalog.items.map((item) => ({
      templateId: item.templateId,
      goldPrice: item.price,
      coinPrice: item.price,
    })),
  };

  session.writePacket(
    packet,
    DEFAULT_FLAGS,
    `Sending npc shop open cmd=0x${GAME_NPC_SHOP_CMD.toString(16)} subtype=0x07 npcId=${npcId} mapId=${session.currentMapId} npcKey=${npcKey} items=${catalog.items.length} speaker="${speaker}" source=json-registry packetHex=${packet.toString('hex')}`
  );
}

function resolveShopCatalog(mapId: number, npcId: number): ShopCatalogRecord | null {
  const mapOverride = Array.isArray(NPC_SHOP_REGISTRY.mapOverrides)
    ? NPC_SHOP_REGISTRY.mapOverrides.find(
        (entry) => Number.isInteger(entry?.mapId) && entry.mapId === mapId && Number.isInteger(entry?.npcId) && entry.npcId === npcId
      ) || null
    : null;
  if (mapOverride && Array.isArray(mapOverride.items) && mapOverride.items.length > 0) {
    return normalizeShopCatalogRecord(mapOverride);
  }

  const defaultsByNpcId =
    NPC_SHOP_REGISTRY.defaultsByNpcId && typeof NPC_SHOP_REGISTRY.defaultsByNpcId === 'object'
      ? NPC_SHOP_REGISTRY.defaultsByNpcId
      : {};
  const defaultCatalog = defaultsByNpcId[String(npcId)] || null;
  if (!defaultCatalog) {
    return null;
  }
  return normalizeShopCatalogRecord(defaultCatalog);
}

function normalizeShopCatalogRecord(source: ShopCatalogRecord | Record<string, any>): ShopCatalogRecord | null {
  const items = Array.isArray(source?.items)
    ? source.items
        .filter(
          (item: Record<string, any>) =>
            Number.isInteger(item?.templateId) &&
            item.templateId > 0 &&
            Number.isInteger(item?.price) &&
            item.price > 0
        )
        .map((item: Record<string, any>) => ({
          templateId: item.templateId >>> 0,
          price: item.price >>> 0,
        }))
    : [];
  if (items.length < 1) {
    return null;
  }
  return {
    speaker: typeof source?.speaker === 'string' ? source.speaker : '',
    items,
  };
}

function handleHousewifeTeachingRequest(
  session: GameSession,
  npcId: number,
  request: ServerRunRequestData
): boolean {
  if ((npcId >>> 0) !== HOUSEWIFE_NPC_ID || request.subcmd !== 0x02) {
    return false;
  }

  const learnedLifeSkillIds = HOUSEWIFE_LIFE_SKILL_IDS.filter((skillId) =>
    Array.isArray(session.skillState?.learnedSkills)
      ? session.skillState.learnedSkills.some((entry) => Number(entry?.skillId || 0) === skillId)
      : false
  );
  const unlearnedSkillIds = HOUSEWIFE_LIFE_SKILL_IDS.filter((skillId) => !learnedLifeSkillIds.includes(skillId));
  if (unlearnedSkillIds.length === 0) {
    session.sendGameDialogue('Housewife', 'You already know every life skill I can teach.');
    return true;
  }

  const renownCost = resolveHousewifeTeachingCost(learnedLifeSkillIds.length);
  if ((session.renown || 0) < renownCost) {
    session.sendGameDialogue('Housewife', `You need ${renownCost} renown for the next life-skill lesson.`);
    return true;
  }

  const skillId = unlearnedSkillIds[0];
  const grantResult = grantSkill(session, skillId, {
    autoAssignHotbar: false,
    skipRequirementChecks: true,
  });
  if (!grantResult.ok) {
    session.sendGameDialogue('Housewife', grantResult.reason || 'I cannot teach you that skill right now.');
    return true;
  }

  if (renownCost > 0) {
    applyEffects(session, [{ kind: 'update-stat', stat: 'renown', delta: -renownCost }], {
      suppressDialogues: true,
    });
  }

  sendSkillStateSync(session, `housewife-teach skillId=${skillId}`);
  session.persistCurrentCharacter();

  const skillName = HOUSEWIFE_LIFE_SKILL_NAMES[skillId] || `skill ${skillId}`;
  const costSuffix = renownCost > 0 ? ` Cost: ${renownCost} renown.` : ' Your first lesson is free.';
  session.sendGameDialogue('Housewife', `You learned ${skillName}.${costSuffix}`);
  return true;
}

function resolveHousewifeTeachingCost(learnedCount: number): number {
  if (learnedCount <= 0) {
    return 0;
  }
  if (learnedCount === 1) {
    return 300;
  }
  if (learnedCount === 2) {
    return 600;
  }
  return 900;
}

function loadNpcShopRegistry(): ShopRegistry {
  try {
    const raw = fs.readFileSync(NPC_SHOP_REGISTRY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as ShopRegistry;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_err) {
    return {};
  }
}

export {
  handleNpcInteractionRequest,
};
