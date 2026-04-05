import { DEFAULT_FLAGS, GAME_SCRIPT_EVENT_CMD } from '../config.js';
import { parseItemContainerMoveRequest, parseWarehousePasswordRequest } from '../protocol/inbound-packets.js';
import { buildScriptEventControlPacket } from '../protocol/gameplay-packets.js';
import {
  sendInventoryFullSync,
  sendWarehouseContainerSync,
  WAREHOUSE_CONTAINER_TYPE,
} from './inventory-runtime.js';
import type { GameSession } from '../types.js';

const BAG_CONTAINER_TYPE = 1;
const DEFAULT_WAREHOUSE_PASSWORD = '000000';
const WAREHOUSE_OPEN_OK_SUBCMD = 0x33;
const WAREHOUSE_OPEN_FAIL_SUBCMD = 0x34;

export async function tryHandleWarehousePasswordPacket(session: GameSession, payload: Buffer): Promise<boolean> {
  const request = parseWarehousePasswordRequest(payload);
  if (!request) {
    return false;
  }

  const requestedPassword = normalizeWarehousePassword(request.password);
  const storedPassword = getStoredWarehousePassword(session);
  if (requestedPassword !== storedPassword) {
    session.warehouseUnlocked = false;
    sendWarehouseScriptEvent(session, WAREHOUSE_OPEN_FAIL_SUBCMD, 'Sending warehouse password failure');
    session.log(
      `Warehouse password rejected mode=${request.mode} provided="${requestedPassword}" stored="${storedPassword}"`
    );
    return true;
  }

  session.warehouseUnlocked = true;
  session.warehousePassword = storedPassword;
  await session.persistCurrentCharacter({ warehousePassword: storedPassword });
  sendWarehouseScriptEvent(session, WAREHOUSE_OPEN_OK_SUBCMD, 'Sending warehouse open');
  sendWarehouseContainerSync(session);
  session.log(
    `Warehouse password accepted mode=${request.mode} items=${Array.isArray(session.warehouseItems) ? session.warehouseItems.length : 0}`
  );
  return true;
}

export async function tryHandleWarehouseItemMovePacket(session: GameSession, payload: Buffer): Promise<boolean> {
  const request = parseItemContainerMoveRequest(payload);
  if (!request) {
    return false;
  }
  if (
    !isWarehouseMovePair(request.fromContainerType, request.toContainerType) ||
    request.instanceId <= 0
  ) {
    return false;
  }

  const sourceLabel =
    request.fromContainerType === WAREHOUSE_CONTAINER_TYPE ? 'warehouse' : 'bag';
  if (session.warehouseUnlocked !== true) {
    sendInventoryFullSync(session);
    sendWarehouseContainerSync(session);
    session.log(
      `Warehouse move rejected instanceId=${request.instanceId} from=${request.fromContainerType} to=${request.toContainerType} reason=locked`
    );
    return true;
  }

  const sourceItems =
    request.fromContainerType === WAREHOUSE_CONTAINER_TYPE
      ? ensureWarehouseItems(session)
      : Array.isArray(session.bagItems)
        ? session.bagItems
        : [];
  const targetItems =
    request.toContainerType === WAREHOUSE_CONTAINER_TYPE
      ? ensureWarehouseItems(session)
      : Array.isArray(session.bagItems)
        ? session.bagItems
        : [];
  const sourceIndex = sourceItems.findIndex((item) => (item?.instanceId >>> 0) === (request.instanceId >>> 0));
  if (sourceIndex < 0) {
    sendInventoryFullSync(session);
    sendWarehouseContainerSync(session);
    session.log(
      `Warehouse move rejected instanceId=${request.instanceId} from=${request.fromContainerType} to=${request.toContainerType} reason=unknown-${sourceLabel}-item`
    );
    return true;
  }

  const item = sourceItems[sourceIndex];
  if (!item || item.equipped === true) {
    sendInventoryFullSync(session);
    sendWarehouseContainerSync(session);
    session.log(
      `Warehouse move rejected instanceId=${request.instanceId} from=${request.fromContainerType} to=${request.toContainerType} reason=equipped-or-missing`
    );
    return true;
  }

  const targetSize =
    request.toContainerType === WAREHOUSE_CONTAINER_TYPE
      ? Math.max(1, session.warehouseSize >>> 0)
      : Math.max(1, session.bagSize >>> 0);
  const targetSlot = findNextAvailableSlot(targetItems, targetSize);
  if (targetSlot === null) {
    sendInventoryFullSync(session);
    sendWarehouseContainerSync(session);
    session.log(
      `Warehouse move rejected instanceId=${request.instanceId} from=${request.fromContainerType} to=${request.toContainerType} reason=target-full`
    );
    return true;
  }

  sourceItems.splice(sourceIndex, 1);
  item.equipped = false;
  item.slot = targetSlot;
  targetItems.push(item);

  refreshContainerLayout(session, request.fromContainerType);
  refreshContainerLayout(session, request.toContainerType);
  await session.persistCurrentCharacter();
  sendInventoryFullSync(session);
  sendWarehouseContainerSync(session);
  session.log(
    `Warehouse move ok instanceId=${request.instanceId} templateId=${item.templateId >>> 0} from=${request.fromContainerType} to=${request.toContainerType} slot=${targetSlot}`
  );
  return true;
}

function sendWarehouseScriptEvent(session: GameSession, subtype: number, message: string): void {
  session.writePacket(
    buildScriptEventControlPacket(subtype),
    DEFAULT_FLAGS,
    `${message} cmd=0x${GAME_SCRIPT_EVENT_CMD.toString(16)} sub=0x${subtype.toString(16)}`
  );
}

function getStoredWarehousePassword(session: GameSession): string {
  return normalizeWarehousePassword(session.warehousePassword || DEFAULT_WAREHOUSE_PASSWORD);
}

function normalizeWarehousePassword(value: string): string {
  const normalized =
    typeof value === 'string'
      ? value.replace(/\0/g, '').trim().slice(0, 6)
      : DEFAULT_WAREHOUSE_PASSWORD;
  return normalized.length > 0 ? normalized : DEFAULT_WAREHOUSE_PASSWORD;
}

function isWarehouseMovePair(fromContainerType: number, toContainerType: number): boolean {
  return (
    (fromContainerType === BAG_CONTAINER_TYPE && toContainerType === WAREHOUSE_CONTAINER_TYPE) ||
    (fromContainerType === WAREHOUSE_CONTAINER_TYPE && toContainerType === BAG_CONTAINER_TYPE)
  );
}

function ensureWarehouseItems(session: GameSession): any[] {
  if (!Array.isArray(session.warehouseItems)) {
    session.warehouseItems = [];
  }
  return session.warehouseItems;
}

function refreshContainerLayout(session: GameSession, containerType: number): void {
  if (containerType === BAG_CONTAINER_TYPE) {
    const bagItems = Array.isArray(session.bagItems) ? session.bagItems : [];
    const bagSize = Math.max(1, session.bagSize >>> 0);
    bagItems.sort((left, right) => (left.slot >>> 0) - (right.slot >>> 0));
    session.bagItems = bagItems;
    session.nextBagSlot = findNextAvailableSlot(bagItems, bagSize) ?? (bagSize + 1);
    return;
  }
  if (containerType === WAREHOUSE_CONTAINER_TYPE) {
    const warehouseItems = ensureWarehouseItems(session);
    const warehouseSize = Math.max(1, session.warehouseSize >>> 0);
    warehouseItems.sort((left, right) => (left.slot >>> 0) - (right.slot >>> 0));
    session.warehouseItems = warehouseItems;
    session.nextWarehouseSlot =
      findNextAvailableSlot(warehouseItems, warehouseSize) ?? (warehouseSize + 1);
  }
}

function findNextAvailableSlot(items: any[], size: number): number | null {
  const occupiedSlots = new Set<number>(
    Array.isArray(items)
      ? items
          .filter((item) => item?.equipped !== true)
          .map((item) => (Number.isInteger(item?.slot) ? (item.slot >>> 0) : 0))
          .filter((slot) => slot >= 1)
      : []
  );
  for (let slot = 1; slot <= size; slot += 1) {
    if (!occupiedSlots.has(slot)) {
      return slot;
    }
  }
  return null;
}
