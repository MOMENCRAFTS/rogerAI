-- Roger AI — Migration 004: Device Registry
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS device_registry (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id        TEXT        UNIQUE NOT NULL,   -- ESP32 MAC-based ID
  user_id          TEXT        NOT NULL,           -- linked Roger AI user
  device_name      TEXT        DEFAULT 'Roger Device',
  firmware_version TEXT,
  last_seen        TIMESTAMPTZ,
  battery_pct      INTEGER     CHECK (battery_pct BETWEEN 0 AND 100),
  signal_strength  INTEGER,                        -- RSSI dBm
  status           TEXT        DEFAULT 'offline'   -- online | offline | charging
                               CHECK (status IN ('online','offline','charging')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Disable RLS for prototype (same pattern as other tables in this project)
ALTER TABLE device_registry DISABLE ROW LEVEL SECURITY;

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_device_registry_user
  ON device_registry (user_id, last_seen DESC);

-- Upsert helper view — last-seen devices per user
CREATE OR REPLACE VIEW active_devices AS
  SELECT *
  FROM device_registry
  WHERE status = 'online'
    AND last_seen > NOW() - INTERVAL '5 minutes';
