-- 046: Saved Spots — user-pinned locations (Home, Work, custom)
-- Enables one-tap location pinning from the Location tab.

CREATE TABLE IF NOT EXISTS saved_spots (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  spot_type   TEXT NOT NULL DEFAULT 'other',   -- 'home' | 'work' | 'other'
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  address     TEXT,
  icon        TEXT DEFAULT '📍',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, label)
);

ALTER TABLE saved_spots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own spots"
  ON saved_spots FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
