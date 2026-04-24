-- ─── Roger AI — Auth RLS Policies ─────────────────────────────────────────────
-- Migration 009: Row Level Security using auth.uid() for all user-owned tables.
-- Both sides cast to text to handle uuid vs text column type differences.
-- Run this in the Supabase SQL Editor after enabling Google OAuth.

-- ─── reminders ────────────────────────────────────────────────────────────────
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reminders_self" ON reminders;
CREATE POLICY "reminders_self" ON reminders
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── tasks ────────────────────────────────────────────────────────────────────
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tasks_self" ON tasks;
CREATE POLICY "tasks_self" ON tasks
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── memories ─────────────────────────────────────────────────────────────────
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memories_self" ON memories;
CREATE POLICY "memories_self" ON memories
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── surface_queue ────────────────────────────────────────────────────────────
ALTER TABLE surface_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "surface_queue_self" ON surface_queue;
CREATE POLICY "surface_queue_self" ON surface_queue
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── user_preferences ─────────────────────────────────────────────────────────
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_preferences_self" ON user_preferences;
CREATE POLICY "user_preferences_self" ON user_preferences
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── conversation_history ─────────────────────────────────────────────────────
ALTER TABLE conversation_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conversation_history_self" ON conversation_history;
CREATE POLICY "conversation_history_self" ON conversation_history
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── entity_mentions ──────────────────────────────────────────────────────────
ALTER TABLE entity_mentions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entity_mentions_self" ON entity_mentions;
CREATE POLICY "entity_mentions_self" ON entity_mentions
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── memory_graph ─────────────────────────────────────────────────────────────
ALTER TABLE memory_graph ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memory_graph_self" ON memory_graph;
CREATE POLICY "memory_graph_self" ON memory_graph
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── memory_insights ──────────────────────────────────────────────────────────
ALTER TABLE memory_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memory_insights_self" ON memory_insights;
CREATE POLICY "memory_insights_self" ON memory_insights
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── push_subscriptions ───────────────────────────────────────────────────────
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_subscriptions_self" ON push_subscriptions;
CREATE POLICY "push_subscriptions_self" ON push_subscriptions
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── user_location ────────────────────────────────────────────────────────────
ALTER TABLE user_location ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_location_self" ON user_location;
CREATE POLICY "user_location_self" ON user_location
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── roger_contacts ───────────────────────────────────────────────────────────
ALTER TABLE roger_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roger_contacts_self" ON roger_contacts;
CREATE POLICY "roger_contacts_self" ON roger_contacts
  FOR ALL
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- ─── relay_messages ───────────────────────────────────────────────────────────
ALTER TABLE relay_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "relay_messages_self" ON relay_messages;
CREATE POLICY "relay_messages_self" ON relay_messages
  FOR ALL
  USING (
    sender_id::text = auth.uid()::text
    OR recipient_id::text = auth.uid()::text
  )
  WITH CHECK (sender_id::text = auth.uid()::text);
