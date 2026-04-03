CREATE TABLE IF NOT EXISTS portal_users (
  portal_user_id BIGSERIAL PRIMARY KEY,
  account_id TEXT NULL REFERENCES accounts(account_id) ON DELETE SET NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS runtime_online_players (
  character_id TEXT PRIMARY KEY REFERENCES characters(character_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL,
  char_name TEXT NOT NULL,
  map_id INTEGER NOT NULL DEFAULT 0,
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS character_inventory_admin_audit (
  audit_id BIGSERIAL PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(character_id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('add', 'remove')),
  inventory_scope TEXT NOT NULL CHECK (inventory_scope IN ('bag', 'warehouse')),
  template_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  actor TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_users_account_id
  ON portal_users (account_id);

CREATE INDEX IF NOT EXISTS idx_runtime_online_players_account_id
  ON runtime_online_players (account_id);

CREATE INDEX IF NOT EXISTS idx_runtime_online_players_updated_at
  ON runtime_online_players (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_character_inventory_admin_audit_character_id
  ON character_inventory_admin_audit (character_id, created_at DESC);
