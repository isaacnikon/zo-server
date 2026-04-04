import type { GameSession, ServerRunRequestData } from '../types.js';

import { DEFAULT_FLAGS, GAME_NPC_SHOP_CMD } from '../config.js';
import { tryReadStaticJsonDocument } from '../db/static-json-store.js';
import { getMapEncounterLevelRange, getMapNpcs, getMapSummary } from '../map-data.js';
import { buildNpcShopOpenPacket } from '../protocol/gameplay-packets.js';
import { resolveRepoPath } from '../runtime-paths.js';
import { resolveFieldEventInteractionTarget, tryHandleFieldEventInteraction } from '../gameplay/field-event-runtime.js';
import { tryHandleConfiguredNpcInteraction } from '../gameplay/npc-interaction-rules.js';
import { isFrogTeleporterNpc, syncFrogTeleporterClientState } from '../gameplay/frog-teleporter-service.js';
import { RENOWN_TASK_ACCEPT_NPC_ID, RENOWN_TASK_ID, getRenownTaskAcceptBlocker } from '../gameplay/renown-task-runtime.js';
import { recomputeSessionMaxVitals, resolveInnRestVitals } from '../gameplay/session-flows.js';
import { primeNpcServiceContext } from '../gameplay/npc-service-runtime.js';
import { sendSelfStateValueUpdate, sendSelfStateVitalsUpdate } from '../gameplay/stat-sync.js';
import { grantSkill, sendSkillStateSync } from '../gameplay/skill-runtime.js';
import { applyEffects } from '../effects/effect-executor.js';
import { dispatchQuestEventToSession } from '../quest2/index.js';

type MapNpcRecord = Record<string, any>;
type ShopCatalogItem = { templateId: number; price: number };
type ShopCatalogRecord = { speaker?: string; items?: ShopCatalogItem[] };
type ShopRegistry = {
  defaultsByNpcId?: Record<string, ShopCatalogRecord>;
  mapOverrides?: Array<{ mapId?: number; npcId?: number; speaker?: string; items?: ShopCatalogItem[] }>;
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
    request.subcmd !== 0x15 &&
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

  const hasActiveRenownTask = Array.isArray(session.questStateV2?.active)
    ? session.questStateV2.active.some((instance) => (instance?.questId >>> 0) === RENOWN_TASK_ID)
    : false;
  if (
    resolvedNpcId === RENOWN_TASK_ACCEPT_NPC_ID &&
    (request.subcmd === 0x02 || request.subcmd === 0x03 || request.subcmd === 0x04 || request.subcmd === 0x08) &&
    !hasActiveRenownTask
  ) {
    const renownTaskAcceptBlocker = getRenownTaskAcceptBlocker(session);
    if (renownTaskAcceptBlocker) {
      session.sendGameDialogue('Thad', renownTaskAcceptBlocker);
      session.log(
        `NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} renownLimit=1`
      );
      return true;
    }
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

  const fieldEventInteraction = tryHandleFieldEventInteraction(session, resolvedNpcId, request);
  if (fieldEventInteraction.handled) {
    session.log(
      `NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} fieldEvent=${fieldEventInteraction.ruleId || 'unknown'} kind=${fieldEventInteraction.kind || 'unknown'}${fieldEventInteraction.detail ? ` ${fieldEventInteraction.detail}` : ''}`
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

  if (request.subcmd === 0x02 || request.subcmd === 0x03 || request.subcmd === 0x04 || request.subcmd === 0x08) {
    const quest2Dispatch = dispatchQuestEventToSession(session, {
      type: 'npc_interact',
      npcId: resolvedNpcId >>> 0,
      mapId: session.currentMapId >>> 0,
      scriptId: Number.isInteger(request.scriptId) ? (request.scriptId! >>> 0) : undefined,
      subtype: request.subcmd >>> 0,
      contextId: Number.isInteger(request.rawArgs?.[1]) ? (request.rawArgs[1] >>> 0) : undefined,
      rewardChoiceId: Number.isInteger(request.awardId) ? (request.awardId! >>> 0) : undefined,
    });
    if (quest2Dispatch.handled) {
      session.log(
        `NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId} quest2=1 transitions=${quest2Dispatch.transitionCount}`
      );
      return true;
    }
  }

  if (
    (request.subcmd === 0x02 || request.subcmd === 0x03 || request.subcmd === 0x04) &&
    Number.isInteger(request.scriptId) &&
    typeof session.sendServerRunScriptImmediate === 'function'
  ) {
    if (isFrogTeleporterNpc(resolvedNpcId)) {
      syncFrogTeleporterClientState(
        session,
        `frog-dialog:${session.currentMapId}:${resolvedNpcId}:${request.scriptId! >>> 0}`
      );
    }
    session.sendServerRunScriptImmediate(request.scriptId! >>> 0);
  }

  session.log(
    `NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId}`
  );
  return true;
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
  if (typeof npc?.name === 'string' && npc.name.length > 0) {
    return npc.name;
  }

  const fieldEventName =
    Array.from(session.fieldEventSpawns?.values() || []).find(
      (entry) =>
        (entry.npcId >>> 0) === (npcId >>> 0) ||
        (entry.entityType >>> 0) === (npcId >>> 0)
    )?.name || '';
  return fieldEventName;
}

function resolveNpcInteractionTarget(session: GameSession, request: ServerRunRequestData): MapNpcRecord | null {
  const mapNpcs = getMapNpcs(session.currentMapId);
  const npcs = Array.isArray(mapNpcs?.npcs) ? mapNpcs.npcs : [];

  if (request.subcmd === 0x08) {
    const npcIndex = Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] >>> 0 : 0;
    if (npcIndex >= 1 && npcIndex <= npcs.length) {
      return npcs[npcIndex - 1] || null;
    }
    return resolveFieldEventInteractionTarget(session, request) as MapNpcRecord | null;
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

  const fieldEventMatch = resolveFieldEventInteractionTarget(session, request);
  if (fieldEventMatch) {
    return fieldEventMatch as MapNpcRecord;
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
  const parsed = tryReadStaticJsonDocument<ShopRegistry>(NPC_SHOP_REGISTRY_FILE);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

export {
  handleNpcInteractionRequest,
};
