-- ─── Roger AI — Migration 005: Geo Location ────────────────────────────────
-- Adds geo-trigger columns to reminders (for location-triggered alerts)
-- and location columns to memories (for place-tagged memory cards).
--
-- Run in: Supabase Dashboard → SQL Editor
-- Safe to run multiple times (all use IF NOT EXISTS / DO NOTHING).

-- ── Reminders: geo-trigger support ──────────────────────────────────────────

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS due_location       text,       -- "pharmacy", "office", "Ahmad's office"
  ADD COLUMN IF NOT EXISTS due_location_lat   float,      -- resolved lat (null until geocoded)
  ADD COLUMN IF NOT EXISTS due_location_lng   float,      -- resolved lng
  ADD COLUMN IF NOT EXISTS due_radius_m       integer DEFAULT 300,   -- trigger radius in metres
  ADD COLUMN IF NOT EXISTS geo_triggered      boolean DEFAULT false;  -- true once fired

-- ── Memories: place tagging ──────────────────────────────────────────────────

ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS location_label text,   -- "Riyadh, Saudi Arabia"
  ADD COLUMN IF NOT EXISTS location_lat   float,
  ADD COLUMN IF NOT EXISTS location_lng   float;

-- ── user_location table (ensure exists) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_location (
  user_id    text PRIMARY KEY,
  latitude   float        NOT NULL,
  longitude  float        NOT NULL,
  city       text,
  country    text,
  accuracy_m float,
  updated_at timestamptz  DEFAULT now()
);

ALTER TABLE user_location DISABLE ROW LEVEL SECURITY;

-- ── Indexes for geo queries ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_reminders_geo
  ON reminders (user_id, status, geo_triggered)
  WHERE due_location IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memories_location
  ON memories (user_id, location_label)
  WHERE location_label IS NOT NULL;
