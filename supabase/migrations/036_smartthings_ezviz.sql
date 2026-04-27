-- 036 — SmartThings + EZVIZ integration columns
-- Adds credential storage for Samsung SmartThings (PAT) and EZVIZ (account UID)

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS smartthings_pat TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ezviz_uid       TEXT DEFAULT NULL;

COMMENT ON COLUMN user_preferences.smartthings_pat IS 'Samsung SmartThings Personal Access Token';
COMMENT ON COLUMN user_preferences.ezviz_uid       IS 'EZVIZ / Hikvision account UID for camera control';
