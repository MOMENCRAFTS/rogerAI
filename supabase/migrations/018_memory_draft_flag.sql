-- ─── Migration 018 — Memory Graph: is_draft column ───────────────────────────
-- Adds is_draft flag to distinguish borderline facts (confidence 50–74)
-- from high-signal confirmed candidates (confidence ≥ 75).
--
-- Draft facts:
--   - Written by extract-memory-facts v2 edge fn when confidence is 50–74
--   - Confidence capped at 60 so they don't dominate context injection
--   - Promoted to is_draft = false when the same fact is mentioned a second time
--   - Visible in MemoryGraph.tsx admin view with a DRAFT badge
--   - Excluded from the top-12 context injection slice in buildUserContext()

ALTER TABLE memory_graph
  ADD COLUMN IF NOT EXISTS is_draft boolean DEFAULT false;

-- Index for efficient draft-only queries (admin review, promotion logic)
CREATE INDEX IF NOT EXISTS idx_memory_graph_draft
  ON memory_graph (user_id, is_draft)
  WHERE is_draft = true;

-- Comment for clarity
COMMENT ON COLUMN memory_graph.is_draft IS
  'true = borderline fact (confidence 50–74), needs a second signal to promote. false = high-signal fact (confidence ≥ 75).';
