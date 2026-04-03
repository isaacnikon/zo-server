ALTER TABLE IF EXISTS portal_users
  ADD COLUMN IF NOT EXISTS game_password_md5 TEXT NULL;

INSERT INTO accounts (
  account_id,
  name,
  selected_character_id,
  created_at,
  updated_at
)
SELECT
  pu.username,
  pu.username,
  NULL,
  NOW(),
  NOW()
FROM portal_users pu
LEFT JOIN accounts a
  ON a.account_id = pu.username
WHERE pu.account_id IS NULL
  AND a.account_id IS NULL;

UPDATE portal_users pu
SET account_id = pu.username,
    updated_at = NOW()
WHERE pu.account_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM accounts a
    WHERE a.account_id = pu.username
  );
