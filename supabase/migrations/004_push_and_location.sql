-- ─── Roger AI — Push Notifications + Location Migration ──────────────────────
-- Run AFTER 003_memory_system.sql

-- ─── push_subscriptions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  endpoint    text NOT NULL,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user
  ON push_subscriptions (user_id);

-- ─── user_location (live location snapshots) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS user_location (
  user_id       text PRIMARY KEY,
  latitude      double precision NOT NULL,
  longitude     double precision NOT NULL,
  city          text,
  country       text,
  accuracy_m    double precision,
  updated_at    timestamptz DEFAULT now()
);
