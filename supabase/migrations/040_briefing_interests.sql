-- 040: Add briefing_interests to user_preferences
-- Stores user-specific topics for the morning briefing (searched via web).
-- Example: {"Gold price in SAR per gram","Bitcoin, Ethereum, Solana prices","Riyadh weather"}

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS briefing_interests text[] DEFAULT '{}';

COMMENT ON COLUMN user_preferences.briefing_interests IS
  'User-defined topics for morning briefing. GPT searches the web for each at briefing time.';
