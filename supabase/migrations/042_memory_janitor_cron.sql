-- ─── Migration 042: Memory Janitor Cron Job ──────────────────────────────────
-- Schedules the memory-janitor edge function to run nightly at 3 AM UTC.
--
-- The janitor runs three internal AI nodes per user:
--   Node A — Noise Judge       : removes gibberish / whisper hallucinations
--   Node B — Semantic Curator  : merges semantically equivalent facts
--   Node C — Conflict Resolver : resolves or flags contradictory facts
--
-- Plus rule-based pre-filter (free) and SQL confidence decay (free).
--
-- Running at 3 AM UTC = lowest traffic window across all user timezones.
-- Expected runtime: ~30-60s for up to 1,000 users.
-- Expected cost:    ~$0.20/day (gpt-5.4-mini, avg 20 facts/user)

SELECT cron.schedule(
  'roger-memory-janitor',
  '0 3 * * *',   -- 3:00 AM UTC, every day
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/memory-janitor',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
