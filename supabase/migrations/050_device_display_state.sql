-- 050: Add display_state columns to device_tokens for LCD push
-- These columns allow the backend to push visual states to the ESP32 display

ALTER TABLE device_tokens
  ADD COLUMN IF NOT EXISTS display_state  text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS display_line1  text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS display_line2  text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS display_line3  text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS display_value  integer DEFAULT 0;

COMMENT ON COLUMN device_tokens.display_state IS 'LCD state to push: prayer, reminder, briefing, relay, idle, locked';
COMMENT ON COLUMN device_tokens.display_line1 IS 'Primary text line for LCD display';
COMMENT ON COLUMN device_tokens.display_line2 IS 'Secondary text line for LCD display';
COMMENT ON COLUMN device_tokens.display_line3 IS 'Tertiary text line for LCD display';
COMMENT ON COLUMN device_tokens.display_value IS 'Numeric value (countdown seconds, progress, etc.)';
