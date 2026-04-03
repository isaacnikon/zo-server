CREATE TABLE IF NOT EXISTS static_json_documents (
  document_path TEXT PRIMARY KEY,
  document_group TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_sha256 TEXT NOT NULL,
  source_size BIGINT NOT NULL CHECK (source_size >= 0),
  source_mtime TIMESTAMPTZ NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_item_definitions (
  template_id INTEGER PRIMARY KEY,
  source_document TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  name TEXT NOT NULL,
  max_stack INTEGER NOT NULL DEFAULT 1,
  container_type INTEGER NOT NULL DEFAULT 1,
  client_template_family INTEGER NULL,
  equip_slot_field INTEGER NULL,
  sell_price INTEGER NULL,
  icon_path TEXT NOT NULL DEFAULT '',
  raw_data JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_skill_definitions (
  skill_id INTEGER PRIMARY KEY,
  template_id INTEGER NULL,
  name TEXT NOT NULL,
  required_level INTEGER NULL,
  required_attribute TEXT NULL,
  required_attribute_value INTEGER NULL,
  behavior TEXT NULL,
  implementation_class INTEGER NULL,
  selection_mode TEXT NULL,
  follow_up_mode TEXT NULL,
  allow_enemy_counterattack BOOLEAN NOT NULL DEFAULT TRUE,
  is_passive BOOLEAN NOT NULL DEFAULT FALSE,
  acquisition_source TEXT NULL,
  raw_data JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_quest_definitions (
  quest_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'unknown',
  accept_npc_id INTEGER NULL,
  min_level INTEGER NOT NULL DEFAULT 1,
  repeatable BOOLEAN NOT NULL DEFAULT FALSE,
  next_quest_id INTEGER NULL,
  raw_data JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_quest_tasklist (
  task_id INTEGER PRIMARY KEY,
  start_npc_id INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  field11 INTEGER NOT NULL DEFAULT 0,
  raw_data JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_map_summaries (
  map_id INTEGER PRIMARY KEY,
  map_name TEXT NOT NULL,
  summary_data JSONB NOT NULL,
  raw_data JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_npc_shops (
  npc_id INTEGER PRIMARY KEY,
  speaker TEXT NOT NULL DEFAULT '',
  shop_data JSONB NOT NULL,
  raw_data JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_role_definitions (
  role_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role_class_field INTEGER NULL,
  map_id INTEGER NULL,
  raw_data JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_static_json_documents_group
  ON static_json_documents (document_group);

CREATE INDEX IF NOT EXISTS idx_game_item_definitions_kind
  ON game_item_definitions (item_kind);

CREATE INDEX IF NOT EXISTS idx_game_quest_definitions_accept_npc
  ON game_quest_definitions (accept_npc_id);

CREATE INDEX IF NOT EXISTS idx_game_map_summaries_name
  ON game_map_summaries (map_name);
