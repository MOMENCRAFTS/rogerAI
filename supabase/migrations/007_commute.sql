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
