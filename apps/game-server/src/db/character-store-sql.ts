import { numberOrDefault } from '../utils.js';
import {
  sqlBigInt,
  sqlBoolean,
  sqlInteger,
  sqlJson,
  sqlNullableInteger,
  sqlText,
  sqlTimestamp,
} from './sql-literals.js';

type CharacterRecord = Record<string, any>;

function sanitizePathSegment(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export function resolveCharacterId(accountId: string, character: CharacterRecord, explicitCharacterId?: string | null): string {
  if (typeof explicitCharacterId === 'string' && explicitCharacterId.length > 0) {
    return sanitizePathSegment(explicitCharacterId);
  }
  if (typeof character?.characterId === 'string' && character.characterId.length > 0) {
    return sanitizePathSegment(character.characterId);
  }
  const baseName =
    typeof character?.charName === 'string' && character.charName.length > 0
      ? character.charName
      : accountId;
  return sanitizePathSegment(baseName);
}

function buildInventoryItemInsertSql(
  characterId: string,
  inventoryScope: 'bag' | 'warehouse',
  item: CharacterRecord,
  updatedAt: string
): string {
  return `INSERT INTO character_inventory_items (
    character_id,
    inventory_scope,
    instance_id,
    template_id,
    quantity,
    durability,
    trade_state,
    bind_state,
    refine_level,
    state_code,
    extra_value,
    enhancement_growth_id,
    enhancement_current_exp,
    enhancement_soul_points,
    enhancement_aptitude_growth,
    enhancement_unknown13,
    attribute_pairs,
    equipped,
    slot,
    updated_at
  ) VALUES (
    ${sqlText(characterId)},
    ${sqlText(inventoryScope)},
    ${sqlBigInt(item?.instanceId, 0)},
    ${sqlInteger(item?.templateId, 0)},
    ${sqlInteger(item?.quantity, 1)},
    ${sqlNullableInteger(item?.durability)},
    ${sqlNullableInteger(item?.tradeState)},
    ${sqlNullableInteger(item?.bindState)},
    ${sqlNullableInteger(item?.refineLevel)},
    ${sqlNullableInteger(item?.stateCode)},
    ${sqlNullableInteger(item?.extraValue)},
    ${sqlNullableInteger(item?.enhancementGrowthId)},
    ${sqlNullableInteger(item?.enhancementCurrentExp)},
    ${sqlNullableInteger(item?.enhancementSoulPoints)},
    ${sqlNullableInteger(item?.enhancementAptitudeGrowth)},
    ${sqlNullableInteger(item?.enhancementUnknown13)},
    ${sqlJson(Array.isArray(item?.attributePairs) ? item.attributePairs : [])},
    ${sqlBoolean(item?.equipped === true)},
    ${sqlInteger(item?.slot, 0)},
    ${sqlTimestamp(updatedAt)}
  );`;
}

export function buildCharacterReplaceSql(
  accountId: string,
  character: CharacterRecord,
  options: {
    explicitCharacterId?: string | null;
    accountName?: string | null;
    selectedCharacterId?: string | null;
    updatedAt?: string | null;
    wrapTransaction?: boolean;
  } = {}
): string {
  const updatedAt = typeof options.updatedAt === 'string' && options.updatedAt.length > 0
    ? options.updatedAt
    : new Date().toISOString();
  const characterId = resolveCharacterId(accountId, character, options.explicitCharacterId);
  const selectedCharacterId = resolveCharacterId(
    accountId,
    character,
    options.selectedCharacterId || options.explicitCharacterId || null
  );
  const accountName =
    (typeof options.accountName === 'string' && options.accountName.length > 0
      ? options.accountName
      : character?.charName || character?.name || 'Hero') as string;
  const primaryAttributes = character?.primaryAttributes && typeof character.primaryAttributes === 'object'
    ? character.primaryAttributes
    : {};
  const bonusAttributes = character?.bonusAttributes && typeof character.bonusAttributes === 'object'
    ? character.bonusAttributes
    : {};
  const inventory = character?.inventory && typeof character.inventory === 'object' ? character.inventory : {};
  const bagItems = Array.isArray(inventory?.bag) ? inventory.bag : [];
  const warehouseItems = Array.isArray(inventory?.warehouse) ? inventory.warehouse : [];
  const learnedSkills = Array.isArray(character?.skillState?.learnedSkills) ? character.skillState.learnedSkills : [];
  const hotbarSkillIds = Array.isArray(character?.skillState?.hotbarSkillIds) ? character.skillState.hotbarSkillIds : [];
  const pets = Array.isArray(character?.pets) ? character.pets : [];

  const statements: string[] = [];
  if (options.wrapTransaction !== false) {
    statements.push('BEGIN;');
  }

  statements.push(
    `INSERT INTO accounts (account_id, name, selected_character_id, created_at, updated_at)
     VALUES (
       ${sqlText(accountId)},
       ${sqlText(accountName)},
       ${sqlText(selectedCharacterId)},
       ${sqlTimestamp(updatedAt)},
       ${sqlTimestamp(updatedAt)}
     )
     ON CONFLICT (account_id) DO UPDATE
     SET name = EXCLUDED.name,
         selected_character_id = EXCLUDED.selected_character_id,
         updated_at = EXCLUDED.updated_at;`
  );

  statements.push(
    `INSERT INTO characters (
      character_id,
      account_id,
      slot_index,
      char_name,
      birth_month,
      birth_day,
      entity_type,
      role_entity_type,
      role_data,
      selected_aptitude,
      level,
      experience,
      gold,
      bank_gold,
      bound_gold,
      coins,
      renown,
      status_points,
      selected_pet_runtime_id,
      pet_summoned,
      warehouse_password,
      online_state,
      renown_task_daily_state,
      quest_state_v2,
      frog_teleporter_unlocks,
      map_id,
      x,
      y,
      last_town_map_id,
      last_town_x,
      last_town_y,
      attack_min,
      attack_max,
      created_at,
      updated_at
    ) VALUES (
      ${sqlText(characterId)},
      ${sqlText(accountId)},
      ${sqlInteger(character?.slot, 0)},
      ${sqlText(character?.charName || character?.name || 'Hero')},
      ${sqlInteger(character?.birthMonth, 0)},
      ${sqlInteger(character?.birthDay, 0)},
      ${sqlInteger(character?.entityType, 0)},
      ${sqlInteger(character?.roleEntityType ?? character?.entityType, 0)},
      ${sqlInteger(character?.roleData, 0)},
      ${sqlInteger(character?.selectedAptitude, 0)},
      ${sqlInteger(character?.level, 1)},
      ${sqlBigInt(character?.experience, 0)},
      ${sqlBigInt(character?.gold, 0)},
      ${sqlBigInt(character?.bankGold, 0)},
      ${sqlBigInt(character?.boundGold, 0)},
      ${sqlBigInt(character?.coins, 0)},
      ${sqlBigInt(character?.renown, 0)},
      ${sqlInteger(character?.statusPoints, 0)},
      ${sqlNullableInteger(character?.selectedPetRuntimeId)},
      ${sqlBoolean(character?.petSummoned === true)},
      ${sqlText(
        typeof character?.warehousePassword === 'string' && character.warehousePassword.length > 0
          ? character.warehousePassword
          : '000000'
      )},
      ${sqlJson(character?.onlineState && typeof character.onlineState === 'object' ? character.onlineState : {})},
      ${sqlJson(
        character?.renownTaskDailyState && typeof character.renownTaskDailyState === 'object'
          ? character.renownTaskDailyState
          : {}
      )},
      ${sqlJson(
        character?.questStateV2 && typeof character.questStateV2 === 'object'
          ? character.questStateV2
          : { active: [], completed: [], failed: [] }
      )},
      ${sqlJson(
        character?.frogTeleporterUnlocks && typeof character.frogTeleporterUnlocks === 'object'
          ? character.frogTeleporterUnlocks
          : {}
      )},
      ${sqlInteger(character?.mapId, 0)},
      ${sqlInteger(character?.x, 0)},
      ${sqlInteger(character?.y, 0)},
      ${sqlNullableInteger(character?.lastTownMapId)},
      ${sqlNullableInteger(character?.lastTownX)},
      ${sqlNullableInteger(character?.lastTownY)},
      ${sqlNullableInteger(character?.attackMin)},
      ${sqlNullableInteger(character?.attackMax)},
      ${sqlTimestamp(updatedAt)},
      ${sqlTimestamp(updatedAt)}
    )
    ON CONFLICT (character_id) DO UPDATE
    SET account_id = EXCLUDED.account_id,
        slot_index = EXCLUDED.slot_index,
        char_name = EXCLUDED.char_name,
        birth_month = EXCLUDED.birth_month,
        birth_day = EXCLUDED.birth_day,
        entity_type = EXCLUDED.entity_type,
        role_entity_type = EXCLUDED.role_entity_type,
        role_data = EXCLUDED.role_data,
        selected_aptitude = EXCLUDED.selected_aptitude,
        level = EXCLUDED.level,
        experience = EXCLUDED.experience,
        gold = EXCLUDED.gold,
        bank_gold = EXCLUDED.bank_gold,
        bound_gold = EXCLUDED.bound_gold,
        coins = EXCLUDED.coins,
        renown = EXCLUDED.renown,
        status_points = EXCLUDED.status_points,
        selected_pet_runtime_id = EXCLUDED.selected_pet_runtime_id,
        pet_summoned = EXCLUDED.pet_summoned,
        warehouse_password = EXCLUDED.warehouse_password,
        online_state = EXCLUDED.online_state,
        renown_task_daily_state = EXCLUDED.renown_task_daily_state,
        quest_state_v2 = EXCLUDED.quest_state_v2,
        frog_teleporter_unlocks = EXCLUDED.frog_teleporter_unlocks,
        map_id = EXCLUDED.map_id,
        x = EXCLUDED.x,
        y = EXCLUDED.y,
        last_town_map_id = EXCLUDED.last_town_map_id,
        last_town_x = EXCLUDED.last_town_x,
        last_town_y = EXCLUDED.last_town_y,
        attack_min = EXCLUDED.attack_min,
        attack_max = EXCLUDED.attack_max,
        updated_at = EXCLUDED.updated_at;`
  );

  statements.push(
    `INSERT INTO character_vitals (
      character_id,
      current_health,
      current_mana,
      current_rage,
      max_health,
      max_mana,
      max_rage,
      updated_at
    ) VALUES (
      ${sqlText(characterId)},
      ${sqlInteger(character?.currentHealth, 0)},
      ${sqlInteger(character?.currentMana, 0)},
      ${sqlInteger(character?.currentRage, 0)},
      ${sqlInteger(character?.maxHealth, 0)},
      ${sqlInteger(character?.maxMana, 0)},
      ${sqlInteger(character?.maxRage, 0)},
      ${sqlTimestamp(updatedAt)}
    )
    ON CONFLICT (character_id) DO UPDATE
    SET current_health = EXCLUDED.current_health,
        current_mana = EXCLUDED.current_mana,
        current_rage = EXCLUDED.current_rage,
        max_health = EXCLUDED.max_health,
        max_mana = EXCLUDED.max_mana,
        max_rage = EXCLUDED.max_rage,
        updated_at = EXCLUDED.updated_at;`
  );

  statements.push(
    `INSERT INTO character_attributes (
      character_id,
      intelligence,
      vitality,
      dexterity,
      strength,
      bonus_attributes,
      updated_at
    ) VALUES (
      ${sqlText(characterId)},
      ${sqlInteger(primaryAttributes?.intelligence, 15)},
      ${sqlInteger(primaryAttributes?.vitality, 15)},
      ${sqlInteger(primaryAttributes?.dexterity, 15)},
      ${sqlInteger(primaryAttributes?.strength, 15)},
      ${sqlJson({
        intelligence: numberOrDefault(bonusAttributes?.intelligence, 0),
        vitality: numberOrDefault(bonusAttributes?.vitality, 0),
        dexterity: numberOrDefault(bonusAttributes?.dexterity, 0),
        strength: numberOrDefault(bonusAttributes?.strength, 0),
      })},
      ${sqlTimestamp(updatedAt)}
    )
    ON CONFLICT (character_id) DO UPDATE
    SET intelligence = EXCLUDED.intelligence,
        vitality = EXCLUDED.vitality,
        dexterity = EXCLUDED.dexterity,
        strength = EXCLUDED.strength,
        bonus_attributes = EXCLUDED.bonus_attributes,
        updated_at = EXCLUDED.updated_at;`
  );

  statements.push(
    `INSERT INTO character_inventory_state (
      character_id,
      bag_size,
      warehouse_size,
      next_item_instance_id,
      next_bag_slot,
      next_warehouse_slot,
      updated_at
    ) VALUES (
      ${sqlText(characterId)},
      ${sqlInteger(inventory?.bagSize, 24)},
      ${sqlInteger(inventory?.warehouseSize, 30)},
      ${sqlBigInt(inventory?.nextItemInstanceId, 1)},
      ${sqlInteger(inventory?.nextBagSlot, 0)},
      ${sqlInteger(inventory?.nextWarehouseSlot, 0)},
      ${sqlTimestamp(updatedAt)}
    )
    ON CONFLICT (character_id) DO UPDATE
    SET bag_size = EXCLUDED.bag_size,
        warehouse_size = EXCLUDED.warehouse_size,
        next_item_instance_id = EXCLUDED.next_item_instance_id,
        next_bag_slot = EXCLUDED.next_bag_slot,
        next_warehouse_slot = EXCLUDED.next_warehouse_slot,
        updated_at = EXCLUDED.updated_at;`
  );

  statements.push(`DELETE FROM character_inventory_items WHERE character_id = ${sqlText(characterId)};`);
  statements.push(`DELETE FROM character_skill_hotbar WHERE character_id = ${sqlText(characterId)};`);
  statements.push(`DELETE FROM character_skills WHERE character_id = ${sqlText(characterId)};`);
  statements.push(`DELETE FROM character_pets WHERE character_id = ${sqlText(characterId)};`);

  for (const item of bagItems) {
    statements.push(buildInventoryItemInsertSql(characterId, 'bag', item, updatedAt));
  }
  for (const item of warehouseItems) {
    statements.push(buildInventoryItemInsertSql(characterId, 'warehouse', item, updatedAt));
  }

  for (const skill of learnedSkills) {
    statements.push(
      `INSERT INTO character_skills (
        character_id,
        skill_id,
        name,
        level,
        proficiency,
        source_template_id,
        learned_at,
        required_level,
        required_attribute,
        required_attribute_value,
        hotbar_slot,
        updated_at
      ) VALUES (
        ${sqlText(characterId)},
        ${sqlInteger(skill?.skillId, 0)},
        ${sqlText(typeof skill?.name === 'string' ? skill.name : `Skill ${numberOrDefault(skill?.skillId, 0)}`)},
        ${sqlNullableInteger(skill?.level)},
        ${sqlNullableInteger(skill?.proficiency)},
        ${sqlNullableInteger(skill?.sourceTemplateId)},
        ${sqlBigInt(skill?.learnedAt, 0)},
        ${sqlNullableInteger(skill?.requiredLevel)},
        ${sqlText(typeof skill?.requiredAttribute === 'string' ? skill.requiredAttribute : null)},
        ${sqlNullableInteger(skill?.requiredAttributeValue)},
        ${sqlNullableInteger(skill?.hotbarSlot)},
        ${sqlTimestamp(updatedAt)}
      );`
    );
  }

  hotbarSkillIds.forEach((skillId: unknown, slotIndex: number) => {
    if (!Number.isInteger(skillId) || Number(skillId) <= 0) {
      return;
    }
    statements.push(
      `INSERT INTO character_skill_hotbar (character_id, slot_index, skill_id, updated_at)
       VALUES (
         ${sqlText(characterId)},
         ${sqlInteger(slotIndex, 0)},
         ${sqlInteger(skillId, 0)},
         ${sqlTimestamp(updatedAt)}
       );`
    );
  });

  for (const pet of pets) {
    statements.push(
      `INSERT INTO character_pets (
        character_id,
        runtime_id,
        template_id,
        awarded_at,
        name,
        level,
        generation,
        current_health,
        current_mana,
        loyalty,
        stat_points,
        state_flags,
        stats,
        updated_at
      ) VALUES (
        ${sqlText(characterId)},
        ${sqlBigInt(pet?.runtimeId, 0)},
        ${sqlInteger(pet?.templateId, 0)},
        ${sqlBigInt(pet?.awardedAt, 0)},
        ${sqlText(typeof pet?.name === 'string' ? pet.name : '')},
        ${sqlInteger(pet?.level, 1)},
        ${sqlInteger(pet?.generation, 0)},
        ${sqlInteger(pet?.currentHealth, 0)},
        ${sqlInteger(pet?.currentMana, 0)},
        ${sqlInteger(pet?.loyalty, 0)},
        ${sqlInteger(pet?.statPoints, 0)},
        ${sqlJson(pet?.stateFlags && typeof pet.stateFlags === 'object' ? pet.stateFlags : {})},
        ${sqlJson(pet?.stats && typeof pet.stats === 'object' ? pet.stats : {})},
        ${sqlTimestamp(updatedAt)}
      );`
    );
  }

  if (options.wrapTransaction !== false) {
    statements.push('COMMIT;');
  }
  return statements.join('\n');
}
