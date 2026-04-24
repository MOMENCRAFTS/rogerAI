-- ─── Roger AI — Migration 016: Admin Views ────────────────────────────────────
-- Safe read-only view of auth.users for admin user-picker dropdowns.
-- Used by MemoryMonitor and PatternLab so admins can inspect any user's data.

-- ─── admin_user_list view ─────────────────────────────────────────────────────
-- Joins auth.users with user_preferences for display_name, mode, etc.
-- Never exposes password hashes, raw tokens, or sensitive auth fields.
CREATE OR REPLACE VIEW admin_user_list AS
SELECT
  u.id                                       AS user_id,
  u.email,
  COALESCE(up.display_name, split_part(u.email, '@', 1))
                                             AS display_name,
  up.onboarding_complete,
  up.onboarding_step,
  up.roger_mode,
  up.language,
  u.created_at                               AS joined_at,
  u.last_sign_in_at
FROM auth.users u
LEFT JOIN user_preferences up ON up.user_id = u.id::text
ORDER BY u.last_sign_in_at DESC NULLS LAST;

-- ─── user_memory_summary view ─────────────────────────────────────────────────
-- Per-user memory health counts for MemoryMonitor admin overview.
CREATE OR REPLACE VIEW user_memory_summary AS
SELECT
  u.id                                            AS user_id,
  COALESCE(up.display_name, u.email)              AS display_name,
  (SELECT COUNT(*) FROM conversation_history ch WHERE ch.user_id = u.id::text)   AS conversation_turns,
  (SELECT COUNT(*) FROM entity_mentions em     WHERE em.user_id  = u.id::text)   AS entity_count,
  (SELECT COUNT(*) FROM memory_graph mg        WHERE mg.user_id  = u.id::text)   AS fact_count,
  (SELECT COUNT(*) FROM memory_insights mi     WHERE mi.user_id  = u.id::text)   AS insight_count,
  (SELECT COUNT(*) FROM memories m             WHERE m.user_id   = u.id::text)   AS memory_count,
  (SELECT MAX(created_at) FROM conversation_history WHERE user_id = u.id::text)  AS last_active
FROM auth.users u
LEFT JOIN user_preferences up ON up.user_id = u.id::text
ORDER BY last_active DESC NULLS LAST;
