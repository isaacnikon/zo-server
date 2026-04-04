ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS quest_state_v2 JSONB NOT NULL DEFAULT '{"active":[],"completed":[],"failed":[]}'::jsonb;
