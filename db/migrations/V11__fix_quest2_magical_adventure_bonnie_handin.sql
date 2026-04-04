UPDATE game_quest2_steps
SET next_step_id = 'return_to_bonnie'
WHERE quest_id = 8
  AND step_id = 'defeat_ahriman_lord';

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
) VALUES (
  8,
  'return_to_bonnie',
  3,
  'talk',
  'Return to Bonnie in Orchid Temple.',
  'npc_interact',
  NULL,
  NULL,
  NULL,
  NULL,
  3036,
  3036,
  NULL,
  32,
  0,
  4,
  4
);

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
  (8, 'step', 'return_to_bonnie', 1, 'npc_is', NULL, NULL, NULL, 3036, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (8, 'step', 'return_to_bonnie', 2, 'map_is', NULL, NULL, 163, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
