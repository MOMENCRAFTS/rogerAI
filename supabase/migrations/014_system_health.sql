-- ─── Roger AI — Migration 014: System Health & Alerts ────────────────────────
-- Replaces hardcoded HEALTH[] and ALERTS[] constants in Dashboard.tsx.

-- ─── system_health_checks ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_health_checks (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  service     text         NOT NULL,
  uptime_pct  numeric(5,2) NOT NULL DEFAULT 100,
  status      text         NOT NULL DEFAULT 'operational'
                CHECK (status IN ('operational', 'degraded', 'down')),
  message     text,
  checked_at  timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE system_health_checks DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_health_service
  ON system_health_checks (service, checked_at DESC);

-- Latest-per-service helper view
CREATE OR REPLACE VIEW latest_health_checks AS
SELECT DISTINCT ON (service)
  id, service, uptime_pct, status, message, checked_at
FROM system_health_checks
ORDER BY service, checked_at DESC;

-- Seed default services (these will be updated by health-check workers)
INSERT INTO system_health_checks (service, uptime_pct, status, message) VALUES
  ('AI_PIPELINE',  99.2, 'operational', 'Whisper + GPT-4o pipeline nominal'),
  ('DEVICE_SYNC',  97.8, 'operational', 'ESP32 relay heartbeat OK'),
  ('BRIEFING_GEN', 98.5, 'operational', 'AM/PM generation on schedule'),
  ('MEMORY_GRAPH', 99.8, 'operational', 'Memory graph writes < 50ms p95')
ON CONFLICT DO NOTHING;

-- ─── system_alerts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_alerts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  level       text        NOT NULL CHECK (level IN ('info', 'warning', 'critical')),
  message     text        NOT NULL,
  source      text,
  resolved    boolean     NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE system_alerts DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_alerts_active
  ON system_alerts (resolved, created_at DESC)
  WHERE resolved = false;

-- Seed existing mock alerts as real DB rows
INSERT INTO system_alerts (level, message, source, resolved) VALUES
  ('warning', 'Ambiguity rate elevated in EU region (+2.3%)', 'EU_REGION', false),
  ('info',    'Device firmware 2.4.1 rolling out (34% complete)', 'DEVICE_SYNC', false)
ON CONFLICT DO NOTHING;
