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
