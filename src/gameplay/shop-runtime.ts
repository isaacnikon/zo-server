import { GAME_ITEM_SERVICE_CMD } from '../config.js';
import { getBagItemByInstanceId, getItemDefinition, grantItemToBag, removeBagItemByInstanceId, } from '../inventory/index.js';
import { sendGrantResultPackets, sendInventoryFullSync, sendConsumeResultPackets, } from './inventory-runtime.js';
import { sendSelfStateValueUpdate } from './stat-sync.js';
import type { UnknownRecord } from '../utils.js';
import type { GameSession } from '../types.js';

const SHOP_SERVICE_BUY_GOLD = 0x01;
const SHOP_SERVICE_SELL = 0x02;
const SHOP_SERVICE_BUY_COINS = 0x0b;

export function handleNpcShopServiceRequest(session: GameSession, payload: Buffer): boolean {
  if (!Buffer.isBuffer(payload) || payload.length < 9) {
    return false;
  }

  const cmdWord = payload.readUInt16LE(0);
  if (cmdWord !== GAME_ITEM_SERVICE_CMD) {
    return false;
  }

  const serviceNpcKey = payload.readUInt16LE(2);
  const serviceMapId = payload.readUInt16LE(4);
  const serviceSubtype = payload.readUInt8(6);
  const activeShop = session.activeNpcShop;

  if (!activeShop || !Array.isArray(activeShop.items)) {
    session.log('Ignoring npc shop service request without an active npc shop context');
    return true;
  }

  if (
    serviceNpcKey !== ((activeShop.npcKey || 0) >>> 0) ||
    serviceMapId !== ((activeShop.mapId || 0) >>> 0)
  ) {
    session.log(
      `Ignoring npc shop service request for mismatched context npcKey=${serviceNpcKey} mapId=${serviceMapId} activeNpcKey=${(activeShop.npcKey || 0) >>> 0} activeMapId=${(activeShop.mapId || 0) >>> 0} activeShopNpcId=${activeShop.npcId >>> 0}`
    );
    return true;
  }

  if ((serviceSubtype >>> 0) === SHOP_SERVICE_SELL) {
    const instanceId = payload.length >= 11 ? payload.readUInt32LE(7) : 0;
    session.log(
      `Parsed npc shop service cmd=0x${cmdWord.toString(16)} npcKey=${serviceNpcKey} mapId=${serviceMapId} subtype=0x2 instanceId=${instanceId}`
    );
    return completeNpcShopSell(session, activeShop, instanceId);
  }

  const templateId = payload.readUInt16LE(7);
  session.log(
    `Parsed npc shop service cmd=0x${cmdWord.toString(16)} npcKey=${serviceNpcKey} mapId=${serviceMapId} subtype=0x${serviceSubtype.toString(16)} templateId=${templateId}`
  );

  const currency = resolveShopCurrencyBySubtype(serviceSubtype);
  if (!currency) {
    session.log(
      `Unhandled npc shop service subtype=0x${serviceSubtype.toString(16)} activeShop=${activeShop.key || 'unknown'}`
    );
    return true;
  }

  const catalogItem = activeShop.items.find((entry: UnknownRecord) => entry.templateId === (templateId >>> 0));
  if (!catalogItem) {
    session.log(
      `Rejected npc shop service templateId=${templateId} reason=not-in-active-shop key=${activeShop.key || 'unknown'}`
    );
    return true;
  }

  return completeNpcShopPurchase(session, activeShop, catalogItem, currency);
}

function completeNpcShopPurchase(
  session: GameSession,
  activeShop: UnknownRecord,
  catalogItem: UnknownRecord,
  requestedCurrency: 'coins' | 'gold'
): boolean {
  const definition = getItemDefinition(catalogItem.templateId);
  const itemName = definition?.name || `item ${catalogItem.templateId}`;
  const price = resolveDisplayPrice(catalogItem);
  const bindState = requestedCurrency === 'coins' ? 1 : 0;
  const tradeState = requestedCurrency === 'coins' ? -2 : 0;
  const grantQuantity =
    Number.isInteger(catalogItem?.quantity) && catalogItem.quantity > 0
      ? (catalogItem.quantity as number)
      :
    Number.isInteger(definition?.maxStack) && definition!.maxStack > 1
      ? definition!.maxStack
      : 1;

  if (!Number.isInteger(price) || price <= 0) {
    session.sendGameDialogue(activeShop.speaker || 'Shop', `${itemName} is not available for ${requestedCurrency}.`);
    session.log(
      `Shop purchase rejected key=${activeShop.key || 'unknown'} templateId=${catalogItem.templateId} reason=unsupported-currency requested=${requestedCurrency}`
    );
    return true;
  }

  const balance = Math.max(0, Number.isInteger(session[requestedCurrency]) ? session[requestedCurrency] : 0);
  if (balance < price) {
    session.sendGameDialogue(activeShop.speaker || 'Shop', `You need ${price} ${requestedCurrency} to buy ${itemName}.`);
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
    session.sendGameDialogue(activeShop.speaker || 'Shop', `${itemName} could not be added: ${grantResult.reason}.`);
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
  session.sendGameDialogue(activeShop.speaker || 'Shop', `You bought ${itemName} for ${price} ${requestedCurrency}.`);
  session.log(
    `Shop purchase ok key=${activeShop.key || 'unknown'} templateId=${catalogItem.templateId} qty=${grantQuantity} currency=${requestedCurrency} price=${price} bindState=${bindState} tradeState=${tradeState} balance=${session[requestedCurrency]}`
  );
  return true;
}

function completeNpcShopSell(session: GameSession, activeShop: UnknownRecord, instanceId: number): boolean {
  const bagItem = getBagItemByInstanceId(session, instanceId);
  if (!bagItem) {
    session.log(`Shop sell rejected key=${activeShop.key || 'unknown'} instanceId=${instanceId} reason=unknown-item`);
    return true;
  }

  const definition = getItemDefinition(bagItem.templateId);
  const itemName = definition?.name || `item ${bagItem.templateId}`;
  const unitSellPrice = Number.isInteger(definition?.sellPrice) ? Math.max(1, definition!.sellPrice as number) : 1;
  const quantity =
    Number.isInteger(definition?.maxStack) && definition!.maxStack > 1
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
  session.sendGameDialogue(activeShop.speaker || 'Shop', `You sold ${itemName} for ${sellPrice} coins.`);
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

function resolveCurrencyPrice(catalogItem: UnknownRecord, requestedCurrency: 'coins' | 'gold'): number | null {
  if (requestedCurrency === 'coins') {
    return Number.isInteger(catalogItem.coinPrice) && catalogItem.coinPrice > 0
      ? catalogItem.coinPrice
      : null;
  }
  return Number.isInteger(catalogItem.goldPrice) && catalogItem.goldPrice > 0
    ? catalogItem.goldPrice
    : null;
}

function resolveDisplayPrice(catalogItem: UnknownRecord): number {
  const coinPrice = resolveCurrencyPrice(catalogItem, 'coins');
  if (coinPrice !== null) {
    return coinPrice;
  }
  const goldPrice = resolveCurrencyPrice(catalogItem, 'gold');
  return goldPrice !== null ? goldPrice : 1;
}
