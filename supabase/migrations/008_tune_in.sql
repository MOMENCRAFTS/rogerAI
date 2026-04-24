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
