import { GAME_ITEM_SERVICE_CMD } from '../config.js';
import { getBagItemByInstanceId, getItemDefinition, grantItemToBag, removeBagItemByInstanceId, } from '../inventory/index.js';
import { sendGrantResultPackets, sendConsumeResultPackets, syncInventoryStateToClient, } from './inventory-runtime.js';
import { sendSelfStateValueUpdate } from './stat-sync.js';
import type { UnknownRecord } from '../utils.js';
import type { GameSession } from '../types.js';

const SHOP_SERVICE_BUY_GOLD = 0x01;
const SHOP_SERVICE_SELL = 0x02;
const SHOP_SERVICE_REPAIR_ONE = 0x05;
const SHOP_SERVICE_REPAIR_ALL = 0x06;
const SHOP_SERVICE_BUY_COINS = 0x0b;

export async function handleNpcShopServiceRequest(session: GameSession, payload: Buffer): Promise<boolean> {
  if (!Buffer.isBuffer(payload) || payload.length < 7) {
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

  if ((serviceSubtype >>> 0) === SHOP_SERVICE_REPAIR_ALL) {
    session.log(
      `Parsed npc shop service cmd=0x${cmdWord.toString(16)} npcKey=${serviceNpcKey} mapId=${serviceMapId} subtype=0x6 repair=all`
    );
    return await completeNpcShopRepairAll(session, activeShop);
  }

  if (payload.length < 9) {
    session.log(
      `Ignoring short npc shop service cmd=0x${cmdWord.toString(16)} npcKey=${serviceNpcKey} mapId=${serviceMapId} subtype=0x${serviceSubtype.toString(16)} len=${payload.length}`
    );
    return true;
  }

  if ((serviceSubtype >>> 0) === SHOP_SERVICE_SELL) {
    const instanceId = payload.length >= 11 ? payload.readUInt32LE(7) : 0;
    session.log(
      `Parsed npc shop service cmd=0x${cmdWord.toString(16)} npcKey=${serviceNpcKey} mapId=${serviceMapId} subtype=0x2 instanceId=${instanceId}`
    );
    return await completeNpcShopSell(session, activeShop, instanceId);
  }

  if ((serviceSubtype >>> 0) === SHOP_SERVICE_REPAIR_ONE) {
    const instanceId = payload.length >= 11 ? payload.readUInt32LE(7) : 0;
    session.log(
      `Parsed npc shop service cmd=0x${cmdWord.toString(16)} npcKey=${serviceNpcKey} mapId=${serviceMapId} subtype=0x5 instanceId=${instanceId}`
    );
    return await completeNpcShopRepairOne(session, activeShop, instanceId);
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

  return await completeNpcShopPurchase(session, activeShop, catalogItem, currency);
}

async function completeNpcShopRepairAll(session: GameSession, activeShop: UnknownRecord): Promise<boolean> {
  const repairTargets = (Array.isArray(session.bagItems) ? session.bagItems : [])
    .map((item) => buildRepairTarget(item))
    .filter((entry) => entry.maxDurability > 0 && entry.missingDurability > 0);

  if (repairTargets.length <= 0) {
    session.sendGameDialogue(activeShop.speaker || 'Shop', 'Nothing needs repair.');
    session.log(`Shop repair-all skipped key=${activeShop.key || 'unknown'} reason=no-damaged-items`);
    return true;
  }

  const repairCost = repairTargets.reduce((total, entry) => total + computeRepairCost(entry), 0);
  const currentCoins = Math.max(0, Number.isInteger(session.coins) ? session.coins : 0);

  if (currentCoins < repairCost) {
    session.sendGameDialogue(activeShop.speaker || 'Shop', `You need ${repairCost} coins to repair everything.`);
    session.log(
      `Shop repair-all rejected key=${activeShop.key || 'unknown'} reason=insufficient-coins coins=${currentCoins} cost=${repairCost} items=${repairTargets.length}`
    );
    return true;
  }

  for (const entry of repairTargets) {
    entry.item.durability = entry.maxDurability;
  }

  session.coins = currentCoins - repairCost;
  syncInventoryStateToClient(session);
  sendSelfStateValueUpdate(session, 'coins', session.coins);
  await session.persistCurrentCharacter();
  session.sendGameDialogue(
    activeShop.speaker || 'Shop',
    `Repaired ${repairTargets.length} item${repairTargets.length === 1 ? '' : 's'} for ${repairCost} coins.`
  );
  session.log(
    `Shop repair-all ok key=${activeShop.key || 'unknown'} items=${repairTargets.length} cost=${repairCost} coins=${session.coins}`
  );
  return true;
}

async function completeNpcShopRepairOne(session: GameSession, activeShop: UnknownRecord, instanceId: number): Promise<boolean> {
  const repairTarget = (Array.isArray(session.bagItems) ? session.bagItems : [])
    .map((item) => buildRepairTarget(item))
    .find((entry) => (entry.item?.instanceId >>> 0) === (instanceId >>> 0)) || null;

  if (!repairTarget) {
    session.sendGameDialogue(activeShop.speaker || 'Shop', 'That item could not be found for repair.');
    session.log(`Shop repair-one rejected key=${activeShop.key || 'unknown'} instanceId=${instanceId} reason=unknown-item`);
    return true;
  }

  if (repairTarget.maxDurability <= 0) {
    session.sendGameDialogue(activeShop.speaker || 'Shop', 'That item cannot be repaired.');
    session.log(
      `Shop repair-one rejected key=${activeShop.key || 'unknown'} instanceId=${instanceId} templateId=${repairTarget.item?.templateId || 0} reason=not-repairable`
    );
    return true;
  }

  if (repairTarget.missingDurability <= 0) {
    session.sendGameDialogue(activeShop.speaker || 'Shop', 'That item does not need repair.');
    session.log(
      `Shop repair-one skipped key=${activeShop.key || 'unknown'} instanceId=${instanceId} templateId=${repairTarget.item?.templateId || 0} reason=already-full`
    );
    return true;
  }

  const repairCost = computeRepairCost(repairTarget);
  const currentCoins = Math.max(0, Number.isInteger(session.coins) ? session.coins : 0);
  if (currentCoins < repairCost) {
    session.sendGameDialogue(activeShop.speaker || 'Shop', `You need ${repairCost} coins to repair that item.`);
    session.log(
      `Shop repair-one rejected key=${activeShop.key || 'unknown'} instanceId=${instanceId} templateId=${repairTarget.item?.templateId || 0} reason=insufficient-coins coins=${currentCoins} cost=${repairCost}`
    );
    return true;
  }

  repairTarget.item.durability = repairTarget.maxDurability;
  session.coins = currentCoins - repairCost;
  syncInventoryStateToClient(session);
  sendSelfStateValueUpdate(session, 'coins', session.coins);
  await session.persistCurrentCharacter();
  session.sendGameDialogue(
    activeShop.speaker || 'Shop',
    `Repaired ${repairTarget.definition?.name || `item ${repairTarget.item?.templateId || 0}`} for ${repairCost} coins.`
  );
  session.log(
    `Shop repair-one ok key=${activeShop.key || 'unknown'} instanceId=${instanceId} templateId=${repairTarget.item?.templateId || 0} cost=${repairCost} durability=${repairTarget.maxDurability} coins=${session.coins}`
  );
  return true;
}

async function completeNpcShopPurchase(
  session: GameSession,
  activeShop: UnknownRecord,
  catalogItem: UnknownRecord,
  requestedCurrency: 'coins' | 'gold'
): Promise<boolean> {
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
  syncInventoryStateToClient(session);
  sendSelfStateValueUpdate(session, requestedCurrency, session[requestedCurrency]);
  await session.persistCurrentCharacter();
  if (typeof session.refreshQuestStateForItemTemplates === 'function') {
    await session.refreshQuestStateForItemTemplates([catalogItem.templateId]);
  }
  session.sendGameDialogue(activeShop.speaker || 'Shop', `You bought ${itemName} for ${price} ${requestedCurrency}.`);
  session.log(
    `Shop purchase ok key=${activeShop.key || 'unknown'} templateId=${catalogItem.templateId} qty=${grantQuantity} currency=${requestedCurrency} price=${price} bindState=${bindState} tradeState=${tradeState} balance=${session[requestedCurrency]}`
  );
  return true;
}

async function completeNpcShopSell(session: GameSession, activeShop: UnknownRecord, instanceId: number): Promise<boolean> {
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
  syncInventoryStateToClient(session);
  sendSelfStateValueUpdate(session, 'coins', session.coins);
  await session.persistCurrentCharacter();
  session.sendGameDialogue(activeShop.speaker || 'Shop', `You sold ${itemName} for ${sellPrice} coins.`);
  session.log(
    `Shop sell ok key=${activeShop.key || 'unknown'} instanceId=${instanceId} templateId=${bagItem.templateId} qty=${quantity} unitPrice=${unitSellPrice} coins=${session.coins} price=${sellPrice}`
  );
  return true;
}

function buildRepairTarget(item: UnknownRecord): {
  item: UnknownRecord;
  definition: UnknownRecord | null;
  maxDurability: number;
  currentDurability: number;
  missingDurability: number;
} {
  const definition = getItemDefinition(item?.templateId >>> 0);
  const maxDurability =
    definition?.hasDurability === true && Number.isInteger(definition?.defaultQuantity) && definition.defaultQuantity! > 0
      ? (definition.defaultQuantity as number)
      : 0;
  const currentDurability =
    Number.isInteger(item?.durability) && item.durability >= 0 ? (item.durability as number) : maxDurability;
  const missingDurability = Math.max(0, maxDurability - currentDurability);
  return {
    item,
    definition,
    maxDurability,
    currentDurability,
    missingDurability,
  };
}

function computeRepairCost(repairTarget: {
  definition: UnknownRecord | null;
  maxDurability: number;
  missingDurability: number;
}): number {
  const basePrice =
    repairTarget.definition && Number.isInteger(repairTarget.definition.sellPrice)
      ? Math.max(1, repairTarget.definition.sellPrice as number)
      : 1;
  const proportionalCost = Math.ceil((basePrice * repairTarget.missingDurability) / Math.max(1, repairTarget.maxDurability));
  return Math.max(1, proportionalCost);
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
