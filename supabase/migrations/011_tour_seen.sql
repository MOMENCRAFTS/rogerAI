-- 011_tour_seen.sql
-- Tracks whether a user has completed the Mission Brief orientation tour.
-- tour_version allows re-showing the tour after major capability updates.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS tour_seen     BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tour_version  INTEGER  DEFAULT 0;
