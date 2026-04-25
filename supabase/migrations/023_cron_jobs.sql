-- ─── Migration 023: Scheduled Cron Jobs ─────────────────────────────────────
-- Sets up pg_cron schedules to invoke Edge Functions for proactive features.
--
-- Functions scheduled:
--   1. morning-briefing  — 6:00 AM UTC daily  → generates morning summary for all active users
--   2. weekly-digest     — 8:00 AM UTC Monday → generates weekly performance digest
--   3. check-reminders   — Every 5 minutes    → checks for upcoming/overdue reminders and surfaces them
--
-- IMPORTANT: pg_cron calls Edge Functions via pg_net (HTTP).
-- The service role key is used so RLS is bypassed for the batch operation.
-- Each function handles its own per-user logic internally.
--
-- To verify jobs after applying:
--   SELECT jobid, jobname, schedule, active FROM cron.job;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── 1. Morning Briefing — 6:00 AM UTC daily ──────────────────────────────────
SELECT cron.schedule(
  'roger-morning-briefing',        -- job name (unique)
  '0 6 * * *',                     -- cron expression: 6am every day
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/morning-briefing',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── 2. Weekly Digest — 8:00 AM UTC every Monday ──────────────────────────────
SELECT cron.schedule(
  'roger-weekly-digest',
  '0 8 * * 1',                     -- 8am every Monday
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/weekly-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── 3. Reminder Check — every 5 minutes ──────────────────────────────────────
SELECT cron.schedule(
  'roger-check-reminders',
  '*/5 * * * *',                   -- every 5 minutes
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/check-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Set app-level config for cron to read ────────────────────────────────────
-- These are set at the database level so pg_cron jobs can read them.
-- Replace the placeholders with your actual values if running manually,
-- or apply via Supabase dashboard → Settings → Database → Config.
-- In Supabase hosted projects, SUPABASE_URL and SERVICE_ROLE_KEY are
-- available as vault secrets — the Edge Functions read them from env.
-- The cron jobs themselves just need to know the project URL.
ALTER DATABASE postgres SET app.supabase_url = 'https://krbfhiupcquddguorowe.supabase.co';
