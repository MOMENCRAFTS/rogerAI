-- 053: Cron schedule for Roger's thinking engine
-- Runs roger-think every 20 minutes to check talkative-mode users.
-- Requires pg_cron extension (already enabled on Supabase Pro).

SELECT cron.schedule(
  'roger-think-cron',           -- job name
  '*/20 * * * *',               -- every 20 minutes
  $$
    SELECT net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/roger-think',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
