import { supabase } from './supabase';

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
};

// ─── Task ─────────────────────────────────────────────────────────────────────
export type DbTask = {
  id: string; user_id: string; text: string;
  priority: number; status: 'open' | 'done' | 'cancelled';
  due_at: string | null; source_tx_id: string | null;
  is_admin_test: boolean; created_at: string; updated_at: string;
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
  timezone: string; updated_at: string;
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

export async function updateTaskStatus(id: string, status: DbTask['status']): Promise<void> {
  const { error } = await supabase.from('tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
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
  fact_type: 'person' | 'company' | 'project' | 'preference' | 'relationship' | 'goal' | 'habit' | 'location';
  subject: string; predicate: string; object: string;
  confidence: number; source_tx: string | null;
  is_confirmed: boolean; created_at: string; updated_at: string;
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
    .select('id')
    .eq('user_id', fact.user_id)
    .eq('subject', fact.subject)
    .eq('predicate', fact.predicate)
    .maybeSingle();

  if (existing) {
    await supabase.from('memory_graph')
      .update({ object: fact.object, confidence: fact.confidence, updated_at: new Date().toISOString() })
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
  mode: 'driving' | 'walking' | 'transit' = 'driving'
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
