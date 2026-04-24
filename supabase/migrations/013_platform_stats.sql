-- ─── Roger AI — Migration 013: Platform Stats ─────────────────────────────────
-- Replaces hardcoded Dashboard KPI mock values with a real aggregated table.
-- The `compute-stats` edge function upserts one row per day into platform_stats.
-- The `live_platform_stats` view computes today's numbers on-demand from raw tables.

-- ─── platform_stats ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_stats (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_date           date         NOT NULL UNIQUE,
  active_users        integer      NOT NULL DEFAULT 0,
  connected_devices   integer      NOT NULL DEFAULT 0,
  tx_today            integer      NOT NULL DEFAULT 0,
  success_rate        numeric(5,2) NOT NULL DEFAULT 0,
  clarification_rate  numeric(5,2) NOT NULL DEFAULT 0,
  avg_latency_ms      integer      NOT NULL DEFAULT 0,
  briefing_success    numeric(5,2) NOT NULL DEFAULT 100,
  smart_momentum      numeric(5,2) NOT NULL DEFAULT 0,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

-- Admin-read only; compute-stats edge function uses service_role key
ALTER TABLE platform_stats DISABLE ROW LEVEL SECURITY;

-- ─── live_platform_stats view ────────────────────────────────────────────────
-- Computes today's KPIs directly from the transmissions table.
-- Used by Dashboard as a fallback when platform_stats has no row for today.
CREATE OR REPLACE VIEW live_platform_stats AS
SELECT
  current_date                                                                AS stat_date,
  COUNT(DISTINCT t.user_id)::integer                                          AS active_users,
  (SELECT COUNT(*) FROM devices WHERE status = 'online')::integer             AS connected_devices,
  COUNT(t.id)::integer                                                        AS tx_today,
  COALESCE(ROUND(
    100.0 * COUNT(CASE WHEN t.status = 'SUCCESS'       THEN 1 END)
            / NULLIF(COUNT(t.id), 0), 2
  ), 0)                                                                       AS success_rate,
  COALESCE(ROUND(
    100.0 * COUNT(CASE WHEN t.status = 'CLARIFICATION' THEN 1 END)
            / NULLIF(COUNT(t.id), 0), 2
  ), 0)                                                                       AS clarification_rate,
  COALESCE(ROUND(AVG(t.latency_ms))::integer, 0)                             AS avg_latency_ms
FROM transmissions t
WHERE t.created_at >= current_date;

-- ─── Seed today's row (will be refreshed by edge fn in production) ────────────
INSERT INTO platform_stats (stat_date, active_users, connected_devices, tx_today,
  success_rate, clarification_rate, avg_latency_ms)
VALUES (current_date, 0, 0, 0, 0, 0, 0)
ON CONFLICT (stat_date) DO NOTHING;
