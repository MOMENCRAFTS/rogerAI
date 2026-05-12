-- 052: Device provisioning metadata
-- Adds BLE provisioning method tracking to device tables.
-- Idempotent: safe to re-run.

ALTER TABLE device_tokens
  ADD COLUMN IF NOT EXISTS conn_mode    TEXT DEFAULT 'wifi',
  ADD COLUMN IF NOT EXISTS prov_method  TEXT DEFAULT 'ble';

ALTER TABLE device_registry
  ADD COLUMN IF NOT EXISTS prov_method  TEXT DEFAULT 'ble';

COMMENT ON COLUMN device_tokens.conn_mode   IS 'wifi | hotspot | ble_tether';
COMMENT ON COLUMN device_tokens.prov_method IS 'ble | qr | manual';
COMMENT ON COLUMN device_registry.prov_method IS 'ble | qr | manual';
