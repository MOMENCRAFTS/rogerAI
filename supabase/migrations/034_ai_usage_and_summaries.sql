-- ─── Migration 034: AI Usage Tracking & Conversation Summaries ──────────────
-- Adds token budget tracking for all AI edge functions and
-- conversation summary compression for memory optimization.

-- ── 1. AI Usage Log — tracks every AI call ─────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  function_name TEXT NOT NULL,           -- e.g. 'process-transmission', 'roger-think'
  model         TEXT NOT NULL,           -- e.g. 'gpt-5.5', 'gpt-5.4-mini', 'whisper-1'
  prompt_tokens    INT DEFAULT 0,
  completion_tokens INT DEFAULT 0,
  total_tokens     INT DEFAULT 0,
  cost_usd      NUMERIC(10,6) DEFAULT 0,  -- estimated cost
  latency_ms    INT DEFAULT 0,
  success       BOOLEAN DEFAULT true,
  error_message TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time
  ON ai_usage_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_function
  ON ai_usage_log(function_name, created_at DESC);

-- Daily aggregate view for admin dashboard
CREATE OR REPLACE VIEW ai_usage_daily AS
  SELECT
    date_trunc('day', created_at) AS day,
    function_name,
    model,
    COUNT(*) AS call_count,
    SUM(total_tokens) AS total_tokens,
    SUM(cost_usd) AS total_cost,
    AVG(latency_ms)::INT AS avg_latency_ms,
    COUNT(*) FILTER (WHERE NOT success) AS error_count
  FROM ai_usage_log
  GROUP BY 1, 2, 3
  ORDER BY 1 DESC, 4 DESC;

-- RLS: users see own usage, service role sees all
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_usage_select ON ai_usage_log
  FOR SELECT USING (auth.uid() = user_id);

-- Service role inserts (edge functions use service key, bypasses RLS)
CREATE POLICY ai_usage_insert ON ai_usage_log
  FOR INSERT WITH CHECK (true);

-- ── 2. Conversation Summaries — compressed session memory ──────────────────

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL,              -- grouping key for conversation turns
  summary     JSONB NOT NULL,            -- { key_decisions, action_items, topics, mood }
  turn_count  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_summaries_user
  ON conversation_summaries(user_id, created_at DESC);

ALTER TABLE conversation_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY conv_summaries_select ON conversation_summaries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY conv_summaries_insert ON conversation_summaries
  FOR INSERT WITH CHECK (true);

-- ── 3. Email digest preference column ──────────────────────────────────────

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS email_digest_enabled BOOLEAN DEFAULT false;
