-- ─── Roger AI — User Tables Migration ──────────────────────────────────────
-- Run this in Supabase SQL Editor.

-- ─── reminders ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reminders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  text          text NOT NULL,
  entities      jsonb,
  due_at        timestamptz,
  status        text DEFAULT 'pending' CHECK (status IN ('pending','done','dismissed')),
  source_tx_id  text,
  is_admin_test boolean DEFAULT false,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- ─── tasks ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  text          text NOT NULL,
  priority      integer DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  status        text DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  due_at        timestamptz,
  source_tx_id  text,
  is_admin_test boolean DEFAULT false,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- ─── memories ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  type          text DEFAULT 'note' CHECK (type IN ('note','book','observation','capture')),
  text          text NOT NULL,
  entities      jsonb,
  tags          text[],
  source_tx_id  text,
  is_admin_test boolean DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

-- ─── surface_queue ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS surface_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  type          text NOT NULL,
  content       text NOT NULL,
  priority      integer DEFAULT 5,
  surface_at    timestamptz DEFAULT now(),
  snooze_count  integer DEFAULT 0,
  dismissed     boolean DEFAULT false,
  context       text,
  source_tx_id  text,
  created_at    timestamptz DEFAULT now()
);

-- ─── user_preferences ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id        text PRIMARY KEY,
  roger_mode     text DEFAULT 'active' CHECK (roger_mode IN ('quiet','active','briefing')),
  language       text DEFAULT 'en',
  briefing_time  text DEFAULT '08:00',
  briefing_time2 text DEFAULT '18:00',
  timezone       text DEFAULT 'UTC',
  updated_at     timestamptz DEFAULT now()
);

-- ─── intent_registry ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intent_registry (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text UNIQUE NOT NULL,
  status               text DEFAULT 'pending_review'
                         CHECK (status IN ('pending_review','active','disabled','blocked')),
  execution_tier       text DEFAULT 'soft'
                         CHECK (execution_tier IN ('soft','hard','pending_integration')),
  ambient_mode         boolean DEFAULT false,
  requires_consent     boolean DEFAULT false,
  max_duration_seconds integer,
  handler_function     text,
  suggested_group      text,
  description          text,
  use_count            integer DEFAULT 1,
  last_used_at         timestamptz DEFAULT now(),
  created_at           timestamptz DEFAULT now()
);

-- ─── intent_audit_log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intent_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_name text NOT NULL,
  old_status  text,
  new_status  text,
  changed_by  text,
  reason      text,
  changed_at  timestamptz DEFAULT now()
);

-- ─── intent_block_log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intent_block_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_intent text,
  matched_block    text,
  transcript       text,
  user_id          text,
  similarity_score float,
  blocked_at       timestamptz DEFAULT now()
);

-- ─── Seed: built-in active intents ───────────────────────────────────────────
INSERT INTO intent_registry (name, status, execution_tier, suggested_group, description)
VALUES
  ('CREATE_REMINDER',   'active', 'hard', 'SCHEDULING',     'User wants to set a reminder or follow-up'),
  ('CREATE_TASK',       'active', 'hard', 'SCHEDULING',     'User wants to create an action item or to-do'),
  ('MEMORY_CAPTURE',    'active', 'hard', 'MEMORY',         'User wants to save a note, thought, or observation'),
  ('BOOK_UPDATE',       'active', 'hard', 'MEMORY',         'User wants to add to their book or journal'),
  ('QUERY_REMINDERS',   'active', 'soft', 'QUERIES',        'User wants to hear their reminders'),
  ('BRIEFING_REQUEST',  'active', 'soft', 'QUERIES',        'User wants a briefing or summary'),
  ('WATCHLIST_QUERY',   'active', 'soft', 'QUERIES',        'User asks about stocks or market data'),
  ('IDENTIFY_MUSIC',    'pending_review', 'soft', 'AMBIENT', 'Identify a song playing nearby'),
  ('TRANSCRIBE_AMBIENT','blocked', 'soft', 'AMBIENT',       'Transcribe a nearby conversation'),
  ('TRANSLATE_AMBIENT', 'blocked', 'soft', 'AMBIENT',       'Translate nearby speech to user language'),
  ('STATUS_CHECK',      'active', 'soft', 'SYSTEM',         'User asks about their status, stats, or usage')
ON CONFLICT (name) DO NOTHING;
