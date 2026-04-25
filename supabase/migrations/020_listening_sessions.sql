-- ─── Migration 020 — Listening Sessions & Meeting Recordings ─────────────────
-- Run after 019_road_hazards.sql

-- ─── ambient_sessions — "Roger, listen to this" sessions ─────────────────────
CREATE TABLE IF NOT EXISTS ambient_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  started_at   timestamptz DEFAULT now(),
  ended_at     timestamptz,
  duration_s   integer,
  content_type text CHECK (content_type IN ('speech','music','ambient','mixed','unknown')),
  language     text,          -- detected language code e.g. 'ar', 'en', 'fr'
  language_name text,         -- human-readable e.g. 'Arabic'
  transcript   text,          -- full rolling transcript (joined chunks)
  summary      text,          -- GPT-4o summary
  music_title  text,          -- if music detected via ACRCloud
  music_artist text,
  music_album  text,
  raw_chunks   jsonb DEFAULT '[]'  -- [{ts, type, text, language, confidence, music_hint}]
);

CREATE INDEX IF NOT EXISTS idx_ambient_sessions_user
  ON ambient_sessions (user_id, started_at DESC);

-- ─── meeting_recordings — structured meeting sessions ─────────────────────────
CREATE TABLE IF NOT EXISTS meeting_recordings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  title        text,
  started_at   timestamptz DEFAULT now(),
  ended_at     timestamptz,
  duration_s   integer,
  transcript   text,                 -- full joined transcript
  summary      text,                 -- GPT-4o executive summary
  action_items jsonb DEFAULT '[]',   -- [{text, owner, due_date}]
  decisions    jsonb DEFAULT '[]',   -- [{text}]
  participants jsonb DEFAULT '[]',   -- [{name, role}]
  chunk_count  integer DEFAULT 0,
  status       text DEFAULT 'recording'
               CHECK (status IN ('recording','processing','done','failed'))
);

CREATE INDEX IF NOT EXISTS idx_meeting_recordings_user
  ON meeting_recordings (user_id, started_at DESC);

COMMENT ON TABLE ambient_sessions   IS 'Roger listen-to-this ambient analysis sessions';
COMMENT ON TABLE meeting_recordings IS 'Roger record-meeting structured meeting capture sessions';
