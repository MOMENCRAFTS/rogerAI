-- ─── Migration 041: memory_graph Schema Fixes ────────────────────────────────
-- Fixes three P0 bugs identified in the Roger Knows audit:
--
-- Bug 1: is_draft column missing — draft facts are never persisted/promoted
-- Bug 2: language_vocab missing from fact_type CHECK — Academy vocab never saves
-- Bug 3: No unique DB index — concurrent writes create duplicate facts
--
-- Also patches memory_insights to support conflict flagging from memory-janitor.
--
-- Safe to run multiple times (all statements are idempotent).

-- ── Bug 1: Add missing is_draft column ───────────────────────────────────────
ALTER TABLE memory_graph
  ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false;

-- Backfill: treat any existing low-confidence unconfirmed facts as drafts
UPDATE memory_graph
SET    is_draft = true
WHERE  is_confirmed = false
  AND  confidence < 75
  AND  is_draft = false;

-- ── Bug 2: Add language_vocab to fact_type CHECK constraint ──────────────────
-- Must drop + recreate the constraint (Postgres doesn't support ALTER CHECK)
ALTER TABLE memory_graph
  DROP CONSTRAINT IF EXISTS memory_graph_fact_type_check;

ALTER TABLE memory_graph
  ADD CONSTRAINT memory_graph_fact_type_check
  CHECK (fact_type IN (
    'person',
    'company',
    'project',
    'preference',
    'relationship',
    'goal',
    'habit',
    'location',
    'language_vocab'
  ));

-- ── Bug 3: Unique index on (user_id, subject, predicate, object) ─────────────
-- Case-insensitive to prevent "Ahmad" vs "ahmad" duplicates.
-- The janitor will clean existing dupes before this runs; but IF any survive,
-- the index creation may fail — in that case run the janitor first, then rerun.
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_graph_fact_unique
  ON memory_graph (
    user_id,
    lower(subject),
    lower(predicate),
    lower(object)
  );

-- ── memory_insights: add columns needed by memory-janitor Node C ─────────────
-- The janitor flags contradictory facts here for user review.
ALTER TABLE memory_insights
  ADD COLUMN IF NOT EXISTS insight_type text DEFAULT 'FACT' CHECK (
    insight_type IN ('FACT', 'PATTERN', 'CONFLICT', 'NOISE')
  ),
  ADD COLUMN IF NOT EXISTS metadata     jsonb,
  ADD COLUMN IF NOT EXISTS discarded    boolean DEFAULT false;

-- Rename existing 'insight' column alias for clarity (kept as-is for compat)
-- The memory-janitor uses 'insight' for the content field — matches existing schema.

-- ── Index: fast lookup of unreviewed conflicts for the UI ─────────────────────
CREATE INDEX IF NOT EXISTS idx_memory_insights_conflicts
  ON memory_insights (user_id, insight_type, created_at DESC)
  WHERE discarded = false;
