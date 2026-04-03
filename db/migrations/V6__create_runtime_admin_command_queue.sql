CREATE TABLE IF NOT EXISTS runtime_admin_commands (
  command_id BIGSERIAL PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(character_id) ON DELETE CASCADE,
  command_kind TEXT NOT NULL,
  requested_by TEXT NOT NULL DEFAULT 'admin-portal',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NULL,
  processed_at TIMESTAMPTZ NULL,
  result_payload JSONB NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runtime_admin_commands_status
  ON runtime_admin_commands (status, command_id);

CREATE INDEX IF NOT EXISTS idx_runtime_admin_commands_character_id
  ON runtime_admin_commands (character_id, created_at DESC);
