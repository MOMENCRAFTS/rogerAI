-- ─── Roger AI — Migration 018: Admin Audit Log ────────────────────────────────
-- Every admin action (intent status change, flag toggle, user flush, etc.)
-- is written here. Powers the Audit Log admin panel (currently a placeholder).

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      text        NOT NULL,         -- auth.users id of the acting admin
  admin_email   text,
  module        text        NOT NULL,          -- 'intent_registry', 'feature_flags', etc.
  action        text        NOT NULL,          -- 'STATUS_CHANGE', 'FLAG_TOGGLE', 'MEMORY_FLUSH', etc.
  target_id     text,                          -- ID of the affected entity (intent name, flag key, user id…)
  target_label  text,                          -- human-readable label of target
  before_state  jsonb,
  after_state   jsonb,
  reason        text,
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_audit_log DISABLE ROW LEVEL SECURITY;

-- Indexes for filtered views
CREATE INDEX IF NOT EXISTS idx_audit_time   ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_admin  ON admin_audit_log (admin_id,  created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_module ON admin_audit_log (module,    created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON admin_audit_log (action,    created_at DESC);

-- Seed: back-fill existing intent registry status changes from intent_audit_log
-- (Maps existing intent audit trail into the global audit log format)
INSERT INTO admin_audit_log (admin_id, admin_email, module, action, target_id, target_label, before_state, after_state, reason, created_at)
SELECT
  COALESCE(changed_by, 'system'),
  null,
  'intent_registry',
  'STATUS_CHANGE',
  intent_name,
  intent_name,
  CASE WHEN old_status IS NOT NULL THEN jsonb_build_object('status', old_status) ELSE NULL END,
  jsonb_build_object('status', new_status),
  reason,
  changed_at
FROM intent_audit_log
ON CONFLICT DO NOTHING;
