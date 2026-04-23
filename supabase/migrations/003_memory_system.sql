-- ─── Roger AI — Memory System Migration ─────────────────────────────────────
-- Run this in Supabase SQL Editor AFTER 002_user_tables.sql

-- ─── Patch user_preferences (add onboarding + style fields) ──────────────────
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_step     integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS response_style      text DEFAULT 'balanced'
    CHECK (response_style IN ('brief','balanced','detailed')),
  ADD COLUMN IF NOT EXISTS display_name        text;

-- ─── Patch memories (add raw_transcript + session_id) ────────────────────────
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS raw_transcript text,
  ADD COLUMN IF NOT EXISTS session_id     text,
  ADD COLUMN IF NOT EXISTS distilled_by   text DEFAULT 'gpt-4o';

-- ─── conversation_history ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  session_id    text NOT NULL,
  role          text NOT NULL CHECK (role IN ('user','assistant')),
  content       text NOT NULL,
  intent        text,
  is_admin_test boolean DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_history_user_time
  ON conversation_history (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conv_history_fts
  ON conversation_history USING gin(to_tsvector('english', content));

-- ─── entity_mentions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entity_mentions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text NOT NULL,
  entity_text         text NOT NULL,
  entity_type         text NOT NULL,
  mention_count       integer DEFAULT 1,
  last_mentioned_at   timestamptz DEFAULT now(),
  first_mentioned_at  timestamptz DEFAULT now(),
  has_task            boolean DEFAULT false,
  has_reminder        boolean DEFAULT false,
  surfaced            boolean DEFAULT false,
  UNIQUE (user_id, entity_text)
);

CREATE INDEX IF NOT EXISTS idx_entity_mentions_user
  ON entity_mentions (user_id, mention_count DESC);

-- ─── memory_graph ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_graph (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  fact_type    text NOT NULL CHECK (fact_type IN (
                 'person','company','project','preference',
                 'relationship','goal','habit','location'
               )),
  subject      text NOT NULL,
  predicate    text NOT NULL,
  object       text NOT NULL,
  confidence   integer DEFAULT 80,
  source_tx    text,
  is_confirmed boolean DEFAULT false,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_graph_user
  ON memory_graph (user_id, fact_type);

-- ─── memory_insights ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_insights (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  insight     text NOT NULL,
  source_turn text,
  acted_on    boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_insights_user
  ON memory_insights (user_id, created_at DESC);

-- ─── Full-text search on memories ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_memories_fts
  ON memories USING gin(to_tsvector('english', text));

-- ─── Surface queue priority index ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_surface_queue_active
  ON surface_queue (user_id, priority DESC, surface_at)
  WHERE dismissed = false;
