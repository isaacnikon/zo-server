UPDATE game_quest2_rewards
SET
  experience = 800,
  gold = 800,
  coins = 1200,
  renown = 40
WHERE quest_id = 8;

DELETE FROM game_quest2_reward_items
WHERE quest_id = 8;

INSERT INTO game_quest2_reward_items (
  quest_id,
  sort_order,
  template_id,
  quantity,
  name
)
VALUES (
  8,
  1,
  10102,
  1,
  'Universal Cap'
);
