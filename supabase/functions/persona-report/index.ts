// supabase/functions/persona-report/index.ts
// Generates a comprehensive admin study report for an AI persona.
// Each life event is traced: question → AI nodes → DB changes → answer.
// Deploy: supabase functions deploy persona-report --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { trackUsage } from '../_shared/tokenTracker.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;
const OPENAI_API_KEY   = Deno.env.get('OPENAI_API_KEY')!;
const ADMIN_EMAILS     = (Deno.env.get('ADMIN_EMAILS') ?? '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

async function sb(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
  });
  if (res.status === 204) return null;
  return res.json();
}

// ── Map intent → screen name ───────────────────────────────────────────────────
const INTENT_SCREEN: Record<string, string> = {
  BRIEFING_REQUEST: 'UserHome → Briefing',
  CREATE_REMINDER:  'RemindersView',
  QUERY_REMINDERS:  'RemindersView',
  CREATE_TASK:      'TasksView',
  QUERY_TASKS:      'TasksView',
  MEMORY_CAPTURE:   'MemoryView',
  BOOK_UPDATE:      'MemoryView (books)',
  DEPARTURE_SIGNAL: 'CommuteRadar',
  PARK_REMEMBER:    'CommuteRadar (parking)',
  SMART_HOME_CONTROL: 'SmartHomeView',
  SMART_HOME_QUERY: 'SmartHomeView',
  PLAY_RADIO:       'UserHome (radio)',
  RELAY_SEND:       'PTT Network',
  TUNE_IN_REQUEST:  'TuneIn session',
  QUERY_STOCK:      'MarketDashboard',
  QUERY_GOLD:       'MarketDashboard',
};

// ── Map edge function → human-readable node name ───────────────────────────────
const NODE_NAMES: Record<string, string> = {
  'spawn-ai-persona':       'Spawn Engine',
  'advance-persona-life':   'Life Simulator',
  'persona-report':         'Report Engine',
  'process-transmission':   'PTT Processor',
  'roger-think':            'Proactive AI (Roger Think)',
  'morning-briefing':       'Morning Briefing',
  'detect-patterns':        'Pattern Detector',
  'generate-surface-script':'Surface Scripter',
  'generate-meeting-notes': 'Meeting Notes AI',
  'end-tune-in':            'TuneIn Analyzer',
  'device-relay':           'Device Relay',
  'weekly-digest':          'Weekly Digest',
  'check-reminders':        'Reminder Cron',
  'advance-persona-life-cron': 'Persona Cron (pg_cron)',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  const anonClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !user?.email) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!ADMIN_EMAILS.length || !ADMIN_EMAILS.includes(user.email.toLowerCase()))
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json() as { userId: string };
    if (!body.userId) return new Response(JSON.stringify({ error: 'userId required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const uid = body.userId;

    // ── Fetch all persona data ────────────────────────────────────────────────
    const [
      prefs, facts, memories, reminders, tasks,
      conversations, entities, aiUsage, personaEvents,
    ] = await Promise.all([
      sb(`user_preferences?user_id=eq.${uid}&select=*`),
      sb(`memory_graph?user_id=eq.${uid}&order=created_at.asc&select=fact_type,subject,predicate,object,confidence,source_tx,created_at`),
      sb(`memories?user_id=eq.${uid}&order=created_at.asc&select=type,text,tags,created_at`),
      sb(`reminders?user_id=eq.${uid}&order=created_at.asc&select=text,status,due_at,created_at`),
      sb(`tasks?user_id=eq.${uid}&order=created_at.asc&select=text,status,priority,created_at,updated_at`),
      sb(`conversation_history?user_id=eq.${uid}&order=created_at.asc&select=role,content,intent,session_id,created_at`),
      sb(`entity_mentions?user_id=eq.${uid}&order=mention_count.desc&select=entity_text,entity_type,mention_count`),
      sb(`ai_usage_log?user_id=eq.${uid}&order=created_at.asc&select=function_name,model,prompt_tokens,completion_tokens,total_tokens,cost_usd,latency_ms,success,created_at`),
      sb(`ai_persona_events?user_id=eq.${uid}&order=created_at.asc&select=id,event_type,summary,model_used,tokens_used,cost_usd,detail,created_at`),
    ]);

    const profile = Array.isArray(prefs) ? prefs[0] : null;
    if (!profile?.is_ai_persona) return new Response(JSON.stringify({ error: 'Not an AI persona' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const identity = (profile.ai_persona_identity as Record<string, unknown>) ?? {};
    const convRows       = Array.isArray(conversations) ? conversations as { role: string; content: string; intent: string | null; session_id: string; created_at: string }[] : [];
    const aiUsageRows    = Array.isArray(aiUsage)       ? aiUsage       as { function_name: string; model: string; prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_usd: number; latency_ms: number; success: boolean; created_at: string }[] : [];
    const eventsRows     = Array.isArray(personaEvents) ? personaEvents as { id: string; event_type: string; summary: string; model_used: string; tokens_used: number; cost_usd: number; detail: Record<string, unknown>; created_at: string }[] : [];
    const factsRows      = Array.isArray(facts)         ? facts         as { fact_type: string; subject: string; predicate: string; object: string; confidence: number; source_tx: string; created_at: string }[] : [];
    const memoriesRows   = Array.isArray(memories)      ? memories      as { type: string; text: string; tags: unknown[]; created_at: string }[] : [];
    const tasksRows      = Array.isArray(tasks)         ? tasks         as { text: string; status: string; priority: number; created_at: string; updated_at: string }[] : [];
    const remindersRows  = Array.isArray(reminders)     ? reminders     as { text: string; status: string; due_at: string; created_at: string }[] : [];

    // ── Stats ─────────────────────────────────────────────────────────────────
    const spawnEvent    = eventsRows.find(e => e.event_type === 'spawn');
    const spawnedAt     = spawnEvent ? new Date(spawnEvent.created_at) : new Date();
    const lifespanHours = Math.round((Date.now() - spawnedAt.getTime()) / 3600000);
    const tasksDone     = tasksRows.filter(t => t.status === 'done').length;
    const remindersDone = remindersRows.filter(r => r.status === 'done').length;
    const reportVersion = eventsRows.filter(e => e.event_type === 'report').length + 1;

    const totalTokens = aiUsageRows.reduce((s, r) => s + (r.total_tokens ?? 0), 0);
    const totalCost   = aiUsageRows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    const totalCalls  = aiUsageRows.length;

    // ── AI breakdown by function ──────────────────────────────────────────────
    const aiBreakdown: Record<string, { calls: number; tokens: number; cost: number; latencyMs: number[] }> = {};
    for (const row of aiUsageRows) {
      if (!aiBreakdown[row.function_name]) aiBreakdown[row.function_name] = { calls: 0, tokens: 0, cost: 0, latencyMs: [] };
      aiBreakdown[row.function_name].calls++;
      aiBreakdown[row.function_name].tokens  += row.total_tokens ?? 0;
      aiBreakdown[row.function_name].cost    += Number(row.cost_usd ?? 0);
      aiBreakdown[row.function_name].latencyMs.push(row.latency_ms ?? 0);
    }
    const aiBreakdownList = Object.entries(aiBreakdown).map(([fn, d]) => ({
      function:       fn,
      node_name:      NODE_NAMES[fn] ?? fn,
      calls:          d.calls,
      tokens:         d.tokens,
      cost:           Math.round(d.cost * 10000) / 10000,
      avg_latency_ms: d.latencyMs.length ? Math.round(d.latencyMs.reduce((a, b) => a + b, 0) / d.latencyMs.length) : 0,
    })).sort((a, b) => b.tokens - a.tokens);

    // ── Per-event trace log ───────────────────────────────────────────────────
    // For each ai_persona_event, correlate:
    //   • conversation turns created within ±3min window
    //   • ai_usage_log entries created within ±3min window
    //   • memory_graph entries with source_tx matching this event type
    //   • memories / tasks / reminders created within ±3min window

    const WINDOW_MS = 3 * 60 * 1000; // 3 minutes

    const traceLog = eventsRows.map(evt => {
      const evtTime = new Date(evt.created_at).getTime();
      const lo = evtTime - WINDOW_MS;
      const hi = evtTime + WINDOW_MS;

      // Conversation turns in window
      const convInWindow = convRows.filter(c => {
        const t = new Date(c.created_at).getTime();
        return t >= lo && t <= hi;
      });

      // Group turns into exchanges: find user→assistant pairs
      const exchanges: { user_msg: string; user_intent: string | null; roger_reply: string; timestamp: string }[] = [];
      for (let i = 0; i < convInWindow.length; i++) {
        if (convInWindow[i].role === 'user') {
          const reply = convInWindow[i + 1]?.role === 'assistant' ? convInWindow[i + 1].content : null;
          if (reply) {
            exchanges.push({
              user_msg:    convInWindow[i].content,
              user_intent: convInWindow[i].intent,
              roger_reply: reply,
              timestamp:   convInWindow[i].created_at,
            });
            i++; // skip the assistant turn
          }
        }
      }

      // AI calls in window
      const aiCallsInWindow = aiUsageRows.filter(a => {
        const t = new Date(a.created_at).getTime();
        return t >= lo && t <= hi;
      }).map(a => ({
        node:          NODE_NAMES[a.function_name] ?? a.function_name,
        function_name: a.function_name,
        model:         a.model,
        prompt_tokens: a.prompt_tokens ?? 0,
        completion_tokens: a.completion_tokens ?? 0,
        total_tokens:  a.total_tokens ?? 0,
        cost_usd:      Math.round(Number(a.cost_usd ?? 0) * 100000) / 100000,
        latency_ms:    a.latency_ms ?? 0,
        success:       a.success,
        timestamp:     a.created_at,
      }));

      // DB changes from event detail (already stored by advance-persona-life)
      const det = evt.detail ?? {};
      const db_changes = {
        memories_added:      (det.new_memories  as string[] | undefined) ?? [],
        facts_added:         (det.new_facts     as string[] | undefined) ?? [],
        tasks_added:         (det.new_tasks     as string[] | undefined) ?? [],
        tasks_completed:     (det.completed_tasks as string[] | undefined) ?? [],
        reminders_triggered: (det.trigger_reminder_texts as string[] | undefined) ?? [],
      };

      // Also catch DB rows created in window that aren't in the detail yet
      const memsInWindow = memoriesRows.filter(m => {
        const t = new Date(m.created_at).getTime();
        return t >= lo && t <= hi && !db_changes.memories_added.some(x => x === m.text);
      }).map(m => m.text);
      db_changes.memories_added = [...db_changes.memories_added, ...memsInWindow];

      const factsInWindow = factsRows.filter(f => {
        const t = new Date(f.created_at).getTime();
        return t >= lo && t <= hi && !db_changes.facts_added.some(x => x.includes(f.subject));
      }).map(f => `${f.subject} ${f.predicate} ${f.object}`);
      db_changes.facts_added = [...db_changes.facts_added, ...factsInWindow];

      // Silent nodes (passive processing) triggered in this window
      const silentNodes: string[] = [];
      for (const call of aiCallsInWindow) {
        if (['detect-patterns', 'roger-think', 'generate-surface-script'].includes(call.function_name)) {
          silentNodes.push(`${call.node} — triggered silently (${call.model}, ${call.latency_ms}ms)`);
        }
      }
      if (db_changes.facts_added.length > 0)  silentNodes.push(`Memory Graph Writer — ${db_changes.facts_added.length} new facts persisted`);
      if (db_changes.memories_added.length > 0) silentNodes.push(`Memory Store — ${db_changes.memories_added.length} memory notes written`);

      // Cron triggers
      const cronTriggers: string[] = [];
      if (evt.event_type === 'life_advance') cronTriggers.push('pg_cron: advance-persona-life (every 3h, max 3 personas)');
      if (evt.event_type === 'scenario')     cronTriggers.push('Manual: Admin scenario injection via admin panel');
      if (evt.event_type === 'spawn')        cronTriggers.push('Manual: Admin spawn trigger via admin panel');

      return {
        event_id:      evt.id,
        event_type:    evt.event_type,
        timestamp:     evt.created_at,
        summary:       evt.summary,
        narrative:     (det.event_narrative as string | undefined) ?? null,
        model_used:    evt.model_used,
        tokens_used:   evt.tokens_used ?? 0,
        cost_usd:      Math.round(Number(evt.cost_usd ?? 0) * 100000) / 100000,
        cron_triggers: cronTriggers,
        ai_calls:      aiCallsInWindow,
        silent_nodes:  silentNodes,
        exchanges,
        db_changes,
        events_applied: (det.events_applied as number | undefined) ?? 0,
      };
    });

    // ── UX Journey from conversation intents ──────────────────────────────────
    const uxJourney: string[] = [];
    const txsByDay = new Map<string, string[]>();
    for (const c of convRows.filter(c => c.role === 'user' && c.intent)) {
      const day = new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!txsByDay.has(day)) txsByDay.set(day, []);
      const screen = (c.intent && INTENT_SCREEN[c.intent]) ? INTENT_SCREEN[c.intent] : c.intent ?? 'Roger chat';
      const current = txsByDay.get(day)!;
      if (!current.includes(screen)) current.push(screen);
    }
    for (const [day, screens] of txsByDay) {
      uxJourney.push(`${day}: ${screens.join(' → ')}`);
    }

    // Memory highlights
    const memHighlights = factsRows.slice(0, 5).map(f => `${f.subject} ${f.predicate} ${f.object} (${f.confidence}%)`);

    // ── GPT executive summary ─────────────────────────────────────────────────
    const start = Date.now();
    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 600,
        messages: [
          { role: 'system', content: 'You are a research analyst studying AI user persona data for the RogerAI platform. Write a clear, insightful executive summary. Plain text, no markdown.' },
          { role: 'user', content: `Analyze this AI persona and write a 3-paragraph executive summary:

PERSONA: ${identity.name} (${identity.archetype})
${identity.nationality} · ${identity.city} · ${identity.profession}
Why Roger: ${identity.why_roger}
Lifespan: ${lifespanHours}h · ${eventsRows.length} life events

STATS:
- Memory facts: ${factsRows.length} · Memories: ${memoriesRows.length}
- Conv turns: ${convRows.length} · Exchanges: ${Math.floor(convRows.length / 2)}
- Tasks: ${tasksDone}/${tasksRows.length} done · Reminders: ${remindersDone}/${remindersRows.length} fired
- AI calls: ${totalCalls} · Total tokens: ${totalTokens} · Cost: $${totalCost.toFixed(4)}

TOP AI NODES: ${aiBreakdownList.slice(0, 4).map(a => `${a.node_name}(${a.calls}x,$${a.cost})`).join(', ')}
MEMORY: ${memHighlights.slice(0, 3).join(' | ')}

Para 1: Who this persona is and their relationship with Roger AI
Para 2: How they use Roger (patterns, features, interactions)
Para 3: Memory growth, engagement health, and behavioral insights` },
        ],
      }),
    });
    const gptData = await gptRes.json() as { choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const narrative = gptData.choices?.[0]?.message?.content ?? 'Summary unavailable.';
    const pt = gptData.usage?.prompt_tokens ?? 0;
    const ct = gptData.usage?.completion_tokens ?? 0;
    const synthCost    = (pt / 1000) * 0.005 + (ct / 1000) * 0.015;
    const synthLatency = Date.now() - start;

    await trackUsage({ functionName: 'persona-report', model: 'gpt-4o', userId: uid,
      promptTokens: pt, completionTokens: ct, totalTokens: pt + ct, latencyMs: synthLatency, success: true });

    // ── Build final report ────────────────────────────────────────────────────
    const { data: cs } = await db.from('user_callsigns').select('callsign').eq('user_id', uid).maybeSingle();

    const report = {
      version:      reportVersion,
      generated_at: new Date().toISOString(),
      persona: {
        name:        identity.name,
        archetype:   identity.archetype,
        age:         identity.age,
        nationality: identity.nationality,
        city:        identity.city,
        profession:  identity.profession,
        why_roger:   identity.why_roger,
        language:    profile.language,
        roger_mode:  profile.roger_mode,
        islamic_mode: profile.islamic_mode,
        callsign:    cs?.callsign ?? null,
        spawned_at:  spawnedAt.toISOString(),
      },
      executive_summary: narrative,
      stats: {
        lifespan_hours:      lifespanHours,
        life_events:         eventsRows.length,
        total_facts:         factsRows.length,
        total_memories:      memoriesRows.length,
        total_conversations: convRows.length,
        tasks_done:          tasksDone,
        tasks_open:          tasksRows.length - tasksDone,
        tasks_total:         tasksRows.length,
        reminders_fired:     remindersDone,
        reminders_pending:   remindersRows.length - remindersDone,
        reminders_total:     remindersRows.length,
        total_ai_calls:      totalCalls,
        total_tokens:        totalTokens,
        total_cost_usd:      Math.round(totalCost * 10000) / 10000,
      },
      ai_breakdown:   aiBreakdownList,
      memory_highlights: memHighlights,
      ux_journey:     uxJourney,
      top_entities:   Array.isArray(entities) ? (entities as { entity_text: string; entity_type: string; mention_count: number }[]).slice(0, 8) : [],
      trace_log:      traceLog,  // ← Full per-event trace
      report_meta: {
        synthesis_tokens:    pt + ct,
        synthesis_cost_usd:  Math.round(synthCost * 10000) / 10000,
        synthesis_latency_ms: synthLatency,
      },
    };

    await db.from('ai_persona_events').insert({
      user_id:     uid,
      event_type:  'report',
      summary:     `Report v${reportVersion} — ${eventsRows.length} events traced, ${convRows.length} turns, $${report.stats.total_cost_usd} total cost`,
      report_data: report,
      model_used:  'gpt-4o',
      tokens_used: pt + ct,
      cost_usd:    synthCost,
    });

    return new Response(JSON.stringify({ ok: true, report, version: reportVersion }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
