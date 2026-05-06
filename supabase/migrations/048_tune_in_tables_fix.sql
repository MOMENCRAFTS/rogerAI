-- ─── Migration 048: Ensure Tune In tables exist ──────────────────────────────
-- Safety net: creates tune_in tables if migration 008 was tracked but not applied.

-- ─── Tune In Requests ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tune_in_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id     uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  requester_callsign text,
  target_callsign  text NOT NULL,
  target_user_id   uuid REFERENCES auth.users ON DELETE SET NULL,
  reason           text,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'declined', 'ended', 'expired')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  responded_at     timestamptz,
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '2 minutes')
);

-- ─── Tune In Sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tune_in_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid NOT NULL REFERENCES tune_in_requests ON DELETE CASCADE,
  participant_a  uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  participant_b  uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'ended')),
  session_start  timestamptz NOT NULL DEFAULT now(),
  session_end    timestamptz,
  roger_notes    text,
  turn_count     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── Tune In Turns ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tune_in_turns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES tune_in_sessions ON DELETE CASCADE,
  speaker_id  uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  transcript  text NOT NULL,
  is_flagged  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Add columns from migration 047 (safe re-run) ────────────────────────────
ALTER TABLE tune_in_turns
  ADD COLUMN IF NOT EXISTS audio_url text;

ALTER TABLE tune_in_sessions
  ADD COLUMN IF NOT EXISTS debrief_a jsonb;
ALTER TABLE tune_in_sessions
  ADD COLUMN IF NOT EXISTS debrief_b jsonb;

-- ─── Indexes (IF NOT EXISTS) ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tune_in_requests_target
  ON tune_in_requests (target_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tune_in_requests_requester
  ON tune_in_requests (requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tune_in_sessions_participants
  ON tune_in_sessions (participant_a, participant_b, status);
CREATE INDEX IF NOT EXISTS idx_tune_in_turns_session
  ON tune_in_turns (session_id, created_at ASC);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE tune_in_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tune_in_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tune_in_turns     ENABLE ROW LEVEL SECURITY;

-- Policies (CREATE IF NOT EXISTS via DO block)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tunein_req_select') THEN
    CREATE POLICY "tunein_req_select" ON tune_in_requests
      FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = target_user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tunein_req_insert') THEN
    CREATE POLICY "tunein_req_insert" ON tune_in_requests
      FOR INSERT WITH CHECK (auth.uid() = requester_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tunein_req_update') THEN
    CREATE POLICY "tunein_req_update" ON tune_in_requests
      FOR UPDATE USING (auth.uid() = requester_id OR auth.uid() = target_user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tunein_sess_select') THEN
    CREATE POLICY "tunein_sess_select" ON tune_in_sessions
      FOR SELECT USING (auth.uid() = participant_a OR auth.uid() = participant_b);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tunein_sess_update') THEN
    CREATE POLICY "tunein_sess_update" ON tune_in_sessions
      FOR UPDATE USING (auth.uid() = participant_a OR auth.uid() = participant_b);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tunein_turns_select') THEN
    CREATE POLICY "tunein_turns_select" ON tune_in_turns
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM tune_in_sessions s
          WHERE s.id = session_id
            AND (s.participant_a = auth.uid() OR s.participant_b = auth.uid())
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tunein_turns_insert') THEN
    CREATE POLICY "tunein_turns_insert" ON tune_in_turns
      FOR INSERT WITH CHECK (auth.uid() = speaker_id);
  END IF;
END $$;
