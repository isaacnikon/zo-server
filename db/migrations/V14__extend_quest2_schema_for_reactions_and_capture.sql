CREATE TABLE IF NOT EXISTS game_quest2_step_reactions (
  quest_id INTEGER NOT NULL,
  step_id TEXT NOT NULL,
  reaction_id TEXT NOT NULL,
  reaction_order INTEGER NOT NULL CHECK (reaction_order > 0),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('npc_interact', 'monster_defeat', 'item_changed', 'combat_won')),
  PRIMARY KEY (quest_id, step_id, reaction_id),
  UNIQUE (quest_id, step_id, reaction_order),
  FOREIGN KEY (quest_id, step_id) REFERENCES game_quest2_steps(quest_id, step_id) ON DELETE CASCADE
);

ALTER TABLE game_quest2_steps
  DROP CONSTRAINT IF EXISTS game_quest2_steps_progress_event_value_check;

ALTER TABLE game_quest2_steps
  ADD CONSTRAINT game_quest2_steps_progress_event_value_check
  CHECK (
    progress_event_value IS NULL
    OR progress_event_value IN ('count', 'delta', 'one', 'quantity')
  );

ALTER TABLE game_quest2_requirements
  ADD COLUMN IF NOT EXISTS reaction_id TEXT NOT NULL DEFAULT '';

ALTER TABLE game_quest2_effects
  ADD COLUMN IF NOT EXISTS reaction_id TEXT NOT NULL DEFAULT '';

ALTER TABLE game_quest2_requirements
  DROP CONSTRAINT IF EXISTS game_quest2_requirements_pkey;
ALTER TABLE game_quest2_requirements
  DROP CONSTRAINT IF EXISTS game_quest2_requirements_scope_type_check;
ALTER TABLE game_quest2_requirements
  DROP CONSTRAINT IF EXISTS game_quest2_requirements_kind_check;

ALTER TABLE game_quest2_effects
  DROP CONSTRAINT IF EXISTS game_quest2_effects_pkey;
ALTER TABLE game_quest2_effects
  DROP CONSTRAINT IF EXISTS game_quest2_effects_scope_type_check;
ALTER TABLE game_quest2_effects
  DROP CONSTRAINT IF EXISTS game_quest2_effects_kind_check;

ALTER TABLE game_quest2_requirements
  ADD CONSTRAINT game_quest2_requirements_scope_type_check
  CHECK (scope_type IN ('accept', 'step', 'step_event', 'reaction'));

ALTER TABLE game_quest2_requirements
  ADD CONSTRAINT game_quest2_requirements_kind_check
  CHECK (kind IN (
    'level_at_least',
    'quest_completed',
    'quest_active',
    'map_is',
    'npc_is',
    'monster_is',
    'item_is',
    'item_count_at_least',
    'captured_monster_count_at_least',
    'flag_is',
    'counter_at_least',
    'script_is',
    'subtype_is',
    'context_is',
    'turn_in_map_is',
    'turn_in_npc_is'
  ));

ALTER TABLE game_quest2_effects
  ADD CONSTRAINT game_quest2_effects_scope_type_check
  CHECK (scope_type IN ('accept', 'step', 'step_event', 'reaction'));

ALTER TABLE game_quest2_effects
  ADD CONSTRAINT game_quest2_effects_kind_check
  CHECK (kind IN (
    'set_flag',
    'clear_flag',
    'increment_counter',
    'reset_counter',
    'select_reward_choice',
    'grant_item',
    'remove_item',
    'remove_captured_monster_item',
    'update_stat',
    'grant_pet',
    'start_combat',
    'show_dialogue'
  ));

ALTER TABLE game_quest2_requirements
  ADD CONSTRAINT game_quest2_requirements_pkey
  PRIMARY KEY (quest_id, scope_type, step_id, reaction_id, sort_order);

ALTER TABLE game_quest2_effects
  ADD CONSTRAINT game_quest2_effects_pkey
  PRIMARY KEY (quest_id, scope_type, step_id, reaction_id, sort_order);

DROP INDEX IF EXISTS idx_game_quest2_requirements_lookup;
CREATE INDEX idx_game_quest2_requirements_lookup
  ON game_quest2_requirements (quest_id, scope_type, step_id, reaction_id, sort_order);

DROP INDEX IF EXISTS idx_game_quest2_effects_lookup;
CREATE INDEX idx_game_quest2_effects_lookup
  ON game_quest2_effects (quest_id, scope_type, step_id, reaction_id, sort_order);
