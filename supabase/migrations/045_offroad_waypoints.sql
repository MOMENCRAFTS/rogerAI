-- ═══════════════════════════════════════════════════════════════════════════════
-- 045: Offroad Waypoints
-- Stores GPS pins dropped during offroad driving sessions
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.offroad_waypoints (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT 'Waypoint',
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  accuracy_m  REAL,                           -- GPS accuracy in metres
  notes       TEXT,
  session_id  TEXT,                            -- groups waypoints by offroad session
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_offroad_waypoints_user
  ON public.offroad_waypoints(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_offroad_waypoints_session
  ON public.offroad_waypoints(session_id)
  WHERE session_id IS NOT NULL;

-- RLS
ALTER TABLE public.offroad_waypoints ENABLE ROW LEVEL SECURITY;

-- Users can manage their own waypoints
CREATE POLICY "Users manage own waypoints"
  ON public.offroad_waypoints
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role bypass
CREATE POLICY "Service role full access on waypoints"
  ON public.offroad_waypoints
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
