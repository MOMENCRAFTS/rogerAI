-- ═══════════════════════════════════════════════════════════════════════════════
-- 044 — Knowledge Pathways (Classroom Mode)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Universal learning system: users study any topic via structured voice lessons.
-- Roger generates a curriculum, teaches module-by-module, and assesses progress.

-- ── Pathway (top-level learning plan) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_pathways (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic           TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  total_modules   INT NOT NULL DEFAULT 6,
  completed       INT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','completed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pathways_user ON learning_pathways(user_id, status);

-- ── Modules within a pathway ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pathway_modules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pathway_id      UUID NOT NULL REFERENCES learning_pathways(id) ON DELETE CASCADE,
  module_number   INT NOT NULL,
  title           TEXT NOT NULL,
  summary         TEXT,
  key_concepts    JSONB NOT NULL DEFAULT '[]',
  lesson_content  TEXT,
  status          TEXT NOT NULL DEFAULT 'locked'
                    CHECK (status IN ('locked','available','in_progress','completed')),
  score           INT,
  attempts        INT NOT NULL DEFAULT 0,
  unlocked_at     TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modules_pathway ON pathway_modules(pathway_id, module_number);

-- ── Assessment questions per module ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pathway_assessments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id       UUID NOT NULL REFERENCES pathway_modules(id) ON DELETE CASCADE,
  question        TEXT NOT NULL,
  expected_answer TEXT NOT NULL,
  user_answer     TEXT,
  result          TEXT CHECK (result IN ('correct','partial','wrong')),
  feedback        TEXT,
  asked_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessments_module ON pathway_assessments(module_id);

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE learning_pathways ENABLE ROW LEVEL SECURITY;
ALTER TABLE pathway_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pathway_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own pathways"
  ON learning_pathways FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users access own modules"
  ON pathway_modules FOR ALL
  USING (pathway_id IN (
    SELECT id FROM learning_pathways WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users access own assessments"
  ON pathway_assessments FOR ALL
  USING (module_id IN (
    SELECT pm.id FROM pathway_modules pm
    JOIN learning_pathways lp ON pm.pathway_id = lp.id
    WHERE lp.user_id = auth.uid()
  ));
