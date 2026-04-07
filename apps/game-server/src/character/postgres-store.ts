import { buildCharacterReplaceSql } from '../db/character-store-sql.js';
import { executePostgresSql, queryJsonArrayPostgres, queryOptionalJsonPostgres, withPostgresTransaction } from '../db/postgres-pool.js';

type CharacterRecord = Record<string, unknown>;
type CharacterSelector = {
  slot?: number | null;
  characterId?: string | null;
};

type HeaderRecord = {
  characterId: string;
  accountId: string;
  slot: number;
  selected: boolean;
  charName: string;
  birthMonth: number;
  birthDay: number;
  entityType: number;
  roleEntityType: number;
  roleData: number;
  selectedAptitude: number;
  level: number;
  experience: number;
  currentHealth: number;
  currentMana: number;
  currentRage: number;
  maxHealth: number;
  maxMana: number;
  maxRage: number;
  gold: number;
  bankGold: number;
  boundGold: number;
  coins: number;
  renown: number;
  onlineState: Record<string, unknown>;
  renownTaskDailyState: Record<string, unknown>;
  questStateV2: Record<string, unknown>;
  statusPoints: number;
  selectedPetRuntimeId: number | null;
  petSummoned: boolean;
  warehousePassword: string | null;
  frogTeleporterUnlocks: Record<string, unknown>;
  mapId: number;
  x: number;
  y: number;
  lastTownMapId: number | null;
  lastTownX: number | null;
  lastTownY: number | null;
  attackMin: number | null;
  attackMax: number | null;
  primaryAttributes: Record<string, unknown>;
  bonusAttributes: Record<string, unknown>;
  bagSize: number;
  warehouseSize: number;
  nextItemInstanceId: number;
  nextBagSlot: number;
  nextWarehouseSlot: number;
};

export class PostgresCharacterStore {
  cache: Map<string, CharacterRecord[]>;

  constructor(_filePath: string) {
    this.cache = new Map();
  }

  async list(accountId: string | null): Promise<CharacterRecord[]> {
    if (!accountId) {
      return [];
    }

    if (this.cache.has(accountId)) {
      return cloneJson(this.cache.get(accountId)!);
    }

    const headers = await queryJsonArrayPostgres<HeaderRecord>(
      `SELECT COALESCE(
         json_agg(
           json_build_object(
             'characterId', c.character_id,
             'accountId', a.account_id,
             'slot', c.slot_index,
             'selected', c.character_id = a.selected_character_id,
             'charName', c.char_name,
             'birthMonth', c.birth_month,
             'birthDay', c.birth_day,
             'entityType', c.entity_type,
             'roleEntityType', c.role_entity_type,
             'roleData', c.role_data,
             'selectedAptitude', c.selected_aptitude,
             'level', c.level,
             'experience', c.experience,
             'currentHealth', v.current_health,
             'currentMana', v.current_mana,
             'currentRage', v.current_rage,
             'maxHealth', v.max_health,
             'maxMana', v.max_mana,
             'maxRage', v.max_rage,
             'gold', c.gold,
             'bankGold', c.bank_gold,
             'boundGold', c.bound_gold,
             'coins', c.coins,
             'renown', c.renown,
             'onlineState', c.online_state,
             'renownTaskDailyState', c.renown_task_daily_state,
             'questStateV2', c.quest_state_v2,
             'statusPoints', c.status_points,
             'selectedPetRuntimeId', c.selected_pet_runtime_id,
             'petSummoned', c.pet_summoned,
             'warehousePassword', c.warehouse_password,
             'frogTeleporterUnlocks', c.frog_teleporter_unlocks,
             'mapId', c.map_id,
             'x', c.x,
             'y', c.y,
             'lastTownMapId', c.last_town_map_id,
             'lastTownX', c.last_town_x,
             'lastTownY', c.last_town_y,
             'attackMin', c.attack_min,
             'attackMax', c.attack_max,
             'primaryAttributes', json_build_object(
               'intelligence', att.intelligence,
               'vitality', att.vitality,
               'dexterity', att.dexterity,
               'strength', att.strength
             ),
             'bonusAttributes', att.bonus_attributes,
             'bagSize', inv.bag_size,
             'warehouseSize', inv.warehouse_size,
             'nextItemInstanceId', inv.next_item_instance_id,
             'nextBagSlot', inv.next_bag_slot,
             'nextWarehouseSlot', inv.next_warehouse_slot
           )
           ORDER BY c.slot_index, CASE WHEN c.character_id = a.selected_character_id THEN 0 ELSE 1 END, c.updated_at DESC
         ) FILTER (WHERE c.character_id IS NOT NULL),
         '[]'::json
       )
       FROM accounts a
       LEFT JOIN characters c ON c.account_id = a.account_id
       LEFT JOIN character_vitals v ON v.character_id = c.character_id
       LEFT JOIN character_attributes att ON att.character_id = c.character_id
       LEFT JOIN character_inventory_state inv ON inv.character_id = c.character_id
       WHERE a.account_id = $1`,
      [accountId]
    );

    if (headers.length < 1) {
      return [];
    }

    const records = await Promise.all(headers.map((header) => this.loadCharacterRecord(header)));
    this.cache.set(accountId, cloneJson(records));
    return cloneJson(records);
  }

  async get(accountId: string | null, selector: CharacterSelector = {}): Promise<CharacterRecord | null> {
    const characters = await this.list(accountId);
    const character = resolveCharacterFromList(characters, selector);
    return character ? cloneJson(character) : null;
  }

  async set(accountId: string, character: CharacterRecord): Promise<void> {
    if (!accountId || !character || typeof character !== 'object') {
      return;
    }
    const normalizedCharacter = cloneJson(character) as Record<string, any>;
    await executePostgresSql(
      buildCharacterReplaceSql(accountId, normalizedCharacter, {
        explicitCharacterId:
          typeof normalizedCharacter.characterId === 'string' && normalizedCharacter.characterId.length > 0
            ? normalizedCharacter.characterId
            : null,
      })
    );
    this.cache.delete(accountId);
  }

  async select(accountId: string, selector: CharacterSelector = {}): Promise<CharacterRecord | null> {
    const characters = await this.list(accountId);
    const targetCharacter = resolveCharacterFromList(characters, selector);
    if (!targetCharacter || typeof targetCharacter.characterId !== 'string') {
      return null;
    }

    await executePostgresSql(
      `UPDATE accounts
       SET selected_character_id = $2,
           updated_at = NOW()
       WHERE account_id = $1`,
      [accountId, targetCharacter.characterId]
    );
    this.cache.delete(accountId);
    return cloneJson({
      ...targetCharacter,
      selected: true,
    });
  }

  async delete(accountId: string, selector: CharacterSelector = {}): Promise<boolean> {
    const characters = await this.list(accountId);
    const targetCharacter = resolveCharacterFromList(characters, selector);
    if (!targetCharacter || typeof targetCharacter.characterId !== 'string') {
      return false;
    }

    const remainingCharacters = characters.filter((character) => character.characterId !== targetCharacter.characterId);
    const currentlySelectedCharacter = characters.find((character) => character.selected === true) || null;
    const nextSelectedCharacter =
      currentlySelectedCharacter &&
      currentlySelectedCharacter.characterId !== targetCharacter.characterId
        ? currentlySelectedCharacter
        : (remainingCharacters[0] || null);
    await withPostgresTransaction(async (client) => {
      await client.query(
        `DELETE FROM characters
         WHERE account_id = $1
           AND character_id = $2`,
        [accountId, targetCharacter.characterId]
      );
      await client.query(
        `UPDATE accounts
         SET selected_character_id = $2,
             updated_at = NOW()
         WHERE account_id = $1`,
        [accountId, nextSelectedCharacter?.characterId || null]
      );
    });
    this.cache.delete(accountId);
    return true;
  }

  async existsName(
    roleName: string,
    options: { excludeCharacterId?: string | null } = {}
  ): Promise<boolean> {
    const normalizedName = roleName.trim();
    if (normalizedName.length < 1) {
      return false;
    }
    const rows = await queryOptionalJsonPostgres<{ exists: boolean }>(
      `SELECT json_build_object(
         'exists',
         EXISTS(
           SELECT 1
           FROM characters
           WHERE LOWER(char_name) = LOWER($1)
             AND ($2::text IS NULL OR character_id <> $2)
         )
       )`,
      [normalizedName, options.excludeCharacterId || null]
    );
    return rows?.exists === true;
  }

  private async loadCharacterRecord(header: HeaderRecord): Promise<CharacterRecord> {
    const characterId = header.characterId;
    const [learnedSkills, hotbarSkillIds, pets, inventoryItems] = await Promise.all([
      queryJsonArrayPostgres<Record<string, unknown>>(
        `SELECT COALESCE(
           json_agg(
             json_build_object(
               'skillId', skill_id,
               'name', name,
               'level', level,
               'proficiency', proficiency,
               'sourceTemplateId', source_template_id,
               'learnedAt', learned_at,
               'requiredLevel', required_level,
               'requiredAttribute', required_attribute,
               'requiredAttributeValue', required_attribute_value,
               'hotbarSlot', hotbar_slot
             )
             ORDER BY skill_id
           ),
           '[]'::json
         )
         FROM character_skills
         WHERE character_id = $1`,
        [characterId]
      ),
      queryJsonArrayPostgres<number>(
        `SELECT COALESCE(json_agg(skill_id ORDER BY slot_index), '[]'::json)
         FROM character_skill_hotbar
         WHERE character_id = $1`,
        [characterId]
      ),
      queryJsonArrayPostgres<Record<string, unknown>>(
        `SELECT COALESCE(
           json_agg(
             json_build_object(
               'templateId', template_id,
               'awardedAt', awarded_at,
               'runtimeId', runtime_id,
               'name', name,
               'level', level,
               'generation', generation,
               'currentHealth', current_health,
               'currentMana', current_mana,
               'loyalty', loyalty,
               'statPoints', stat_points,
               'stateFlags', state_flags,
               'stats', stats
             )
             ORDER BY runtime_id
           ),
           '[]'::json
         )
         FROM character_pets
         WHERE character_id = $1`,
        [characterId]
      ),
      queryJsonArrayPostgres<Record<string, unknown>>(
        `SELECT COALESCE(
           json_agg(
             json_build_object(
               'inventoryScope', inventory_scope,
               'instanceId', instance_id,
               'templateId', template_id,
               'quantity', quantity,
               'durability', durability,
               'tradeState', trade_state,
               'bindState', bind_state,
               'refineLevel', refine_level,
               'stateCode', state_code,
               'extraValue', extra_value,
               'enhancementGrowthId', enhancement_growth_id,
               'enhancementCurrentExp', enhancement_current_exp,
               'enhancementSoulPoints', enhancement_soul_points,
               'enhancementAptitudeGrowth', enhancement_aptitude_growth,
               'enhancementUnknown13', enhancement_unknown13,
               'attributePairs', attribute_pairs,
               'equipped', equipped,
               'slot', slot
             )
             ORDER BY inventory_scope, slot, instance_id
           ),
           '[]'::json
         )
         FROM character_inventory_items
         WHERE character_id = $1`,
        [characterId]
      ),
    ]);

    const bag = inventoryItems
      .filter((item) => item.inventoryScope === 'bag')
      .map(({ inventoryScope, ...item }) => item);
    const warehouse = inventoryItems
      .filter((item) => item.inventoryScope === 'warehouse')
      .map(({ inventoryScope, ...item }) => item);

    return {
      characterId: header.characterId,
      accountId: header.accountId,
      slot: header.slot,
      selected: header.selected,
      charName: header.charName,
      birthMonth: header.birthMonth,
      birthDay: header.birthDay,
      entityType: header.entityType,
      roleEntityType: header.roleEntityType,
      roleData: header.roleData,
      selectedAptitude: header.selectedAptitude,
      level: header.level,
      experience: header.experience,
      currentHealth: header.currentHealth,
      currentMana: header.currentMana,
      currentRage: header.currentRage,
      maxHealth: header.maxHealth,
      maxMana: header.maxMana,
      maxRage: header.maxRage,
      gold: header.gold,
      bankGold: header.bankGold,
      boundGold: header.boundGold,
      coins: header.coins,
      renown: header.renown,
      onlineState: header.onlineState,
      renownTaskDailyState: header.renownTaskDailyState,
      questStateV2: header.questStateV2,
      statusPoints: header.statusPoints,
      selectedPetRuntimeId: header.selectedPetRuntimeId,
      petSummoned: header.petSummoned,
      warehousePassword: header.warehousePassword || undefined,
      frogTeleporterUnlocks: header.frogTeleporterUnlocks,
      mapId: header.mapId,
      x: header.x,
      y: header.y,
      lastTownMapId: header.lastTownMapId,
      lastTownX: header.lastTownX,
      lastTownY: header.lastTownY,
      attackMin: header.attackMin,
      attackMax: header.attackMax,
      primaryAttributes: header.primaryAttributes || {},
      bonusAttributes: header.bonusAttributes || {},
      skillState: {
        learnedSkills,
        hotbarSkillIds,
      },
      pets,
      inventory: {
        bag,
        warehouse,
        bagSize: header.bagSize,
        warehouseSize: header.warehouseSize,
        nextItemInstanceId: header.nextItemInstanceId,
        nextBagSlot: header.nextBagSlot,
        nextWarehouseSlot: header.nextWarehouseSlot,
      },
    };
  }
}

function resolveCharacterFromList(
  characters: CharacterRecord[],
  selector: CharacterSelector
): CharacterRecord | null {
  const characterId =
    typeof selector.characterId === 'string' && selector.characterId.length > 0
      ? selector.characterId
      : null;
  if (characterId) {
    return characters.find((character) => character.characterId === characterId) || null;
  }

  if (typeof selector.slot === 'number' && Number.isFinite(selector.slot)) {
    const slot = selector.slot | 0;
    return characters.find((character) => Number(character.slot) === slot) || null;
  }

  return characters.find((character) => character.selected === true) || characters[0] || null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
