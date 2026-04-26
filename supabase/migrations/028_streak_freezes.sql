-- 028_streak_freezes.sql — Streak freeze & milestone support for Academy gamification
-- Adds freeze inventory + milestone tracking to academy_streaks.

ALTER TABLE academy_streaks
  ADD COLUMN IF NOT EXISTS streak_freezes INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS freezes_used   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_milestone INT NOT NULL DEFAULT 0;

-- streak_freezes: number of freeze tokens the user has (earn 1 per 7-day streak)
-- freezes_used:   lifetime count of freezes consumed
-- last_milestone: highest streak milestone celebrated (7, 14, 30, 60, 100, 365)
