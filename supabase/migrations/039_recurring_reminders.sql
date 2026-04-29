-- ─── Migration 039: Recurring Reminders ──────────────────────────────────────
-- Adds recurrence metadata to the reminders table so reminders can repeat
-- on a daily, weekday, weekly, monthly, or custom schedule.
--
-- When a recurring reminder fires (marked 'done'), the check-reminders edge
-- function clones it with the next due_at computed from these columns.
--
-- Run in: Supabase Dashboard → SQL Editor
-- Safe to run multiple times (all use IF NOT EXISTS).

-- ── Add recurrence columns ──────────────────────────────────────────────────

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS recurrence_rule  text DEFAULT NULL
    CHECK (recurrence_rule IS NULL OR recurrence_rule IN ('daily','weekdays','weekly','monthly','custom')),
  ADD COLUMN IF NOT EXISTS recurrence_time  text DEFAULT NULL,         -- 'HH:MM' in user local time
  ADD COLUMN IF NOT EXISTS recurrence_days  integer[] DEFAULT NULL;    -- ISO weekdays for 'custom': 1=Mon … 7=Sun

-- ── Index for cron query (find recurring reminders that just completed) ──────

CREATE INDEX IF NOT EXISTS idx_reminders_recurring
  ON reminders (user_id, status, recurrence_rule)
  WHERE recurrence_rule IS NOT NULL;

-- ── Comment for documentation ────────────────────────────────────────────────

COMMENT ON COLUMN reminders.recurrence_rule IS 'NULL = one-shot. daily|weekdays|weekly|monthly|custom = recurring.';
COMMENT ON COLUMN reminders.recurrence_time IS 'Time of day to fire, HH:MM format. Used to compute next due_at.';
COMMENT ON COLUMN reminders.recurrence_days IS 'ISO weekday numbers for custom rule. 1=Mon … 7=Sun. e.g. {1,3,5} = Mon/Wed/Fri.';
