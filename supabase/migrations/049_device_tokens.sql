-- ─── Roger AI — Migration 049: Device Tokens for Secure Pairing ─────────────
-- Enables QR-based device pairing. Each device gets a unique token
-- that replaces the insecure manual user_id entry system.

CREATE TABLE IF NOT EXISTS device_tokens (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       TEXT        UNIQUE NOT NULL,       -- ESP32 MAC-based ID
  user_id         UUID        NOT NULL,              -- auth.users FK
  token           TEXT        UNIQUE NOT NULL,        -- secure random token
  pairing_code    TEXT,                               -- 6-char code shown on device QR
  device_name     TEXT        DEFAULT 'Roger Device',
  firmware_ver    TEXT,
  paired_at       TIMESTAMPTZ DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ,
  revoked         BOOLEAN     DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- No RLS — tokens are validated via edge functions, not direct client access
ALTER TABLE device_tokens DISABLE ROW LEVEL SECURITY;

-- Fast token lookup (only non-revoked)
CREATE INDEX IF NOT EXISTS idx_device_tokens_token
  ON device_tokens (token) WHERE NOT revoked;

-- User's paired devices
CREATE INDEX IF NOT EXISTS idx_device_tokens_user
  ON device_tokens (user_id) WHERE NOT revoked;

-- Unique active device per user (optional: allow multiple devices)
-- CREATE UNIQUE INDEX idx_device_tokens_active_device
--   ON device_tokens (device_id) WHERE NOT revoked;
