-- ─── Migration 029: Talkative Mode + Roger Thoughts ───────────────────────────
-- Adds talkative mode columns to user_preferences and creates the
-- roger_thoughts table for deduplication of AI outreach.

-- ── 1. Extend user_preferences with talkative columns ─────────────────────────

-- talkative_enabled: master toggle
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS talkative_enabled BOOLEAN DEFAULT false;

-- talkative_frequency: 'thoughtful' | 'active_talk' | 'always_on'
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS talkative_frequency TEXT DEFAULT 'thoughtful'
  CHECK (talkative_frequency IN ('thoughtful', 'active_talk', 'always_on'));

-- talkative_delivery: 'auto_speak' | 'ptt_pulse'
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS talkative_delivery TEXT DEFAULT 'ptt_pulse'
  CHECK (talkative_delivery IN ('auto_speak', 'ptt_pulse'));

-- ── 2. Roger Thoughts — AI outreach log ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS roger_thoughts (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thought     TEXT NOT NULL,                 -- the generated spoken message
  topic_hash  TEXT NOT NULL,                 -- hash of reasoning topic for dedup
  trigger_ctx TEXT,                          -- what triggered this thought
  delivered   BOOLEAN DEFAULT false,         -- was the message actually spoken?
  snoozed     BOOLEAN DEFAULT false,         -- was it snoozed by the user?
  created_at  TIMESTAMPTZ DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

-- Index for fast user + time lookups and deduplication
CREATE INDEX IF NOT EXISTS idx_roger_thoughts_user_time
  ON roger_thoughts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_roger_thoughts_dedup
  ON roger_thoughts(user_id, topic_hash, created_at DESC);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE roger_thoughts ENABLE ROW LEVEL SECURITY;

-- Users can read their own thoughts
CREATE POLICY roger_thoughts_select ON roger_thoughts
  FOR SELECT USING (auth.uid() = user_id);

-- Service role inserts (edge function uses service key, bypasses RLS)
-- Users can update delivered/snoozed status
CREATE POLICY roger_thoughts_update ON roger_thoughts
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow inserts from authenticated users (plus service role bypasses RLS)
CREATE POLICY roger_thoughts_insert ON roger_thoughts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── 4. Cron schedule — Silent Thinking Engine (every 20 min) ──────────────────
-- The edge function internally gates per-user frequency based on talkative_frequency.
-- 20-min is the base tick rate; thoughtful/active users are throttled inside the function.
SELECT cron.schedule(
  'roger-silent-think',              -- job name (unique)
  '*/20 * * * *',                    -- every 20 minutes
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/roger-think',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
