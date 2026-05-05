// supabase/functions/admin-users/index.ts
// Admin-only endpoint — uses service-role key to bypass RLS on user_preferences.
// Returns either all user profiles (action=list) or per-user stats (action=stats).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')          ?? '';
const SERVICE_ROLE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY             = Deno.env.get('SUPABASE_ANON_KEY')     ?? '';

// Admin emails allowed to call this function (comma-separated env var)
const ADMIN_EMAILS = (Deno.env.get('ADMIN_EMAILS') ?? '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // ── Auth check: only verified admin emails may call this ──────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Verify the caller's JWT using anon client (reads the user's email)
  const anonClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !user?.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // If ADMIN_EMAILS is configured, enforce it; otherwise allow any authenticated user
  // (useful during initial setup before ADMIN_EMAILS is set)
  if (ADMIN_EMAILS.length > 0 && !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Service-role client — bypasses ALL RLS ────────────────────────────────
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json() as { action: string; userId?: string };

    // ── action=list: return all user profiles ─────────────────────────────
    if (body.action === 'list') {
      const { data, error } = await db
        .from('user_preferences')
        .select('user_id, display_name, roger_mode, language, timezone, onboarding_complete, islamic_mode, tour_seen, updated_at')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return new Response(JSON.stringify({ users: data ?? [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── action=stats: return per-user counts ──────────────────────────────
    if (body.action === 'stats' && body.userId) {
      const uid = body.userId;
      const [mem, rem, tsk, tx, conv] = await Promise.all([
        db.from('memories').select('id', { count: 'exact', head: true }).eq('user_id', uid),
        db.from('reminders').select('id', { count: 'exact', head: true }).eq('user_id', uid),
        db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', uid),
        db.from('transmissions').select('id', { count: 'exact', head: true }).eq('user_id', uid),
        db.from('conversation_history').select('id', { count: 'exact', head: true }).eq('user_id', uid),
      ]);
      return new Response(JSON.stringify({
        memories:      mem.count  ?? 0,
        reminders:     rem.count  ?? 0,
        tasks:         tsk.count  ?? 0,
        transmissions: tx.count   ?? 0,
        conversations: conv.count ?? 0,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── action=list_personas: return only AI persona users ────────────────────
    if (body.action === 'list_personas') {
      const { data, error } = await db
        .from('user_preferences')
        .select('user_id, display_name, roger_mode, language, timezone, onboarding_complete, islamic_mode, tour_seen, updated_at, is_ai_persona, ai_persona_identity, last_advanced_at')
        .eq('is_ai_persona', true)
        .order('last_advanced_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return new Response(JSON.stringify({ users: data ?? [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── action=delete: permanently delete a user and all their data ───────────
    if (body.action === 'delete' && body.userId) {
      const uid = body.userId;
      // Phase 1: delete all user data in parallel
      await Promise.all([
        db.from('conversation_history').delete().eq('user_id', uid),
        db.from('entity_mentions').delete().eq('user_id', uid),
        db.from('memory_graph').delete().eq('user_id', uid),
        db.from('memory_insights').delete().eq('user_id', uid),
        db.from('memories').delete().eq('user_id', uid),
        db.from('surface_queue').delete().eq('user_id', uid),
        db.from('user_encyclopedia').delete().eq('user_id', uid),
        db.from('reminders').delete().eq('user_id', uid),
        db.from('tasks').delete().eq('user_id', uid),
        db.from('user_callsigns').delete().eq('user_id', uid),
        db.from('ai_persona_events').delete().eq('user_id', uid),
        db.from('ai_usage_log').delete().eq('user_id', uid),
        db.from('roger_thoughts').delete().eq('user_id', uid).then(() => {}, () => {}),
        db.from('transmissions').delete().eq('user_id', uid).then(() => {}, () => {}),
      ]);
      // Phase 2: delete preferences last (FK root)
      await db.from('user_preferences').delete().eq('user_id', uid);
      // Phase 3: delete the Auth user
      const { error: delErr } = await db.auth.admin.deleteUser(uid);
      if (delErr) throw new Error(`Auth delete failed: ${delErr.message}`);
      return new Response(JSON.stringify({ ok: true, userId: uid }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── action=ai_usage: get AI usage summary for a specific user ─────────────
    if (body.action === 'ai_usage' && body.userId) {
      const uid = body.userId;
      const { data, error } = await db
        .from('ai_usage_log')
        .select('function_name, model, total_tokens, cost_usd, latency_ms, success, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ usage: data ?? [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── action=persona_events: get lifespan event log ─────────────────────────
    if (body.action === 'persona_events' && body.userId) {
      const uid = body.userId;
      const { data, error } = await db
        .from('ai_persona_events')
        .select('id, event_type, summary, model_used, tokens_used, cost_usd, created_at, report_data')
        .eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ events: data ?? [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── action=conversation_history: get full PTT conversation for a persona ───
    if (body.action === 'conversation_history' && body.userId) {
      const uid   = body.userId;
      const limit = Number((body as Record<string, unknown>).limit ?? 60);
      const { data, error } = await db
        .from('conversation_history')
        .select('id, session_id, role, content, intent, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return new Response(JSON.stringify({ turns: data ?? [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── action=live_snapshot: tasks + reminders + memories for Live tab ────────
    if (body.action === 'live_snapshot' && body.userId) {
      const uid = body.userId;
      const [tasks, reminders, memories, facts] = await Promise.all([
        db.from('tasks').select('id, text, priority, status, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(20),
        db.from('reminders').select('id, text, status, due_at, created_at').eq('user_id', uid).order('due_at', { ascending: true }).limit(20),
        db.from('memories').select('id, type, text, tags, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(15),
        db.from('memory_graph').select('id, fact_type, subject, predicate, object, confidence').eq('user_id', uid).order('created_at', { ascending: false }).limit(20),
      ]);
      return new Response(JSON.stringify({
        tasks:     tasks.data     ?? [],
        reminders: reminders.data ?? [],
        memories:  memories.data  ?? [],
        facts:     facts.data     ?? [],
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── action=execution_audit: unified proof-of-execution timeline ─────────────
    if (body.action === 'execution_audit' && body.userId) {
      const uid = body.userId;
      const b = body as Record<string, unknown>;
      const dateFrom = b.dateFrom ? String(b.dateFrom) : null;
      const dateTo   = b.dateTo   ? String(b.dateTo)   : null;
      const catFilter = b.category ? String(b.category) : null;
      const limit = Number(b.limit ?? 200);

      // Build entries array from multiple tables in parallel
      type AuditEntry = {
        id: string; timestamp: string;
        category: string; action: string; status: string;
        trigger_transcript: string | null; trigger_intent: string | null; trigger_confidence: number | null;
        description: string; db_table: string | null; db_row_id: string | null; db_current_status: string | null;
        service_name: string | null; service_response: string | null; roger_response: string | null;
        tokens: number | null; cost_usd: number | null; latency_ms: number | null;
      };

      const entries: AuditEntry[] = [];

      // Helper: apply date range
      const dateQ = (q: ReturnType<typeof db.from>) => {
        let r = q;
        if (dateFrom) r = r.gte('created_at', dateFrom);
        if (dateTo) r = r.lte('created_at', dateTo);
        return r;
      };

      // 1) Reminders — created + status
      if (!catFilter || catFilter === 'reminder') {
        const { data: rems } = await dateQ(
          db.from('reminders').select('id, text, status, due_at, recurrence_rule, created_at').eq('user_id', uid)
        ).order('created_at', { ascending: false }).limit(limit);
        for (const r of (rems ?? [])) {
          entries.push({
            id: `rem-${r.id}`, timestamp: r.created_at,
            category: 'reminder',
            action: r.status === 'done' ? 'fired' : r.status === 'pending' ? 'created' : 'updated',
            status: 'success',
            trigger_transcript: null, trigger_intent: 'CREATE_REMINDER', trigger_confidence: null,
            description: r.text,
            db_table: 'reminders', db_row_id: r.id, db_current_status: r.status,
            service_name: null, service_response: null, roger_response: null,
            tokens: null, cost_usd: null, latency_ms: null,
          });
        }
      }

      // 2) Tasks — created, completed, failed
      if (!catFilter || catFilter === 'task') {
        const { data: tasks } = await dateQ(
          db.from('tasks').select('id, text, priority, status, resolved_by, created_at').eq('user_id', uid)
        ).order('created_at', { ascending: false }).limit(limit);
        for (const t of (tasks ?? [])) {
          entries.push({
            id: `task-${t.id}`, timestamp: t.created_at,
            category: 'task',
            action: t.status === 'done' ? 'completed' : t.status === 'open' ? 'created' : 'updated',
            status: 'success',
            trigger_transcript: null, trigger_intent: 'CREATE_TASK', trigger_confidence: null,
            description: `${t.text} (P${t.priority})${t.resolved_by ? ` · resolved by: ${t.resolved_by}` : ''}`,
            db_table: 'tasks', db_row_id: t.id, db_current_status: t.status,
            service_name: null, service_response: null, roger_response: null,
            tokens: null, cost_usd: null, latency_ms: null,
          });
        }
      }

      // 3) Memory facts — extracted
      if (!catFilter || catFilter === 'fact') {
        const { data: facts } = await dateQ(
          db.from('memory_graph').select('id, fact_type, subject, predicate, object, confidence, created_at').eq('user_id', uid)
        ).order('created_at', { ascending: false }).limit(limit);
        for (const f of (facts ?? [])) {
          entries.push({
            id: `fact-${f.id}`, timestamp: f.created_at,
            category: 'fact', action: 'extracted', status: 'success',
            trigger_transcript: null, trigger_intent: null, trigger_confidence: f.confidence,
            description: `${f.subject} → ${f.predicate} → ${f.object}`,
            db_table: 'memory_graph', db_row_id: f.id, db_current_status: null,
            service_name: null, service_response: null, roger_response: null,
            tokens: null, cost_usd: null, latency_ms: null,
          });
        }
      }

      // 4) Memories (semantic) — extracted
      if (!catFilter || catFilter === 'memory') {
        const { data: mems } = await dateQ(
          db.from('memories').select('id, type, text, tags, created_at').eq('user_id', uid)
        ).order('created_at', { ascending: false }).limit(limit);
        for (const m of (mems ?? [])) {
          entries.push({
            id: `mem-${m.id}`, timestamp: m.created_at,
            category: 'memory', action: 'extracted', status: 'success',
            trigger_transcript: null, trigger_intent: null, trigger_confidence: null,
            description: m.text,
            db_table: 'memories', db_row_id: m.id, db_current_status: m.type,
            service_name: null, service_response: null, roger_response: null,
            tokens: null, cost_usd: null, latency_ms: null,
          });
        }
      }

      // 5) Conversation turns — with intent
      if (!catFilter || catFilter === 'conversation') {
        const { data: convs } = await dateQ(
          db.from('conversation_history').select('id, role, content, intent, created_at').eq('user_id', uid)
        ).order('created_at', { ascending: false }).limit(limit);
        // Group user+assistant pairs
        const turns = convs ?? [];
        for (let i = 0; i < turns.length; i++) {
          const t = turns[i];
          if (t.role === 'user') {
            const next = turns[i - 1]; // turns are desc, so previous index is the response
            entries.push({
              id: `conv-${t.id}`, timestamp: t.created_at,
              category: 'conversation', action: 'created', status: 'success',
              trigger_transcript: t.content,
              trigger_intent: t.intent ?? null,
              trigger_confidence: null,
              description: `User message with intent: ${t.intent ?? 'unknown'}`,
              db_table: 'conversation_history', db_row_id: t.id, db_current_status: null,
              service_name: null, service_response: null,
              roger_response: next?.role === 'assistant' ? next.content?.slice(0, 200) ?? null : null,
              tokens: null, cost_usd: null, latency_ms: null,
            });
          }
        }
      }

      // 6) AI usage log — service calls
      if (!catFilter || catFilter === 'service') {
        const { data: usage } = await dateQ(
          db.from('ai_usage_log').select('id, function_name, model, total_tokens, cost_usd, latency_ms, success, created_at').eq('user_id', uid)
        ).order('created_at', { ascending: false }).limit(limit);
        for (const u of (usage ?? [])) {
          entries.push({
            id: `svc-${u.id}`, timestamp: u.created_at,
            category: 'service',
            action: u.success ? 'completed' : 'failed',
            status: u.success ? 'success' : 'error',
            trigger_transcript: null, trigger_intent: null, trigger_confidence: null,
            description: `${u.function_name} (${u.model})`,
            db_table: 'ai_usage_log', db_row_id: u.id, db_current_status: u.success ? 'success' : 'failed',
            service_name: u.function_name, service_response: null, roger_response: null,
            tokens: u.total_tokens, cost_usd: Number(u.cost_usd ?? 0), latency_ms: u.latency_ms,
          });
        }
      }

      // Sort by timestamp descending
      entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Compute summary
      const summary = {
        total: entries.length,
        success: entries.filter(e => e.status === 'success').length,
        warning: entries.filter(e => e.status === 'warning').length,
        error: entries.filter(e => e.status === 'error').length,
        total_tokens: entries.reduce((s, e) => s + (e.tokens ?? 0), 0),
        total_cost_usd: entries.reduce((s, e) => s + (e.cost_usd ?? 0), 0),
        avg_latency_ms: entries.filter(e => e.latency_ms).length > 0
          ? entries.reduce((s, e) => s + (e.latency_ms ?? 0), 0) / entries.filter(e => e.latency_ms).length
          : 0,
        by_category: entries.reduce((m, e) => { m[e.category] = (m[e.category] ?? 0) + 1; return m; }, {} as Record<string, number>),
      };

      return new Response(JSON.stringify({ entries: entries.slice(0, limit), summary }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── action=verify_row: real-time DB row existence check ──────────────────────
    if (body.action === 'verify_row') {
      const b = body as Record<string, unknown>;
      const table = String(b.table ?? '');
      const rowId = String(b.rowId ?? '');
      // Whitelist allowed tables for security
      const allowed = ['reminders', 'tasks', 'memories', 'memory_graph', 'conversation_history', 'ai_usage_log', 'surface_queue'];
      if (!allowed.includes(table) || !rowId) {
        return new Response(JSON.stringify({ exists: false, current_status: null, row_data: null }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      const { data, error: qErr } = await db.from(table).select('*').eq('id', rowId).maybeSingle();
      if (qErr || !data) {
        return new Response(JSON.stringify({ exists: false, current_status: null, row_data: null }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        exists: true,
        current_status: data.status ?? data.fact_type ?? data.role ?? null,
        row_data: data,
      }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── action=persona_analytics: global cross-persona KPIs ──────────────────────
    if (body.action === 'persona_analytics') {
      // 1) Get all AI personas
      const { data: allP } = await db
        .from('user_preferences')
        .select('user_id, display_name, ai_persona_identity, last_advanced_at')
        .eq('is_ai_persona', true);
      const personas = allP ?? [];
      const pIds = personas.map(p => p.user_id);

      if (pIds.length === 0) {
        return new Response(JSON.stringify({
          active_personas: 0, total_sessions_today: 0,
          avg_intent_accuracy: 0, fallback_rate: 0, red_flags: 0,
          total_cost_7d: 0, top_intents: [], worst_persona: null, best_persona: null,
          service_failures_24h: 0,
        }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
      }

      // 2) Active = advanced in last 48h
      const cutoff48h = new Date(Date.now() - 48 * 3600000).toISOString();
      const active = personas.filter(p => p.last_advanced_at && p.last_advanced_at > cutoff48h).length;

      // 3) Sessions today (conversation turns today)
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const { count: sessionsToday } = await db
        .from('conversation_history')
        .select('id', { count: 'exact', head: true })
        .in('user_id', pIds)
        .eq('role', 'user')
        .gte('created_at', todayStart.toISOString());

      // 4) Intent accuracy + fallback rate from recent conversations
      const { data: recentConvs } = await db
        .from('conversation_history')
        .select('user_id, intent')
        .in('user_id', pIds)
        .eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(500);
      const convList = recentConvs ?? [];
      const total = convList.length || 1;
      const fallbacks = convList.filter(c => !c.intent || c.intent === 'UNKNOWN' || c.intent === 'FALLBACK' || c.intent === 'NONE').length;
      const fallbackRate = fallbacks / total;
      const avgAccuracy = 1 - fallbackRate;

      // Per-persona fallback counts
      const perPersona: Record<string, { total: number; fallback: number }> = {};
      for (const c of convList) {
        if (!perPersona[c.user_id]) perPersona[c.user_id] = { total: 0, fallback: 0 };
        perPersona[c.user_id].total++;
        if (!c.intent || c.intent === 'UNKNOWN' || c.intent === 'FALLBACK' || c.intent === 'NONE') {
          perPersona[c.user_id].fallback++;
        }
      }
      const redFlags = Object.values(perPersona).filter(v => v.total >= 5 && (v.fallback / v.total) > 0.3).length;

      // Top intents
      const intentCounts: Record<string, number> = {};
      for (const c of convList) {
        if (c.intent && c.intent !== 'UNKNOWN' && c.intent !== 'NONE') {
          intentCounts[c.intent] = (intentCounts[c.intent] ?? 0) + 1;
        }
      }
      const topIntents = Object.entries(intentCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([intent, count]) => ({ intent, count }));

      // Worst & best persona
      let worst: { name: string; user_id: string; fallback_pct: number } | null = null;
      let best: { name: string; user_id: string; fallback_pct: number } | null = null;
      for (const [uid, v] of Object.entries(perPersona)) {
        if (v.total < 3) continue;
        const pct = v.fallback / v.total;
        const p = personas.find(x => x.user_id === uid);
        const name = (p?.ai_persona_identity as Record<string, unknown>)?.name as string ?? p?.display_name ?? uid;
        if (!worst || pct > worst.fallback_pct) worst = { name, user_id: uid, fallback_pct: pct };
        if (!best || pct < best.fallback_pct) best = { name, user_id: uid, fallback_pct: pct };
      }

      // 5) Cost last 7 days
      const cutoff7d = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: usageRows } = await db
        .from('ai_usage_log')
        .select('cost_usd')
        .in('user_id', pIds)
        .gte('created_at', cutoff7d);
      const totalCost7d = (usageRows ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);

      // 6) Service failures last 24h
      const cutoff24h = new Date(Date.now() - 24 * 3600000).toISOString();
      const { count: failures24h } = await db
        .from('ai_usage_log')
        .select('id', { count: 'exact', head: true })
        .in('user_id', pIds)
        .eq('success', false)
        .gte('created_at', cutoff24h);

      return new Response(JSON.stringify({
        active_personas: active,
        total_sessions_today: sessionsToday ?? 0,
        avg_intent_accuracy: avgAccuracy,
        fallback_rate: fallbackRate,
        red_flags: redFlags,
        total_cost_7d: totalCost7d,
        top_intents: topIntents,
        worst_persona: worst,
        best_persona: best,
        service_failures_24h: failures24h ?? 0,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
