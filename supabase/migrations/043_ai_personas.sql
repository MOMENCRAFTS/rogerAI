-- ─── Migration 043: AI Persona System ──────────────────────────────────────
-- Adds:
--   1. is_ai_persona + ai_persona_identity columns to user_preferences
--   2. ai_persona_events table (lifespan timeline + report storage)
--   3. last_advanced_at column for staggered cron scheduling
--   4. pg_cron job: advance-persona-life every 3 hours

-- ── 1. AI Persona columns on user_preferences ────────────────────────────────
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS is_ai_persona       boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_persona_identity jsonb   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_advanced_at    timestamptz DEFAULT NULL;
  -- ai_persona_identity stores: { name, age, nationality, city, archetype,
  --   profession, family_context, why_roger, daily_rhythm, ... }

-- Index for fast persona-only queries
CREATE INDEX IF NOT EXISTS idx_user_prefs_ai_persona
  ON user_preferences (is_ai_persona)
  WHERE is_ai_persona = true;

-- Index for staggered cron scheduling (advance least-recently-touched first)
CREATE INDEX IF NOT EXISTS idx_user_prefs_last_advanced
  ON user_preferences (last_advanced_at ASC NULLS FIRST)
  WHERE is_ai_persona = true;

-- ── 2. AI Persona Events table ────────────────────────────────────────────────
-- Stores every lifespan event: spawns, auto-advances, manual advances,
-- scenario injections, and generated reports (versioned).
CREATE TABLE IF NOT EXISTS ai_persona_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  event_type    text NOT NULL,   -- 'spawn' | 'life_advance' | 'manual_advance'
                                 -- | 'scenario' | 'report'
  summary       text NOT NULL,   -- human-readable: "Added 2 memories, completed 1 task"
  detail        jsonb,           -- full diff payload (new_memories, completed_tasks, ...)
  report_data   jsonb,           -- for event_type='report': the full structured report JSON
  model_used    text,            -- 'gpt-5.5' | 'gpt-4o-mini'
  tokens_used   int  DEFAULT 0,
  cost_usd      numeric(10,6) DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_persona_events_user_time
  ON ai_persona_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_persona_events_type
  ON ai_persona_events (user_id, event_type, created_at DESC);

-- ── 3. Cron: advance AI personas every 3 hours ───────────────────────────────
-- Max 3 personas per tick (staggered by last_advanced_at ASC).
-- The edge function self-limits to 3 to avoid rate spikes.
SELECT cron.schedule(
  'roger-advance-persona-life',
  '0 */3 * * *',   -- every 3 hours
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/advance-persona-life',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
