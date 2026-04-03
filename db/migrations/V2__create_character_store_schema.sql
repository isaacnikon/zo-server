CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  selected_character_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS characters (
  character_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  char_name TEXT NOT NULL,
  entity_type INTEGER NOT NULL DEFAULT 0,
  role_entity_type INTEGER NOT NULL DEFAULT 0,
  role_data INTEGER NOT NULL DEFAULT 0,
  selected_aptitude INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  experience BIGINT NOT NULL DEFAULT 0,
  gold BIGINT NOT NULL DEFAULT 0,
  bank_gold BIGINT NOT NULL DEFAULT 0,
  bound_gold BIGINT NOT NULL DEFAULT 0,
  coins BIGINT NOT NULL DEFAULT 0,
  renown BIGINT NOT NULL DEFAULT 0,
  status_points INTEGER NOT NULL DEFAULT 0,
  selected_pet_runtime_id BIGINT NULL,
  pet_summoned BOOLEAN NOT NULL DEFAULT FALSE,
  warehouse_password TEXT NULL,
  online_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  renown_task_daily_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  frog_teleporter_unlocks JSONB NOT NULL DEFAULT '{}'::jsonb,
  map_id INTEGER NOT NULL DEFAULT 0,
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  last_town_map_id INTEGER NULL,
  last_town_x INTEGER NULL,
  last_town_y INTEGER NULL,
  attack_min INTEGER NULL,
  attack_max INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS character_vitals (
  character_id TEXT PRIMARY KEY REFERENCES characters(character_id) ON DELETE CASCADE,
  current_health INTEGER NOT NULL DEFAULT 0,
  current_mana INTEGER NOT NULL DEFAULT 0,
  current_rage INTEGER NOT NULL DEFAULT 0,
  max_health INTEGER NOT NULL DEFAULT 0,
  max_mana INTEGER NOT NULL DEFAULT 0,
  max_rage INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS character_attributes (
  character_id TEXT PRIMARY KEY REFERENCES characters(character_id) ON DELETE CASCADE,
  intelligence INTEGER NOT NULL DEFAULT 15,
  vitality INTEGER NOT NULL DEFAULT 15,
  dexterity INTEGER NOT NULL DEFAULT 15,
  strength INTEGER NOT NULL DEFAULT 15,
  bonus_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS character_inventory_state (
  character_id TEXT PRIMARY KEY REFERENCES characters(character_id) ON DELETE CASCADE,
  bag_size INTEGER NOT NULL DEFAULT 24,
  warehouse_size INTEGER NOT NULL DEFAULT 30,
  next_item_instance_id BIGINT NOT NULL DEFAULT 1,
  next_bag_slot INTEGER NOT NULL DEFAULT 0,
  next_warehouse_slot INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS character_inventory_items (
  character_id TEXT NOT NULL REFERENCES characters(character_id) ON DELETE CASCADE,
  inventory_scope TEXT NOT NULL CHECK (inventory_scope IN ('bag', 'warehouse')),
  instance_id BIGINT NOT NULL,
  template_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  durability INTEGER NULL,
  trade_state INTEGER NULL,
  bind_state INTEGER NULL,
  refine_level INTEGER NULL,
  state_code INTEGER NULL,
  extra_value INTEGER NULL,
  enhancement_growth_id INTEGER NULL,
  enhancement_current_exp INTEGER NULL,
  enhancement_soul_points INTEGER NULL,
  enhancement_aptitude_growth INTEGER NULL,
  enhancement_unknown13 INTEGER NULL,
  attribute_pairs JSONB NOT NULL DEFAULT '[]'::jsonb,
  equipped BOOLEAN NOT NULL DEFAULT FALSE,
  slot INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, inventory_scope, instance_id)
);

CREATE TABLE IF NOT EXISTS character_active_quests (
  character_id TEXT NOT NULL REFERENCES characters(character_id) ON DELETE CASCADE,
  quest_id INTEGER NOT NULL,
  step_index INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 0,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  accepted_at BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, quest_id)
);

CREATE TABLE IF NOT EXISTS character_completed_quests (
  character_id TEXT NOT NULL REFERENCES characters(character_id) ON DELETE CASCADE,
  quest_id INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, quest_id)
);

CREATE TABLE IF NOT EXISTS character_skills (
  character_id TEXT NOT NULL REFERENCES characters(character_id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  level INTEGER NULL,
  proficiency INTEGER NULL,
  source_template_id INTEGER NULL,
  learned_at BIGINT NOT NULL DEFAULT 0,
  required_level INTEGER NULL,
  required_attribute TEXT NULL,
  required_attribute_value INTEGER NULL,
  hotbar_slot INTEGER NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, skill_id)
);

CREATE TABLE IF NOT EXISTS character_skill_hotbar (
  character_id TEXT NOT NULL REFERENCES characters(character_id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL,
  skill_id INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, slot_index)
);

CREATE TABLE IF NOT EXISTS character_pets (
  character_id TEXT NOT NULL REFERENCES characters(character_id) ON DELETE CASCADE,
  runtime_id BIGINT NOT NULL,
  template_id INTEGER NOT NULL,
  awarded_at BIGINT NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  level INTEGER NOT NULL DEFAULT 1,
  generation INTEGER NOT NULL DEFAULT 0,
  current_health INTEGER NOT NULL DEFAULT 0,
  current_mana INTEGER NOT NULL DEFAULT 0,
  loyalty INTEGER NOT NULL DEFAULT 0,
  stat_points INTEGER NOT NULL DEFAULT 0,
  state_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (character_id, runtime_id)
);

CREATE INDEX IF NOT EXISTS idx_character_inventory_items_slot
  ON character_inventory_items (character_id, inventory_scope, slot);

CREATE INDEX IF NOT EXISTS idx_characters_account_id
  ON characters (account_id);

CREATE INDEX IF NOT EXISTS idx_character_active_quests_character
  ON character_active_quests (character_id);

CREATE INDEX IF NOT EXISTS idx_character_completed_quests_character
  ON character_completed_quests (character_id);

CREATE INDEX IF NOT EXISTS idx_character_skills_character
  ON character_skills (character_id);

CREATE INDEX IF NOT EXISTS idx_character_pets_character
  ON character_pets (character_id);
