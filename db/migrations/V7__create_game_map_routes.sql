CREATE TABLE IF NOT EXISTS game_map_routes (
  source_map_id INTEGER NOT NULL,
  source_scene_script_id INTEGER NOT NULL,
  display_label TEXT NULL,
  trigger_min_x INTEGER NOT NULL,
  trigger_max_x INTEGER NOT NULL,
  trigger_min_y INTEGER NOT NULL,
  trigger_max_y INTEGER NOT NULL,
  target_map_id INTEGER NOT NULL,
  target_scene_script_id INTEGER NULL,
  target_x INTEGER NOT NULL,
  target_y INTEGER NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'unknown',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_map_id, source_scene_script_id)
);

CREATE INDEX IF NOT EXISTS idx_game_map_routes_target
  ON game_map_routes (target_map_id, target_scene_script_id);

CREATE INDEX IF NOT EXISTS idx_game_map_routes_updated_at
  ON game_map_routes (updated_at DESC);
