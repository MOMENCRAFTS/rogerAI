-- ─── Roger AI — Integrations Schema ──────────────────────────────────────────
-- Migration 012: Adds columns for 6 new external API integrations.

ALTER TABLE user_preferences
  -- Finnhub Finance
  ADD COLUMN IF NOT EXISTS finnhub_tickers    TEXT[],

  -- Twilio SMS
  ADD COLUMN IF NOT EXISTS twilio_phone       TEXT,

  -- Notion
  ADD COLUMN IF NOT EXISTS notion_token       TEXT,
  ADD COLUMN IF NOT EXISTS notion_db_id       TEXT,

  -- Spotify
  ADD COLUMN IF NOT EXISTS spotify_connected  BOOLEAN DEFAULT FALSE,

  -- Google Calendar (OAuth tokens stored server-side)
  ADD COLUMN IF NOT EXISTS gcal_connected     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gcal_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS gcal_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS gcal_token_expiry  TIMESTAMPTZ;
