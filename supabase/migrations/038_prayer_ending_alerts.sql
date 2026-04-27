-- ─── Roger AI — Migration 038: Prayer Ending Alerts ────────────────────────
-- Adds alert_type column to islamic_alerts_log to distinguish:
--   'start'     — 10 min before prayer begins (existing behavior)
--   'ending_30' — 30 min before prayer window closes
--   'ending_15' — 15 min before prayer window closes

ALTER TABLE islamic_alerts_log
  ADD COLUMN IF NOT EXISTS alert_type text DEFAULT 'start';
-- Values: 'start' | 'ending_30' | 'ending_15'

COMMENT ON COLUMN islamic_alerts_log.alert_type IS
  'Type of prayer alert: start (10min before adhan), ending_30 (30min before window closes), ending_15 (15min before window closes)';

-- Index for filtering by alert type in admin monitor
CREATE INDEX IF NOT EXISTS idx_islamic_alerts_log_type
  ON islamic_alerts_log (alert_type, fired_at DESC);
