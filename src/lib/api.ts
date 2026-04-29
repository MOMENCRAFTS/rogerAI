import { supabase } from './supabase';
import { getAuthToken } from './getAuthToken';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

// ─── Transmission types ───────────────────────────────────────────────────────
export type DbTransmission = {
  id: string; user_id: string; device_id: string | null;
  transcript: string; intent: string;
  confidence: number; ambiguity: number;
  status: 'SUCCESS' | 'CLARIFICATION' | 'ERROR';
  latency_ms: number; region: string; is_simulated: boolean;
  created_at: string;
};

export type DbDevice = {
  id: string; user_id: string; region: string; firmware: string;
  battery: number; signal: number; sync_health: number;
  queue_depth: number; status: 'online' | 'offline' | 'sync_issue';
  last_sync_at: string; created_at: string;
};

export type DbPlatformStat = {
  id: string; stat_date: string; active_users: number;
  connected_devices: number; tx_today: number; success_rate: number;
  clarification_rate: number; avg_latency_ms: number; created_at: string;
};

// ─── Reminder ────────────────────────────────────────────────────────────────
export type DbReminder = {
  id: string; user_id: string; text: string;
  entities: { text: string; type: string; confidence: number }[] | null;
  due_at: string | null;
  status: 'pending' | 'done' | 'dismissed';
  source_tx_id: string | null;
  is_admin_test: boolean;
  created_at: string; updated_at: string;
  // Geo-trigger fields (added in migration 005)
  due_location:     string  | null;
  due_location_lat: number  | null;
  due_location_lng: number  | null;
  due_radius_m:     number;
  geo_triggered:    boolean;
  // Recurrence fields (added in migration 039)
  recurrence_rule:  'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom' | null;
  recurrence_time:  string | null;   // 'HH:MM'
  recurrence_days:  number[] | null; // ISO weekdays for 'custom': 1=Mon … 7=Sun
};

// ─── Task ─────────────────────────────────────────────────────────────────────
export type TaskExecutionTier = 'auto' | 'confirm' | 'setup_required' | 'manual';

export type DbTask = {
  id: string; user_id: string; text: string;
  priority: number; status: 'open' | 'done' | 'cancelled';
  due_at: string | null; source_tx_id: string | null;
  is_admin_test: boolean; created_at: string; updated_at: string;
  // ── Task Automation Engine fields ──
  execution_tier: TaskExecutionTier;
  dedup_group: string | null;
  resolved_by: 'user' | 'roger_auto' | 'roger_confirm' | null;
  resolved_at: string | null;
};

// ─── Memory ───────────────────────────────────────────────────────────────────
export type DbMemory = {
  id: string; user_id: string;
  type: 'note' | 'book' | 'observation' | 'capture';
  text: string;
  entities: { text: string; type: string; confidence: number }[] | null;
  tags: string[] | null; source_tx_id: string | null;
  is_admin_test: boolean; created_at: string;
  // Place-tagging fields (added in migration 005)
  location_label: string | null;
  location_lat:   number | null;
  location_lng:   number | null;
};

// ─── Surface Queue ────────────────────────────────────────────────────────────
export type DbSurfaceItem = {
  id: string; user_id: string; type: string; content: string;
  priority: number; surface_at: string; snooze_count: number;
  dismissed: boolean; context: string | null; source_tx_id: string | null;
  created_at: string;
};

// ─── User Preferences ─────────────────────────────────────────────────────────
export type DbUserPreferences = {
  user_id: string;
  roger_mode: 'quiet' | 'active' | 'briefing';
  language: string; briefing_time: string; briefing_time2: string;
  timezone: string;
  haptic_enabled: boolean;
  sfx_enabled:    boolean;
  updated_at: string;
  // ── Integration fields ────────────────────────
  finnhub_tickers:    string[]      | null;
  twilio_phone:       string        | null;
  notion_token:       string        | null;
  notion_db_id:       string        | null;
  spotify_connected:  boolean;
  gcal_connected:     boolean;
  gcal_access_token:  string        | null;
  gcal_refresh_token: string        | null;
  gcal_token_expiry:  string        | null;
  // ── Tuya Smart Home ─────────────────────────
  tuya_uid:           string        | null;
  // ── SmartThings + EZVIZ ─────────────────────
  smartthings_pat:    string        | null;
  ezviz_uid:          string        | null;
  // ── Tour ────────────────────────────────────
  tour_seen:          boolean;
  tour_version:       number        | null;
  // ── Talkative Mode ────────────────────────
  talkative_enabled:    boolean;
  talkative_frequency:  'thoughtful' | 'active_talk' | 'always_on';
  talkative_delivery:   'auto_speak' | 'ptt_pulse';
  // ── Briefing Interests ───────────────────
  briefing_interests:   string[]      | null;
};

// ─── Intent Registry ──────────────────────────────────────────────────────────
export type DbIntent = {
  id: string; name: string;
  status: 'pending_review' | 'active' | 'disabled' | 'blocked';
  execution_tier: 'soft' | 'hard' | 'pending_integration';
  ambient_mode: boolean; requires_consent: boolean;
  max_duration_seconds: number | null; handler_function: string | null;
  suggested_group: string | null; description: string | null;
  use_count: number; last_used_at: string; created_at: string;
};

export type DbIntentAuditLog = {
  id: string; intent_name: string; old_status: string | null;
  new_status: string; changed_by: string | null;
  reason: string | null; changed_at: string;
};

// ─── Transmissions ────────────────────────────────────────────────────────────
export async function fetchTransmissions(limit = 50): Promise<DbTransmission[]> {
  const { data, error } = await supabase.from('transmissions').select('*')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function insertTransmission(tx: Omit<DbTransmission, 'created_at'>): Promise<DbTransmission> {
  const { data, error } = await supabase.from('transmissions').insert(tx).select().single();
  if (error) throw error;
  return data;
}

// ─── Devices ─────────────────────────────────────────────────────────────────
export async function fetchDevices(): Promise<DbDevice[]> {
  const { data, error } = await supabase.from('devices').select('*')
    .order('last_sync_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ─── Platform Stats ───────────────────────────────────────────────────────────
export async function fetchLatestPlatformStat(): Promise<DbPlatformStat | null> {
  const { data, error } = await supabase.from('platform_stats').select('*')
    .order('stat_date', { ascending: false }).limit(1).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export async function fetchPlatformStatHistory(days = 7): Promise<DbPlatformStat[]> {
  const { data, error } = await supabase.from('platform_stats').select('*')
    .order('stat_date', { ascending: true }).limit(days);
  if (error) throw error;
  return data ?? [];
}

// ─── Reminders ───────────────────────────────────────────────────────────────
export async function fetchReminders(userId: string, status?: DbReminder['status']): Promise<DbReminder[]> {
  let q = supabase.from('reminders').select('*').eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function insertReminder(reminder: Omit<DbReminder, 'id' | 'created_at' | 'updated_at'>): Promise<DbReminder> {
  const { data, error } = await supabase.from('reminders').insert(reminder).select().single();
  if (error) throw error;
  return data;
}

export async function updateReminderStatus(id: string, status: DbReminder['status']): Promise<void> {
  const { error } = await supabase.from('reminders').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function updateReminderRecurrence(
  id: string,
  recurrence_rule: DbReminder['recurrence_rule'],
  recurrence_time: string | null = null,
  recurrence_days: number[] | null = null,
): Promise<void> {
  const { error } = await supabase.from('reminders').update({
    recurrence_rule, recurrence_time, recurrence_days,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
export async function fetchTasks(userId: string, status?: DbTask['status']): Promise<DbTask[]> {
  let q = supabase.from('tasks').select('*').eq('user_id', userId)
    .order('priority', { ascending: false }).order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function insertTask(task: Omit<DbTask, 'id' | 'created_at' | 'updated_at'>): Promise<DbTask> {
  const { data, error } = await supabase.from('tasks').insert(task).select().single();
  if (error) throw error;
  return data;
}

export async function updateTaskStatus(id: string, status: DbTask['status'], resolvedBy?: DbTask['resolved_by']): Promise<void> {
  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (resolvedBy) {
    update.resolved_by = resolvedBy;
    update.resolved_at = new Date().toISOString();
  }
  const { error } = await supabase.from('tasks').update(update).eq('id', id);
  if (error) throw error;
}

// ─── Task Automation Engine ───────────────────────────────────────────────────

/** Jaccard word-set similarity (0-1). Cheap, no API call needed. */
function textSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF\s]/g, '').split(/\s+/).filter(w => w.length > 1));
  const setA = normalize(a);
  const setB = normalize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = new Set([...setA].filter(w => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

/** Find semantically similar open tasks for dedup check */
export async function findSimilarTasks(userId: string, text: string, threshold = 0.55): Promise<DbTask[]> {
  const { data } = await supabase.from('tasks').select('*')
    .eq('user_id', userId).eq('status', 'open');
  return (data ?? []).filter(t => textSimilarity(t.text, text) > threshold);
}

/** Insert task with dedup gate — merges if similar task exists */
export async function insertTaskWithDedup(
  task: Omit<DbTask, 'id' | 'created_at' | 'updated_at' | 'dedup_group' | 'resolved_by' | 'resolved_at'>,
): Promise<{ task: DbTask; merged: boolean }> {
  const similar = await findSimilarTasks(task.user_id, task.text);
  if (similar.length > 0) {
    const existing = similar[0];
    const newPriority = Math.max(existing.priority, task.priority);
    if (newPriority > existing.priority) {
      await supabase.from('tasks').update({ priority: newPriority, updated_at: new Date().toISOString() }).eq('id', existing.id);
    }
    return { task: { ...existing, priority: newPriority }, merged: true };
  }
  const created = await insertTask({ ...task, execution_tier: task.execution_tier ?? 'manual' } as Omit<DbTask, 'id' | 'created_at' | 'updated_at'>);
  return { task: created, merged: false };
}

/** Batch auto-resolve tasks that Roger can handle silently */
export async function autoResolveTasks(userId: string): Promise<DbTask[]> {
  const now = new Date().toISOString();
  const { data } = await supabase.from('tasks')
    .update({ status: 'done', resolved_by: 'roger_auto', resolved_at: now, updated_at: now })
    .eq('user_id', userId)
    .eq('status', 'open')
    .eq('execution_tier', 'auto')
    .select();
  return data ?? [];
}

/** Fetch recently auto-resolved tasks (for the banner) */
export async function fetchAutoResolved(userId: string): Promise<DbTask[]> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await supabase.from('tasks').select('*')
    .eq('user_id', userId)
    .eq('resolved_by', 'roger_auto')
    .gte('resolved_at', cutoff)
    .order('resolved_at', { ascending: false });
  return data ?? [];
}

/** Undo auto-resolved tasks (within 30-minute window) */
export async function undoAutoResolve(userId: string): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await supabase.from('tasks')
    .update({ status: 'open', resolved_by: null, resolved_at: null, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('resolved_by', 'roger_auto')
    .gte('resolved_at', cutoff)
    .select();
  return data?.length ?? 0;
}

// ─── Memories ─────────────────────────────────────────────────────────────────
export async function fetchMemories(userId: string, type?: DbMemory['type']): Promise<DbMemory[]> {
  let q = supabase.from('memories').select('*').eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function insertMemory(memory: Omit<DbMemory, 'id' | 'created_at'>): Promise<DbMemory> {
  const { data, error } = await supabase.from('memories').insert(memory).select().single();
  if (error) throw error;
  return data;
}

// ─── Surface Queue ────────────────────────────────────────────────────────────
export async function fetchSurfaceQueue(userId: string): Promise<DbSurfaceItem[]> {
  const { data, error } = await supabase.from('surface_queue').select('*')
    .eq('user_id', userId).eq('dismissed', false)
    .lte('surface_at', new Date().toISOString())
    .lt('snooze_count', 5)
    .order('priority', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function updateSurfaceItem(id: string, patch: Partial<Pick<DbSurfaceItem, 'snooze_count' | 'dismissed' | 'surface_at' | 'priority'>>): Promise<void> {
  const { error } = await supabase.from('surface_queue').update(patch).eq('id', id);
  if (error) throw error;
}

export async function insertSurfaceItem(item: Omit<DbSurfaceItem, 'id' | 'created_at'>): Promise<DbSurfaceItem> {
  const { data, error } = await supabase.from('surface_queue').insert(item).select().single();
  if (error) throw error;
  return data;
}

// ─── User Preferences ─────────────────────────────────────────────────────────
export async function fetchUserPreferences(userId: string): Promise<DbUserPreferences | null> {
  const { data, error } = await supabase.from('user_preferences').select('*').eq('user_id', userId).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export async function upsertUserPreferences(userId: string, prefs: Partial<Omit<DbUserPreferences, 'user_id' | 'updated_at'>>): Promise<void> {
  const { error } = await supabase.from('user_preferences')
    .upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ─── Intent Registry ──────────────────────────────────────────────────────────
export async function fetchIntentRegistry(statusFilter?: DbIntent['status']): Promise<DbIntent[]> {
  let q = supabase.from('intent_registry').select('*').order('use_count', { ascending: false });
  if (statusFilter) q = q.eq('status', statusFilter);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function upsertIntent(name: string, data: Partial<Omit<DbIntent, 'id' | 'name' | 'created_at'>>): Promise<void> {
  const { error } = await supabase.from('intent_registry').upsert(
    { name, ...data, last_used_at: new Date().toISOString() },
    { onConflict: 'name' }
  );
  if (error) throw error;
}

export async function updateIntentStatus(
  name: string, status: DbIntent['status'],
  reason?: string, changedBy?: string
): Promise<void> {
  // Get current status for audit
  const { data: current } = await supabase.from('intent_registry')
    .select('status').eq('name', name).single();
  const oldStatus = current?.status;

  // Update intent
  const { error } = await supabase.from('intent_registry').update({ status }).eq('name', name);
  if (error) throw error;

  // Write audit log
  await supabase.from('intent_audit_log').insert({
    intent_name: name, old_status: oldStatus, new_status: status,
    changed_by: changedBy ?? 'admin', reason: reason ?? null,
  });
}

export async function fetchIntentAuditLog(intentName: string): Promise<DbIntentAuditLog[]> {
  const { data, error } = await supabase.from('intent_audit_log').select('*')
    .eq('intent_name', intentName).order('changed_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ─── Realtime subscriptions ───────────────────────────────────────────────────
export function subscribeToTransmissions(onInsert: (tx: DbTransmission) => void) {
  return supabase.channel('transmissions-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transmissions' },
      (payload) => onInsert(payload.new as DbTransmission))
    .subscribe();
}

export function subscribeToDevices(onUpdate: (device: DbDevice) => void) {
  return supabase.channel('devices-live')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices' },
      (payload) => onUpdate(payload.new as DbDevice))
    .subscribe();
}

export function subscribeToReminders(userId: string, onInsert: (r: DbReminder) => void) {
  return supabase.channel('reminders-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reminders',
      filter: `user_id=eq.${userId}` },
      (payload) => onInsert(payload.new as DbReminder))
    .subscribe();
}

export function subscribeToIntentRegistry(onChange: () => void) {
  return supabase.channel('intent-registry-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'intent_registry' }, onChange)
    .subscribe();
}

// ─────────────────────────────────────────────────────────────────────────────
// MEMORY SYSTEM — Phase 1 additions
// ─────────────────────────────────────────────────────────────────────────────

// ─── Types ───────────────────────────────────────────────────────────────────

export type DbConversationTurn = {
  id: string; user_id: string; session_id: string;
  role: 'user' | 'assistant'; content: string;
  intent: string | null; is_admin_test: boolean; created_at: string;
};

export type DbEntityMention = {
  id: string; user_id: string; entity_text: string; entity_type: string;
  mention_count: number; last_mentioned_at: string; first_mentioned_at: string;
  has_task: boolean; has_reminder: boolean; surfaced: boolean;
};

export type DbMemoryFact = {
  id: string; user_id: string;
  fact_type: 'person' | 'company' | 'project' | 'preference' | 'relationship' | 'goal' | 'habit' | 'location' | 'language_vocab';
  subject: string; predicate: string; object: string;
  confidence: number; source_tx: string | null;
  is_confirmed: boolean;
  is_draft: boolean;       // true = borderline (confidence 50–74), needs second signal
  created_at: string; updated_at: string;
};

export type DbMemoryInsight = {
  id: string; user_id: string; insight: string;
  source_turn: string | null; acted_on: boolean; created_at: string;
};

// ─── Conversation History ─────────────────────────────────────────────────────

export async function fetchConversationHistory(
  userId: string, limit = 20
): Promise<DbConversationTurn[]> {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).reverse(); // oldest first for injection
}

export async function fetchConversationSessions(userId: string) {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('session_id, created_at, role, content, intent')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function searchConversationHistory(userId: string, query: string) {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('*')
    .eq('user_id', userId)
    .ilike('content', `%${query}%`)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

export async function insertConversationTurn(
  turn: Pick<DbConversationTurn, 'user_id' | 'session_id' | 'role' | 'content' | 'intent' | 'is_admin_test'>
): Promise<void> {
  await supabase.from('conversation_history').insert(turn);
}

// ─── Admin Conversation Monitor ──────────────────────────────────────────────

/** Fetch ALL conversation turns across all users (admin only) */
export async function fetchAllConversations(limit = 500): Promise<DbConversationTurn[]> {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Search all conversations across all users by content (admin only) */
export async function searchAllConversations(query: string, limit = 100): Promise<DbConversationTurn[]> {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('*')
    .ilike('content', `%${query}%`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Fetch distinct session IDs with their turn counts (admin overview) */
export async function fetchConversationSessionList(): Promise<{
  session_id: string;
  user_id: string;
  turn_count: number;
  first_at: string;
  last_at: string;
  preview: string;
}[]> {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('session_id, user_id, content, created_at')
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) throw error;

  // Group by session
  const sessions = new Map<string, {
    session_id: string;
    user_id: string;
    turns: { content: string; created_at: string }[];
  }>();
  for (const row of data ?? []) {
    const sid = row.session_id;
    if (!sessions.has(sid)) {
      sessions.set(sid, { session_id: sid, user_id: row.user_id, turns: [] });
    }
    sessions.get(sid)!.turns.push({ content: row.content, created_at: row.created_at });
  }

  return Array.from(sessions.values()).map(s => {
    const sorted = s.turns.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const userTurn = sorted[0]; // first turn
    return {
      session_id: s.session_id,
      user_id: s.user_id,
      turn_count: s.turns.length,
      first_at: sorted[0]?.created_at ?? '',
      last_at: sorted[sorted.length - 1]?.created_at ?? '',
      preview: userTurn?.content?.slice(0, 120) ?? '',
    };
  }).sort((a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime());
}

/** Fetch all turns for a specific session (admin view, not user-scoped) */
export async function fetchAdminSessionTurns(sessionId: string): Promise<DbConversationTurn[]> {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ─── Entity Mentions ──────────────────────────────────────────────────────────

export async function upsertEntityMention(
  userId: string, entityText: string, entityType: string
): Promise<void> {
  // Use upsert with count increment
  const { data: existing } = await supabase
    .from('entity_mentions')
    .select('id, mention_count')
    .eq('user_id', userId)
    .eq('entity_text', entityText)
    .maybeSingle();

  if (existing) {
    await supabase.from('entity_mentions')
      .update({ mention_count: existing.mention_count + 1, last_mentioned_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await supabase.from('entity_mentions').insert({
      user_id: userId, entity_text: entityText, entity_type: entityType,
      mention_count: 1, first_mentioned_at: new Date().toISOString(),
    });
  }
}

export async function fetchFrequentEntities(
  userId: string, minCount = 3
): Promise<DbEntityMention[]> {
  const { data, error } = await supabase
    .from('entity_mentions')
    .select('*')
    .eq('user_id', userId)
    .gte('mention_count', minCount)
    .eq('surfaced', false)
    .order('mention_count', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchAllEntityMentions(userId: string): Promise<DbEntityMention[]> {
  const { data, error } = await supabase
    .from('entity_mentions')
    .select('*')
    .eq('user_id', userId)
    .order('mention_count', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function markEntitySurfaced(entityId: string): Promise<void> {
  await supabase.from('entity_mentions').update({ surfaced: true }).eq('id', entityId);
}

// ─── Memory Graph ─────────────────────────────────────────────────────────────

export async function fetchMemoryGraph(
  userId: string, factType?: DbMemoryFact['fact_type']
): Promise<DbMemoryFact[]> {
  let q = supabase.from('memory_graph').select('*').eq('user_id', userId);
  if (factType) q = q.eq('fact_type', factType);
  const { data, error } = await q.order('confidence', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function upsertMemoryFact(
  fact: Omit<DbMemoryFact, 'id' | 'created_at' | 'updated_at'>
): Promise<void> {
  // Check if a fact with same user+subject+predicate exists
  const { data: existing } = await supabase
    .from('memory_graph')
    .select('id, is_draft')
    .eq('user_id', fact.user_id)
    .eq('subject', fact.subject)
    .eq('predicate', fact.predicate)
    .maybeSingle();

  if (existing) {
    // Second mention of a draft fact promotes it to full fact (is_draft → false)
    const promoted = existing.is_draft && !fact.is_draft;
    await supabase.from('memory_graph')
      .update({
        object:     fact.object,
        confidence: fact.confidence,
        is_draft:   promoted ? false : fact.is_draft,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('memory_graph').insert(fact);
  }
}

export async function confirmMemoryFact(factId: string): Promise<void> {
  await supabase.from('memory_graph').update({ is_confirmed: true }).eq('id', factId);
}

export async function deleteMemoryFact(factId: string): Promise<void> {
  await supabase.from('memory_graph').delete().eq('id', factId);
}

// ─── Academy — Streak & Vocab ─────────────────────────────────────────────────

export interface DbAcademyStreak {
  user_id: string;
  target_locale: string;
  current_streak: number;
  longest_streak: number;
  last_session: string | null;
  total_sessions: number;
  total_words: number;
  accuracy_pct: number;
  streak_freezes: number;
  freezes_used: number;
  last_milestone: number;
  created_at: string;
  updated_at: string;
}

/** Fetch the user's academy streak record */
export async function fetchAcademyStreak(userId: string): Promise<DbAcademyStreak | null> {
  const { data } = await supabase
    .from('academy_streaks')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as DbAcademyStreak | null) ?? null;
}

/** Upsert academy streak — creates if missing, updates if exists */
export async function upsertAcademyStreak(
  userId: string,
  updates: Partial<Omit<DbAcademyStreak, 'user_id' | 'created_at'>>
): Promise<void> {
  const now = new Date().toISOString();
  await supabase.from('academy_streaks').upsert({
    user_id: userId,
    ...updates,
    updated_at: now,
  }, { onConflict: 'user_id' });
}

/** Streak milestone thresholds */
const MILESTONES = [7, 14, 30, 60, 100, 365];

/** Record an academy session — bumps session count, updates streak, handles freezes + milestones */
export async function recordAcademySession(userId: string): Promise<{ milestone?: number; frozeUsed?: boolean }> {
  const existing = await fetchAcademyStreak(userId);
  const now = new Date();
  const lastDay = existing?.last_session?.slice(0, 10);

  let newStreak = 1;
  let frozeUsed = false;
  let freezes = existing?.streak_freezes ?? 1;
  let freezesUsed = existing?.freezes_used ?? 0;

  if (existing && lastDay) {
    const diff = (now.getTime() - new Date(lastDay).getTime()) / 86400000;
    if (diff < 1) {
      // Same day — don't increment streak
      newStreak = existing.current_streak;
    } else if (diff < 2) {
      // Consecutive day — increment
      newStreak = existing.current_streak + 1;
    } else if (diff < 3 && freezes > 0) {
      // Missed 1 day but has a freeze — consume it, keep streak
      newStreak = existing.current_streak + 1;
      freezes -= 1;
      freezesUsed += 1;
      frozeUsed = true;
    }
    // else gap > 2 days (or no freeze) — reset to 1
  }

  // Earn a freeze every 7-day streak interval
  if (newStreak > 0 && newStreak % 7 === 0 && newStreak > (existing?.current_streak ?? 0)) {
    freezes = Math.min(freezes + 1, 3); // max 3 freezes
  }

  const longestStreak = Math.max(newStreak, existing?.longest_streak ?? 0);
  const totalSessions = (existing?.total_sessions ?? 0) + 1;
  const lastMilestone = existing?.last_milestone ?? 0;

  // Detect new milestone
  const newMilestone = MILESTONES.find(m => newStreak >= m && m > lastMilestone);

  await upsertAcademyStreak(userId, {
    current_streak: newStreak,
    longest_streak: longestStreak,
    total_sessions: totalSessions,
    last_session: now.toISOString(),
    streak_freezes: freezes,
    freezes_used: freezesUsed,
    ...(newMilestone ? { last_milestone: newMilestone } : {}),
  });

  return { milestone: newMilestone, frozeUsed };
}

/** Save a vocab word to memory_graph as a language_vocab fact */
export async function upsertVocabWord(
  userId: string,
  word: string,
  translation: string,
  targetLocale: string,
  mastery = 0
): Promise<void> {
  await upsertMemoryFact({
    user_id: userId,
    fact_type: 'language_vocab',
    subject: targetLocale,
    predicate: 'vocab_word',
    object: word,
    confidence: Math.min(100, 50 + mastery * 10),
    source_tx: `translation:${translation}|mastery:${mastery}`,
    is_confirmed: mastery >= 3,
    is_draft: mastery < 2,
  });
}

/** Fetch all vocab words for a given target locale */
export async function fetchVocabWords(
  userId: string,
  targetLocale?: string
): Promise<{ word: string; translation: string; mastery: number; locale: string }[]> {
  let q = supabase
    .from('memory_graph')
    .select('subject, object, confidence, source_tx')
    .eq('user_id', userId)
    .eq('fact_type', 'language_vocab')
    .eq('predicate', 'vocab_word')
    .order('updated_at', { ascending: false });

  if (targetLocale) q = q.eq('subject', targetLocale);

  const { data } = await q.limit(200);
  return (data ?? []).map(d => {
    const tx = (d.source_tx ?? '').split('|');
    const translation = tx.find((s: string) => s.startsWith('translation:'))?.replace('translation:', '') ?? '';
    const mastery = parseInt(tx.find((s: string) => s.startsWith('mastery:'))?.replace('mastery:', '') ?? '0', 10);
    return { word: d.object, translation, mastery, locale: d.subject };
  });
}

// ─── Memory Insights ──────────────────────────────────────────────────────────

export async function fetchMemoryInsights(userId: string): Promise<DbMemoryInsight[]> {
  const { data, error } = await supabase
    .from('memory_insights')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

export async function insertMemoryInsight(
  insight: Pick<DbMemoryInsight, 'user_id' | 'insight' | 'source_turn'>
): Promise<void> {
  await supabase.from('memory_insights').insert({ ...insight, acted_on: false });
}

// ─── Onboarding helpers ───────────────────────────────────────────────────────

export async function fetchOnboardingState(userId: string): Promise<{
  complete: boolean; step: number; displayName?: string;
}> {
  const { data } = await supabase
    .from('user_preferences')
    .select('onboarding_complete, onboarding_step, display_name')
    .eq('user_id', userId)
    .maybeSingle();
  return {
    complete: data?.onboarding_complete ?? false,
    step: data?.onboarding_step ?? 0,
    displayName: data?.display_name ?? undefined,
  };
}

export async function updateOnboardingStep(
  userId: string, step: number, displayName?: string
): Promise<void> {
  const upsertData: Record<string, unknown> = {
    user_id: userId,
    onboarding_step: step,
    updated_at: new Date().toISOString(),
  };
  if (displayName) upsertData.display_name = displayName;
  await supabase.from('user_preferences').upsert(upsertData, { onConflict: 'user_id' });
}

// ─── Feature Tour helpers ─────────────────────────────────────────────────────

/** Mark the mission brief tour as seen for this user at this version. */
export async function markTourSeen(userId: string, version = 1): Promise<void> {
  await supabase.from('user_preferences').upsert(
    { user_id: userId, tour_seen: true, tour_version: version, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  );
}

/** Check whether the user has already seen the current tour version. */
export async function hasTourBeenSeen(userId: string, currentVersion = 1): Promise<boolean> {
  const { data } = await supabase
    .from('user_preferences')
    .select('tour_seen, tour_version')
    .eq('user_id', userId)
    .maybeSingle();
  return (data?.tour_seen === true) && ((data?.tour_version ?? 0) >= currentVersion);
}

/** Reset tour state so it will show again on next login (admin/testing use). */
export async function flushTourSeen(userId: string): Promise<void> {
  await supabase.from('user_preferences').upsert(
    { user_id: userId, tour_seen: false, tour_version: 0, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  );
}

// ─── Orientation helpers ──────────────────────────────────────────────────────

/** Check whether the user has completed the interactive orientation. */
export async function hasOrientationBeenSeen(userId: string, version = 1): Promise<boolean> {
  const { data } = await supabase
    .from('user_preferences')
    .select('orientation_seen, orientation_version')
    .eq('user_id', userId)
    .maybeSingle();
  return (data?.orientation_seen === true) && ((data?.orientation_version ?? 0) >= version);
}

/** Mark orientation as completed for this user. */
export async function markOrientationSeen(userId: string, version = 1): Promise<void> {
  await supabase.from('user_preferences').upsert(
    { user_id: userId, orientation_seen: true, orientation_version: version, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  );
}

/** Reset orientation so it will show again — for Settings replay and testing. */
export async function resetOrientationSeen(userId: string): Promise<void> {
  await supabase.from('user_preferences').upsert(
    { user_id: userId, orientation_seen: false, orientation_version: 0, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  );
}


// ─── Admin Flush Utilities ────────────────────────────────────────────────────

/**
 * Reset onboarding state only — memory graph facts and conversation history
 * from onboarding are cleared. User will go through onboarding again next
 * time they enter the user experience.
 */
export async function flushOnboarding(userId: string): Promise<void> {
  await Promise.all([
    supabase.from('user_preferences').upsert({
      user_id: userId,
      onboarding_complete: false,
      onboarding_step: 0,
      display_name: null,
      response_style: 'balanced',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }),
    // Remove facts written by onboarding
    supabase.from('memory_graph')
      .delete()
      .eq('user_id', userId)
      .eq('source_tx', 'onboarding'),
  ]);
}

/**
 * Flush ALL memory for a user — conversation history, entity mentions,
 * memory graph, memories, surface queue, and memory insights.
 * Does NOT reset user_preferences (language, mode etc).
 */
export async function flushAllMemory(userId: string): Promise<void> {
  await Promise.all([
    supabase.from('conversation_history').delete().eq('user_id', userId),
    supabase.from('entity_mentions').delete().eq('user_id', userId),
    supabase.from('memory_graph').delete().eq('user_id', userId),
    supabase.from('memory_insights').delete().eq('user_id', userId),
    supabase.from('memories').delete().eq('user_id', userId),
    supabase.from('surface_queue').delete().eq('user_id', userId),
  ]);
}

/**
 * Full factory reset — flushes everything including onboarding state.
 * Equivalent to calling flushAllMemory + flushOnboarding together.
 */
export async function flushEverything(userId: string): Promise<void> {
  await Promise.all([
    flushAllMemory(userId),
    flushOnboarding(userId),
  ]);
}

/**
 * COMPLETE user factory reset — wipes every piece of user data across all
 * tables and resets preferences to clean defaults.  The user will start
 * from scratch (onboarding, orientation, tour, memory, tasks, reminders,
 * contacts, channels, integrations, etc.).
 *
 * ⚠️  This is IRREVERSIBLE.  The caller must gate this behind strong
 * confirmation UX (multi-step, type-to-confirm, cooldown).
 */
export async function fullUserReset(userId: string): Promise<void> {
  // Phase 1 — Delete all user-owned rows across every table
  await Promise.all([
    // Memory & AI
    supabase.from('conversation_history').delete().eq('user_id', userId),
    supabase.from('entity_mentions').delete().eq('user_id', userId),
    supabase.from('memory_graph').delete().eq('user_id', userId),
    supabase.from('memory_insights').delete().eq('user_id', userId),
    supabase.from('memories').delete().eq('user_id', userId),
    supabase.from('surface_queue').delete().eq('user_id', userId),
    supabase.from('user_encyclopedia').delete().eq('user_id', userId),
    // Tasks & Reminders
    supabase.from('reminders').delete().eq('user_id', userId),
    supabase.from('tasks').delete().eq('user_id', userId),
    // Commute & Errands
    supabase.from('parking_logs').delete().eq('user_id', userId),
    supabase.from('errand_list').delete().eq('user_id', userId),
    // PTT Network
    supabase.from('roger_contacts').delete().eq('user_id', userId),
    supabase.from('channel_members').delete().eq('user_id', userId),
    // Push & Location
    supabase.from('push_subscriptions').delete().eq('user_id', userId),
    supabase.from('user_location').delete().eq('user_id', userId),
    // Callsign
    supabase.from('user_callsigns').delete().eq('user_id', userId),
    // Hazards, listening, tune-in (best-effort — ignore errors for non-existent tables)
    supabase.from('road_hazards').delete().eq('reporter_id', userId).then(() => {}, () => {}),
    supabase.from('listening_sessions').delete().eq('user_id', userId).then(() => {}, () => {}),
    supabase.from('tune_in_sessions').delete().eq('participant_a', userId).then(() => {}, () => {}),
    supabase.from('tune_in_sessions').delete().eq('participant_b', userId).then(() => {}, () => {}),
    supabase.from('transmissions').delete().eq('user_id', userId).then(() => {}, () => {}),
  ]);

  // Phase 2 — Reset user_preferences to clean defaults (keeps the row for auth)
  await supabase.from('user_preferences').upsert({
    user_id: userId,
    roger_mode: 'active',
    language: 'en',
    briefing_time: '08:00',
    briefing_time2: '18:00',
    haptic_enabled: true,
    sfx_enabled: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    onboarding_complete: false,
    onboarding_step: 0,
    display_name: null,
    response_style: 'balanced',
    tour_seen: false,
    tour_version: 0,
    orientation_seen: false,
    orientation_version: 0,
    islamic_mode: false,
    prayer_notifications: false,
    finnhub_tickers: null,
    twilio_phone: null,
    notion_token: null,
    notion_db_id: null,
    spotify_connected: false,
    gcal_connected: false,
    gcal_access_token: null,
    gcal_refresh_token: null,
    gcal_token_expiry: null,
    tuya_uid: null,
    smartthings_pat: null,
    ezviz_uid: null,
    home_address: null,
    home_lat: null,
    home_lng: null,
    work_address: null,
    work_lat: null,
    work_lng: null,
    commute_mode: 'driving',
    commute_leave_time: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

// ─── Push Subscriptions ───────────────────────────────────────────────────────

export type DbPushSubscription = {
  id: string; user_id: string;
  endpoint: string; p256dh: string; auth: string;
  user_agent: string | null; created_at: string;
};

export async function savePushSubscription(
  userId: string,
  sub: PushSubscription
): Promise<void> {
  const json = sub.toJSON();
  await supabase.from('push_subscriptions').upsert({
    user_id:  userId,
    endpoint: sub.endpoint,
    p256dh:   json.keys?.p256dh  ?? '',
    auth:     json.keys?.auth     ?? '',
    user_agent: navigator.userAgent.slice(0, 200),
  }, { onConflict: 'user_id,endpoint' });
}

export async function deletePushSubscription(userId: string, endpoint: string): Promise<void> {
  await supabase.from('push_subscriptions').delete()
    .eq('user_id', userId).eq('endpoint', endpoint);
}

export async function fetchPushSubscription(userId: string): Promise<DbPushSubscription | null> {
  const { data } = await supabase.from('push_subscriptions')
    .select('*').eq('user_id', userId).limit(1).maybeSingle();
  return data ?? null;
}

// ─── User Location ────────────────────────────────────────────────────────────

export type DbUserLocation = {
  user_id: string; latitude: number; longitude: number;
  city: string | null; country: string | null;
  accuracy_m: number | null; updated_at: string;
};

export async function upsertUserLocation(
  userId: string,
  loc: { latitude: number; longitude: number; city?: string; country?: string; accuracy_m?: number }
): Promise<void> {
  await supabase.from('user_location').upsert({
    user_id:    userId,
    latitude:   loc.latitude,
    longitude:  loc.longitude,
    city:       loc.city        ?? null,
    country:    loc.country     ?? null,
    accuracy_m: loc.accuracy_m  ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

export async function fetchUserLocation(userId: string): Promise<DbUserLocation | null> {
  const { data } = await supabase.from('user_location')
    .select('*').eq('user_id', userId).maybeSingle();
  return data ?? null;
}

// ─── Commute Query (Google Maps Distance Matrix) ───────────────────────────────

const GOOGLE_MAPS_API_KEY = (typeof import.meta !== 'undefined')
  ? (import.meta as { env?: Record<string, string> }).env?.VITE_GOOGLE_MAPS_API_KEY ?? ''
  : '';

export interface CommuteResult {
  duration:     string;   // "23 mins"
  distance:     string;   // "14.2 km"
  durationSecs: number;
  distanceM:    number;
  mode:         string;
}

export async function getCommute(
  originLat: number,
  originLng: number,
  destination: string,
  mode: 'driving' | 'walking' | 'transit' | 'cycling' = 'driving'
): Promise<CommuteResult | null> {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('[Commute] VITE_GOOGLE_MAPS_API_KEY not set');
    return null;
  }

  const origin = `${originLat},${originLng}`;
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&mode=${mode}&departure_time=now&key=${GOOGLE_MAPS_API_KEY}`;

  try {
    const res  = await fetch(url);
    const data = await res.json() as {
      rows: { elements: { status: string; duration_in_traffic?: { text: string; value: number }; duration: { text: string; value: number }; distance: { text: string; value: number } }[] }[];
    };

    const el = data.rows?.[0]?.elements?.[0];
    if (!el || el.status !== 'OK') return null;

    const dur = el.duration_in_traffic ?? el.duration;
    return {
      duration:     dur.text,
      distance:     el.distance.text,
      durationSecs: dur.value,
      distanceM:    el.distance.value,
      mode,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PTT NETWORK — roger_contacts, relay_messages, roger_channels
// ─────────────────────────────────────────────────────────────────────────────

export type DbRogerContact = {
  id:            string;
  user_id:       string;
  contact_id:    string | null;
  display_name:  string;
  handle:        string | null;
  status:        'pending' | 'active' | 'blocked';
  invited_at:    string;
  accepted_at:   string | null;
  created_at:    string;
};

export type DbRelayMessage = {
  id:             string;
  channel_id:     string | null;
  sender_id:      string;
  recipient_id:   string | null;
  transcript:     string;
  roger_summary:  string | null;
  audio_url:      string | null;
  priority:       'normal' | 'urgent' | 'emergency';
  status:         'queued' | 'delivered' | 'read' | 'deferred';
  deferred_until: string | null;
  intent:         string | null;
  created_at:     string;
  delivered_at:   string | null;
  read_at:        string | null;
};

export type DbRogerChannel = {
  id:         string;
  name:       string;
  type:       'direct' | 'group' | 'open';
  owner_id:   string;
  created_at: string;
};

// ─── Contacts ─────────────────────────────────────────────────────────────────

export async function fetchContacts(userId: string): Promise<DbRogerContact[]> {
  const { data, error } = await supabase
    .from('roger_contacts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function inviteContact(
  userId: string,
  displayName: string,
  handle: string   // email or handle
): Promise<DbRogerContact> {
  const { data, error } = await supabase
    .from('roger_contacts')
    .insert({ user_id: userId, display_name: displayName, handle, status: 'pending' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function acceptContact(contactRowId: string): Promise<void> {
  const { error } = await supabase
    .from('roger_contacts')
    .update({ status: 'active', accepted_at: new Date().toISOString() })
    .eq('id', contactRowId);
  if (error) throw error;
}

export async function blockContact(contactRowId: string): Promise<void> {
  const { error } = await supabase
    .from('roger_contacts')
    .update({ status: 'blocked' })
    .eq('id', contactRowId);
  if (error) throw error;
}

// ─── Relay Messages ───────────────────────────────────────────────────────────

export async function fetchRelayHistory(
  userId: string, contactId: string, limit = 50
): Promise<DbRelayMessage[]> {
  const { data, error } = await supabase
    .from('relay_messages')
    .select('*')
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .or(`sender_id.eq.${contactId},recipient_id.eq.${contactId}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function deferRelayMessage(
  messageId: string,
  deferHours = 2
): Promise<void> {
  const deferUntil = new Date(Date.now() + deferHours * 3_600_000).toISOString();
  const { error } = await supabase
    .from('relay_messages')
    .update({ status: 'deferred', deferred_until: deferUntil })
    .eq('id', messageId);
  if (error) throw error;
}

export async function markRelayRead(messageId: string): Promise<void> {
  const { error } = await supabase
    .from('relay_messages')
    .update({ status: 'read', read_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw error;
}

// ─── Relay Realtime ───────────────────────────────────────────────────────────

export function subscribeToRelayMessages(
  userId: string,
  onMessage: (msg: DbRelayMessage) => void
) {
  return supabase
    .channel(`relay-inbox-${userId}`)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'relay_messages',
        filter: `recipient_id=eq.${userId}`,
      },
      (payload) => onMessage(payload.new as DbRelayMessage)
    )
    .subscribe();
}

// ─── Channels ─────────────────────────────────────────────────────────────────

export async function fetchChannels(userId: string): Promise<DbRogerChannel[]> {
  const { data, error } = await supabase
    .from('roger_channels')
    .select('*, channel_members!inner(user_id)')
    .eq('channel_members.user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as DbRogerChannel[];
}

export async function createChannel(
  name: string, type: DbRogerChannel['type'], ownerId: string
): Promise<DbRogerChannel> {
  const { data: channel, error } = await supabase
    .from('roger_channels')
    .insert({ name, type, owner_id: ownerId })
    .select()
    .single();
  if (error) throw error;
  // Add owner as first member
  await supabase.from('channel_members').insert({ channel_id: channel.id, user_id: ownerId });
  return channel;
}

export async function addChannelMember(channelId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('channel_members')
    .insert({ channel_id: channelId, user_id: userId });
  if (error && error.code !== '23505') throw error; // ignore duplicate
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMUTE INTELLIGENCE — parking_logs, errand_list, user_preferences commute
// ─────────────────────────────────────────────────────────────────────────────

export type DbParkingLog = {
  id:             string;
  user_id:        string;
  location_label: string;
  lat:            number | null;
  lng:            number | null;
  address:        string | null;
  notes:          string | null;
  source_tx_id:   string | null;
  created_at:     string;
  retrieved_at:   string | null;
};

export type DbErrandItem = {
  id:             string;
  user_id:        string;
  item:           string;
  location_hint:  string | null;
  location_lat:   number | null;
  location_lng:   number | null;
  radius_m:       number;
  status:         'pending' | 'done' | 'skipped';
  source_tx_id:   string | null;
  created_at:     string;
  completed_at:   string | null;
};

export type DbCommuteProfile = {
  home_address:       string | null;
  home_lat:           number | null;
  home_lng:           number | null;
  work_address:       string | null;
  work_lat:           number | null;
  work_lng:           number | null;
  commute_mode:       'driving' | 'transit' | 'walking' | 'cycling';
  commute_leave_time: string | null;  // "08:00:00"
};

// ─── Parking ──────────────────────────────────────────────────────────────────

export async function logParking(
  userId: string,
  locationLabel: string,
  opts?: { lat?: number; lng?: number; address?: string; notes?: string; sourceTxId?: string }
): Promise<DbParkingLog> {
  const { data, error } = await supabase
    .from('parking_logs')
    .insert({
      user_id:        userId,
      location_label: locationLabel,
      lat:            opts?.lat ?? null,
      lng:            opts?.lng ?? null,
      address:        opts?.address ?? null,
      notes:          opts?.notes ?? null,
      source_tx_id:   opts?.sourceTxId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchLatestParking(userId: string): Promise<DbParkingLog | null> {
  const { data } = await supabase
    .from('parking_logs')
    .select('*')
    .eq('user_id', userId)
    .is('retrieved_at', null)          // not yet retrieved
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) {
    // Mark as retrieved
    await supabase
      .from('parking_logs')
      .update({ retrieved_at: new Date().toISOString() })
      .eq('id', data.id);
  }
  return data;
}

// ─── Errands ──────────────────────────────────────────────────────────────────

export async function fetchErrands(
  userId: string, status?: DbErrandItem['status']
): Promise<DbErrandItem[]> {
  let q = supabase
    .from('errand_list')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function insertErrand(
  errand: Omit<DbErrandItem, 'id' | 'created_at' | 'completed_at'>
): Promise<DbErrandItem> {
  const { data, error } = await supabase
    .from('errand_list')
    .insert(errand)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function completeErrand(errandId: string): Promise<void> {
  const { error } = await supabase
    .from('errand_list')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', errandId);
  if (error) throw error;
}

// ─── Commute Profile ──────────────────────────────────────────────────────────

export async function fetchCommuteProfile(
  userId: string
): Promise<DbCommuteProfile | null> {
  const { data } = await supabase
    .from('user_preferences')
    .select('home_address,home_lat,home_lng,work_address,work_lat,work_lng,commute_mode,commute_leave_time')
    .eq('user_id', userId)
    .maybeSingle();
  return data as DbCommuteProfile | null;
}

export async function upsertCommuteProfile(
  userId: string,
  profile: Partial<DbCommuteProfile>
): Promise<void> {
  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, ...profile, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

// ─── Session Archive ───────────────────────────────────────────────────────────

export interface DbSessionSummary {
  id: string;
  session_start: string;
  session_end: string | null;
  duration_min: number;
  turn_count: number;
  roger_notes: string | null;
  contact_name: string | null;
  contact_callsign: string | null;
  other_user_id: string | null;
}

export interface DbSessionTurn {
  id: string;
  speaker_id: string;
  transcript: string;
  is_flagged: boolean;
  created_at: string;
  is_me: boolean;
}

export async function fetchSessionArchive(userId: string): Promise<DbSessionSummary[]> {
  const { data, error } = await supabase
    .from('tune_in_sessions')
    .select('id, session_start, session_end, turn_count, roger_notes, participant_a, participant_b')
    .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
    .eq('status', 'ended')
    .order('session_start', { ascending: false })
    .limit(50);

  if (error || !data) return [];

  const otherIds = [...new Set(
    data.map(s => s.participant_a === userId ? s.participant_b : s.participant_a).filter(Boolean)
  )];
  const { data: contacts } = otherIds.length
    ? await supabase.from('roger_contacts').select('contact_id, display_name, callsign').eq('user_id', userId).in('contact_id', otherIds)
    : { data: [] };

  const contactMap = new Map((contacts ?? []).map(c => [c.contact_id, c]));

  return data.map(s => {
    const otherId = s.participant_a === userId ? s.participant_b : s.participant_a;
    const contact = contactMap.get(otherId);
    const startMs = new Date(s.session_start).getTime();
    const endMs   = s.session_end ? new Date(s.session_end).getTime() : startMs;
    return {
      id: s.id,
      session_start: s.session_start,
      session_end: s.session_end,
      duration_min: Math.round((endMs - startMs) / 60000),
      turn_count: s.turn_count ?? 0,
      roger_notes: s.roger_notes ?? null,
      contact_name: contact?.display_name ?? null,
      contact_callsign: contact?.callsign ?? null,
      other_user_id: otherId ?? null,
    };
  });
}

export async function searchSessions(userId: string, keyword: string): Promise<DbSessionSummary[]> {
  const all = await fetchSessionArchive(userId);
  const q = keyword.toLowerCase();
  return all.filter(s =>
    s.roger_notes?.toLowerCase().includes(q) ||
    s.contact_name?.toLowerCase().includes(q) ||
    s.contact_callsign?.toLowerCase().includes(q)
  );
}

export async function fetchSessionTurns(sessionId: string, userId: string): Promise<DbSessionTurn[]> {
  const { data, error } = await supabase
    .from('tune_in_turns')
    .select('id, speaker_id, transcript, is_flagged, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return data.map(t => ({ ...t, is_me: t.speaker_id === userId }));
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL — True DB functions (replaces mockData.ts)
// ─────────────────────────────────────────────────────────────────────────────

// ─── System Health ────────────────────────────────────────────────────────────

export type DbHealthCheck = {
  id: string; service: string;
  uptime_pct: number; status: 'operational' | 'degraded' | 'down';
  message: string | null; checked_at: string;
};

export async function fetchLatestHealthChecks(): Promise<DbHealthCheck[]> {
  const { data, error } = await supabase
    .from('latest_health_checks')   // view from migration 014
    .select('*');
  if (error) throw error;
  return data ?? [];
}

export async function upsertHealthCheck(
  service: string,
  uptime_pct: number,
  status: DbHealthCheck['status'],
  message?: string
): Promise<void> {
  const { error } = await supabase.from('system_health_checks').insert({
    service, uptime_pct, status, message: message ?? null,
  });
  if (error) throw error;
}

// ─── System Alerts ────────────────────────────────────────────────────────────

export type DbSystemAlert = {
  id: string; level: 'info' | 'warning' | 'critical';
  message: string; source: string | null;
  resolved: boolean; resolved_at: string | null;
  created_at: string;
};

export async function fetchActiveAlerts(): Promise<DbSystemAlert[]> {
  const { data, error } = await supabase
    .from('system_alerts')
    .select('*')
    .eq('resolved', false)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export async function resolveAlert(id: string): Promise<void> {
  const { error } = await supabase
    .from('system_alerts')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function insertAlert(
  level: DbSystemAlert['level'],
  message: string,
  source?: string
): Promise<void> {
  const { error } = await supabase
    .from('system_alerts')
    .insert({ level, message, source: source ?? null });
  if (error) throw error;
}

// ─── Live Platform Stats ───────────────────────────────────────────────────────

export type DbLiveStat = {
  stat_date: string;
  active_users: number;
  connected_devices: number;
  tx_today: number;
  success_rate: number;
  clarification_rate: number;
  avg_latency_ms: number;
};

/** Fetches today's live stats from the computed view first, falls back to the
 *  historical platform_stats table row for today if the view returns nothing. */
export async function fetchLivePlatformStats(): Promise<DbLiveStat | null> {
  const { data: live } = await supabase
    .from('live_platform_stats')
    .select('*')
    .maybeSingle();
  if (live && (live.tx_today ?? 0) > 0) return live as DbLiveStat;

  // Fallback to stored daily snapshot
  const { data: stored } = await supabase
    .from('platform_stats')
    .select('*')
    .order('stat_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (stored as DbLiveStat) ?? null;
}




// ─── Admin User List ──────────────────────────────────────────────────────────

export type DbAdminUser = {
  user_id: string;
  email: string;
  display_name: string;
  onboarding_complete: boolean;
  onboarding_step: number;
  roger_mode: string;
  language: string;
  joined_at: string;
  last_sign_in_at: string | null;
};

export async function fetchAdminUserList(): Promise<DbAdminUser[]> {
  const { data, error } = await supabase
    .from('admin_user_list')   // view from migration 016
    .select('*');
  if (error) throw error;
  return data ?? [];
}

// ─── Feature Flags ────────────────────────────────────────────────────────────

export type DbFeatureFlag = {
  id: string; key: string; name: string;
  description: string | null; enabled: boolean;
  rollout_pct: number; environment: string;
  target_users: string[] | null;
  category: 'general' | 'ui' | 'ai' | 'hardware' | 'experiment';
  created_by: string | null;
  updated_at: string; created_at: string;
};

export async function fetchFeatureFlags(env?: string): Promise<DbFeatureFlag[]> {
  let q = supabase
    .from('feature_flags')
    .select('*')
    .order('category')
    .order('name');
  if (env) q = q.eq('environment', env);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function toggleFeatureFlag(
  id: string,
  enabled: boolean,
  rollout_pct?: number
): Promise<void> {
  const patch: Partial<DbFeatureFlag> = {
    enabled,
    updated_at: new Date().toISOString(),
  };
  if (rollout_pct !== undefined) patch.rollout_pct = rollout_pct;
  const { error } = await supabase.from('feature_flags').update(patch).eq('id', id);
  if (error) throw error;
}

export async function upsertFeatureFlag(
  flag: Omit<DbFeatureFlag, 'id' | 'created_at' | 'updated_at'>
): Promise<void> {
  const { error } = await supabase
    .from('feature_flags')
    .upsert({ ...flag, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

export async function updateFeatureFlag(
  id: string, patch: Partial<Pick<DbFeatureFlag, 'enabled' | 'rollout_pct' | 'environment' | 'target_users' | 'name' | 'description' | 'category'>>
): Promise<void> {
  const { error } = await supabase.from('feature_flags')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function insertFeatureFlag(
  flag: Pick<DbFeatureFlag, 'key' | 'name' | 'description' | 'enabled' | 'rollout_pct' | 'environment' | 'category'>
): Promise<DbFeatureFlag> {
  const { data, error } = await supabase.from('feature_flags')
    .insert({ ...flag, created_by: 'admin' })
    .select().single();
  if (error) throw error;
  return data;
}

export async function deleteFeatureFlag(id: string): Promise<void> {
  const { error } = await supabase.from('feature_flags').delete().eq('id', id);
  if (error) throw error;
}

// ─── Admin Audit Log ──────────────────────────────────────────────────────────

export type DbAdminAuditEntry = {
  id: string;
  admin_id: string; admin_email: string | null;
  module: string; action: string;
  target_id: string | null; target_label: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
};

export async function fetchAdminAuditLog(
  opts?: { module?: string; adminId?: string; limit?: number }
): Promise<DbAdminAuditEntry[]> {
  let q = supabase
    .from('admin_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.module)  q = q.eq('module', opts.module);
  if (opts?.adminId) q = q.eq('admin_id', opts.adminId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function writeAuditEntry(
  entry: Omit<DbAdminAuditEntry, 'id' | 'created_at'>
): Promise<void> {
  const { error } = await supabase.from('admin_audit_log').insert(entry);
  if (error) throw error;
}

// ─── Realtime for system_alerts ───────────────────────────────────────────────
export function subscribeToSystemAlerts(onChange: () => void) {
  return supabase
    .channel('system-alerts-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'system_alerts' }, onChange)
    .subscribe();
}

export function subscribeToHealthChecks(onChange: () => void) {
  return supabase
    .channel('health-checks-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_health_checks' }, onChange)
    .subscribe();
}

// ─── Personal Encyclopedia ────────────────────────────────────────────────────

export type DbEncyclopediaEntry = {
  id: string;
  user_id: string;
  topic: string;
  emoji: string;
  summary: string;
  full_article: string;
  sections: { title: string; content: string }[];
  tags: string[];
  source_turns: number;
  created_at: string;
  updated_at: string;
};

export async function fetchEncyclopedia(userId: string): Promise<DbEncyclopediaEntry[]> {
  const { data, error } = await supabase
    .from('user_encyclopedia')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function upsertEncyclopediaEntry(entry: {
  user_id: string;
  topic: string;
  emoji?: string;
  summary: string;
  full_article: string;
  sections?: { title: string; content: string }[];
  tags?: string[];
  source_turns?: number;
}): Promise<void> {
  const { error } = await supabase.from('user_encyclopedia').upsert({
    ...entry,
    sections: entry.sections ?? [],
    tags: entry.tags ?? [],
    source_turns: entry.source_turns ?? 1,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,lower(topic)' });
  // Fallback: if unique-index upsert fails, try insert
  if (error) {
    await supabase.from('user_encyclopedia').insert({
      ...entry,
      sections: entry.sections ?? [],
      tags: entry.tags ?? [],
      source_turns: entry.source_turns ?? 1,
    });
  }
}

export async function deleteEncyclopediaEntry(id: string): Promise<void> {
  const { error } = await supabase.from('user_encyclopedia').delete().eq('id', id);
  if (error) throw error;
}



// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG — Read-only admin action journal
// ─────────────────────────────────────────────────────────────────────────────

export type DbAuditLogEntry = {
  id: string;
  admin_id: string;
  admin_email: string | null;
  module: string;
  action: string;
  target_id: string | null;
  target_label: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export async function fetchAuditLog(
  opts?: { module?: string; limit?: number }
): Promise<DbAuditLogEntry[]> {
  let q = supabase.from('admin_audit_log').select('*')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 200);
  if (opts?.module) q = q.eq('module', opts.module);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function insertAuditLogEntry(
  entry: Pick<DbAuditLogEntry, 'admin_id' | 'admin_email' | 'module' | 'action' | 'target_id' | 'target_label' | 'before_state' | 'after_state' | 'reason'>
): Promise<void> {
  await supabase.from('admin_audit_log').insert(entry);
}

// ─────────────────────────────────────────────────────────────────────────────
// USER REGISTRY — Admin list of all users with profile data
// ─────────────────────────────────────────────────────────────────────────────

export type DbUserProfile = {
  user_id: string;
  display_name: string | null;
  roger_mode: string;
  language: string;
  timezone: string;
  onboarding_complete: boolean;
  islamic_mode: boolean;
  tour_seen: boolean;
  updated_at: string;
};

/** Fetch all user profiles via the admin-users edge function (bypasses RLS using service-role key) */
export async function fetchAllUserProfiles(): Promise<DbUserProfile[]> {
  const token = await getAuthToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ action: 'list' }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`admin-users: ${res.status} — ${err}`);
  }
  const json = await res.json() as { users: DbUserProfile[] };
  return json.users ?? [];
}

/** Fetch per-user stats via the admin-users edge function (bypasses RLS) */
export async function fetchUserStats(userId: string): Promise<{
  memories: number; reminders: number; tasks: number; transmissions: number; conversations: number;
}> {
  const token = await getAuthToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ action: 'stats', userId }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`admin-users stats: ${res.status} — ${err}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// USER AUDIT — Deep inspection functions for admin testing/QA
// ─────────────────────────────────────────────────────────────────────────────

export type DbUserConversation = {
  id: string; role: string; content: string; created_at: string;
};

/** Fetch a user's conversation history (admin inspection) */
export async function fetchUserConversations(userId: string, limit = 100): Promise<DbUserConversation[]> {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('id, role, content, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export type DbUserTransmission = {
  id: string; transcript: string; roger_response: string | null;
  intent: string | null; outcome: string | null; created_at: string;
};

/** Fetch a user's PTT transmissions with intent + response (admin inspection) */
export async function fetchUserTransmissions(userId: string, limit = 100): Promise<DbUserTransmission[]> {
  const { data, error } = await supabase
    .from('transmissions')
    .select('id, transcript, roger_response, intent, outcome, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export type DbUserTask = {
  id: string; text: string; priority: number; status: string;
  due_at: string | null; created_at: string;
};

/** Fetch a user's tasks (admin inspection) */
export async function fetchUserTaskList(userId: string): Promise<DbUserTask[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, text, priority, status, due_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export type DbUserReminder = {
  id: string; text: string; status: string;
  due_at: string | null; due_location: string | null;
  created_at: string;
};

/** Fetch a user's reminders (admin inspection) */
export async function fetchUserReminderList(userId: string): Promise<DbUserReminder[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('id, text, status, due_at, due_location, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export type DbUserMemory = {
  id: string; fact: string; category: string | null;
  confidence: number | null; created_at: string;
};

/** Fetch a user's memory facts (admin inspection) */
export async function fetchUserMemories(userId: string, limit = 100): Promise<DbUserMemory[]> {
  const { data, error } = await supabase
    .from('memories')
    .select('id, fact, category, confidence, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

