-- 027_academy_streaks.sql — Roger Academy streak + progress tracking
-- Lightweight table for language learning gamification.

CREATE TABLE IF NOT EXISTS academy_streaks (
  user_id         UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  target_locale   TEXT NOT NULL DEFAULT 'fr-fr',
  current_streak  INT NOT NULL DEFAULT 0,
  longest_streak  INT NOT NULL DEFAULT 0,
  last_session    TIMESTAMPTZ,
  total_sessions  INT NOT NULL DEFAULT 0,
  total_words     INT NOT NULL DEFAULT 0,
  accuracy_pct    REAL NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: users can only access their own streaks
ALTER TABLE academy_streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own streaks"
  ON academy_streaks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_academy_streaks_user
  ON academy_streaks (user_id);
