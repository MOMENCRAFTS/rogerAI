-- ─── Migration 021 — Orientation Flag ───────────────────────────────────────
-- Adds orientation tracking columns to user_preferences.
-- Run after 020_listening_sessions.sql

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS orientation_seen    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS orientation_version integer DEFAULT 0;

COMMENT ON COLUMN user_preferences.orientation_seen    IS 'True once user completes or skips Roger orientation';
COMMENT ON COLUMN user_preferences.orientation_version IS 'Version of orientation last completed, for future re-trigger';
