-- 025_user_encyclopedia.sql
-- Personal Encyclopedia — auto-accumulated knowledge from deep dive sessions.

CREATE TABLE IF NOT EXISTS user_encyclopedia (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic        TEXT NOT NULL,
  emoji        TEXT DEFAULT '📚',
  summary      TEXT NOT NULL,
  full_article TEXT NOT NULL,
  sections     JSONB DEFAULT '[]'::jsonb,   -- [{title, content}]
  tags         TEXT[] DEFAULT '{}',
  source_turns INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_encyclopedia_user  ON user_encyclopedia(user_id);
CREATE INDEX IF NOT EXISTS idx_encyclopedia_topic ON user_encyclopedia USING gin(to_tsvector('english', topic));

ALTER TABLE user_encyclopedia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own encyclopedia"
  ON user_encyclopedia FOR ALL
  USING (auth.uid() = user_id);

-- Unique constraint: one article per topic per user (upsert-friendly)
CREATE UNIQUE INDEX IF NOT EXISTS idx_encyclopedia_user_topic
  ON user_encyclopedia(user_id, lower(topic));
