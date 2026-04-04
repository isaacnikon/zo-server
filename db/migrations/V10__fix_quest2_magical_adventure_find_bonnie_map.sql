UPDATE game_quest2_requirements
SET map_id_value = 163
WHERE quest_id = 8
  AND scope_type = 'step'
  AND step_id = 'find_bonnie'
  AND kind = 'map_is';
