-- 037 — Task Automation Engine
-- Adds execution tier classification, dedup grouping, and auto-resolve tracking
-- to the tasks table for the Smart Tasks system.

-- ── Execution tier: how Roger should handle this task ──
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS execution_tier text
  DEFAULT 'manual' CHECK (execution_tier IN ('auto','confirm','setup_required','manual'));

-- ── Dedup group: tasks with the same group are semantic duplicates ──
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS dedup_group text DEFAULT NULL;

-- ── Resolved-by: tracks who/what completed the task ──
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS resolved_by text DEFAULT NULL
  CHECK (resolved_by IS NULL OR resolved_by IN ('user','roger_auto','roger_confirm'));

-- ── Resolved-at: timestamp for the 30-minute undo window ──
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS resolved_at timestamptz DEFAULT NULL;

-- ── Indexes for fast lookups ──

-- Quick lookup of open auto-tier tasks for background sweep
CREATE INDEX IF NOT EXISTS idx_tasks_execution_tier
  ON tasks(user_id, execution_tier) WHERE status = 'open';

-- Dedup group lookups during insertion
CREATE INDEX IF NOT EXISTS idx_tasks_dedup_group
  ON tasks(user_id, dedup_group) WHERE status = 'open';

-- Auto-resolved tasks within undo window
CREATE INDEX IF NOT EXISTS idx_tasks_resolved_at
  ON tasks(user_id, resolved_at) WHERE resolved_by = 'roger_auto';

COMMENT ON COLUMN tasks.execution_tier IS 'auto=silent resolve, confirm=needs approval, setup_required=blocked on integration, manual=human only';
COMMENT ON COLUMN tasks.dedup_group IS 'Semantic dedup key — tasks with same group are duplicates';
COMMENT ON COLUMN tasks.resolved_by IS 'Who resolved: user, roger_auto (silent), roger_confirm (approved)';
COMMENT ON COLUMN tasks.resolved_at IS 'When resolved — enables 30min undo window for auto-resolved tasks';
