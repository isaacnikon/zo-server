ALTER TABLE game_quest2_requirements
  DROP CONSTRAINT IF EXISTS game_quest2_requirements_kind_check;

ALTER TABLE game_quest2_requirements
  ADD CONSTRAINT game_quest2_requirements_kind_check CHECK (kind IN (
    'level_at_least',
    'quest_completed',
    'quest_active',
    'map_is',
    'npc_is',
    'turn_in_map_is',
    'turn_in_npc_is',
    'monster_is',
    'item_count_at_least',
    'flag_is',
    'counter_at_least',
    'script_is',
    'subtype_is',
    'context_is'
  ));

DELETE FROM game_quest2_requirements
WHERE quest_id = 8
  AND scope_type = 'step'
  AND step_id = 'return_to_bonnie';

DELETE FROM game_quest2_steps
WHERE quest_id = 8
  AND step_id = 'return_to_bonnie';

UPDATE game_quest2_steps
SET next_step_id = NULL,
    status = 3
WHERE quest_id = 8
  AND step_id = 'defeat_ahriman_lord';

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
  (8, 'step', 'defeat_ahriman_lord', 3, 'turn_in_npc_is', NULL, NULL, NULL, 3036, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (8, 'step', 'defeat_ahriman_lord', 4, 'turn_in_map_is', NULL, NULL, 163, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

UPDATE characters
SET quest_state_v2 = jsonb_set(
  COALESCE(quest_state_v2, '{}'::jsonb),
  '{active}',
  COALESCE((
    SELECT jsonb_agg(
      CASE
        WHEN (entry->>'questId')::int = 8 AND entry->>'stepId' = 'return_to_bonnie' THEN
          jsonb_set(
            jsonb_set(
              jsonb_set(
                entry,
                '{stepId}',
                '"defeat_ahriman_lord"'::jsonb,
                true
              ),
              '{counters}',
              COALESCE(entry->'counters', '{}'::jsonb) || jsonb_build_object('ahriman_lord_kills', 1),
              true
            ),
            '{flags}',
            COALESCE(entry->'flags', '{}'::jsonb) || jsonb_build_object('__turn_in_ready__:defeat_ahriman_lord', true),
            true
          )
        ELSE entry
      END
    )
    FROM jsonb_array_elements(COALESCE(quest_state_v2->'active', '[]'::jsonb)) AS entry
  ), '[]'::jsonb),
  true
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(COALESCE(quest_state_v2->'active', '[]'::jsonb)) AS entry
  WHERE (entry->>'questId')::int = 8
    AND entry->>'stepId' = 'return_to_bonnie'
);
