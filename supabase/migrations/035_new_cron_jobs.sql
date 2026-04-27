-- ─── Migration 035: New Cron Jobs — Pattern Detector & Email Digest ──────────
-- Adds scheduled cron jobs for the new AI brain nodes.

-- ── 1. Pattern Detector — Monday 9AM UTC (after weekly-digest at 8AM) ────────
SELECT cron.schedule(
  'roger-detect-patterns',
  '0 9 * * 1',                     -- 9am every Monday
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/detect-patterns',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── 2. Email Digest — Every 30 minutes ───────────────────────────────────────
SELECT cron.schedule(
  'roger-email-digest',
  '*/30 * * * *',                  -- every 30 minutes
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/email-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
