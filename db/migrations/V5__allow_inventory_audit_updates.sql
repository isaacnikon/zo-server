ALTER TABLE character_inventory_admin_audit
  DROP CONSTRAINT IF EXISTS character_inventory_admin_audit_action_check;

ALTER TABLE character_inventory_admin_audit
  ADD CONSTRAINT character_inventory_admin_audit_action_check
  CHECK (action IN ('add', 'update', 'remove'));
