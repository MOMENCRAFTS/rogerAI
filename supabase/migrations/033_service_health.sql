-- ─── Roger AI — Service Health Telemetry ────────────────────────────────────
-- Migration 033: Enables persistent logging for the Silent AI Node's
-- ServiceGraph health monitoring system. Captures service status snapshots
-- for admin dashboard visualization and degradation trend analysis.

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_health_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id    text NOT NULL,
  status        text NOT NULL CHECK (status IN ('healthy', 'degraded', 'down', 'unconfigured', 'unknown')),
  latency_ms    integer,
  error_msg     text,
  circuit_state text CHECK (circuit_state IN ('closed', 'open', 'half-open')),
  checked_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

-- Primary query pattern: "show me service X health over time" (admin dashboard)
CREATE INDEX IF NOT EXISTS idx_shl_service_time
  ON service_health_log (service_id, checked_at DESC);

-- Secondary: "show me all service issues for user Y"
CREATE INDEX IF NOT EXISTS idx_shl_user_time
  ON service_health_log (user_id, checked_at DESC);

-- Filtered index: only degraded/down entries (for alert queries)
CREATE INDEX IF NOT EXISTS idx_shl_issues
  ON service_health_log (service_id, checked_at DESC)
  WHERE status IN ('degraded', 'down');

-- ─── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE service_health_log ENABLE ROW LEVEL SECURITY;

-- Users can read their own health logs
CREATE POLICY "Users read own health logs"
  ON service_health_log FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own health logs (from client-side ServiceGraph)
CREATE POLICY "Users insert own health logs"
  ON service_health_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Admin can read all (for admin dashboard — uses service_role key)
-- No explicit policy needed; service_role bypasses RLS.

-- ─── Auto-Purge: Delete entries older than 7 days ────────────────────────────
-- This runs via pg_cron (already set up in 023_cron_jobs.sql pattern)
-- Add to the cron schedule:

DO $do$
BEGIN
  -- Only create the cron job if pg_cron extension is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'purge-service-health-log',
      '0 3 * * *',  -- daily at 3 AM UTC
      $$DELETE FROM service_health_log WHERE checked_at < now() - interval '7 days'$$
    );
  END IF;
END
$do$;

-- ─── Comment ─────────────────────────────────────────────────────────────────

COMMENT ON TABLE service_health_log IS
  'Silent AI Node telemetry — tracks service health snapshots for observability dashboard. Auto-purged after 7 days.';
