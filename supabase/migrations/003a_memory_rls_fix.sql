-- ─── Roger AI — Memory Tables RLS Fix ────────────────────────────────────────
-- Run this in Supabase SQL Editor AFTER 003_memory_system.sql
-- Disables RLS on the new memory tables so the anon key can access them.
-- This matches the pattern of existing tables (reminders, tasks, memories, etc.)

-- ─── Disable RLS on new tables ───────────────────────────────────────────────
ALTER TABLE conversation_history  DISABLE ROW LEVEL SECURITY;
ALTER TABLE entity_mentions       DISABLE ROW LEVEL SECURITY;
ALTER TABLE memory_graph          DISABLE ROW LEVEL SECURITY;
ALTER TABLE memory_insights       DISABLE ROW LEVEL SECURITY;

-- ─── Also ensure existing tables are accessible ───────────────────────────────
-- (Run these if you're still getting 401s on reminders, tasks, memories etc.)
ALTER TABLE reminders             DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE memories              DISABLE ROW LEVEL SECURITY;
ALTER TABLE surface_queue         DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences      DISABLE ROW LEVEL SECURITY;
ALTER TABLE intent_registry       DISABLE ROW LEVEL SECURITY;
ALTER TABLE intent_audit_log      DISABLE ROW LEVEL SECURITY;
ALTER TABLE intent_block_log      DISABLE ROW LEVEL SECURITY;
