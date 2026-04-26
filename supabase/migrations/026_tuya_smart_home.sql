-- 026_tuya_smart_home.sql
-- Adds tuya_uid column to user_preferences for Tuya/SmartLife IoT integration.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS tuya_uid TEXT DEFAULT NULL;

COMMENT ON COLUMN user_preferences.tuya_uid IS 'Tuya Cloud user UID from SmartLife app — used for device discovery and control via the tuya-control edge function';
