CREATE TABLE IF NOT EXISTS game_quest2_definitions (
  quest_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  repeatable BOOLEAN NOT NULL DEFAULT FALSE,
  family_task_id INTEGER NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_quest2_accept_rules (
  quest_id INTEGER PRIMARY KEY REFERENCES game_quest2_definitions(quest_id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('npc_interact', 'monster_defeat', 'item_changed', 'combat_won'))
);

CREATE TABLE IF NOT EXISTS game_quest2_steps (
  quest_id INTEGER NOT NULL REFERENCES game_quest2_definitions(quest_id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  step_order INTEGER NOT NULL CHECK (step_order > 0),
  kind TEXT NOT NULL CHECK (kind IN ('talk', 'kill', 'collect', 'turn_in', 'trigger_combat', 'escort')),
  description TEXT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('npc_interact', 'monster_defeat', 'item_changed', 'combat_won')),
  next_step_id TEXT NULL,
  progress_counter TEXT NULL,
  progress_target INTEGER NULL CHECK (progress_target IS NULL OR progress_target > 0),
  progress_event_value TEXT NULL CHECK (progress_event_value IS NULL OR progress_event_value IN ('count', 'delta', 'one')),
  marker_npc_id INTEGER NULL,
  over_npc_id INTEGER NULL,
  task_role_npc_id INTEGER NULL,
  task_type INTEGER NULL,
  max_award INTEGER NULL,
  task_step INTEGER NULL,
  status INTEGER NULL,
  PRIMARY KEY (quest_id, step_id),
  UNIQUE (quest_id, step_order)
);

CREATE TABLE IF NOT EXISTS game_quest2_requirements (
  quest_id INTEGER NOT NULL REFERENCES game_quest2_definitions(quest_id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('accept', 'step')),
  step_id TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL CHECK (sort_order > 0),
  kind TEXT NOT NULL CHECK (kind IN (
    'level_at_least',
    'quest_completed',
    'quest_active',
    'map_is',
    'npc_is',
    'monster_is',
    'item_count_at_least',
    'flag_is',
    'counter_at_least',
    'script_is',
    'subtype_is',
    'context_is'
  )),
  level_value INTEGER NULL,
  quest_id_value INTEGER NULL,
  map_id_value INTEGER NULL,
  npc_id_value INTEGER NULL,
  monster_id_value INTEGER NULL,
  template_id_value INTEGER NULL,
  quantity_value INTEGER NULL,
  flag_value TEXT NULL,
  boolean_value BOOLEAN NULL,
  counter_value TEXT NULL,
  numeric_value INTEGER NULL,
  script_id_value INTEGER NULL,
  subtype_value INTEGER NULL,
  context_id_value INTEGER NULL,
  PRIMARY KEY (quest_id, scope_type, step_id, sort_order)
);

CREATE TABLE IF NOT EXISTS game_quest2_effects (
  quest_id INTEGER NOT NULL REFERENCES game_quest2_definitions(quest_id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('accept', 'step')),
  step_id TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL CHECK (sort_order > 0),
  kind TEXT NOT NULL CHECK (kind IN (
    'set_flag',
    'clear_flag',
    'increment_counter',
    'reset_counter',
    'select_reward_choice',
    'grant_item',
    'remove_item',
    'update_stat',
    'grant_pet',
    'start_combat',
    'show_dialogue'
  )),
  flag_value TEXT NULL,
  boolean_value BOOLEAN NULL,
  counter_value TEXT NULL,
  amount_value INTEGER NULL,
  reward_choice_id_value INTEGER NULL,
  item_template_id INTEGER NULL,
  item_quantity INTEGER NULL,
  item_name TEXT NULL,
  stat_value TEXT NULL CHECK (stat_value IS NULL OR stat_value IN ('gold', 'coins', 'renown', 'experience')),
  delta_value INTEGER NULL,
  pet_template_id INTEGER NULL,
  monster_id_value INTEGER NULL,
  count_value INTEGER NULL,
  title_value TEXT NULL,
  message_value TEXT NULL,
  PRIMARY KEY (quest_id, scope_type, step_id, sort_order)
);

CREATE TABLE IF NOT EXISTS game_quest2_step_tracker_scripts (
  quest_id INTEGER NOT NULL,
  step_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order > 0),
  script_id INTEGER NOT NULL CHECK (script_id > 0),
  PRIMARY KEY (quest_id, step_id, sort_order),
  FOREIGN KEY (quest_id, step_id) REFERENCES game_quest2_steps(quest_id, step_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_quest2_rewards (
  quest_id INTEGER PRIMARY KEY REFERENCES game_quest2_definitions(quest_id) ON DELETE CASCADE,
  gold INTEGER NOT NULL DEFAULT 0,
  experience INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  renown INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_quest2_reward_items (
  quest_id INTEGER NOT NULL REFERENCES game_quest2_definitions(quest_id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL CHECK (sort_order > 0),
  template_id INTEGER NOT NULL CHECK (template_id > 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  name TEXT NULL,
  PRIMARY KEY (quest_id, sort_order)
);

CREATE TABLE IF NOT EXISTS game_quest2_reward_pets (
  quest_id INTEGER NOT NULL REFERENCES game_quest2_definitions(quest_id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL CHECK (sort_order > 0),
  pet_template_id INTEGER NOT NULL CHECK (pet_template_id > 0),
  PRIMARY KEY (quest_id, sort_order)
);

CREATE TABLE IF NOT EXISTS game_quest2_reward_choices (
  quest_id INTEGER NOT NULL REFERENCES game_quest2_definitions(quest_id) ON DELETE CASCADE,
  choice_id INTEGER NOT NULL CHECK (choice_id > 0),
  label TEXT NULL,
  gold INTEGER NOT NULL DEFAULT 0,
  experience INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  renown INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (quest_id, choice_id)
);

CREATE TABLE IF NOT EXISTS game_quest2_reward_choice_items (
  quest_id INTEGER NOT NULL,
  choice_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order > 0),
  template_id INTEGER NOT NULL CHECK (template_id > 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  name TEXT NULL,
  PRIMARY KEY (quest_id, choice_id, sort_order),
  FOREIGN KEY (quest_id, choice_id) REFERENCES game_quest2_reward_choices(quest_id, choice_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_quest2_reward_choice_pets (
  quest_id INTEGER NOT NULL,
  choice_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order > 0),
  pet_template_id INTEGER NOT NULL CHECK (pet_template_id > 0),
  PRIMARY KEY (quest_id, choice_id, sort_order),
  FOREIGN KEY (quest_id, choice_id) REFERENCES game_quest2_reward_choices(quest_id, choice_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_quest2_steps_quest_order
  ON game_quest2_steps (quest_id, step_order);

CREATE INDEX IF NOT EXISTS idx_game_quest2_requirements_lookup
  ON game_quest2_requirements (quest_id, scope_type, step_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_game_quest2_effects_lookup
  ON game_quest2_effects (quest_id, scope_type, step_id, sort_order);

DELETE FROM game_quest2_reward_choice_items WHERE quest_id IN (7, 8);
DELETE FROM game_quest2_reward_choice_pets WHERE quest_id IN (7, 8);
DELETE FROM game_quest2_reward_choices WHERE quest_id IN (7, 8);
DELETE FROM game_quest2_reward_items WHERE quest_id IN (7, 8);
DELETE FROM game_quest2_reward_pets WHERE quest_id IN (7, 8);
DELETE FROM game_quest2_rewards WHERE quest_id IN (7, 8);
DELETE FROM game_quest2_step_tracker_scripts WHERE quest_id IN (7, 8);
DELETE FROM game_quest2_effects WHERE quest_id IN (7, 8);
DELETE FROM game_quest2_requirements WHERE quest_id IN (7, 8);
DELETE FROM game_quest2_steps WHERE quest_id IN (7, 8);
DELETE FROM game_quest2_accept_rules WHERE quest_id IN (7, 8);
DELETE FROM game_quest2_definitions WHERE quest_id IN (7, 8);

INSERT INTO game_quest2_definitions (quest_id, name, repeatable, family_task_id, imported_at) VALUES
  (7, 'Disenchanting', FALSE, NULL, NOW()),
  (8, 'Magical Adventure', FALSE, NULL, NOW());

INSERT INTO game_quest2_accept_rules (quest_id, trigger_type) VALUES
  (7, 'npc_interact'),
  (8, 'npc_interact');

INSERT INTO game_quest2_requirements (
  quest_id,
  scope_type,
  step_id,
  sort_order,
  kind,
  level_value,
  quest_id_value,
  map_id_value,
  npc_id_value,
  monster_id_value,
  template_id_value,
  quantity_value,
  flag_value,
  boolean_value,
  counter_value,
  numeric_value,
  script_id_value,
  subtype_value,
  context_id_value
) VALUES
  (7, 'accept', '', 1, 'level_at_least', 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (7, 'accept', '', 2, 'npc_is', NULL, NULL, NULL, 3030, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (7, 'accept', '', 3, 'subtype_is', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 3, NULL),
  (7, 'accept', '', 4, 'map_is', NULL, NULL, 112, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (7, 'step', 'franklin_intro', 1, 'npc_is', NULL, NULL, NULL, 3118, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (7, 'step', 'franklin_intro', 2, 'map_is', NULL, NULL, 112, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (7, 'step', 'bonnie_pendant', 1, 'npc_is', NULL, NULL, NULL, 3036, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (7, 'step', 'bonnie_pendant', 2, 'map_is', NULL, NULL, 112, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (7, 'step', 'return_to_franklin', 1, 'npc_is', NULL, NULL, NULL, 3118, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (7, 'step', 'return_to_franklin', 2, 'map_is', NULL, NULL, 112, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (7, 'step', 'return_to_franklin', 3, 'item_count_at_least', NULL, NULL, NULL, NULL, NULL, 21006, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (8, 'accept', '', 1, 'level_at_least', 14, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (8, 'accept', '', 2, 'quest_completed', NULL, 7, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (8, 'accept', '', 3, 'npc_is', NULL, NULL, NULL, 3118, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (8, 'accept', '', 4, 'subtype_is', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 3, NULL),
  (8, 'accept', '', 5, 'map_is', NULL, NULL, 112, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (8, 'step', 'find_bonnie', 1, 'npc_is', NULL, NULL, NULL, 3036, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (8, 'step', 'find_bonnie', 2, 'map_is', NULL, NULL, 112, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (8, 'step', 'defeat_ahriman_lord', 1, 'monster_is', NULL, NULL, NULL, NULL, 5099, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (8, 'step', 'defeat_ahriman_lord', 2, 'map_is', NULL, NULL, 163, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

INSERT INTO game_quest2_steps (
  quest_id,
  step_id,
  step_order,
  kind,
  description,
  trigger_type,
  next_step_id,
  progress_counter,
  progress_target,
  progress_event_value,
  marker_npc_id,
  over_npc_id,
  task_role_npc_id,
  task_type,
  max_award,
  task_step,
  status
) VALUES
  (7, 'franklin_intro', 1, 'talk', 'At your 14 level, go to speak with Franklin. Quest reward: None', 'npc_interact', 'bonnie_pendant', NULL, NULL, NULL, 3118, 3118, NULL, 0, 0, 1, NULL),
  (7, 'bonnie_pendant', 2, 'talk', 'Encounter a ghost called Bonnie. Bonnie gives you a jewelry to bring to Franklin.', 'npc_interact', 'return_to_franklin', NULL, NULL, NULL, 3036, 3036, NULL, 0, 0, 2, NULL),
  (7, 'return_to_franklin', 3, 'turn_in', 'Bring Bonnie''s Pendant to Franklin.', 'npc_interact', NULL, NULL, NULL, NULL, 3118, 3118, NULL, 0, 0, 3, NULL),
  (8, 'find_bonnie', 1, 'talk', 'Locate Bonnie at Orchid Temple at night.', 'npc_interact', 'defeat_ahriman_lord', NULL, NULL, NULL, 3036, 3036, NULL, 32, 0, 1, NULL),
  (8, 'defeat_ahriman_lord', 2, 'kill', 'Kill "Ahriman Lord" at Orchid Temple.', 'monster_defeat', NULL, 'ahriman_lord_kills', 1, 'count', 3036, 3036, NULL, 1, 2, 3, NULL);

INSERT INTO game_quest2_effects (
  quest_id,
  scope_type,
  step_id,
  sort_order,
  kind,
  flag_value,
  boolean_value,
  counter_value,
  amount_value,
  reward_choice_id_value,
  item_template_id,
  item_quantity,
  item_name,
  stat_value,
  delta_value,
  pet_template_id,
  monster_id_value,
  count_value,
  title_value,
  message_value
) VALUES
  (7, 'step', 'bonnie_pendant', 1, 'grant_item', NULL, NULL, NULL, NULL, NULL, 21006, 1, 'Bonnie''s Pendant', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (7, 'step', 'return_to_franklin', 1, 'remove_item', NULL, NULL, NULL, NULL, NULL, 21006, 1, 'Bonnie''s Pendant', NULL, NULL, NULL, NULL, NULL, NULL, NULL);

INSERT INTO game_quest2_rewards (quest_id, gold, experience, coins, renown) VALUES
  (7, 0, 1200, 1000, 0),
  (8, 800, 4000, 1200, 40);
