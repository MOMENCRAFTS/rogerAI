-- ─── Migration 047: Tune In Audio Support ────────────────────────────────────
-- Adds audio_url column to tune_in_turns for optional audio storage reference.
-- Primary audio delivery is via Realtime base64 broadcast (ephemeral),
-- but transcripts and optional audio URLs are persisted for session history.

ALTER TABLE tune_in_turns
  ADD COLUMN IF NOT EXISTS audio_url text;

-- Add debrief notes field for post-call AI analysis per-user
ALTER TABLE tune_in_sessions
  ADD COLUMN IF NOT EXISTS debrief_a jsonb;   -- participant_a's AI debrief
ALTER TABLE tune_in_sessions
  ADD COLUMN IF NOT EXISTS debrief_b jsonb;   -- participant_b's AI debrief
