-- ─── Roger AI — Islamic Mode Migration ──────────────────────────────────────
-- Adds islamic_mode flag + prayer preferences to user_preferences
-- Also creates an alert log table for proactive prayer notifications.

-- ── user_preferences additions ────────────────────────────────────────────────
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS islamic_mode         boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS prayer_city          text,        -- optional city name override for display
  ADD COLUMN IF NOT EXISTS prayer_method        integer DEFAULT 3, -- AlAdhan calculation method (3=MWL)
  ADD COLUMN IF NOT EXISTS prayer_notifications boolean DEFAULT true;

-- ── islamic_alerts_log — lightweight prayer alert audit log ───────────────────
CREATE TABLE IF NOT EXISTS islamic_alerts_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  prayer_name text NOT NULL,          -- 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha'
  fired_at    timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE islamic_alerts_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "islamic_alerts_log: user owns their rows"
  ON islamic_alerts_log
  FOR ALL
  USING (auth.uid()::text = user_id);

-- Admin select (service role bypasses RLS automatically)

-- ── Index for admin queries ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_islamic_alerts_log_user
  ON islamic_alerts_log (user_id, fired_at DESC);
