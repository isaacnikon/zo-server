ALTER TABLE game_quest2_rewards
  ADD COLUMN IF NOT EXISTS pet_by_aptitude_base_template_id INTEGER NULL;
