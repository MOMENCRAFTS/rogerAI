-- 051: Auto-discovery pairing support
-- Adds pending_code column to device_registry for backend claim-code flow
-- Allows user_id to be nullable (device registers before pairing)
-- Adds 'awaiting_pair' to status enum

-- Add pending_code column
ALTER TABLE device_registry
  ADD COLUMN IF NOT EXISTS pending_code TEXT;

-- Allow NULL user_id (pre-pairing registration)
ALTER TABLE device_registry
  ALTER COLUMN user_id DROP NOT NULL;

-- Update status check to include 'awaiting_pair'
ALTER TABLE device_registry
  DROP CONSTRAINT IF EXISTS device_registry_status_check;
ALTER TABLE device_registry
  ADD CONSTRAINT device_registry_status_check
  CHECK (status IN ('online','offline','charging','awaiting_pair'));
