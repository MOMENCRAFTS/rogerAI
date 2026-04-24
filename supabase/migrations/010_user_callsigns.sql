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
