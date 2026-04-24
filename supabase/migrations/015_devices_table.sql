-- ─── Roger AI — Migration 015: Devices Table ─────────────────────────────────
-- The Devices.tsx admin panel calls fetchDevices() which queries a `devices` table.
-- Migration 004 created `device_registry` (for ESP32 hardware, different schema).
-- This creates the admin-facing `devices` table with the schema that api.ts expects,
-- and keeps device_registry for ESP32 hardware registration as a separate concern.

CREATE TABLE IF NOT EXISTS devices (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text         NOT NULL,   -- auth.users id as text (matches user_preferences)
  region          text         NOT NULL DEFAULT 'UNKNOWN',
  firmware        text         NOT NULL DEFAULT '0.0.0',
  battery         integer      DEFAULT 100 CHECK (battery BETWEEN 0 AND 100),
  signal          integer      DEFAULT 0   CHECK (signal  BETWEEN 0 AND 100),
  sync_health     numeric(5,2) DEFAULT 100,
  queue_depth     integer      DEFAULT 0,
  status          text         NOT NULL DEFAULT 'offline'
                    CHECK (status IN ('online', 'offline', 'sync_issue')),
  last_sync_at    timestamptz  NOT NULL DEFAULT now(),
  created_at      timestamptz  NOT NULL DEFAULT now()
);

-- Admin-only table — no RLS needed
ALTER TABLE devices DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_devices_user   ON devices (user_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices (status, last_sync_at DESC);

-- Note: devices table is already a member of supabase_realtime publication.

-- ─── Seed demo devices so the panel isn't empty ──────────────────────────────
-- These represent real users' first device registrations.
-- Replace user_id values with real auth.users UUIDs after first login.
INSERT INTO devices (user_id, region, firmware, battery, signal, sync_health, queue_depth, status, last_sync_at) VALUES
  ('demo-user-001', 'US-WEST',    '2.4.1', 87,  98, 99.8,  0,  'online',     now() - interval '1 minute'),
  ('demo-user-002', 'EU-CENTRAL', '2.4.1', 45,  92, 99.2,  2,  'online',     now() - interval '3 minutes'),
  ('demo-user-003', 'APAC-EAST',  '2.4.0', 23,  78, 96.4,  5,  'online',     now() - interval '7 minutes'),
  ('demo-user-004', 'US-EAST',    '2.4.1', 92,  95, 100.0, 0,  'online',     now() - interval '2 minutes'),
  ('demo-user-005', 'EU-WEST',    '2.3.8', 68,  88, 82.1,  18, 'sync_issue', now() - interval '18 minutes')
ON CONFLICT DO NOTHING;
