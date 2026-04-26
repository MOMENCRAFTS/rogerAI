-- ─── Roger AI — Clarification Context Tracking ──────────────────────────────
-- Migration 024: Adds columns to the transmissions table for richer
-- clarification analytics — resolution status, attempt tracking, and
-- original context preservation.
-- Run in Supabase SQL Editor AFTER 023_cron_jobs.sql

-- ─── Extend transmissions table with clarification tracking columns ──────────

ALTER TABLE transmissions
  ADD COLUMN IF NOT EXISTS resolution_status text DEFAULT NULL
    CHECK (resolution_status IN ('pending','resolved','abandoned')),
  ADD COLUMN IF NOT EXISTS attempt_number integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS original_transcript text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS clarification_question text DEFAULT NULL;

-- Index for admin dashboard clarification analytics queries
CREATE INDEX IF NOT EXISTS idx_transmissions_clarification
  ON transmissions (status, resolution_status, created_at DESC)
  WHERE status = 'CLARIFICATION';

-- ─── View: Clarification Analytics ───────────────────────────────────────────
-- Aggregated stats for the admin Disambiguation Centre module.

CREATE OR REPLACE VIEW clarification_analytics AS
SELECT
  DATE(created_at) AS stat_date,
  COUNT(*) AS total_clarifications,
  COUNT(CASE WHEN resolution_status = 'resolved' THEN 1 END) AS resolved_count,
  COUNT(CASE WHEN resolution_status = 'abandoned' THEN 1 END) AS abandoned_count,
  COUNT(CASE WHEN resolution_status = 'pending' THEN 1 END) AS pending_count,
  ROUND(
    100.0 * COUNT(CASE WHEN resolution_status = 'resolved' THEN 1 END)
    / NULLIF(COUNT(*), 0)
  , 1) AS resolution_rate,
  ROUND(AVG(attempt_number), 2) AS avg_attempts,
  intent,
  COUNT(DISTINCT user_id) AS affected_users
FROM transmissions
WHERE status = 'CLARIFICATION'
GROUP BY DATE(created_at), intent
ORDER BY stat_date DESC, total_clarifications DESC;
