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
