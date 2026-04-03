import { createGamePasswordDigest, createPasswordHash } from './auth.js';
import { query, queryOne, withTransaction } from './db.js';

export class PortalDataError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function normalizeUsername(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function parsePositiveInteger(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    return null;
  }
  return normalized;
}

function parseInteger(value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    return null;
  }
  return normalized;
}

function parseNullableInteger(value, options) {
  if (value == null || value === '') {
    return null;
  }
  return parseInteger(value, options);
}

function parseTradeState(value) {
  if (value == null || value === '') {
    return null;
  }
  if (value === 'tradable') {
    return 0;
  }
  if (value === 'bound') {
    return -2;
  }
  if (typeof value === 'string' && value.startsWith('timed:')) {
    return parseInteger(value.slice('timed:'.length), {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    });
  }
  if (typeof value === 'string' && value.startsWith('raw:')) {
    const parsed = parseInteger(value.slice('raw:'.length), {
      min: Number.MIN_SAFE_INTEGER,
      max: Number.MAX_SAFE_INTEGER,
    });
    if (parsed == null || (parsed < 0 && parsed !== -2)) {
      return null;
    }
    return parsed;
  }

  const parsed = parseNullableInteger(value, {
    min: Number.MIN_SAFE_INTEGER,
    max: Number.MAX_SAFE_INTEGER,
  });
  if (parsed == null || (parsed < 0 && parsed !== -2)) {
    return null;
  }
  return parsed;
}

function parseBindState(value) {
  if (value == null || value === '') {
    return null;
  }
  if (value === 'unbound') {
    return 0;
  }
  if (value === 'bound') {
    return 1;
  }
  if (
    typeof value === 'string' &&
    (value.startsWith('legacy:') || value.startsWith('raw:'))
  ) {
    const rawValue = value.slice(value.indexOf(':') + 1);
    return parseInteger(rawValue, {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });
  }
  return parseNullableInteger(value, { min: 0, max: Number.MAX_SAFE_INTEGER });
}

function parseBoolean(value) {
  return value === true || value === 'true' || value === '1' || value === 'on';
}

function normalizeInventoryScope(value) {
  return value === 'warehouse' ? 'warehouse' : value === 'bag' ? 'bag' : null;
}

function normalizeRequiredAttribute(value) {
  return ['strength', 'dexterity', 'vitality', 'intelligence'].includes(value) ? value : null;
}

function normalizeAttributePairs(value) {
  if (value == null || value === '') {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new PortalDataError('invalid-item', 'Attribute pairs must be valid JSON.');
  }
}

function isEquipmentKind(itemKind, equipSlotField) {
  return itemKind === 'weapon' || itemKind === 'armor' || equipSlotField != null;
}

function normalizeValidationStatus(value) {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : 'unknown';
}

function assertValidSignup({ username, email, password }) {
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    throw new PortalDataError('invalid-signup');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PortalDataError('invalid-signup');
  }

  if (typeof password !== 'string' || password.length < 8) {
    throw new PortalDataError('invalid-signup');
  }
}

export async function createPortalUser(input) {
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  const password = String(input.password || '');
  assertValidSignup({ username, email, password });
  const { salt, hash } = createPasswordHash(password);
  const gamePasswordMd5 = createGamePasswordDigest(password);

  try {
    const result = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO accounts (
          account_id,
          name,
          selected_character_id,
          created_at,
          updated_at
        )
        VALUES ($1, $1, NULL, NOW(), NOW())
        ON CONFLICT (account_id) DO NOTHING`,
        [username]
      );

      const insertResult = await client.query(
        `INSERT INTO portal_users (
          account_id,
          username,
          email,
          password_salt,
          password_hash,
          game_password_md5,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING portal_user_id, account_id, username, email, created_at`,
        [username, username, email, salt, hash, gamePasswordMd5]
      );

      return insertResult.rows[0] || null;
    });
    return result;
  } catch (error) {
    if (error && error.code === '23505') {
      const detail = String(error.detail || '');
      if (detail.includes('(username)')) {
        throw new PortalDataError('username-taken');
      }
      if (detail.includes('(email)')) {
        throw new PortalDataError('email-taken');
      }
    }
    throw error;
  }
}

export async function getAdminDashboard() {
  const [counts, onlinePlayers, recentCharacters] = await Promise.all([
    queryOne(
      `SELECT
        (SELECT COUNT(*)::int FROM accounts) AS total_accounts,
        (SELECT COUNT(*)::int FROM portal_users) AS total_portal_users,
        (SELECT COUNT(*)::int FROM characters) AS total_characters,
        (SELECT COUNT(*)::int FROM runtime_online_players) AS logged_in_players`
    ),
    query(
      `SELECT
        r.character_id,
        r.account_id,
        r.char_name,
        r.map_id,
        COALESCE(m.map_name, CONCAT('Map #', r.map_id::text)) AS map_name,
        r.x,
        r.y,
        r.updated_at
      FROM runtime_online_players r
      LEFT JOIN game_map_summaries m
        ON m.map_id = r.map_id
      ORDER BY updated_at DESC
      LIMIT 24`
    ),
    query(
      `SELECT
        c.character_id,
        c.account_id,
        c.char_name,
        c.level,
        c.map_id,
        COALESCE(m.map_name, CONCAT('Map #', c.map_id::text)) AS map_name,
        c.updated_at
      FROM characters c
      LEFT JOIN game_map_summaries m
        ON m.map_id = c.map_id
      ORDER BY updated_at DESC
      LIMIT 12`
    ),
  ]);

  return {
    totalAccounts: Number(counts?.total_accounts || 0),
    totalPortalUsers: Number(counts?.total_portal_users || 0),
    totalCharacters: Number(counts?.total_characters || 0),
    loggedInPlayers: Number(counts?.logged_in_players || 0),
    onlinePlayers: onlinePlayers.rows,
    recentCharacters: recentCharacters.rows,
  };
}

export async function listMapCatalog() {
  const result = await query(
    `SELECT
      map_id,
      map_name
    FROM game_map_summaries
    ORDER BY map_name ASC, map_id ASC`
  );

  return result.rows;
}

export async function listMapRoutes() {
  const result = await query(
    `SELECT
      r.source_map_id,
      COALESCE(sm.map_name, CONCAT('Map #', r.source_map_id::text)) AS source_map_name,
      r.source_scene_script_id,
      r.display_label,
      r.trigger_min_x,
      r.trigger_max_x,
      r.trigger_min_y,
      r.trigger_max_y,
      r.target_map_id,
      COALESCE(tm.map_name, CONCAT('Map #', r.target_map_id::text)) AS target_map_name,
      r.target_scene_script_id,
      r.target_x,
      r.target_y,
      r.validation_status,
      r.updated_at
    FROM game_map_routes r
    LEFT JOIN game_map_summaries sm
      ON sm.map_id = r.source_map_id
    LEFT JOIN game_map_summaries tm
      ON tm.map_id = r.target_map_id
    ORDER BY
      COALESCE(sm.map_name, CONCAT('Map #', r.source_map_id::text)) ASC,
      r.source_scene_script_id ASC`
  );

  return result.rows;
}

export async function searchItemCatalog(search) {
  const normalizedSearch = String(search || '').trim();
  if (normalizedSearch.length < 1) {
    return [];
  }

  const prefix = `${normalizedSearch}%`;
  const wildcard = `%${normalizedSearch}%`;
  const result = await query(
    `SELECT
      template_id,
      name,
      item_kind,
      max_stack,
      container_type,
      equip_slot_field,
      COALESCE(raw_data->>'description', '') AS description,
      raw_data->'combatStats' AS combat_stats
    FROM game_item_definitions
    WHERE template_id::text = $1
       OR name ILIKE $2
    ORDER BY
      CASE
        WHEN template_id::text = $1 THEN 0
        WHEN name ILIKE $3 THEN 1
        WHEN name ILIKE $2 THEN 2
        ELSE 3
      END,
      name ASC
    LIMIT 24`,
    [normalizedSearch, wildcard, prefix]
  );

  return result.rows.map((row) => ({
    ...row,
    is_equipment: isEquipmentKind(row.item_kind, row.equip_slot_field),
  }));
}

export async function searchSkillCatalog(search) {
  const normalizedSearch = String(search || '').trim();
  if (normalizedSearch.length < 1) {
    return [];
  }

  const prefix = `${normalizedSearch}%`;
  const wildcard = `%${normalizedSearch}%`;
  const result = await query(
    `SELECT
      skill_id,
      name,
      required_level,
      required_attribute,
      required_attribute_value,
      template_id
    FROM game_skill_definitions
    WHERE skill_id::text = $1
       OR name ILIKE $2
    ORDER BY
      CASE
        WHEN skill_id::text = $1 THEN 0
        WHEN name ILIKE $3 THEN 1
        WHEN name ILIKE $2 THEN 2
        ELSE 3
      END,
      skill_id ASC
    LIMIT 24`,
    [normalizedSearch, wildcard, prefix]
  );

  return result.rows;
}

export async function listCharacters(search) {
  const normalizedSearch = String(search || '').trim().toLowerCase();
  if (normalizedSearch) {
    const wildcard = `%${normalizedSearch}%`;
    const result = await query(
      `SELECT
        c.character_id,
        c.account_id,
        c.char_name,
        c.level,
        c.map_id,
        COALESCE(m.map_name, CONCAT('Map #', c.map_id::text)) AS map_name,
        c.x,
        c.y,
        EXISTS (
          SELECT 1
          FROM runtime_online_players r
          WHERE r.character_id = c.character_id
        ) AS is_online
      FROM characters c
      LEFT JOIN game_map_summaries m
        ON m.map_id = c.map_id
      WHERE LOWER(c.char_name) LIKE $1
         OR LOWER(c.account_id) LIKE $1
         OR LOWER(COALESCE(m.map_name, '')) LIKE $1
      ORDER BY is_online DESC, c.updated_at DESC
      LIMIT 100`,
      [wildcard]
    );
    return result.rows;
  }

  const result = await query(
    `SELECT
      c.character_id,
      c.account_id,
      c.char_name,
      c.level,
      c.map_id,
      COALESCE(m.map_name, CONCAT('Map #', c.map_id::text)) AS map_name,
      c.x,
      c.y,
      EXISTS (
        SELECT 1
        FROM runtime_online_players r
        WHERE r.character_id = c.character_id
      ) AS is_online
    FROM characters c
    LEFT JOIN game_map_summaries m
      ON m.map_id = c.map_id
    ORDER BY c.updated_at DESC
    LIMIT 100`
  );

  return result.rows;
}

export async function getCharacterProfile(characterId) {
  const header = await queryOne(
    `SELECT
      c.character_id,
      c.account_id,
      c.char_name,
      c.level,
      c.experience,
      c.gold,
      c.bank_gold,
      c.bound_gold,
      c.coins,
      c.renown,
      c.map_id,
      COALESCE(m.map_name, CONCAT('Map #', c.map_id::text)) AS map_name,
      c.x,
      c.y,
      c.status_points,
      c.attack_min,
      c.attack_max,
      c.updated_at,
      v.current_health,
      v.current_mana,
      v.current_rage,
      v.max_health,
      v.max_mana,
      v.max_rage,
      att.strength,
      att.dexterity,
      att.vitality,
      att.intelligence,
      EXISTS (
        SELECT 1
        FROM runtime_online_players r
        WHERE r.character_id = c.character_id
      ) AS is_online
    FROM characters c
    LEFT JOIN game_map_summaries m
      ON m.map_id = c.map_id
    LEFT JOIN character_vitals v
      ON v.character_id = c.character_id
    LEFT JOIN character_attributes att
      ON att.character_id = c.character_id
    WHERE c.character_id = $1`,
    [characterId]
  );

  if (!header) {
    return null;
  }

  const [inventory, skills] = await Promise.all([
    query(
      `SELECT
        i.inventory_scope,
        i.instance_id,
        i.template_id,
        i.quantity,
        i.durability,
        i.trade_state,
        i.bind_state,
        i.refine_level,
        i.state_code,
        i.extra_value,
        i.enhancement_growth_id,
        i.enhancement_current_exp,
        i.enhancement_soul_points,
        i.enhancement_aptitude_growth,
        i.enhancement_unknown13,
        i.attribute_pairs,
        i.equipped,
        i.slot,
        COALESCE(d.name, CONCAT('Item #', i.template_id::text)) AS item_name,
        d.item_kind,
        d.max_stack,
        d.container_type,
        d.equip_slot_field,
        COALESCE(d.raw_data->>'description', '') AS item_description
      FROM character_inventory_items i
      LEFT JOIN game_item_definitions d
        ON d.template_id = i.template_id
      WHERE i.character_id = $1
      ORDER BY i.inventory_scope, i.slot, i.instance_id`,
      [characterId]
    ),
    query(
      `SELECT
        cs.skill_id,
        cs.name,
        cs.level,
        cs.proficiency,
        cs.hotbar_slot,
        cs.source_template_id,
        cs.required_level,
        cs.required_attribute,
        cs.required_attribute_value,
        gd.template_id AS definition_template_id
      FROM character_skills
      cs
      LEFT JOIN game_skill_definitions gd
        ON gd.skill_id = cs.skill_id
      WHERE cs.character_id = $1
      ORDER BY cs.skill_id`,
      [characterId]
    ),
  ]);

  return {
    ...header,
    inventory: inventory.rows,
    skills: skills.rows,
  };
}

async function isCharacterOnline(characterId) {
  const row = await queryOne(
    `SELECT character_id
     FROM runtime_online_players
     WHERE character_id = $1`,
    [characterId]
  );

  return Boolean(row?.character_id);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function executeRealtimeAdminCommand({ characterId, commandKind, payload, requestedBy = 'admin-portal' }) {
  const inserted = await queryOne(
    `INSERT INTO runtime_admin_commands (
      character_id,
      command_kind,
      requested_by,
      payload,
      status,
      updated_at
    ) VALUES (
      $1,
      $2,
      $3,
      $4::jsonb,
      'pending',
      NOW()
    )
    RETURNING command_id`,
    [characterId, commandKind, requestedBy, JSON.stringify(payload || {})]
  );

  if (!inserted?.command_id) {
    throw new PortalDataError('mutation-failed');
  }

  const commandId = Number(inserted.command_id);
  const timeoutAt = Date.now() + 5000;

  while (Date.now() < timeoutAt) {
    const commandRow = await queryOne(
      `SELECT
        status,
        result_payload,
        error_code,
        error_message
      FROM runtime_admin_commands
      WHERE command_id = $1`,
      [commandId]
    );

    if (commandRow?.status === 'completed') {
      return commandRow.result_payload || { characterId, liveApplied: true, mode: 'online' };
    }

    if (commandRow?.status === 'failed') {
      throw new PortalDataError(
        String(commandRow.error_code || 'mutation-failed'),
        String(commandRow.error_message || commandRow.error_code || 'mutation-failed')
      );
    }

    await sleep(120);
  }

  throw new PortalDataError(
    'character-live-timeout',
    'The live game server did not apply that change before the portal timed out.'
  );
}

async function runCharacterMutation(characterId, commandKind, payload, offlineWork) {
  const online = await isCharacterOnline(characterId);
  if (!online) {
    return offlineWork();
  }

  try {
    return await executeRealtimeAdminCommand({
      characterId,
      commandKind,
      payload,
      requestedBy: String(payload?.actor || 'admin-portal'),
    });
  } catch (error) {
    if (
      error instanceof PortalDataError &&
      (error.code === 'character-offline' || error.code === 'character-session-not-found')
    ) {
      return offlineWork();
    }
    throw error;
  }
}

async function ensureCharacterOffline(client, characterId) {
  const runtimeRow = await client.query(
    `SELECT 1
     FROM runtime_online_players
     WHERE character_id = $1`,
    [characterId]
  );

  if (runtimeRow.rowCount > 0) {
    throw new PortalDataError('character-online');
  }
}

async function ensureCharacterExists(client, characterId) {
  const characterRow = await client.query(
    `SELECT character_id
     FROM characters
     WHERE character_id = $1
     FOR UPDATE`,
    [characterId]
  );

  if (characterRow.rowCount < 1) {
    throw new PortalDataError('character-not-found');
  }
}

async function ensureInventoryState(client, characterId) {
  await client.query(
    `INSERT INTO character_inventory_state (character_id)
     VALUES ($1)
     ON CONFLICT (character_id) DO NOTHING`,
    [characterId]
  );
}

async function syncSkillHotbar(client, characterId, skillId, hotbarSlot) {
  if (hotbarSlot == null) {
    await client.query(
      `DELETE FROM character_skill_hotbar
       WHERE character_id = $1
         AND skill_id = $2`,
      [characterId, skillId]
    );
    await client.query(
      `UPDATE character_skills
       SET hotbar_slot = NULL,
           updated_at = NOW()
       WHERE character_id = $1
         AND skill_id = $2`,
      [characterId, skillId]
    );
    return;
  }

  await client.query(
    `UPDATE character_skills
     SET hotbar_slot = NULL,
         updated_at = NOW()
     WHERE character_id = $1
       AND hotbar_slot = $2
       AND skill_id <> $3`,
    [characterId, hotbarSlot, skillId]
  );

  await client.query(
    `INSERT INTO character_skill_hotbar (
      character_id,
      slot_index,
      skill_id,
      updated_at
    ) VALUES ($1, $2, $3, NOW())
    ON CONFLICT (character_id, slot_index) DO UPDATE
    SET skill_id = EXCLUDED.skill_id,
        updated_at = EXCLUDED.updated_at`,
    [characterId, hotbarSlot, skillId]
  );

  await client.query(
    `UPDATE character_skills
     SET hotbar_slot = $3,
         updated_at = NOW()
     WHERE character_id = $1
       AND skill_id = $2`,
    [characterId, skillId, hotbarSlot]
  );
}

export async function updateCharacterProfile(input) {
  const characterId = String(input.characterId || '').trim();
  if (!characterId) {
    throw new PortalDataError('character-not-found');
  }

  const level = parseInteger(input.level, { min: 1, max: 999 });
  const experience = parseInteger(input.experience, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const gold = parseInteger(input.gold, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const bankGold = parseInteger(input.bankGold, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const boundGold = parseInteger(input.boundGold, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const coins = parseInteger(input.coins, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const renown = parseInteger(input.renown, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const statusPoints = parseInteger(input.statusPoints, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const mapId = parseInteger(input.mapId, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const x = parseInteger(input.x, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const y = parseInteger(input.y, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const currentHealth = parseInteger(input.currentHealth, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const currentMana = parseInteger(input.currentMana, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const currentRage = parseInteger(input.currentRage, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const maxHealth = parseInteger(input.maxHealth, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const maxMana = parseInteger(input.maxMana, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const maxRage = parseInteger(input.maxRage, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const strength = parseInteger(input.strength, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const dexterity = parseInteger(input.dexterity, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const vitality = parseInteger(input.vitality, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const intelligence = parseInteger(input.intelligence, { min: 0, max: Number.MAX_SAFE_INTEGER });

  const values = [
    level,
    experience,
    gold,
    bankGold,
    boundGold,
    coins,
    renown,
    statusPoints,
    mapId,
    x,
    y,
    currentHealth,
    currentMana,
    currentRage,
    maxHealth,
    maxMana,
    maxRage,
    strength,
    dexterity,
    vitality,
    intelligence,
  ];

  if (values.some((value) => value == null)) {
    throw new PortalDataError('invalid-character');
  }

  const commandPayload = {
    characterId,
    level,
    experience,
    gold,
    bankGold,
    boundGold,
    coins,
    renown,
    statusPoints,
    mapId,
    x,
    y,
    currentHealth,
    currentMana,
    currentRage,
    maxHealth,
    maxMana,
    maxRage,
    strength,
    dexterity,
    vitality,
    intelligence,
  };

  return runCharacterMutation(characterId, 'character.profile.update', commandPayload, () =>
    withTransaction(async (client) => {
      await ensureCharacterOffline(client, characterId);
      await ensureCharacterExists(client, characterId);

      await client.query(
        `UPDATE characters
         SET level = $2,
             experience = $3,
             gold = $4,
             bank_gold = $5,
             bound_gold = $6,
             coins = $7,
             renown = $8,
             status_points = $9,
             map_id = $10,
             x = $11,
             y = $12,
             updated_at = NOW()
         WHERE character_id = $1`,
        [
          characterId,
          level,
          experience,
          gold,
          bankGold,
          boundGold,
          coins,
          renown,
          statusPoints,
          mapId,
          x,
          y,
        ]
      );

      await client.query(
        `INSERT INTO character_vitals (
          character_id,
          current_health,
          current_mana,
          current_rage,
          max_health,
          max_mana,
          max_rage,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (character_id) DO UPDATE
        SET current_health = EXCLUDED.current_health,
            current_mana = EXCLUDED.current_mana,
            current_rage = EXCLUDED.current_rage,
            max_health = EXCLUDED.max_health,
            max_mana = EXCLUDED.max_mana,
            max_rage = EXCLUDED.max_rage,
            updated_at = EXCLUDED.updated_at`,
        [characterId, currentHealth, currentMana, currentRage, maxHealth, maxMana, maxRage]
      );

      await client.query(
        `INSERT INTO character_attributes (
          character_id,
          strength,
          dexterity,
          vitality,
          intelligence,
          bonus_attributes,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, NOW())
        ON CONFLICT (character_id) DO UPDATE
        SET strength = EXCLUDED.strength,
            dexterity = EXCLUDED.dexterity,
            vitality = EXCLUDED.vitality,
            intelligence = EXCLUDED.intelligence,
            updated_at = EXCLUDED.updated_at`,
        [characterId, strength, dexterity, vitality, intelligence]
      );

      return { characterId };
    })
  );
}

async function ensureMapExists(client, mapId) {
  const row = await client.query(
    `SELECT map_id
     FROM game_map_summaries
     WHERE map_id = $1`,
    [mapId]
  );

  if (row.rowCount < 1) {
    throw new PortalDataError('invalid-map-route');
  }
}

export async function saveMapRoute(input) {
  const sourceMapId = parsePositiveInteger(input.sourceMapId);
  const sourceSceneScriptId = parsePositiveInteger(input.sourceSceneScriptId);
  const targetMapId = parsePositiveInteger(input.targetMapId);
  const targetSceneScriptId = parseNullableInteger(input.targetSceneScriptId, { min: 1, max: Number.MAX_SAFE_INTEGER });
  const triggerMinX = parseInteger(input.triggerMinX, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const triggerMaxX = parseInteger(input.triggerMaxX, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const triggerMinY = parseInteger(input.triggerMinY, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const triggerMaxY = parseInteger(input.triggerMaxY, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const targetX = parseInteger(input.targetX, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const targetY = parseInteger(input.targetY, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const displayLabel = String(input.displayLabel || '').trim() || null;
  const validationStatus = normalizeValidationStatus(input.validationStatus);

  if (
    !sourceMapId ||
    !sourceSceneScriptId ||
    !targetMapId ||
    triggerMinX == null ||
    triggerMaxX == null ||
    triggerMinY == null ||
    triggerMaxY == null ||
    targetX == null ||
    targetY == null ||
    triggerMinX > triggerMaxX ||
    triggerMinY > triggerMaxY
  ) {
    throw new PortalDataError('invalid-map-route');
  }

  return withTransaction(async (client) => {
    await ensureMapExists(client, sourceMapId);
    await ensureMapExists(client, targetMapId);

    await client.query(
      `INSERT INTO game_map_routes (
        source_map_id,
        source_scene_script_id,
        display_label,
        trigger_min_x,
        trigger_max_x,
        trigger_min_y,
        trigger_max_y,
        target_map_id,
        target_scene_script_id,
        target_x,
        target_y,
        validation_status,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
      )
      ON CONFLICT (source_map_id, source_scene_script_id) DO UPDATE
      SET display_label = EXCLUDED.display_label,
          trigger_min_x = EXCLUDED.trigger_min_x,
          trigger_max_x = EXCLUDED.trigger_max_x,
          trigger_min_y = EXCLUDED.trigger_min_y,
          trigger_max_y = EXCLUDED.trigger_max_y,
          target_map_id = EXCLUDED.target_map_id,
          target_scene_script_id = EXCLUDED.target_scene_script_id,
          target_x = EXCLUDED.target_x,
          target_y = EXCLUDED.target_y,
          validation_status = EXCLUDED.validation_status,
          updated_at = EXCLUDED.updated_at`,
      [
        sourceMapId,
        sourceSceneScriptId,
        displayLabel,
        triggerMinX,
        triggerMaxX,
        triggerMinY,
        triggerMaxY,
        targetMapId,
        targetSceneScriptId,
        targetX,
        targetY,
        validationStatus,
      ]
    );

    return {
      sourceMapId,
      sourceSceneScriptId,
    };
  });
}

export async function deleteMapRoute(input) {
  const sourceMapId = parsePositiveInteger(input.sourceMapId);
  const sourceSceneScriptId = parsePositiveInteger(input.sourceSceneScriptId);

  if (!sourceMapId || !sourceSceneScriptId) {
    throw new PortalDataError('invalid-map-route');
  }

  const result = await query(
    `DELETE FROM game_map_routes
     WHERE source_map_id = $1
       AND source_scene_script_id = $2`,
    [sourceMapId, sourceSceneScriptId]
  );

  if (result.rowCount < 1) {
    throw new PortalDataError('map-route-not-found');
  }

  return {
    sourceMapId,
    sourceSceneScriptId,
  };
}

export async function addCharacterItem(input) {
  const characterId = String(input.characterId || '').trim();
  const templateId = parsePositiveInteger(input.templateId);
  const quantity = parsePositiveInteger(input.quantity);
  const inventoryScope = normalizeInventoryScope(input.inventoryScope);
  const actor = String(input.actor || 'admin-portal').trim() || 'admin-portal';
  const slotOverride = parseNullableInteger(input.slot, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const durability = parseNullableInteger(input.durability, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const tradeState = parseTradeState(input.tradeState);
  const bindState = parseBindState(input.bindState);
  const refineLevel = parseNullableInteger(input.refineLevel, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const stateCode = parseNullableInteger(input.stateCode, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const extraValue = parseNullableInteger(input.extraValue, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const enhancementGrowthId = parseNullableInteger(input.enhancementGrowthId, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const enhancementCurrentExp = parseNullableInteger(input.enhancementCurrentExp, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const enhancementSoulPoints = parseNullableInteger(input.enhancementSoulPoints, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const enhancementAptitudeGrowth = parseNullableInteger(input.enhancementAptitudeGrowth, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const enhancementUnknown13 = parseNullableInteger(input.enhancementUnknown13, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const equipped = parseBoolean(input.equipped);
  const attributePairs = normalizeAttributePairs(input.attributePairs);

  if (!characterId || !templateId || !quantity || !inventoryScope) {
    throw new PortalDataError('invalid-item');
  }

  const commandPayload = {
    characterId,
    templateId,
    quantity,
    inventoryScope,
    actor,
    slot: slotOverride,
    durability,
    tradeState,
    bindState,
    refineLevel,
    stateCode,
    extraValue,
    enhancementGrowthId,
    enhancementCurrentExp,
    enhancementSoulPoints,
    enhancementAptitudeGrowth,
    enhancementUnknown13,
    equipped,
    attributePairs,
  };

  return runCharacterMutation(characterId, 'inventory.item.add', commandPayload, () =>
    withTransaction(async (client) => {
      await ensureCharacterOffline(client, characterId);
      await ensureInventoryState(client, characterId);

      const characterResult = await client.query(
        `SELECT
          c.character_id,
          c.char_name,
          s.next_item_instance_id,
          s.next_bag_slot,
          s.next_warehouse_slot
        FROM characters c
        JOIN character_inventory_state s
          ON s.character_id = c.character_id
        WHERE c.character_id = $1
        FOR UPDATE OF s`,
        [characterId]
      );

      if (characterResult.rowCount < 1) {
        throw new PortalDataError('character-not-found');
      }

      const itemResult = await client.query(
        `SELECT template_id, name, item_kind, max_stack, equip_slot_field
         FROM game_item_definitions
         WHERE template_id = $1`,
        [templateId]
      );

      if (itemResult.rowCount < 1) {
        throw new PortalDataError('item-not-found');
      }

      const definition = itemResult.rows[0];
      if (Number(definition.max_stack) > 0 && quantity > Number(definition.max_stack)) {
        throw new PortalDataError('invalid-item', 'Quantity exceeds max stack.');
      }

      const state = characterResult.rows[0];
      const instanceId = Number(state.next_item_instance_id || 1);
      const slot = slotOverride != null
        ? slotOverride
        : inventoryScope === 'warehouse'
          ? Number(state.next_warehouse_slot || 0)
          : Number(state.next_bag_slot || 0);
      const slotColumn = inventoryScope === 'warehouse' ? 'next_warehouse_slot' : 'next_bag_slot';

      await client.query(
        `INSERT INTO character_inventory_items (
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
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16,
          $17::jsonb, $18, $19, NOW()
        )`,
        [
          characterId,
          inventoryScope,
          instanceId,
          templateId,
          quantity,
          durability,
          tradeState,
          bindState,
          refineLevel,
          stateCode,
          extraValue,
          enhancementGrowthId,
          enhancementCurrentExp,
          enhancementSoulPoints,
          enhancementAptitudeGrowth,
          enhancementUnknown13,
          JSON.stringify(attributePairs),
          equipped,
          slot,
        ]
      );

      await client.query(
        `UPDATE character_inventory_state
         SET next_item_instance_id = next_item_instance_id + 1,
             ${slotColumn} = GREATEST(${slotColumn}, $2 + 1),
             updated_at = NOW()
         WHERE character_id = $1`,
        [characterId, slot]
      );

      await client.query(
        `INSERT INTO character_inventory_admin_audit (
          character_id,
          action,
          inventory_scope,
          template_id,
          quantity,
          actor,
          metadata
        ) VALUES ($1, 'add', $2, $3, $4, $5, $6::jsonb)`,
        [
          characterId,
          inventoryScope,
          templateId,
          quantity,
          actor,
          JSON.stringify({
            itemName: definition.name,
            instanceId,
            slot,
            itemKind: definition.item_kind,
          }),
        ]
      );

      return {
        characterId,
        templateId,
        quantity,
        instanceId,
      };
    })
  );
}

export async function updateCharacterItem(input) {
  const characterId = String(input.characterId || '').trim();
  const instanceId = parsePositiveInteger(input.instanceId);
  const inventoryScope = normalizeInventoryScope(input.inventoryScope);
  const currentInventoryScope = normalizeInventoryScope(input.currentInventoryScope) || inventoryScope;
  const templateId = parsePositiveInteger(input.templateId);
  const quantity = parsePositiveInteger(input.quantity);
  const slot = parseInteger(input.slot, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const actor = String(input.actor || 'admin-portal').trim() || 'admin-portal';
  const durability = parseNullableInteger(input.durability, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const tradeState = parseTradeState(input.tradeState);
  const bindState = parseBindState(input.bindState);
  const refineLevel = parseNullableInteger(input.refineLevel, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const stateCode = parseNullableInteger(input.stateCode, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const extraValue = parseNullableInteger(input.extraValue, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const enhancementGrowthId = parseNullableInteger(input.enhancementGrowthId, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const enhancementCurrentExp = parseNullableInteger(input.enhancementCurrentExp, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const enhancementSoulPoints = parseNullableInteger(input.enhancementSoulPoints, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const enhancementAptitudeGrowth = parseNullableInteger(input.enhancementAptitudeGrowth, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const enhancementUnknown13 = parseNullableInteger(input.enhancementUnknown13, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const equipped = parseBoolean(input.equipped);
  const attributePairs = normalizeAttributePairs(input.attributePairs);

  if (!characterId || !instanceId || !inventoryScope || !templateId || !quantity || slot == null) {
    throw new PortalDataError('invalid-item');
  }

  const commandPayload = {
    characterId,
    instanceId,
    inventoryScope,
    currentInventoryScope,
    templateId,
    quantity,
    slot,
    actor,
    durability,
    tradeState,
    bindState,
    refineLevel,
    stateCode,
    extraValue,
    enhancementGrowthId,
    enhancementCurrentExp,
    enhancementSoulPoints,
    enhancementAptitudeGrowth,
    enhancementUnknown13,
    equipped,
    attributePairs,
  };

  return runCharacterMutation(characterId, 'inventory.item.update', commandPayload, () =>
    withTransaction(async (client) => {
      await ensureCharacterOffline(client, characterId);
      await ensureCharacterExists(client, characterId);
      await ensureInventoryState(client, characterId);

      const currentItem = await client.query(
        `SELECT
          instance_id,
          inventory_scope,
          slot,
          template_id,
          quantity
         FROM character_inventory_items
         WHERE character_id = $1
           AND inventory_scope = $3
           AND instance_id = $2
         FOR UPDATE`,
        [characterId, instanceId, currentInventoryScope]
      );

      if (currentItem.rowCount < 1) {
        throw new PortalDataError('inventory-item-not-found');
      }

      const definitionResult = await client.query(
        `SELECT template_id, max_stack
         FROM game_item_definitions
         WHERE template_id = $1`,
        [templateId]
      );

      if (definitionResult.rowCount < 1) {
        throw new PortalDataError('item-not-found');
      }

      if (Number(definitionResult.rows[0].max_stack) > 0 && quantity > Number(definitionResult.rows[0].max_stack)) {
        throw new PortalDataError('invalid-item', 'Quantity exceeds max stack.');
      }

      const updateResult = await client.query(
        `UPDATE character_inventory_items
         SET inventory_scope = $4,
             template_id = $5,
             quantity = $6,
             durability = $7,
             trade_state = $8,
             bind_state = $9,
             refine_level = $10,
             state_code = $11,
             extra_value = $12,
             enhancement_growth_id = $13,
             enhancement_current_exp = $14,
             enhancement_soul_points = $15,
             enhancement_aptitude_growth = $16,
             enhancement_unknown13 = $17,
             attribute_pairs = $18::jsonb,
             equipped = $19,
             slot = $20,
             updated_at = NOW()
         WHERE character_id = $1
           AND instance_id = $2
           AND inventory_scope = $3`,
        [
          characterId,
          instanceId,
          currentInventoryScope,
          inventoryScope,
          templateId,
          quantity,
          durability,
          tradeState,
          bindState,
          refineLevel,
          stateCode,
          extraValue,
          enhancementGrowthId,
          enhancementCurrentExp,
          enhancementSoulPoints,
          enhancementAptitudeGrowth,
          enhancementUnknown13,
          JSON.stringify(attributePairs),
          equipped,
          slot,
        ]
      );

      if (updateResult.rowCount < 1) {
        throw new PortalDataError('inventory-item-not-found');
      }

      await client.query(
        `UPDATE character_inventory_state
         SET next_bag_slot = CASE
               WHEN $2 = 'bag' THEN GREATEST(next_bag_slot, $1 + 1)
               ELSE next_bag_slot
             END,
             next_warehouse_slot = CASE
               WHEN $2 = 'warehouse' THEN GREATEST(next_warehouse_slot, $1 + 1)
               ELSE next_warehouse_slot
             END,
             updated_at = NOW()
         WHERE character_id = $3`,
        [slot, inventoryScope, characterId]
      );

      await client.query(
        `INSERT INTO character_inventory_admin_audit (
          character_id,
          action,
          inventory_scope,
          template_id,
          quantity,
          actor,
          metadata
        ) VALUES ($1, 'update', $2, $3, $4, $5, $6::jsonb)`,
        [
          characterId,
          inventoryScope,
          templateId,
          quantity,
          actor,
          JSON.stringify({
            instanceId,
            previousInventoryScope: currentInventoryScope,
            previousSlot: currentItem.rows[0].slot,
            previousTemplateId: currentItem.rows[0].template_id,
            previousQuantity: currentItem.rows[0].quantity,
            slot,
          }),
        ]
      );

      return {
        characterId,
        instanceId,
      };
    })
  );
}

export async function removeCharacterItem(input) {
  const characterId = String(input.characterId || '').trim();
  const instanceId = parsePositiveInteger(input.instanceId);
  const inventoryScope = normalizeInventoryScope(input.inventoryScope);
  const actor = String(input.actor || 'admin-portal').trim() || 'admin-portal';

  if (!characterId || !instanceId || !inventoryScope) {
    throw new PortalDataError('invalid-item');
  }

  const commandPayload = {
    characterId,
    instanceId,
    inventoryScope,
    actor,
  };

  return runCharacterMutation(characterId, 'inventory.item.remove', commandPayload, () =>
    withTransaction(async (client) => {
      await ensureCharacterOffline(client, characterId);

      const itemResult = await client.query(
        `SELECT
          i.template_id,
          i.quantity,
          i.slot,
          COALESCE(
            (
              SELECT d.name
              FROM game_item_definitions d
              WHERE d.template_id = i.template_id
            ),
            CONCAT('Item #', i.template_id::text)
          ) AS item_name
        FROM character_inventory_items i
        WHERE i.character_id = $1
          AND i.inventory_scope = $2
          AND i.instance_id = $3
        FOR UPDATE`,
        [characterId, inventoryScope, instanceId]
      );

      if (itemResult.rowCount < 1) {
        throw new PortalDataError('inventory-item-not-found');
      }

      const item = itemResult.rows[0];

      await client.query(
        `DELETE FROM character_inventory_items
         WHERE character_id = $1
           AND inventory_scope = $2
           AND instance_id = $3`,
        [characterId, inventoryScope, instanceId]
      );

      await client.query(
        `INSERT INTO character_inventory_admin_audit (
          character_id,
          action,
          inventory_scope,
          template_id,
          quantity,
          actor,
          metadata
        ) VALUES ($1, 'remove', $2, $3, $4, $5, $6::jsonb)`,
        [
          characterId,
          inventoryScope,
          item.template_id,
          item.quantity,
          actor,
          JSON.stringify({
            itemName: item.item_name,
            instanceId,
            slot: item.slot,
          }),
        ]
      );

      return {
        characterId,
        instanceId,
      };
    })
  );
}

export async function addCharacterSkill(input) {
  const characterId = String(input.characterId || '').trim();
  const skillId = parsePositiveInteger(input.skillId);
  const level = parseNullableInteger(input.level, { min: 1, max: Number.MAX_SAFE_INTEGER }) ?? 1;
  const proficiency = parseNullableInteger(input.proficiency, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const hotbarSlot = parseNullableInteger(input.hotbarSlot, { min: 0, max: 255 });

  if (!characterId || !skillId) {
    throw new PortalDataError('invalid-skill');
  }

  const commandPayload = {
    characterId,
    skillId,
    level,
    proficiency,
    hotbarSlot,
  };

  return runCharacterMutation(characterId, 'skill.add', commandPayload, () =>
    withTransaction(async (client) => {
      await ensureCharacterOffline(client, characterId);
      await ensureCharacterExists(client, characterId);

      const definitionResult = await client.query(
        `SELECT
          skill_id,
          name,
          required_level,
          required_attribute,
          required_attribute_value,
          template_id
        FROM game_skill_definitions
        WHERE skill_id = $1`,
        [skillId]
      );

      if (definitionResult.rowCount < 1) {
        throw new PortalDataError('skill-not-found');
      }

      const definition = definitionResult.rows[0];
      await client.query(
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
          $1, $2, $3, $4, $5, $6, EXTRACT(EPOCH FROM NOW())::bigint, $7, $8, $9, $10, NOW()
        )
        ON CONFLICT (character_id, skill_id) DO UPDATE
        SET name = EXCLUDED.name,
            level = EXCLUDED.level,
            proficiency = EXCLUDED.proficiency,
            source_template_id = EXCLUDED.source_template_id,
            required_level = EXCLUDED.required_level,
            required_attribute = EXCLUDED.required_attribute,
            required_attribute_value = EXCLUDED.required_attribute_value,
            hotbar_slot = EXCLUDED.hotbar_slot,
            updated_at = EXCLUDED.updated_at`,
        [
          characterId,
          skillId,
          definition.name,
          level,
          proficiency,
          definition.template_id,
          definition.required_level,
          normalizeRequiredAttribute(definition.required_attribute),
          definition.required_attribute_value,
          hotbarSlot,
        ]
      );

      await syncSkillHotbar(client, characterId, skillId, hotbarSlot);

      return {
        characterId,
        skillId,
      };
    })
  );
}

export async function updateCharacterSkill(input) {
  const characterId = String(input.characterId || '').trim();
  const skillId = parsePositiveInteger(input.skillId);
  const level = parseNullableInteger(input.level, { min: 1, max: Number.MAX_SAFE_INTEGER }) ?? 1;
  const proficiency = parseNullableInteger(input.proficiency, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const hotbarSlot = parseNullableInteger(input.hotbarSlot, { min: 0, max: 255 });

  if (!characterId || !skillId) {
    throw new PortalDataError('invalid-skill');
  }

  const commandPayload = {
    characterId,
    skillId,
    level,
    proficiency,
    hotbarSlot,
  };

  return runCharacterMutation(characterId, 'skill.update', commandPayload, () =>
    withTransaction(async (client) => {
      await ensureCharacterOffline(client, characterId);
      await ensureCharacterExists(client, characterId);

      const skillRow = await client.query(
        `SELECT skill_id
         FROM character_skills
         WHERE character_id = $1
           AND skill_id = $2
         FOR UPDATE`,
        [characterId, skillId]
      );

      if (skillRow.rowCount < 1) {
        throw new PortalDataError('skill-not-found');
      }

      await client.query(
        `UPDATE character_skills
         SET level = $3,
             proficiency = $4,
             hotbar_slot = $5,
             updated_at = NOW()
         WHERE character_id = $1
           AND skill_id = $2`,
        [characterId, skillId, level, proficiency, hotbarSlot]
      );

      await syncSkillHotbar(client, characterId, skillId, hotbarSlot);

      return {
        characterId,
        skillId,
      };
    })
  );
}

export async function removeCharacterSkill(input) {
  const characterId = String(input.characterId || '').trim();
  const skillId = parsePositiveInteger(input.skillId);

  if (!characterId || !skillId) {
    throw new PortalDataError('invalid-skill');
  }

  const commandPayload = {
    characterId,
    skillId,
  };

  return runCharacterMutation(characterId, 'skill.remove', commandPayload, () =>
    withTransaction(async (client) => {
      await ensureCharacterOffline(client, characterId);
      await ensureCharacterExists(client, characterId);

      await client.query(
        `DELETE FROM character_skill_hotbar
         WHERE character_id = $1
           AND skill_id = $2`,
        [characterId, skillId]
      );

      const deleteResult = await client.query(
        `DELETE FROM character_skills
         WHERE character_id = $1
           AND skill_id = $2`,
        [characterId, skillId]
      );

      if (deleteResult.rowCount < 1) {
        throw new PortalDataError('skill-not-found');
      }

      return {
        characterId,
        skillId,
      };
    })
  );
}
