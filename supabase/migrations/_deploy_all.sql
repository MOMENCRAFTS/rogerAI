-- ================================================================
-- MIGRATION: 002_user_tables.sql
-- ================================================================
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


-- ================================================================
-- MIGRATION: 003_memory_system.sql
-- ================================================================
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


-- ================================================================
-- MIGRATION: 003a_memory_rls_fix.sql
-- ================================================================
-- ─── Roger AI — Memory Tables RLS Fix ────────────────────────────────────────
-- Run this in Supabase SQL Editor AFTER 003_memory_system.sql
-- Disables RLS on the new memory tables so the anon key can access them.
-- This matches the pattern of existing tables (reminders, tasks, memories, etc.)

-- ─── Disable RLS on new tables ───────────────────────────────────────────────
ALTER TABLE conversation_history  DISABLE ROW LEVEL SECURITY;
ALTER TABLE entity_mentions       DISABLE ROW LEVEL SECURITY;
ALTER TABLE memory_graph          DISABLE ROW LEVEL SECURITY;
ALTER TABLE memory_insights       DISABLE ROW LEVEL SECURITY;

-- ─── Also ensure existing tables are accessible ───────────────────────────────
-- (Run these if you're still getting 401s on reminders, tasks, memories etc.)
ALTER TABLE reminders             DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE memories              DISABLE ROW LEVEL SECURITY;
ALTER TABLE surface_queue         DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences      DISABLE ROW LEVEL SECURITY;
ALTER TABLE intent_registry       DISABLE ROW LEVEL SECURITY;
ALTER TABLE intent_audit_log      DISABLE ROW LEVEL SECURITY;
ALTER TABLE intent_block_log      DISABLE ROW LEVEL SECURITY;


-- ================================================================
-- MIGRATION: 004a_device_registry.sql
-- ================================================================
-- Roger AI — Migration 004: Device Registry
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS device_registry (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id        TEXT        UNIQUE NOT NULL,   -- ESP32 MAC-based ID
  user_id          TEXT        NOT NULL,           -- linked Roger AI user
  device_name      TEXT        DEFAULT 'Roger Device',
  firmware_version TEXT,
  last_seen        TIMESTAMPTZ,
  battery_pct      INTEGER     CHECK (battery_pct BETWEEN 0 AND 100),
  signal_strength  INTEGER,                        -- RSSI dBm
  status           TEXT        DEFAULT 'offline'   -- online | offline | charging
                               CHECK (status IN ('online','offline','charging')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Disable RLS for prototype (same pattern as other tables in this project)
ALTER TABLE device_registry DISABLE ROW LEVEL SECURITY;

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_device_registry_user
  ON device_registry (user_id, last_seen DESC);

-- Upsert helper view — last-seen devices per user
CREATE OR REPLACE VIEW active_devices AS
  SELECT *
  FROM device_registry
  WHERE status = 'online'
    AND last_seen > NOW() - INTERVAL '5 minutes';


-- ================================================================
-- MIGRATION: 004b_push_and_location.sql
-- ================================================================
-- ─── Roger AI — Push Notifications + Location Migration ──────────────────────
-- Run AFTER 003_memory_system.sql

-- ─── push_subscriptions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  endpoint    text NOT NULL,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user
  ON push_subscriptions (user_id);

-- ─── user_location (live location snapshots) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS user_location (
  user_id       text PRIMARY KEY,
  latitude      double precision NOT NULL,
  longitude     double precision NOT NULL,
  city          text,
  country       text,
  accuracy_m    double precision,
  updated_at    timestamptz DEFAULT now()
);


-- ================================================================
-- MIGRATION: 005_geo_location.sql
-- ================================================================
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


-- ================================================================
-- MIGRATION: 006_ptt_network.sql
-- ================================================================
-- ─── Migration 006: PTT Network (roger_contacts, relay_messages, roger_channels) ─
-- Run: supabase db push  OR  paste into Supabase SQL Editor

-- ─── Roger Channels ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roger_channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group', 'open')),
  owner_id    uuid REFERENCES auth.users ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Channel Members ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id  uuid NOT NULL REFERENCES roger_channels ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

-- ─── Roger Contacts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roger_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  contact_id    uuid REFERENCES auth.users ON DELETE SET NULL,
  display_name  text NOT NULL,                    -- how the owner refers to them ("Ahmad", "Mom")
  handle        text,                              -- their callsign / invite email before acceptance
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'active', 'blocked')),
  invited_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_id)
);

-- ─── Relay Messages ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS relay_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      uuid REFERENCES roger_channels ON DELETE SET NULL,
  sender_id       uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  recipient_id    uuid REFERENCES auth.users ON DELETE SET NULL,  -- null = group channel
  transcript      text NOT NULL,
  roger_summary   text,                           -- GPT-4o summary for long messages
  audio_url       text,                           -- Supabase Storage path (optional)
  priority        text NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('normal', 'urgent', 'emergency')),
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'delivered', 'read', 'deferred')),
  deferred_until  timestamptz,
  intent          text,                           -- e.g. RELAY_SEND, ETA_UPDATE
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  read_at         timestamptz
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_relay_messages_recipient
  ON relay_messages (recipient_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_relay_messages_sender
  ON relay_messages (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_roger_contacts_user
  ON roger_contacts (user_id, status);

CREATE INDEX IF NOT EXISTS idx_channel_members_user
  ON channel_members (user_id);

-- ─── RLS Policies ─────────────────────────────────────────────────────────────
ALTER TABLE roger_contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE roger_channels    ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_members   ENABLE ROW LEVEL SECURITY;

-- roger_contacts: owner sees their own contacts
CREATE POLICY "contacts_select" ON roger_contacts
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = contact_id);
CREATE POLICY "contacts_insert" ON roger_contacts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "contacts_update" ON roger_contacts
  FOR UPDATE USING (auth.uid() = user_id OR auth.uid() = contact_id);
CREATE POLICY "contacts_delete" ON roger_contacts
  FOR DELETE USING (auth.uid() = user_id);

-- relay_messages: sender or recipient can see message
CREATE POLICY "relay_select" ON relay_messages
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);
CREATE POLICY "relay_insert" ON relay_messages
  FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "relay_update" ON relay_messages
  FOR UPDATE USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- roger_channels: owner or member
CREATE POLICY "channels_select" ON roger_channels
  FOR SELECT USING (
    auth.uid() = owner_id OR
    EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = roger_channels.id AND cm.user_id = auth.uid())
  );
CREATE POLICY "channels_insert" ON roger_channels
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "channels_update" ON roger_channels
  FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "channels_delete" ON roger_channels
  FOR DELETE USING (auth.uid() = owner_id);

-- channel_members: members see their own memberships
CREATE POLICY "members_select" ON channel_members
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "members_insert" ON channel_members
  FOR INSERT WITH CHECK (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM roger_channels rc WHERE rc.id = channel_id AND rc.owner_id = auth.uid())
  );
CREATE POLICY "members_delete" ON channel_members
  FOR DELETE USING (auth.uid() = user_id);

-- ─── Realtime ─────────────────────────────────────────────────────────────────
-- Enable Realtime for relay_messages so recipients get instant push
ALTER PUBLICATION supabase_realtime ADD TABLE relay_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE roger_contacts;


-- ================================================================
-- MIGRATION: 007_commute.sql
-- ================================================================
-- ─── Migration 007: Commute Intelligence ──────────────────────────────────────
-- Adds commute profile to user_preferences, plus parking_logs and errand_list

-- ─── user_preferences: commute profile columns ────────────────────────────────
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS home_address       text,
  ADD COLUMN IF NOT EXISTS home_lat           numeric,
  ADD COLUMN IF NOT EXISTS home_lng           numeric,
  ADD COLUMN IF NOT EXISTS work_address       text,
  ADD COLUMN IF NOT EXISTS work_lat           numeric,
  ADD COLUMN IF NOT EXISTS work_lng           numeric,
  ADD COLUMN IF NOT EXISTS commute_mode       text DEFAULT 'driving'
                              CHECK (commute_mode IN ('driving', 'transit', 'walking', 'cycling')),
  ADD COLUMN IF NOT EXISTS commute_leave_time time DEFAULT '08:00:00';

-- ─── Parking Logs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parking_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  location_label  text NOT NULL,            -- "Level B2, Spot 47"
  lat             numeric,
  lng             numeric,
  address         text,                     -- reverse-geocoded address
  notes           text,                     -- "near the elevator, blue pillar"
  source_tx_id    text,                     -- transcript that triggered this log
  created_at      timestamptz NOT NULL DEFAULT now(),
  retrieved_at    timestamptz               -- set when user asks "where did I park?"
);

CREATE INDEX IF NOT EXISTS idx_parking_logs_user
  ON parking_logs (user_id, created_at DESC);

ALTER TABLE parking_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parking_select" ON parking_logs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "parking_insert" ON parking_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "parking_update" ON parking_logs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "parking_delete" ON parking_logs
  FOR DELETE USING (auth.uid() = user_id);

-- ─── Errand List ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS errand_list (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  item            text NOT NULL,            -- "Pick up dry cleaning"
  location_hint   text,                     -- "Al Wasl Rd dry cleaner"
  location_lat    numeric,
  location_lng    numeric,
  radius_m        numeric DEFAULT 300,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'done', 'skipped')),
  source_tx_id    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_errand_list_user
  ON errand_list (user_id, status, created_at DESC);

ALTER TABLE errand_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "errand_select" ON errand_list
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "errand_insert" ON errand_list
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "errand_update" ON errand_list
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "errand_delete" ON errand_list
  FOR DELETE USING (auth.uid() = user_id);


-- ================================================================
-- MIGRATION: 008_tune_in.sql
-- ================================================================
-- ─── Migration 008: Tune In System ──────────────────────────────────────────
-- Dual-layer identity: callsign (cold contact) + name (saved contact)

-- ─── User Callsigns ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_callsigns (
  user_id    uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  callsign   text NOT NULL UNIQUE CHECK (char_length(callsign) = 7),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_callsigns_callsign ON user_callsigns (callsign);

-- ─── Add callsign column to roger_contacts ────────────────────────────────────
-- Stores the contact's callsign after first tune-in (hidden behind display_name)
ALTER TABLE roger_contacts
  ADD COLUMN IF NOT EXISTS callsign text;

-- ─── Ghost mode to user_preferences ──────────────────────────────────────────
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS ghost_mode_until timestamptz;    -- NULL = always available

-- ─── Tune In Requests ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tune_in_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id     uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  requester_callsign text,                                  -- shown to target if not a contact
  target_callsign  text NOT NULL,                           -- what the requester dialed
  target_user_id   uuid REFERENCES auth.users ON DELETE SET NULL, -- resolved from callsign
  reason           text,                                    -- optional spoken reason
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'declined', 'ended', 'expired')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  responded_at     timestamptz,
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '2 minutes')
);

CREATE INDEX IF NOT EXISTS idx_tune_in_requests_target
  ON tune_in_requests (target_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tune_in_requests_requester
  ON tune_in_requests (requester_id, created_at DESC);

-- ─── Tune In Sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tune_in_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid NOT NULL REFERENCES tune_in_requests ON DELETE CASCADE,
  participant_a  uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE, -- requester
  participant_b  uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE, -- target
  status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'ended')),
  session_start  timestamptz NOT NULL DEFAULT now(),
  session_end    timestamptz,
  roger_notes    text,                                      -- GPT-4o post-session analysis
  turn_count     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tune_in_sessions_participants
  ON tune_in_sessions (participant_a, participant_b, status);

-- ─── Tune In Turns ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tune_in_turns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES tune_in_sessions ON DELETE CASCADE,
  speaker_id  uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  transcript  text NOT NULL,
  is_flagged  boolean NOT NULL DEFAULT false,  -- "Roger, flag this" mid-session
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tune_in_turns_session
  ON tune_in_turns (session_id, created_at ASC);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE user_callsigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tune_in_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tune_in_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tune_in_turns     ENABLE ROW LEVEL SECURITY;

-- user_callsigns: own row only (callsign lookup done server-side)
CREATE POLICY "callsign_select" ON user_callsigns
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "callsign_insert" ON user_callsigns
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- tune_in_requests: requester or target can see
CREATE POLICY "tunein_req_select" ON tune_in_requests
  FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = target_user_id);
CREATE POLICY "tunein_req_insert" ON tune_in_requests
  FOR INSERT WITH CHECK (auth.uid() = requester_id);
CREATE POLICY "tunein_req_update" ON tune_in_requests
  FOR UPDATE USING (auth.uid() = requester_id OR auth.uid() = target_user_id);

-- tune_in_sessions: participants only
CREATE POLICY "tunein_sess_select" ON tune_in_sessions
  FOR SELECT USING (auth.uid() = participant_a OR auth.uid() = participant_b);
CREATE POLICY "tunein_sess_update" ON tune_in_sessions
  FOR UPDATE USING (auth.uid() = participant_a OR auth.uid() = participant_b);

-- tune_in_turns: session participants only
CREATE POLICY "tunein_turns_select" ON tune_in_turns
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tune_in_sessions s
      WHERE s.id = session_id
        AND (s.participant_a = auth.uid() OR s.participant_b = auth.uid())
    )
  );
CREATE POLICY "tunein_turns_insert" ON tune_in_turns
  FOR INSERT WITH CHECK (auth.uid() = speaker_id);

-- ─── Realtime ─────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE tune_in_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE tune_in_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE tune_in_turns;


-- ================================================================
-- MIGRATION: 009_auth_rls.sql
-- ================================================================
-- ─── Roger AI — Auth RLS Policies ─────────────────────────────────────────────
-- Migration 009: Row Level Security using auth.uid() for all user-owned tables.
-- Both sides cast to text to handle uuid vs text column type differences.
-- Run this in the Supabase SQL Editor after enabling Google OAuth.

-- ─── reminders ────────────────────────────────────────────────────────────────
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reminders_self" ON reminders;
CREATE POLICY "reminders_self" ON reminders
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── tasks ────────────────────────────────────────────────────────────────────
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tasks_self" ON tasks;
CREATE POLICY "tasks_self" ON tasks
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── memories ─────────────────────────────────────────────────────────────────
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memories_self" ON memories;
CREATE POLICY "memories_self" ON memories
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── surface_queue ────────────────────────────────────────────────────────────
ALTER TABLE surface_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "surface_queue_self" ON surface_queue;
CREATE POLICY "surface_queue_self" ON surface_queue
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── user_preferences ─────────────────────────────────────────────────────────
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_preferences_self" ON user_preferences;
CREATE POLICY "user_preferences_self" ON user_preferences
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── conversation_history ─────────────────────────────────────────────────────
ALTER TABLE conversation_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conversation_history_self" ON conversation_history;
CREATE POLICY "conversation_history_self" ON conversation_history
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── entity_mentions ──────────────────────────────────────────────────────────
ALTER TABLE entity_mentions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entity_mentions_self" ON entity_mentions;
CREATE POLICY "entity_mentions_self" ON entity_mentions
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── memory_graph ─────────────────────────────────────────────────────────────
ALTER TABLE memory_graph ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memory_graph_self" ON memory_graph;
CREATE POLICY "memory_graph_self" ON memory_graph
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── memory_insights ──────────────────────────────────────────────────────────
ALTER TABLE memory_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memory_insights_self" ON memory_insights;
CREATE POLICY "memory_insights_self" ON memory_insights
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── push_subscriptions ───────────────────────────────────────────────────────
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_subscriptions_self" ON push_subscriptions;
CREATE POLICY "push_subscriptions_self" ON push_subscriptions
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── user_location ────────────────────────────────────────────────────────────
ALTER TABLE user_location ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_location_self" ON user_location;
CREATE POLICY "user_location_self" ON user_location
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── roger_contacts ───────────────────────────────────────────────────────────
ALTER TABLE roger_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roger_contacts_self" ON roger_contacts;
CREATE POLICY "roger_contacts_self" ON roger_contacts
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── relay_messages ───────────────────────────────────────────────────────────
ALTER TABLE relay_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "relay_messages_self" ON relay_messages;
CREATE POLICY "relay_messages_self" ON relay_messages
  FOR ALL
  USING (
    sender_id::text = auth.uid()::text
    OR recipient_id::text = auth.uid()::text
  )
  WITH CHECK (sender_id::text = auth.uid()::text);


-- ================================================================
-- MIGRATION: 010_user_callsigns.sql
-- ================================================================
-- ─── Roger AI — User Callsigns Table ──────────────────────────────────────────
-- Migration 010: Stores one callsign per user, auto-assigned on first login.
-- Callsign format: NATO-WORD-NN (e.g. ECHO-47, BRAVO-12)

CREATE TABLE IF NOT EXISTS user_callsigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  callsign    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id),
  UNIQUE (callsign)
);

-- RLS: users can only read their own callsign
ALTER TABLE user_callsigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "callsign_self_read"   ON user_callsigns;
DROP POLICY IF EXISTS "callsign_self_insert" ON user_callsigns;
DROP POLICY IF EXISTS "callsign_lookup"      ON user_callsigns;

-- Allow authenticated user to read their own row
CREATE POLICY "callsign_self_read" ON user_callsigns
  FOR SELECT USING (user_id = auth.uid());

-- Allow authenticated user to insert their own row (first-login provision)
CREATE POLICY "callsign_self_insert" ON user_callsigns
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Allow anyone to look up a callsign by value (needed for Tune In dial-by-code)
CREATE POLICY "callsign_lookup" ON user_callsigns
  FOR SELECT USING (true);


-- ================================================================
-- MIGRATION: 011_tour_seen.sql
-- ================================================================
-- 011_tour_seen.sql
-- Tracks whether a user has completed the Mission Brief orientation tour.
-- tour_version allows re-showing the tour after major capability updates.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS tour_seen     BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tour_version  INTEGER  DEFAULT 0;


-- ================================================================
-- MIGRATION: 012_integrations.sql
-- ================================================================
-- ─── Roger AI — Integrations Schema ──────────────────────────────────────────
-- Migration 012: Adds columns for 6 new external API integrations.

ALTER TABLE user_preferences
  -- Finnhub Finance
  ADD COLUMN IF NOT EXISTS finnhub_tickers    TEXT[],

  -- Twilio SMS
  ADD COLUMN IF NOT EXISTS twilio_phone       TEXT,

  -- Notion
  ADD COLUMN IF NOT EXISTS notion_token       TEXT,
  ADD COLUMN IF NOT EXISTS notion_db_id       TEXT,

  -- Spotify
  ADD COLUMN IF NOT EXISTS spotify_connected  BOOLEAN DEFAULT FALSE,

  -- Google Calendar (OAuth tokens stored server-side)
  ADD COLUMN IF NOT EXISTS gcal_connected     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gcal_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS gcal_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS gcal_token_expiry  TIMESTAMPTZ;


-- ================================================================
-- MIGRATION: 013_platform_stats.sql
-- ================================================================
-- ─── Roger AI — Migration 013: Platform Stats ─────────────────────────────────
-- Replaces hardcoded Dashboard KPI mock values with a real aggregated table.
-- The `compute-stats` edge function upserts one row per day into platform_stats.
-- The `live_platform_stats` view computes today's numbers on-demand from raw tables.

-- ─── platform_stats ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_stats (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_date           date         NOT NULL UNIQUE,
  active_users        integer      NOT NULL DEFAULT 0,
  connected_devices   integer      NOT NULL DEFAULT 0,
  tx_today            integer      NOT NULL DEFAULT 0,
  success_rate        numeric(5,2) NOT NULL DEFAULT 0,
  clarification_rate  numeric(5,2) NOT NULL DEFAULT 0,
  avg_latency_ms      integer      NOT NULL DEFAULT 0,
  briefing_success    numeric(5,2) NOT NULL DEFAULT 100,
  smart_momentum      numeric(5,2) NOT NULL DEFAULT 0,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);

-- Admin-read only; compute-stats edge function uses service_role key
ALTER TABLE platform_stats DISABLE ROW LEVEL SECURITY;

-- ─── live_platform_stats view ────────────────────────────────────────────────
-- Computes today's KPIs directly from the transmissions table.
-- Used by Dashboard as a fallback when platform_stats has no row for today.
CREATE OR REPLACE VIEW live_platform_stats AS
SELECT
  current_date                                                                AS stat_date,
  COUNT(DISTINCT t.user_id)::integer                                          AS active_users,
  (SELECT COUNT(*) FROM devices WHERE status = 'online')::integer             AS connected_devices,
  COUNT(t.id)::integer                                                        AS tx_today,
  COALESCE(ROUND(
    100.0 * COUNT(CASE WHEN t.status = 'SUCCESS'       THEN 1 END)
            / NULLIF(COUNT(t.id), 0), 2
  ), 0)                                                                       AS success_rate,
  COALESCE(ROUND(
    100.0 * COUNT(CASE WHEN t.status = 'CLARIFICATION' THEN 1 END)
            / NULLIF(COUNT(t.id), 0), 2
  ), 0)                                                                       AS clarification_rate,
  COALESCE(ROUND(AVG(t.latency_ms))::integer, 0)                             AS avg_latency_ms
FROM transmissions t
WHERE t.created_at >= current_date;

-- ─── Seed today's row (will be refreshed by edge fn in production) ────────────
INSERT INTO platform_stats (stat_date, active_users, connected_devices, tx_today,
  success_rate, clarification_rate, avg_latency_ms)
VALUES (current_date, 0, 0, 0, 0, 0, 0)
ON CONFLICT (stat_date) DO NOTHING;


-- ================================================================
-- MIGRATION: 014_system_health.sql
-- ================================================================
-- ─── Roger AI — Migration 014: System Health & Alerts ────────────────────────
-- Replaces hardcoded HEALTH[] and ALERTS[] constants in Dashboard.tsx.

-- ─── system_health_checks ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_health_checks (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  service     text         NOT NULL,
  uptime_pct  numeric(5,2) NOT NULL DEFAULT 100,
  status      text         NOT NULL DEFAULT 'operational'
                CHECK (status IN ('operational', 'degraded', 'down')),
  message     text,
  checked_at  timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE system_health_checks DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_health_service
  ON system_health_checks (service, checked_at DESC);

-- Latest-per-service helper view
CREATE OR REPLACE VIEW latest_health_checks AS
SELECT DISTINCT ON (service)
  id, service, uptime_pct, status, message, checked_at
FROM system_health_checks
ORDER BY service, checked_at DESC;

-- Seed default services (these will be updated by health-check workers)
INSERT INTO system_health_checks (service, uptime_pct, status, message) VALUES
  ('AI_PIPELINE',  99.2, 'operational', 'Whisper + GPT-4o pipeline nominal'),
  ('DEVICE_SYNC',  97.8, 'operational', 'ESP32 relay heartbeat OK'),
  ('BRIEFING_GEN', 98.5, 'operational', 'AM/PM generation on schedule'),
  ('MEMORY_GRAPH', 99.8, 'operational', 'Memory graph writes < 50ms p95')
ON CONFLICT DO NOTHING;

-- ─── system_alerts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_alerts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  level       text        NOT NULL CHECK (level IN ('info', 'warning', 'critical')),
  message     text        NOT NULL,
  source      text,
  resolved    boolean     NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE system_alerts DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_alerts_active
  ON system_alerts (resolved, created_at DESC)
  WHERE resolved = false;

-- Seed existing mock alerts as real DB rows
INSERT INTO system_alerts (level, message, source, resolved) VALUES
  ('warning', 'Ambiguity rate elevated in EU region (+2.3%)', 'EU_REGION', false),
  ('info',    'Device firmware 2.4.1 rolling out (34% complete)', 'DEVICE_SYNC', false)
ON CONFLICT DO NOTHING;


-- ================================================================
-- MIGRATION: 015_devices_table.sql
-- ================================================================
-- ─── Roger AI — Migration 015: Devices Table ─────────────────────────────────
-- The Devices.tsx admin panel calls fetchDevices() which queries a `devices` table.
-- Migration 004 created `device_registry` (for ESP32 hardware, different schema).
-- This creates the admin-facing `devices` table with the schema that api.ts expects,
-- and keeps device_registry for ESP32 hardware registration as a separate concern.

CREATE TABLE IF NOT EXISTS devices (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text         NOT NULL,   -- auth.users id as text (matches user_preferences)
  region          text         NOT NULL DEFAULT 'UNKNOWN',
  firmware        text         NOT NULL DEFAULT '0.0.0',
  battery         integer      DEFAULT 100 CHECK (battery BETWEEN 0 AND 100),
  signal          integer      DEFAULT 0   CHECK (signal  BETWEEN 0 AND 100),
  sync_health     numeric(5,2) DEFAULT 100,
  queue_depth     integer      DEFAULT 0,
  status          text         NOT NULL DEFAULT 'offline'
                    CHECK (status IN ('online', 'offline', 'sync_issue')),
  last_sync_at    timestamptz  NOT NULL DEFAULT now(),
  created_at      timestamptz  NOT NULL DEFAULT now()
);

-- Admin-only table — no RLS needed
ALTER TABLE devices DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_devices_user   ON devices (user_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices (status, last_sync_at DESC);

-- Note: devices table is already a member of supabase_realtime publication.

-- ─── Seed demo devices so the panel isn't empty ──────────────────────────────
-- These represent real users' first device registrations.
-- Replace user_id values with real auth.users UUIDs after first login.
INSERT INTO devices (user_id, region, firmware, battery, signal, sync_health, queue_depth, status, last_sync_at) VALUES
  ('demo-user-001', 'US-WEST',    '2.4.1', 87,  98, 99.8,  0,  'online',     now() - interval '1 minute'),
  ('demo-user-002', 'EU-CENTRAL', '2.4.1', 45,  92, 99.2,  2,  'online',     now() - interval '3 minutes'),
  ('demo-user-003', 'APAC-EAST',  '2.4.0', 23,  78, 96.4,  5,  'online',     now() - interval '7 minutes'),
  ('demo-user-004', 'US-EAST',    '2.4.1', 92,  95, 100.0, 0,  'online',     now() - interval '2 minutes'),
  ('demo-user-005', 'EU-WEST',    '2.3.8', 68,  88, 82.1,  18, 'sync_issue', now() - interval '18 minutes')
ON CONFLICT DO NOTHING;


-- ================================================================
-- MIGRATION: 016_admin_views.sql
-- ================================================================
-- ─── Roger AI — Migration 016: Admin Views ────────────────────────────────────
-- Safe read-only view of auth.users for admin user-picker dropdowns.
-- Used by MemoryMonitor and PatternLab so admins can inspect any user's data.

-- ─── admin_user_list view ─────────────────────────────────────────────────────
-- Joins auth.users with user_preferences for display_name, mode, etc.
-- Never exposes password hashes, raw tokens, or sensitive auth fields.
CREATE OR REPLACE VIEW admin_user_list AS
SELECT
  u.id                                       AS user_id,
  u.email,
  COALESCE(up.display_name, split_part(u.email, '@', 1))
                                             AS display_name,
  up.onboarding_complete,
  up.onboarding_step,
  up.roger_mode,
  up.language,
  u.created_at                               AS joined_at,
  u.last_sign_in_at
FROM auth.users u
LEFT JOIN user_preferences up ON up.user_id = u.id::text
ORDER BY u.last_sign_in_at DESC NULLS LAST;

-- ─── user_memory_summary view ─────────────────────────────────────────────────
-- Per-user memory health counts for MemoryMonitor admin overview.
CREATE OR REPLACE VIEW user_memory_summary AS
SELECT
  u.id                                            AS user_id,
  COALESCE(up.display_name, u.email)              AS display_name,
  (SELECT COUNT(*) FROM conversation_history ch WHERE ch.user_id = u.id::text)   AS conversation_turns,
  (SELECT COUNT(*) FROM entity_mentions em     WHERE em.user_id  = u.id::text)   AS entity_count,
  (SELECT COUNT(*) FROM memory_graph mg        WHERE mg.user_id  = u.id::text)   AS fact_count,
  (SELECT COUNT(*) FROM memory_insights mi     WHERE mi.user_id  = u.id::text)   AS insight_count,
  (SELECT COUNT(*) FROM memories m             WHERE m.user_id   = u.id::text)   AS memory_count,
  (SELECT MAX(created_at) FROM conversation_history WHERE user_id = u.id::text)  AS last_active
FROM auth.users u
LEFT JOIN user_preferences up ON up.user_id = u.id::text
ORDER BY last_active DESC NULLS LAST;


-- ================================================================
-- MIGRATION: 017_feature_flags.sql
-- ================================================================
-- ─── Roger AI — Migration 017: Feature Flags ──────────────────────────────────
-- Powers the Feature Flags admin panel (currently a placeholder).
-- Admin can toggle flags, set rollout %, and target specific users.

CREATE TABLE IF NOT EXISTS feature_flags (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text        UNIQUE NOT NULL,
  name         text        NOT NULL,
  description  text,
  enabled      boolean     NOT NULL DEFAULT false,
  rollout_pct  integer     DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
  environment  text        NOT NULL DEFAULT 'production'
                 CHECK (environment IN ('development', 'staging', 'production')),
  target_users text[],                      -- specific user IDs (overrides rollout_pct)
  category     text        DEFAULT 'general'
                 CHECK (category IN ('general', 'ui', 'ai', 'hardware', 'experiment')),
  created_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE feature_flags DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_feature_flags_env
  ON feature_flags (environment, enabled);

-- ─── Seed known flags ────────────────────────────────────────────────────────
INSERT INTO feature_flags (key, name, description, enabled, rollout_pct, environment, category) VALUES
  ('splash_screen',        'Cinematic Splash Screen',        '25-second role-aware intro sequence on login',           true,  100, 'production',   'ui'),
  ('mission_brief_tour',   'Mission Brief Onboarding Tour',  '5-slide first-use orientation for new users',            true,  100, 'production',   'ui'),
  ('haptics_enabled',      'Haptic Feedback (Mobile)',        'PTT press/release vibration via Capacitor Haptics',      true,  100, 'production',   'hardware'),
  ('sfx_enabled',          'SFX Audio Feedback',             'Click and radio squelch sounds on PTT actions',          true,  100, 'production',   'hardware'),
  ('tune_in_beta',         'Tune In P2P Sessions',           'Live peer-to-peer PTT sessions via callsign',            true,   75, 'production',   'general'),
  ('commute_cmd',          'Commute Intelligence Module',    'Route briefing, errand list, parking log',               true,  100, 'production',   'general'),
  ('memory_graph_v2',      'Memory Graph V2 Engine',         'Next-gen entity relationship graph with clustering',      false,   0, 'staging',      'ai'),
  ('proactive_summaries',  'Proactive Context Summaries',    'Roger auto-generates a brief before you ask',            false,  20, 'staging',      'ai'),
  ('emergency_ptt',        'Emergency Priority PTT',         'One-touch emergency broadcast to all active contacts',    false,   0, 'development',  'hardware'),
  ('multi_device_sync',    'Multi-Device Session Sync',      'Sync active PTT session across phone + ESP32 device',     false,   0, 'development',  'hardware')
ON CONFLICT (key) DO NOTHING;


-- ================================================================
-- MIGRATION: 018a_admin_audit_log.sql
-- ================================================================
-- ─── Roger AI — Migration 018: Admin Audit Log ────────────────────────────────
-- Every admin action (intent status change, flag toggle, user flush, etc.)
-- is written here. Powers the Audit Log admin panel (currently a placeholder).

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      text        NOT NULL,         -- auth.users id of the acting admin
  admin_email   text,
  module        text        NOT NULL,          -- 'intent_registry', 'feature_flags', etc.
  action        text        NOT NULL,          -- 'STATUS_CHANGE', 'FLAG_TOGGLE', 'MEMORY_FLUSH', etc.
  target_id     text,                          -- ID of the affected entity (intent name, flag key, user id…)
  target_label  text,                          -- human-readable label of target
  before_state  jsonb,
  after_state   jsonb,
  reason        text,
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_audit_log DISABLE ROW LEVEL SECURITY;

-- Indexes for filtered views
CREATE INDEX IF NOT EXISTS idx_audit_time   ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_admin  ON admin_audit_log (admin_id,  created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_module ON admin_audit_log (module,    created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON admin_audit_log (action,    created_at DESC);

-- Seed: back-fill existing intent registry status changes from intent_audit_log
-- (Maps existing intent audit trail into the global audit log format)
INSERT INTO admin_audit_log (admin_id, admin_email, module, action, target_id, target_label, before_state, after_state, reason, created_at)
SELECT
  COALESCE(changed_by, 'system'),
  null,
  'intent_registry',
  'STATUS_CHANGE',
  intent_name,
  intent_name,
  CASE WHEN old_status IS NOT NULL THEN jsonb_build_object('status', old_status) ELSE NULL END,
  jsonb_build_object('status', new_status),
  reason,
  changed_at
FROM intent_audit_log
ON CONFLICT DO NOTHING;


-- ================================================================
-- MIGRATION: 018b_memory_draft_flag.sql
-- ================================================================
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


-- ================================================================
-- MIGRATION: 019_road_hazards.sql
-- ================================================================
-- ─── 019 · Road Hazards ────────────────────────────────────────────────────────
-- Community-sourced + API-fused hazard layer for Roger Radar.
-- Hazard types: speed_cam, police, accident, road_works, debris, flood, closure
-- Sources: community (PTT reports), osm (fixed cameras), tomtom (live incidents)
-- Auto-expiry: 1h police/speed, 4h accidents, 24h roadworks/flood/debris/closure

CREATE TABLE IF NOT EXISTS road_hazards (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type             text        NOT NULL CHECK (type IN (
                     'speed_cam','police','accident','road_works','debris','flood','closure')),
  lat              double precision NOT NULL,
  lng              double precision NOT NULL,
  heading_deg      int,
  reported_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  source           text        NOT NULL DEFAULT 'community'
                   CHECK (source IN ('community','osm','tomtom')),
  confirmed_count  int         NOT NULL DEFAULT 1,
  denied_count     int         NOT NULL DEFAULT 0,
  expires_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Row Level Security
ALTER TABLE road_hazards ENABLE ROW LEVEL SECURITY;

-- Anyone can read hazards (community-shared data)
CREATE POLICY "rh_select"
  ON road_hazards FOR SELECT
  USING (true);

-- Authenticated users can insert
CREATE POLICY "rh_insert"
  ON road_hazards FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Authenticated users can update vote counts (confirmed/denied)
CREATE POLICY "rh_update_votes"
  ON road_hazards FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Index for geo-proximity queries
CREATE INDEX IF NOT EXISTS road_hazards_geo_idx ON road_hazards (lat, lng);
CREATE INDEX IF NOT EXISTS road_hazards_created_idx ON road_hazards (created_at DESC);
CREATE INDEX IF NOT EXISTS road_hazards_expires_idx ON road_hazards (expires_at);

-- Enable Realtime publication for live sync
ALTER PUBLICATION supabase_realtime ADD TABLE road_hazards;


-- ================================================================
-- MIGRATION: 020_listening_sessions.sql
-- ================================================================
-- ─── Migration 020 — Listening Sessions & Meeting Recordings ─────────────────
-- Run after 019_road_hazards.sql

-- ─── ambient_sessions — "Roger, listen to this" sessions ─────────────────────
CREATE TABLE IF NOT EXISTS ambient_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  started_at   timestamptz DEFAULT now(),
  ended_at     timestamptz,
  duration_s   integer,
  content_type text CHECK (content_type IN ('speech','music','ambient','mixed','unknown')),
  language     text,          -- detected language code e.g. 'ar', 'en', 'fr'
  language_name text,         -- human-readable e.g. 'Arabic'
  transcript   text,          -- full rolling transcript (joined chunks)
  summary      text,          -- GPT-4o summary
  music_title  text,          -- if music detected via ACRCloud
  music_artist text,
  music_album  text,
  raw_chunks   jsonb DEFAULT '[]'  -- [{ts, type, text, language, confidence, music_hint}]
);

CREATE INDEX IF NOT EXISTS idx_ambient_sessions_user
  ON ambient_sessions (user_id, started_at DESC);

-- ─── meeting_recordings — structured meeting sessions ─────────────────────────
CREATE TABLE IF NOT EXISTS meeting_recordings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text NOT NULL,
  title        text,
  started_at   timestamptz DEFAULT now(),
  ended_at     timestamptz,
  duration_s   integer,
  transcript   text,                 -- full joined transcript
  summary      text,                 -- GPT-4o executive summary
  action_items jsonb DEFAULT '[]',   -- [{text, owner, due_date}]
  decisions    jsonb DEFAULT '[]',   -- [{text}]
  participants jsonb DEFAULT '[]',   -- [{name, role}]
  chunk_count  integer DEFAULT 0,
  status       text DEFAULT 'recording'
               CHECK (status IN ('recording','processing','done','failed'))
);

CREATE INDEX IF NOT EXISTS idx_meeting_recordings_user
  ON meeting_recordings (user_id, started_at DESC);

COMMENT ON TABLE ambient_sessions   IS 'Roger listen-to-this ambient analysis sessions';
COMMENT ON TABLE meeting_recordings IS 'Roger record-meeting structured meeting capture sessions';


-- ================================================================
-- MIGRATION: 021a_orientation_flag.sql
-- ================================================================
-- ─── Migration 021 — Orientation Flag ───────────────────────────────────────
-- Adds orientation tracking columns to user_preferences.
-- Run after 020_listening_sessions.sql

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS orientation_seen    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS orientation_version integer DEFAULT 0;

COMMENT ON COLUMN user_preferences.orientation_seen    IS 'True once user completes or skips Roger orientation';
COMMENT ON COLUMN user_preferences.orientation_version IS 'Version of orientation last completed, for future re-trigger';


-- ================================================================
-- MIGRATION: 021b_subscriptions.sql
-- ================================================================
-- ─── Roger AI — Migration 021: Subscriptions & Usage Tracking ──────────────────
-- Mockup-ready schema for freemium monetization.
-- Supports Free / Pro / Command tiers with usage enforcement and trial periods.

-- ─── user_subscriptions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id              text        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                 text        NOT NULL DEFAULT 'free'
                         CHECK (plan IN ('free', 'pro', 'command')),
  status               text        NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing')),
  trial_ends_at        timestamptz,
  current_period_end   timestamptz,
  -- Stripe fields (populated when real payment is wired)
  stripe_customer_id   text,
  stripe_sub_id        text,
  -- Admin notes / override reason
  admin_note           text,
  updated_by           text,           -- admin user_id who last changed this
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ─── user_usage ───────────────────────────────────────────────────────────────
-- Tracks rolling usage counters for Free-tier enforcement.
-- Reset logic: ptt_today resets when ptt_date < CURRENT_DATE, etc.
CREATE TABLE IF NOT EXISTS user_usage (
  user_id              text        PRIMARY KEY,
  ptt_today            integer     NOT NULL DEFAULT 0,
  ptt_date             date        NOT NULL DEFAULT CURRENT_DATE,
  tune_in_today        integer     NOT NULL DEFAULT 0,
  tune_in_date         date        NOT NULL DEFAULT CURRENT_DATE,
  meeting_mins_week    integer     NOT NULL DEFAULT 0,
  meeting_week_start   date        NOT NULL DEFAULT date_trunc('week', CURRENT_DATE)::date,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_usage         ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscription
CREATE POLICY "users_read_own_sub"
  ON user_subscriptions FOR SELECT
  USING (auth.uid()::text = user_id);

-- Users can read their own usage
CREATE POLICY "users_read_own_usage"
  ON user_usage FOR SELECT
  USING (auth.uid()::text = user_id);

-- Service role has full access (used by Edge Functions + admin)
CREATE POLICY "service_full_access_sub"
  ON user_subscriptions FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_full_access_usage"
  ON user_usage FOR ALL
  USING (auth.role() = 'service_role');

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_subs_plan   ON user_subscriptions (plan, status);
CREATE INDEX IF NOT EXISTS idx_user_subs_trial  ON user_subscriptions (trial_ends_at) WHERE trial_ends_at IS NOT NULL;

-- ─── Helper function: upsert usage with date-reset logic ─────────────────────
CREATE OR REPLACE FUNCTION increment_ptt_usage(p_user_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO user_usage (user_id, ptt_today, ptt_date)
  VALUES (p_user_id, 1, CURRENT_DATE)
  ON CONFLICT (user_id) DO UPDATE SET
    ptt_today = CASE
      WHEN user_usage.ptt_date < CURRENT_DATE THEN 1
      ELSE user_usage.ptt_today + 1
    END,
    ptt_date  = CURRENT_DATE,
    updated_at = now();
END;
$$;


-- ================================================================
-- MIGRATION: 022_islamic_mode.sql
-- ================================================================
-- ─── Roger AI — Islamic Mode Migration ──────────────────────────────────────
-- Adds islamic_mode flag + prayer preferences to user_preferences
-- Also creates an alert log table for proactive prayer notifications.

-- ── user_preferences additions ────────────────────────────────────────────────
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS islamic_mode         boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS prayer_city          text,        -- optional city name override for display
  ADD COLUMN IF NOT EXISTS prayer_method        integer DEFAULT 3, -- AlAdhan calculation method (3=MWL)
  ADD COLUMN IF NOT EXISTS prayer_notifications boolean DEFAULT true;

-- ── islamic_alerts_log — lightweight prayer alert audit log ───────────────────
CREATE TABLE IF NOT EXISTS islamic_alerts_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  prayer_name text NOT NULL,          -- 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha'
  fired_at    timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE islamic_alerts_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "islamic_alerts_log: user owns their rows"
  ON islamic_alerts_log
  FOR ALL
  USING (auth.uid()::text = user_id);

-- Admin select (service role bypasses RLS automatically)

-- ── Index for admin queries ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_islamic_alerts_log_user
  ON islamic_alerts_log (user_id, fired_at DESC);



