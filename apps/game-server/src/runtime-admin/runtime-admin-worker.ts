import type { GameSession } from '../types.js';

import { CHARACTER_STORE_BACKEND } from '../config.js';
import { normalizePrimaryAttributes } from '../character/normalize.js';
import { sendWarehouseContainerSync, syncInventoryStateToClient } from '../gameplay/inventory-runtime.js';
import { sendSkillStateSync, ensureSkillState } from '../gameplay/skill-runtime.js';
import { getSkillDefinition } from '../skill-definitions.js';
import { sendSelfStateVitalsUpdate } from '../gameplay/stat-sync.js';
import { getItemDefinition, normalizeInventoryState } from '../inventory/index.js';
import { queryPostgres, withPostgresTransaction } from '../db/postgres-pool.js';
import { syncWorldPresence } from '../world-state.js';

type LoggerLike = {
  log(message: string): void;
};

type RuntimeAdminCommandRow = {
  command_id: number;
  character_id: string;
  command_kind: string;
  requested_by: string;
  payload: Record<string, unknown> | null;
};

type RuntimeAdminCommandResult = Record<string, unknown>;

class RuntimeAdminCommandError extends Error {
  code: string;

  constructor(code: string, message?: string) {
    super(message || code);
    this.code = code;
  }
}

const RUNTIME_ADMIN_POLL_INTERVAL_MS = Number.isFinite(Number(process.env.RUNTIME_ADMIN_POLL_INTERVAL_MS))
  ? Math.max(100, Number(process.env.RUNTIME_ADMIN_POLL_INTERVAL_MS))
  : 250;
const RUNTIME_ADMIN_BATCH_SIZE = Number.isFinite(Number(process.env.RUNTIME_ADMIN_BATCH_SIZE))
  ? Math.max(1, Number(process.env.RUNTIME_ADMIN_BATCH_SIZE) | 0)
  : 8;

export function startRuntimeAdminCommandWorker(
  sharedState: { sessionsById?: Map<number, GameSession> },
  logger: LoggerLike
): (() => void) | null {
  if (CHARACTER_STORE_BACKEND !== 'db') {
    return null;
  }

  let disposed = false;
  let polling = false;

  async function tick(): Promise<void> {
    if (disposed || polling) {
      return;
    }
    polling = true;
    try {
      const commands = await claimPendingCommands(RUNTIME_ADMIN_BATCH_SIZE);
      for (const command of commands) {
        await processCommand(sharedState, logger, command);
      }
    } catch (error) {
      logger.log(`[runtime-admin] Worker poll failed: ${(error as Error).message}`);
    } finally {
      polling = false;
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, RUNTIME_ADMIN_POLL_INTERVAL_MS);
  timer.unref?.();
  void tick();

  return () => {
    disposed = true;
    clearInterval(timer);
  };
}

async function claimPendingCommands(limit: number): Promise<RuntimeAdminCommandRow[]> {
  return withPostgresTransaction(async (client) => {
    const result = await client.query<RuntimeAdminCommandRow>(
      `WITH candidate AS (
         SELECT command_id
         FROM runtime_admin_commands
         WHERE status = 'pending'
         ORDER BY command_id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE runtime_admin_commands command_queue
       SET status = 'processing',
           attempt_count = command_queue.attempt_count + 1,
           started_at = NOW(),
           updated_at = NOW()
       FROM candidate
       WHERE command_queue.command_id = candidate.command_id
       RETURNING
         command_queue.command_id,
         command_queue.character_id,
         command_queue.command_kind,
         command_queue.requested_by,
         command_queue.payload`,
      [limit]
    );
    return result.rows;
  });
}

async function processCommand(
  sharedState: { sessionsById?: Map<number, GameSession> },
  logger: LoggerLike,
  command: RuntimeAdminCommandRow
): Promise<void> {
  try {
    const session = findLiveSession(sharedState, command.character_id);
    if (!session) {
      throw new RuntimeAdminCommandError(
        'character-offline',
        `Character "${command.character_id}" is no longer online.`
      );
    }

    const result = applyCommandToSession(session, command);
    session.persistCurrentCharacter();
    session.onlineLastPersistAt = Date.now();
    session.log(
      `[runtime-admin] Applied ${command.command_kind} by ${command.requested_by} commandId=${command.command_id}`
    );
    await completeCommand(command.command_id, result);
  } catch (error) {
    const normalizedError = normalizeRuntimeAdminError(error);
    logger.log(
      `[runtime-admin] Command ${command.command_id} failed kind=${command.command_kind} character=${command.character_id} code=${normalizedError.code} message=${normalizedError.message}`
    );
    await failCommand(command.command_id, normalizedError);
  }
}

function applyCommandToSession(
  session: GameSession,
  command: RuntimeAdminCommandRow
): RuntimeAdminCommandResult {
  const payload = command.payload && typeof command.payload === 'object' ? command.payload : {};

  switch (command.command_kind) {
    case 'character.profile.update':
      return applyProfileUpdate(session, payload);
    case 'inventory.item.add':
      return applyItemAdd(session, payload);
    case 'inventory.item.update':
      return applyItemUpdate(session, payload);
    case 'inventory.item.remove':
      return applyItemRemove(session, payload);
    case 'skill.add':
      return applySkillAdd(session, payload);
    case 'skill.update':
      return applySkillUpdate(session, payload);
    case 'skill.remove':
      return applySkillRemove(session, payload);
    default:
      throw new RuntimeAdminCommandError(
        'unsupported-live-command',
        `Unsupported live command "${command.command_kind}".`
      );
  }
}

function applyProfileUpdate(
  session: GameSession,
  payload: Record<string, unknown>
): RuntimeAdminCommandResult {
  const level = asPositiveInteger(payload.level, 'level');
  const experience = asNonNegativeInteger(payload.experience, 'experience');
  const gold = asNonNegativeInteger(payload.gold, 'gold');
  const bankGold = asNonNegativeInteger(payload.bankGold, 'bankGold');
  const boundGold = asNonNegativeInteger(payload.boundGold, 'boundGold');
  const coins = asNonNegativeInteger(payload.coins, 'coins');
  const renown = asNonNegativeInteger(payload.renown, 'renown');
  const statusPoints = asNonNegativeInteger(payload.statusPoints, 'statusPoints');
  const mapId = asNonNegativeInteger(payload.mapId, 'mapId');
  const x = asNonNegativeInteger(payload.x, 'x');
  const y = asNonNegativeInteger(payload.y, 'y');
  const currentHealth = asNonNegativeInteger(payload.currentHealth, 'currentHealth');
  const currentMana = asNonNegativeInteger(payload.currentMana, 'currentMana');
  const currentRage = asNonNegativeInteger(payload.currentRage, 'currentRage');
  const maxHealth = asNonNegativeInteger(payload.maxHealth, 'maxHealth');
  const maxMana = asNonNegativeInteger(payload.maxMana, 'maxMana');
  const maxRage = asNonNegativeInteger(payload.maxRage, 'maxRage');
  const strength = asNonNegativeInteger(payload.strength, 'strength');
  const dexterity = asNonNegativeInteger(payload.dexterity, 'dexterity');
  const vitality = asNonNegativeInteger(payload.vitality, 'vitality');
  const intelligence = asNonNegativeInteger(payload.intelligence, 'intelligence');

  const positionChanged =
    (session.currentMapId >>> 0) !== mapId ||
    (session.currentX >>> 0) !== x ||
    (session.currentY >>> 0) !== y;

  session.level = level;
  session.experience = experience;
  session.gold = gold;
  session.bankGold = bankGold;
  session.boundGold = boundGold;
  session.coins = coins;
  session.renown = renown;
  session.statusPoints = statusPoints;
  session.primaryAttributes = normalizePrimaryAttributes({
    strength,
    dexterity,
    vitality,
    intelligence,
  });
  session.clientObservedMaxHealth = maxHealth > 0 ? maxHealth : null;
  session.clientObservedMaxMana = maxMana >= 0 ? maxMana : null;
  session.maxHealth = Math.max(0, maxHealth);
  session.maxMana = Math.max(0, maxMana);
  session.maxRage = Math.max(0, maxRage);
  session.derivedMaxHealth = Math.max(0, maxHealth);
  session.derivedMaxMana = Math.max(0, maxMana);
  session.derivedMaxRage = Math.max(0, maxRage);
  session.currentHealth = Math.max(0, Math.min(currentHealth, session.maxHealth));
  session.currentMana = Math.max(0, Math.min(currentMana, session.maxMana));
  session.currentRage = Math.max(0, Math.min(currentRage, session.maxRage));

  if (positionChanged) {
    session.sendSceneEnter(mapId, x, y);
  } else {
    session.currentMapId = mapId;
    session.currentX = x;
    session.currentY = y;
  }

  session.sendSelfStateAptitudeSync();
  sendSelfStateVitalsUpdate(session, {
    health: session.currentHealth,
    mana: session.currentMana,
    rage: session.currentRage,
  });
  syncWorldPresence(session, 'runtime-admin-profile');
  session.sendPetStateSync('runtime-admin-profile');

  return {
    characterId: resolveSessionCharacterId(session),
    liveApplied: true,
    mode: 'online',
    updatedFields: [
      'level',
      'experience',
      'gold',
      'bankGold',
      'boundGold',
      'coins',
      'renown',
      'statusPoints',
      'position',
      'vitals',
      'attributes',
    ],
  };
}

function applyItemAdd(
  session: GameSession,
  payload: Record<string, unknown>
): RuntimeAdminCommandResult {
  const inventoryScope = normalizeInventoryScope(payload.inventoryScope);
  const templateId = asPositiveInteger(payload.templateId, 'templateId', 'invalid-item');
  const quantity = asPositiveInteger(payload.quantity, 'quantity', 'invalid-item');
  const definition = getItemDefinition(templateId);
  if (!definition) {
    throw new RuntimeAdminCommandError('item-not-found', `Unknown item template "${templateId}".`);
  }
  if (definition.maxStack > 0 && quantity > definition.maxStack) {
    throw new RuntimeAdminCommandError('invalid-item', 'Quantity exceeds max stack.');
  }

  const slotOverride = asOptionalNonNegativeInteger(payload.slot);
  const instanceId = resolveNextItemInstanceId(session);
  const nextSlot = slotOverride && slotOverride > 0
    ? slotOverride
    : inventoryScope === 'warehouse'
      ? Math.max(1, session.nextWarehouseSlot || 1)
      : Math.max(1, session.nextBagSlot || 1);

  const item = {
    instanceId,
    templateId,
    quantity,
    durability: asOptionalNonNegativeInteger(payload.durability, 'invalid-item'),
    tradeState: asOptionalTradeState(payload.tradeState),
    bindState: asOptionalNonNegativeInteger(payload.bindState, 'invalid-item'),
    refineLevel: asOptionalNonNegativeInteger(payload.refineLevel, 'invalid-item'),
    stateCode: asOptionalNonNegativeInteger(payload.stateCode, 'invalid-item'),
    extraValue: asOptionalNonNegativeInteger(payload.extraValue, 'invalid-item'),
    enhancementGrowthId: asOptionalNonNegativeInteger(payload.enhancementGrowthId, 'invalid-item'),
    enhancementCurrentExp: asOptionalNonNegativeInteger(payload.enhancementCurrentExp, 'invalid-item'),
    enhancementSoulPoints: asOptionalNonNegativeInteger(payload.enhancementSoulPoints, 'invalid-item'),
    enhancementAptitudeGrowth: asOptionalNonNegativeInteger(payload.enhancementAptitudeGrowth, 'invalid-item'),
    enhancementUnknown13: asOptionalNonNegativeInteger(payload.enhancementUnknown13, 'invalid-item'),
    attributePairs: normalizeAttributePairs(payload.attributePairs),
    equipped: payload.equipped === true,
    slot: nextSlot,
  };

  const bagItems = cloneItemList(session.bagItems);
  const warehouseItems = cloneItemList(session.warehouseItems);
  (inventoryScope === 'warehouse' ? warehouseItems : bagItems).push(item);
  applyNormalizedInventory(session, bagItems, warehouseItems);

  syncInventoryStateToClient(session);
  sendWarehouseContainerSync(session);
  session.refreshQuestStateForItemTemplates([templateId]);

  return {
    characterId: resolveSessionCharacterId(session),
    instanceId,
    templateId,
    quantity,
    inventoryScope,
    liveApplied: true,
    mode: 'online',
  };
}

function applyItemUpdate(
  session: GameSession,
  payload: Record<string, unknown>
): RuntimeAdminCommandResult {
  const instanceId = asPositiveInteger(payload.instanceId, 'instanceId', 'invalid-item');
  const inventoryScope = normalizeInventoryScope(payload.inventoryScope);
  const currentInventoryScope = normalizeInventoryScope(payload.currentInventoryScope ?? payload.inventoryScope);
  const templateId = asPositiveInteger(payload.templateId, 'templateId', 'invalid-item');
  const quantity = asPositiveInteger(payload.quantity, 'quantity', 'invalid-item');
  const slotOverride = asOptionalNonNegativeInteger(payload.slot, 'invalid-item');
  const definition = getItemDefinition(templateId);
  if (!definition) {
    throw new RuntimeAdminCommandError('item-not-found', `Unknown item template "${templateId}".`);
  }
  if (definition.maxStack > 0 && quantity > definition.maxStack) {
    throw new RuntimeAdminCommandError('invalid-item', 'Quantity exceeds max stack.');
  }

  const bagItems = cloneItemList(session.bagItems);
  const warehouseItems = cloneItemList(session.warehouseItems);
  const sourceItems = currentInventoryScope === 'warehouse' ? warehouseItems : bagItems;
  const targetIndex = sourceItems.findIndex((item) => (Number(item.instanceId) >>> 0) === instanceId);
  if (targetIndex < 0) {
    throw new RuntimeAdminCommandError('inventory-item-not-found', `Unknown instance "${instanceId}".`);
  }

  const currentItem = sourceItems[targetIndex]!;
  sourceItems.splice(targetIndex, 1);
  const updatedItem = {
    ...currentItem,
    templateId,
    quantity,
    durability: asOptionalNonNegativeInteger(payload.durability, 'invalid-item'),
    tradeState: asOptionalTradeState(payload.tradeState),
    bindState: asOptionalNonNegativeInteger(payload.bindState, 'invalid-item'),
    refineLevel: asOptionalNonNegativeInteger(payload.refineLevel, 'invalid-item'),
    stateCode: asOptionalNonNegativeInteger(payload.stateCode, 'invalid-item'),
    extraValue: asOptionalNonNegativeInteger(payload.extraValue, 'invalid-item'),
    enhancementGrowthId: asOptionalNonNegativeInteger(payload.enhancementGrowthId, 'invalid-item'),
    enhancementCurrentExp: asOptionalNonNegativeInteger(payload.enhancementCurrentExp, 'invalid-item'),
    enhancementSoulPoints: asOptionalNonNegativeInteger(payload.enhancementSoulPoints, 'invalid-item'),
    enhancementAptitudeGrowth: asOptionalNonNegativeInteger(payload.enhancementAptitudeGrowth, 'invalid-item'),
    enhancementUnknown13: asOptionalNonNegativeInteger(payload.enhancementUnknown13, 'invalid-item'),
    attributePairs: normalizeAttributePairs(payload.attributePairs),
    equipped: payload.equipped === true,
    slot:
      slotOverride && slotOverride > 0
        ? slotOverride
        : inventoryScope === 'warehouse'
          ? Math.max(1, session.nextWarehouseSlot || Number(currentItem.slot) || 1)
          : Math.max(1, session.nextBagSlot || Number(currentItem.slot) || 1),
  };
  (inventoryScope === 'warehouse' ? warehouseItems : bagItems).push(updatedItem);
  applyNormalizedInventory(session, bagItems, warehouseItems);

  syncInventoryStateToClient(session);
  sendWarehouseContainerSync(session);
  session.refreshQuestStateForItemTemplates(
    dedupeIntegers([Number(currentItem.templateId) >>> 0, templateId])
  );

  return {
    characterId: resolveSessionCharacterId(session),
    instanceId,
    templateId,
    inventoryScope,
    liveApplied: true,
    mode: 'online',
  };
}

function applyItemRemove(
  session: GameSession,
  payload: Record<string, unknown>
): RuntimeAdminCommandResult {
  const instanceId = asPositiveInteger(payload.instanceId, 'instanceId', 'invalid-item');
  const inventoryScope = normalizeInventoryScope(payload.inventoryScope);
  const bagItems = cloneItemList(session.bagItems);
  const warehouseItems = cloneItemList(session.warehouseItems);
  const sourceItems = inventoryScope === 'warehouse' ? warehouseItems : bagItems;
  const targetIndex = sourceItems.findIndex((item) => (Number(item.instanceId) >>> 0) === instanceId);
  if (targetIndex < 0) {
    throw new RuntimeAdminCommandError('inventory-item-not-found', `Unknown instance "${instanceId}".`);
  }

  const [removedItem] = sourceItems.splice(targetIndex, 1);
  applyNormalizedInventory(session, bagItems, warehouseItems);

  syncInventoryStateToClient(session);
  sendWarehouseContainerSync(session);
  session.refreshQuestStateForItemTemplates([Number(removedItem?.templateId || 0) >>> 0]);

  return {
    characterId: resolveSessionCharacterId(session),
    instanceId,
    inventoryScope,
    templateId: Number(removedItem?.templateId || 0) >>> 0,
    liveApplied: true,
    mode: 'online',
  };
}

function applySkillAdd(
  session: GameSession,
  payload: Record<string, unknown>
): RuntimeAdminCommandResult {
  const skillId = asPositiveInteger(payload.skillId, 'skillId', 'invalid-skill');
  const definition = getSkillDefinition(skillId);
  if (!definition) {
    throw new RuntimeAdminCommandError('skill-not-found', `Unknown skill "${skillId}".`);
  }

  const skillState = ensureSkillState(session);
  const learnedSkills = Array.isArray(skillState.learnedSkills)
    ? [...skillState.learnedSkills]
    : [];
  const existingIndex = learnedSkills.findIndex((entry: Record<string, unknown>) => (Number(entry?.skillId || 0) >>> 0) === skillId);
  const level = asPositiveInteger(payload.level ?? 1, 'level', 'invalid-skill');
  const proficiency = asOptionalNonNegativeInteger(payload.proficiency, 'invalid-skill') ?? 0;
  const hotbarSlot = asOptionalNonNegativeInteger(payload.hotbarSlot, 'invalid-skill');
  const learnedAt =
    existingIndex >= 0 && Number.isInteger(Number(learnedSkills[existingIndex]?.learnedAt))
      ? Number(learnedSkills[existingIndex]?.learnedAt)
      : Date.now();

  const nextSkill = {
    skillId,
    name: definition.name,
    level,
    proficiency,
    sourceTemplateId: Number.isInteger(definition.sourceTemplateId) ? definition.sourceTemplateId : undefined,
    learnedAt,
    requiredLevel: Number.isInteger(definition.requiredLevel) ? definition.requiredLevel : undefined,
    requiredAttribute: typeof definition.requiredAttribute === 'string' ? definition.requiredAttribute : undefined,
    requiredAttributeValue:
      Number.isInteger(definition.requiredAttributeValue) ? definition.requiredAttributeValue : undefined,
    hotbarSlot: hotbarSlot ?? null,
  };

  if (existingIndex >= 0) {
    learnedSkills[existingIndex] = {
      ...learnedSkills[existingIndex],
      ...nextSkill,
    };
  } else {
    learnedSkills.push(nextSkill);
  }

  session.skillState = applySkillHotbarState(learnedSkills, skillState.hotbarSkillIds, skillId, hotbarSlot) as any;
  sendSkillStateSync(session, `runtime-admin-skill-add:${skillId}`);

  return {
    characterId: resolveSessionCharacterId(session),
    skillId,
    liveApplied: true,
    mode: 'online',
  };
}

function applySkillUpdate(
  session: GameSession,
  payload: Record<string, unknown>
): RuntimeAdminCommandResult {
  const skillId = asPositiveInteger(payload.skillId, 'skillId', 'invalid-skill');
  const level = asPositiveInteger(payload.level ?? 1, 'level', 'invalid-skill');
  const proficiency = asOptionalNonNegativeInteger(payload.proficiency, 'invalid-skill') ?? 0;
  const hotbarSlot = asOptionalNonNegativeInteger(payload.hotbarSlot, 'invalid-skill');
  const skillState = ensureSkillState(session);
  const learnedSkills = Array.isArray(skillState.learnedSkills)
    ? [...skillState.learnedSkills]
    : [];
  const existingIndex = learnedSkills.findIndex((entry: Record<string, unknown>) => (Number(entry?.skillId || 0) >>> 0) === skillId);
  if (existingIndex < 0) {
    throw new RuntimeAdminCommandError('skill-not-found', `Unknown skill "${skillId}".`);
  }

  learnedSkills[existingIndex] = {
    ...learnedSkills[existingIndex],
    level,
    proficiency,
    hotbarSlot: hotbarSlot ?? null,
  };
  session.skillState = applySkillHotbarState(learnedSkills, skillState.hotbarSkillIds, skillId, hotbarSlot) as any;
  sendSkillStateSync(session, `runtime-admin-skill-update:${skillId}`);

  return {
    characterId: resolveSessionCharacterId(session),
    skillId,
    liveApplied: true,
    mode: 'online',
  };
}

function applySkillRemove(
  session: GameSession,
  payload: Record<string, unknown>
): RuntimeAdminCommandResult {
  const skillId = asPositiveInteger(payload.skillId, 'skillId', 'invalid-skill');
  const skillState = ensureSkillState(session);
  const learnedSkills = Array.isArray(skillState.learnedSkills)
    ? [...skillState.learnedSkills]
    : [];
  const existingIndex = learnedSkills.findIndex((entry: Record<string, unknown>) => (Number(entry?.skillId || 0) >>> 0) === skillId);
  if (existingIndex < 0) {
    throw new RuntimeAdminCommandError('skill-not-found', `Unknown skill "${skillId}".`);
  }

  learnedSkills.splice(existingIndex, 1);
  session.skillState = applySkillHotbarState(learnedSkills, skillState.hotbarSkillIds, skillId, null) as any;
  sendSkillStateSync(session, `runtime-admin-skill-remove:${skillId}`);

  return {
    characterId: resolveSessionCharacterId(session),
    skillId,
    liveApplied: true,
    mode: 'online',
  };
}

function applySkillHotbarState(
  learnedSkills: Array<Record<string, unknown>>,
  currentHotbar: unknown,
  targetSkillId: number,
  hotbarSlot: number | null
): { learnedSkills: Array<Record<string, unknown>>; hotbarSkillIds: number[] } {
  const hotbarSkillIds = Array.isArray(currentHotbar)
    ? currentHotbar.map((value) => (Number.isInteger(Number(value)) ? (Number(value) >>> 0) : 0)).slice(0, 12)
    : [];
  while (hotbarSkillIds.length < 12) {
    hotbarSkillIds.push(0);
  }

  for (let index = 0; index < hotbarSkillIds.length; index += 1) {
    if ((hotbarSkillIds[index] >>> 0) === (targetSkillId >>> 0)) {
      hotbarSkillIds[index] = 0;
    }
  }

  for (const learnedSkill of learnedSkills) {
    if ((Number(learnedSkill.skillId) >>> 0) === (targetSkillId >>> 0)) {
      learnedSkill.hotbarSlot = hotbarSlot ?? null;
      continue;
    }
    if (hotbarSlot !== null && Number(learnedSkill.hotbarSlot) === hotbarSlot) {
      learnedSkill.hotbarSlot = null;
    }
  }

  if (hotbarSlot !== null && hotbarSlot >= 0 && hotbarSlot < hotbarSkillIds.length) {
    hotbarSkillIds[hotbarSlot] = targetSkillId >>> 0;
  }

  learnedSkills.sort((left, right) => (Number(left.skillId) >>> 0) - (Number(right.skillId) >>> 0));
  return {
    learnedSkills,
    hotbarSkillIds,
  };
}

function applyNormalizedInventory(
  session: GameSession,
  bagItems: Array<Record<string, unknown>>,
  warehouseItems: Array<Record<string, unknown>>
): void {
  const normalized = normalizeInventoryState({
    inventory: {
      bag: bagItems,
      bagSize: session.bagSize,
      warehouse: warehouseItems,
      warehouseSize: session.warehouseSize,
      nextItemInstanceId: session.nextItemInstanceId,
      nextBagSlot: session.nextBagSlot,
      nextWarehouseSlot: session.nextWarehouseSlot,
    },
  }).inventory;

  session.bagItems = normalized.bag;
  session.bagSize = normalized.bagSize;
  session.warehouseItems = normalized.warehouse;
  session.warehouseSize = normalized.warehouseSize;
  session.nextItemInstanceId = normalized.nextItemInstanceId;
  session.nextBagSlot = normalized.nextBagSlot;
  session.nextWarehouseSlot = normalized.nextWarehouseSlot;
}

function resolveNextItemInstanceId(session: GameSession): number {
  const fallback =
    Math.max(
      0,
      ...(Array.isArray(session.bagItems) ? session.bagItems.map((item: Record<string, unknown>) => Number(item.instanceId) >>> 0) : []),
      ...(Array.isArray(session.warehouseItems)
        ? session.warehouseItems.map((item: Record<string, unknown>) => Number(item.instanceId) >>> 0)
        : [])
    ) + 1;
  const nextItemInstanceId = Number.isInteger(session.nextItemInstanceId) && session.nextItemInstanceId > 0
    ? session.nextItemInstanceId >>> 0
    : fallback;
  session.nextItemInstanceId = nextItemInstanceId + 1;
  return nextItemInstanceId;
}

function cloneItemList(items: unknown): Array<Record<string, unknown>> {
  return Array.isArray(items)
    ? items.map((item) => ({ ...(item as Record<string, unknown>) }))
    : [];
}

function normalizeInventoryScope(value: unknown): 'bag' | 'warehouse' {
  if (value === 'warehouse') {
    return 'warehouse';
  }
  if (value === 'bag') {
    return 'bag';
  }
  throw new RuntimeAdminCommandError('invalid-item', 'Inventory scope must be "bag" or "warehouse".');
}

function normalizeAttributePairs(value: unknown): Array<{ value: number }> {
  if (Array.isArray(value)) {
    return value
      .map((entry) => ({
        value: Number.isInteger(Number((entry as Record<string, unknown>)?.value))
          ? (Number((entry as Record<string, unknown>).value) & 0xffff)
          : 0,
      }))
      .filter((entry) => entry.value !== 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      return normalizeAttributePairs(JSON.parse(value));
    } catch {
      throw new RuntimeAdminCommandError('invalid-item', 'Attribute pairs must be valid JSON.');
    }
  }
  return [];
}

function asPositiveInteger(value: unknown, field: string, code = 'invalid-character'): number {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new RuntimeAdminCommandError(code, `Field "${field}" must be a positive integer.`);
  }
  return normalized;
}

function asNonNegativeInteger(value: unknown, field: string, code = 'invalid-character'): number {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new RuntimeAdminCommandError(code, `Field "${field}" must be a non-negative integer.`);
  }
  return normalized;
}

function asOptionalNonNegativeInteger(value: unknown, code = 'invalid-item'): number | null {
  if (value == null || value === '') {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new RuntimeAdminCommandError(code, 'One or more numeric fields are invalid.');
  }
  return normalized;
}

function asOptionalTradeState(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || (normalized < 0 && normalized !== -2)) {
    throw new RuntimeAdminCommandError('invalid-item', 'Trade state must be 0, -2, or a positive timestamp.');
  }
  return normalized;
}

function dedupeIntegers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))];
}

function findLiveSession(
  sharedState: { sessionsById?: Map<number, GameSession> },
  characterId: string
): GameSession | null {
  const sessionsById = sharedState.sessionsById instanceof Map
    ? sharedState.sessionsById
    : null;
  if (!sessionsById) {
    return null;
  }

  for (const session of sessionsById.values()) {
    if (!session || session.isGame !== true) {
      continue;
    }
    if (resolveSessionCharacterId(session) === characterId) {
      return session;
    }
  }

  return null;
}

function resolveSessionCharacterId(session: GameSession): string {
  const persisted = session.getPersistedCharacter?.();
  if (persisted && typeof persisted.characterId === 'string' && persisted.characterId.length > 0) {
    return persisted.characterId;
  }
  return String(session.charName || '');
}

function normalizeRuntimeAdminError(error: unknown): { code: string; message: string } {
  if (error instanceof RuntimeAdminCommandError) {
    return {
      code: error.code,
      message: error.message,
    };
  }
  return {
    code: 'mutation-failed',
    message: String((error as Error)?.message || 'mutation-failed'),
  };
}

async function completeCommand(commandId: number, result: RuntimeAdminCommandResult): Promise<void> {
  await queryPostgres(
    `UPDATE runtime_admin_commands
     SET status = 'completed',
         processed_at = NOW(),
         result_payload = $2::jsonb,
         error_code = NULL,
         error_message = NULL,
         updated_at = NOW()
     WHERE command_id = $1`,
    [commandId, JSON.stringify(result)]
  );
}

async function failCommand(
  commandId: number,
  error: { code: string; message: string }
): Promise<void> {
  await queryPostgres(
    `UPDATE runtime_admin_commands
     SET status = 'failed',
         processed_at = NOW(),
         error_code = $2,
         error_message = $3,
         updated_at = NOW()
     WHERE command_id = $1`,
    [commandId, error.code, error.message]
  );
}
