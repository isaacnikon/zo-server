import fs from 'fs';
import type { GameSession, ServerRunRequestData } from '../types';

const { DEFAULT_FLAGS, GAME_NPC_SHOP_CMD } = require('../config');
const { getMapNpcs } = require('../map-data');
const { getBagQuantityByTemplateId } = require('../inventory');
const { interactWithNpc } = require('../quest-engine');
const { buildNpcShopOpenPacket } = require('../protocol/gameplay-packets');
const { resolveRepoPath } = require('../runtime-paths');
const { applyQuestEvents } = require('./quest-handler');

type SessionLike = GameSession & Record<string, any>;
type MapNpcRecord = Record<string, any>;
type ShopCatalogItem = { templateId: number; price: number };
type ShopCatalogRecord = { speaker?: string; items?: ShopCatalogItem[] };
type ShopRegistry = {
  defaultsByNpcId?: Record<string, ShopCatalogRecord>;
  mapOverrides?: Array<{ mapId?: number; npcId?: number; speaker?: string; items?: ShopCatalogItem[] }>;
};

const NPC_SHOP_REGISTRY_FILE = resolveRepoPath('data', 'client-derived', 'npc-shops.json');
const NPC_SHOP_REGISTRY = loadNpcShopRegistry();

function handleNpcInteractionRequest(session: SessionLike, request: ServerRunRequestData): boolean {
  if (request.subcmd !== 0x02 && request.subcmd !== 0x03 && request.subcmd !== 0x0f) {
    return false;
  }

  const npc = resolveNpcInteractionTarget(session, request);
  const npcRecordId = typeof npc?.npcId === 'number' && Number.isInteger(npc.npcId) ? (npc.npcId >>> 0) : 0;
  const requestNpcId =
    typeof request.npcId === 'number' && Number.isInteger(request.npcId) ? (request.npcId >>> 0) : 0;
  const resolvedNpcId = npcRecordId || requestNpcId || 0;
  if (resolvedNpcId <= 0) {
    return false;
  }

  if (
    (request.subcmd === 0x02 || request.subcmd === 0x03) &&
    Number.isInteger(request.scriptId) &&
    typeof session.sendServerRunScriptImmediate === 'function'
  ) {
    session.sendServerRunScriptImmediate(request.scriptId! >>> 0);
  }

  if (request.subcmd === 0x0f) {
    sendNpcShopOpen(session, resolvedNpcId, request);
  }

  if (request.subcmd === 0x03) {
    const questState = {
      activeQuests: session.activeQuests,
      completedQuests: session.completedQuests,
      level: session.level,
    };
    const events = interactWithNpc(
      questState,
      resolvedNpcId,
      (templateId: number) => getBagQuantityByTemplateId(session, templateId)
    );

    session.activeQuests = questState.activeQuests;
    session.completedQuests = questState.completedQuests;

    if (events.length > 0) {
      applyQuestEvents(session, events, 'npc-talk');
    }
  }

  session.log(
    `NPC interaction sub=0x${request.subcmd.toString(16)} resolvedNpcId=${resolvedNpcId} requestedNpcId=${requestNpcId} rawNpcKey=${Number.isInteger(request.rawArgs?.[0]) ? request.rawArgs[0] : 0} scriptId=${Number.isInteger(request.scriptId) ? request.scriptId : 0} map=${session.currentMapId}`
  );
  return true;
}

function resolveNpcInteractionTarget(session: SessionLike, request: ServerRunRequestData): MapNpcRecord | null {
  const mapNpcs = getMapNpcs(session.currentMapId);
  const npcs = Array.isArray(mapNpcs?.npcs) ? mapNpcs.npcs : [];
  if (npcs.length === 0) {
    return null;
  }

  const npcKey = Number.isInteger(request.npcId)
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

function sendNpcShopOpen(session: SessionLike, npcId: number, request: ServerRunRequestData): void {
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
