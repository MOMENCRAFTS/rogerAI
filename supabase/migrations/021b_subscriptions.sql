-- ─── Roger AI — Migration 021b: Subscriptions & Usage Tracking ──────────────
-- Mockup-ready schema for freemium monetization.
-- Supports Free / Pro / Command tiers with usage enforcement and trial periods.
-- NOTE: user_id is text (not uuid FK) to match all other tables in this project.

-- ─── user_subscriptions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id              text        PRIMARY KEY,
  plan                 text        NOT NULL DEFAULT 'free'
                         CHECK (plan IN ('free', 'pro', 'command')),
  status               text        NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing')),
  trial_ends_at        timestamptz,
  current_period_end   timestamptz,
  -- Stripe fields (populated when real payment is wired)
  stripe_customer_id   text,
  stripe_sub_id        text,
  -- Admin notes / override reason
  admin_note           text,
  updated_by           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ─── user_usage ───────────────────────────────────────────────────────────────
-- Tracks rolling usage counters for Free-tier enforcement.
-- Reset logic: ptt_today resets when ptt_date < CURRENT_DATE, etc.
CREATE TABLE IF NOT EXISTS user_usage (
  user_id              text        PRIMARY KEY,
  ptt_today            integer     NOT NULL DEFAULT 0,
  ptt_date             date        NOT NULL DEFAULT CURRENT_DATE,
  tune_in_today        integer     NOT NULL DEFAULT 0,
  tune_in_date         date        NOT NULL DEFAULT CURRENT_DATE,
  meeting_mins_week    integer     NOT NULL DEFAULT 0,
  meeting_week_start   date        NOT NULL DEFAULT date_trunc('week', CURRENT_DATE)::date,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_usage         ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_subscriptions' AND policyname='users_read_own_sub') THEN
    CREATE POLICY "users_read_own_sub"
      ON user_subscriptions FOR SELECT USING (auth.uid()::text = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_usage' AND policyname='users_read_own_usage') THEN
    CREATE POLICY "users_read_own_usage"
      ON user_usage FOR SELECT USING (auth.uid()::text = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_subscriptions' AND policyname='service_full_access_sub') THEN
    CREATE POLICY "service_full_access_sub"
      ON user_subscriptions FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_usage' AND policyname='service_full_access_usage') THEN
    CREATE POLICY "service_full_access_usage"
      ON user_usage FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_subs_plan   ON user_subscriptions (plan, status);
CREATE INDEX IF NOT EXISTS idx_user_subs_trial  ON user_subscriptions (trial_ends_at)
  WHERE trial_ends_at IS NOT NULL;

-- ─── Helper function: increment PTT usage with date-reset logic ───────────────
CREATE OR REPLACE FUNCTION increment_ptt_usage(p_user_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO user_usage (user_id, ptt_today, ptt_date)
  VALUES (p_user_id, 1, CURRENT_DATE)
  ON CONFLICT (user_id) DO UPDATE SET
    ptt_today  = CASE
      WHEN user_usage.ptt_date < CURRENT_DATE THEN 1
      ELSE user_usage.ptt_today + 1
    END,
    ptt_date   = CURRENT_DATE,
    updated_at = now();
END;
$$;
