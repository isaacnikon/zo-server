'use strict';
export {};

import fs from 'fs';

const { resolveRepoPath } = require('../runtime-paths');
const {
  DEFAULT_FLAGS,
  GAME_ITEM_SERVICE_CMD,
  GAME_NPC_SHOP_CMD,
} = require('../config');
const {
  getBagItemByInstanceId,
  getItemDefinition,
  grantItemToBag,
  removeBagItemByInstanceId,
} = require('../inventory');
const {
  sendGrantResultPackets,
  sendInventoryFullSync,
  sendConsumeResultPackets,
} = require('./inventory-runtime');
const { sendSelfStateValueUpdate } = require('./stat-sync');
const { buildNpcShopOpenPacket } = require('../protocol/gameplay-packets');

type UnknownRecord = Record<string, any>;
type SessionLike = Record<string, any>;

interface ShopCatalogItem {
  templateId: number;
  goldPrice: number | null;
  coinPrice: number | null;
}

interface ShopCatalogDefinition {
  key: string;
  npcId: number;
  speaker: string;
  sourcePath: string;
  items: ShopCatalogItem[];
}

const SHOP_SERVICE_BUY_GOLD = 0x01;
const SHOP_SERVICE_SELL = 0x02;
const SHOP_SERVICE_BUY_COINS = 0x0b;
const SHOPS_FILE = resolveRepoPath('data', 'client-derived', 'shops.json');

const SHOP_CATALOGS_BY_NPC_ID = loadNpcShopCatalogs();

function hasNpcShopCatalog(npcId: number): boolean {
  return SHOP_CATALOGS_BY_NPC_ID.has(npcId >>> 0);
}

function openNpcShop(session: SessionLike, npcId: number): boolean {
  const catalog = SHOP_CATALOGS_BY_NPC_ID.get(npcId >>> 0) || null;
  if (!catalog || catalog.items.length < 1) {
    return false;
  }

  const items = catalog.items.map((item) => ({
    templateId: item.templateId,
    price: resolveDisplayPrice(item),
  }));
  session.activeNpcShop = {
    key: catalog.key,
    npcId: catalog.npcId,
    speaker: catalog.speaker,
    sourcePath: catalog.sourcePath,
    openedAt: Date.now(),
    items: catalog.items.map((item) => ({ ...item })),
  };
  session.writePacket(
    buildNpcShopOpenPacket(items),
    DEFAULT_FLAGS,
    `Sending npc shop open cmd=0x${GAME_NPC_SHOP_CMD.toString(16)} subtype=0x07 key=${catalog.key} npcId=${catalog.npcId} items=${items.length}`
  );
  return true;
}

function handleNpcShopServiceRequest(session: SessionLike, payload: Buffer): boolean {
  if (!Buffer.isBuffer(payload) || payload.length < 9) {
    return false;
  }

  const cmdWord = payload.readUInt16LE(0);
  if (cmdWord !== GAME_ITEM_SERVICE_CMD) {
    return false;
  }

  const serviceContextId = payload.readUInt32LE(2);
  const serviceSubtype = payload.readUInt8(6);
  const activeShop = session.activeNpcShop;

  if (!activeShop || !Array.isArray(activeShop.items)) {
    session.log('Ignoring npc shop service request without an active npc shop context');
    return true;
  }

  if (serviceContextId !== (activeShop.npcId >>> 0)) {
    session.log(
      `Ignoring npc shop service request for mismatched npcId=${serviceContextId} activeShopNpcId=${activeShop.npcId >>> 0}`
    );
    return true;
  }

  if ((serviceSubtype >>> 0) === SHOP_SERVICE_SELL) {
    const instanceId = payload.length >= 11 ? payload.readUInt32LE(7) : 0;
    session.log(
      `Parsed npc shop service cmd=0x${cmdWord.toString(16)} context=${serviceContextId} subtype=0x2 instanceId=${instanceId}`
    );
    return completeNpcShopSell(session, activeShop, instanceId);
  }

  const templateId = payload.readUInt16LE(7);
  session.log(
    `Parsed npc shop service cmd=0x${cmdWord.toString(16)} context=${serviceContextId} subtype=0x${serviceSubtype.toString(16)} templateId=${templateId}`
  );

  const currency = resolveShopCurrencyBySubtype(serviceSubtype);
  if (!currency) {
    session.log(
      `Unhandled npc shop service subtype=0x${serviceSubtype.toString(16)} activeShop=${activeShop.key || 'unknown'}`
    );
    return true;
  }

  const catalogItem = activeShop.items.find((entry: ShopCatalogItem) => entry.templateId === (templateId >>> 0));
  if (!catalogItem) {
    session.log(
      `Rejected npc shop service templateId=${templateId} reason=not-in-active-shop key=${activeShop.key || 'unknown'}`
    );
    return true;
  }

  return completeNpcShopPurchase(session, activeShop, catalogItem, currency);
}

function completeNpcShopPurchase(
  session: SessionLike,
  activeShop: UnknownRecord,
  catalogItem: ShopCatalogItem,
  requestedCurrency: 'coins' | 'gold'
): boolean {
  const definition = getItemDefinition(catalogItem.templateId);
  const itemName = definition?.name || `item ${catalogItem.templateId}`;
  const price = resolveDisplayPrice(catalogItem);
  const bindState = requestedCurrency === 'coins' ? 1 : 0;
  const tradeState = requestedCurrency === 'coins' ? -2 : 0;
  const grantQuantity =
    Number.isInteger(definition?.maxStack) && definition.maxStack > 1
      ? definition.maxStack
      : 1;

  if (!Number.isInteger(price) || price <= 0) {
    session.sendGameDialogue(
      activeShop.speaker || 'Shop',
      `${itemName} is not available for ${requestedCurrency}.`
    );
    session.log(
      `Shop purchase rejected key=${activeShop.key || 'unknown'} templateId=${catalogItem.templateId} reason=unsupported-currency requested=${requestedCurrency}`
    );
    return true;
  }

  const balance = Math.max(
    0,
    Number.isInteger(session[requestedCurrency]) ? session[requestedCurrency] : 0
  );
  if (balance < price) {
    session.sendGameDialogue(
      activeShop.speaker || 'Shop',
      `You need ${price} ${requestedCurrency} to buy ${itemName}.`
    );
    session.log(
      `Shop purchase rejected key=${activeShop.key || 'unknown'} templateId=${catalogItem.templateId} reason=insufficient-${requestedCurrency} balance=${balance} price=${price}`
    );
    return true;
  }

  const grantResult = grantItemToBag(session, catalogItem.templateId, grantQuantity, {
    bindState,
    tradeState,
  });
  if (!grantResult.ok) {
    session.sendGameDialogue(
      activeShop.speaker || 'Shop',
      `${itemName} could not be added: ${grantResult.reason}.`
    );
    session.log(
      `Shop purchase rejected key=${activeShop.key || 'unknown'} templateId=${catalogItem.templateId} reason=${grantResult.reason}`
    );
    return true;
  }

  session[requestedCurrency] = balance - price;
  sendGrantResultPackets(session, grantResult);
  sendInventoryFullSync(session);
  sendSelfStateValueUpdate(session, requestedCurrency, session[requestedCurrency]);
  session.persistCurrentCharacter();
  if (typeof session.refreshQuestStateForItemTemplates === 'function') {
    session.refreshQuestStateForItemTemplates([catalogItem.templateId]);
  }
  session.sendGameDialogue(
    activeShop.speaker || 'Shop',
    `You bought ${itemName} for ${price} ${requestedCurrency}.`
  );
  session.log(
    `Shop purchase ok key=${activeShop.key || 'unknown'} templateId=${catalogItem.templateId} qty=${grantQuantity} currency=${requestedCurrency} price=${price} bindState=${bindState} tradeState=${tradeState} balance=${session[requestedCurrency]}`
  );
  return true;
}

function completeNpcShopSell(session: SessionLike, activeShop: UnknownRecord, instanceId: number): boolean {
  const bagItem = getBagItemByInstanceId(session, instanceId);
  if (!bagItem) {
    session.log(`Shop sell rejected key=${activeShop.key || 'unknown'} instanceId=${instanceId} reason=unknown-item`);
    return true;
  }

  const definition = getItemDefinition(bagItem.templateId);
  const itemName = definition?.name || `item ${bagItem.templateId}`;
  const unitSellPrice = Number.isInteger(definition?.sellPrice) ? Math.max(1, definition.sellPrice) : 1;
  const quantity =
    Number.isInteger(definition?.maxStack) && definition.maxStack > 1
      ? Math.max(1, Number.isInteger(bagItem.quantity) ? bagItem.quantity : 1)
      : 1;
  const sellPrice = unitSellPrice * quantity;

  const removeResult = removeBagItemByInstanceId(session, instanceId);
  if (!removeResult.ok) {
    session.sendGameDialogue(activeShop.speaker || 'Shop', `${itemName} could not be sold.`);
    session.log(
      `Shop sell rejected key=${activeShop.key || 'unknown'} instanceId=${instanceId} templateId=${bagItem.templateId} reason=${removeResult.reason}`
    );
    return true;
  }

  session.coins = Math.max(0, Number.isInteger(session.coins) ? session.coins : 0) + sellPrice;
  sendConsumeResultPackets(session, removeResult);
  sendInventoryFullSync(session);
  sendSelfStateValueUpdate(session, 'coins', session.coins);
  session.persistCurrentCharacter();
  session.sendGameDialogue(
    activeShop.speaker || 'Shop',
    `You sold ${itemName} for ${sellPrice} coins.`
  );
  session.log(
    `Shop sell ok key=${activeShop.key || 'unknown'} instanceId=${instanceId} templateId=${bagItem.templateId} qty=${quantity} unitPrice=${unitSellPrice} coins=${session.coins} price=${sellPrice}`
  );
  return true;
}

function resolveShopCurrencyBySubtype(serviceSubtype: number): 'coins' | 'gold' | null {
  if ((serviceSubtype >>> 0) === SHOP_SERVICE_BUY_COINS) {
    return 'coins';
  }
  if ((serviceSubtype >>> 0) === SHOP_SERVICE_BUY_GOLD) {
    return 'gold';
  }
  return null;
}

function resolveCurrencyPrice(catalogItem: ShopCatalogItem, requestedCurrency: 'coins' | 'gold'): number | null {
  if (requestedCurrency === 'coins') {
    return Number.isInteger(catalogItem.coinPrice) && catalogItem.coinPrice !== null && catalogItem.coinPrice > 0
      ? catalogItem.coinPrice
      : null;
  }
  return Number.isInteger(catalogItem.goldPrice) && catalogItem.goldPrice !== null && catalogItem.goldPrice > 0
    ? catalogItem.goldPrice
    : null;
}

function resolveDisplayPrice(catalogItem: ShopCatalogItem): number {
  const coinPrice = resolveCurrencyPrice(catalogItem, 'coins');
  if (coinPrice !== null) {
    return coinPrice;
  }
  const goldPrice = resolveCurrencyPrice(catalogItem, 'gold');
  return goldPrice !== null ? goldPrice : 1;
}

function loadNpcShopCatalogs(): Map<number, ShopCatalogDefinition> {
  let parsed: UnknownRecord | null = null;
  try {
    parsed = JSON.parse(fs.readFileSync(SHOPS_FILE, 'utf8')) as UnknownRecord;
  } catch (_err) {
    return new Map<number, ShopCatalogDefinition>();
  }

  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const catalogs = new Map<number, ShopCatalogDefinition>();
  for (const entry of entries) {
    if (!Number.isInteger(entry?.npcId) || !Array.isArray(entry?.items)) {
      continue;
    }
    const items = entry.items
      .filter((item: UnknownRecord) => Number.isInteger(item?.templateId))
      .map((item: UnknownRecord) => ({
        templateId: item.templateId >>> 0,
        goldPrice: Number.isInteger(item?.goldPrice) && item.goldPrice > 0 ? item.goldPrice : null,
        coinPrice: Number.isInteger(item?.coinPrice) && item.coinPrice > 0 ? item.coinPrice : null,
      }));
    if (items.length < 1) {
      continue;
    }
    const npcId = entry.npcId >>> 0;
    catalogs.set(npcId, {
      key: `npc-shop-${npcId}`,
      npcId,
      speaker: typeof entry?.speaker === 'string' && entry.speaker.length > 0 ? entry.speaker : `NPC ${npcId}`,
      sourcePath:
        typeof entry?.extractedFile === 'string' && entry.extractedFile.length > 0
          ? entry.extractedFile
          : SHOPS_FILE,
      items,
    });
  }
  return catalogs;
}

module.exports = {
  handleNpcShopServiceRequest,
  hasNpcShopCatalog,
  openNpcShop,
};
