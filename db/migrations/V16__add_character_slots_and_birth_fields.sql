ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS slot_index INTEGER;

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS birth_month INTEGER NOT NULL DEFAULT 0;

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS birth_day INTEGER NOT NULL DEFAULT 0;

WITH ordered_slots AS (
  SELECT
    c.character_id,
    ROW_NUMBER() OVER (
      PARTITION BY c.account_id
      ORDER BY
        CASE WHEN c.character_id = a.selected_character_id THEN 0 ELSE 1 END,
        c.updated_at,
        c.created_at,
        c.character_id
    ) - 1 AS slot_index
  FROM characters c
  LEFT JOIN accounts a
    ON a.account_id = c.account_id
)
UPDATE characters c
SET slot_index = ordered_slots.slot_index
FROM ordered_slots
WHERE c.character_id = ordered_slots.character_id
  AND (
    c.slot_index IS NULL
    OR c.slot_index <> ordered_slots.slot_index
  );

UPDATE characters
SET slot_index = 0
WHERE slot_index IS NULL;

ALTER TABLE characters
  ALTER COLUMN slot_index SET DEFAULT 0;

ALTER TABLE characters
  ALTER COLUMN slot_index SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_account_slot
  ON characters (account_id, slot_index);
