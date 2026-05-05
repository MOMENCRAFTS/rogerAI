// supabase/functions/advance-persona-life/index.ts
// Advances AI persona lifespans: generates realistic life events using GPT.
// Called by pg_cron every 3 hours (max 3 personas per tick, staggered).
// Also called manually: { userId, scenario? } for single-persona advance.
// Model: gpt-4o-mini for random advances, gpt-5.5 for scenario injections.
// Deploy: supabase functions deploy advance-persona-life --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { trackUsage } from '../_shared/tokenTracker.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!;
const OPENAI_API_KEY    = Deno.env.get('OPENAI_API_KEY')!;
const ADMIN_EMAILS      = (Deno.env.get('ADMIN_EMAILS') ?? '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

const MAX_PERSONAS_PER_TICK = 3;

// ── Time-of-day buckets ───────────────────────────────────────────────────────
function timeOfDay(): string {
  const h = new Date().getUTCHours();
  if (h >= 4 && h < 9)  return 'morning';
  if (h >= 9 && h < 13) return 'commute_and_work';
  if (h >= 13 && h < 18) return 'afternoon_work';
  return 'evening';
}

// ── GPT call ──────────────────────────────────────────────────────────────────
async function gpt(
  model: 'gpt-4o' | 'gpt-4o-mini',
  system: string,
  user: string,
  userId: string,
): Promise<{ text: string; tokens: number; cost: number; latency: number }> {
  const start = Date.now();
  const costRates = model === 'gpt-4o'
    ? { input: 0.005, output: 0.015 }
    : { input: 0.00015, output: 0.0006 };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      max_tokens: 2000,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
    }),
  });

  const data = await res.json() as { choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const text = data.choices?.[0]?.message?.content ?? '{}';
  const pt   = data.usage?.prompt_tokens ?? 0;
  const ct   = data.usage?.completion_tokens ?? 0;
  const cost = (pt / 1000) * costRates.input + (ct / 1000) * costRates.output;
  const latency = Date.now() - start;

  await trackUsage({ functionName: 'advance-persona-life', model, userId,
    promptTokens: pt, completionTokens: ct, totalTokens: pt + ct, latencyMs: latency, success: true });

  return { text, tokens: pt + ct, cost, latency };
}

// ── Supabase REST helper ──────────────────────────────────────────────────────
async function sb(path: string, method = 'GET', body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' || method === 'PATCH' ? 'return=minimal' : '',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  if (res.status === 204) return null;
  return res.json();
}

// ── Advance a single persona ───────────────────────────────────────────────────
async function advancePersona(
  userId: string,
  identity: Record<string, unknown>,
  scenario: string | null,
): Promise<{ summary: string; detail: Record<string, unknown>; tokens: number; cost: number }> {

  const tod = timeOfDay();
  const model: 'gpt-4o' | 'gpt-4o-mini' = scenario ? 'gpt-4o' : 'gpt-4o-mini';

  // Gather current state
  const [convRows, taskRows, reminderRows, factCount] = await Promise.all([
    sb(`conversation_history?user_id=eq.${userId}&order=created_at.desc&limit=5&select=role,content,created_at`),
    sb(`tasks?user_id=eq.${userId}&status=eq.open&order=priority.desc&limit=8&select=text,priority,id`),
    sb(`reminders?user_id=eq.${userId}&status=eq.pending&order=due_at.asc&limit=5&select=text,due_at,id`),
    sb(`memory_graph?user_id=eq.${userId}&select=id&limit=1`),
  ]);

  const recentConv = Array.isArray(convRows)
    ? [...convRows].reverse().map((c: { role: string; content: string }) => `[${c.role}]: ${c.content.slice(0, 100)}`).join('\n')
    : 'none';
  const openTasks = Array.isArray(taskRows)
    ? taskRows.map((t: { text: string; priority: number }) => `• [P${t.priority}] ${t.text}`).join('\n')
    : 'none';
  const pendingReminders = Array.isArray(reminderRows)
    ? reminderRows.map((r: { text: string; due_at: string }) => `• ${r.text} (due ${new Date(r.due_at).toLocaleDateString()})`).join('\n')
    : 'none';

  const name       = String(identity.name ?? 'User');
  const archetype  = String(identity.archetype ?? 'professional');
  const profession = String(identity.profession ?? '');
  const rhythm     = (identity.daily_rhythm as Record<string, string>) ?? {};
  const rhythmNote = rhythm[tod] ?? 'Typical daily routine';
  const factsCount = Array.isArray(factCount) ? factCount.length : '?';

  const systemPrompt = `You are a life event simulator for a RogerAI AI persona.
Generate a realistic, single life event for this persona that feels natural for the time of day.
The event should involve Roger AI — the persona speaks to Roger about something in their life.
Respond ONLY in valid JSON.`;

  const userPrompt = scenario
    ? `Persona: ${name} (${archetype}) — ${profession}
Inject this specific scenario into their life: "${scenario}"
Generate how ${name} would experience this and interact with Roger about it.

Open tasks:\n${openTasks}
Pending reminders:\n${pendingReminders}
Recent conversation:\n${recentConv}

Return JSON:
{
  "event_narrative": "1-2 sentence description of what happened",
  "new_memories": [{ "type": "note|observation|capture", "text": "...", "tags": ["..."] }],
  "new_facts": [{ "fact_type": "person|project|habit|goal|company|location|relationship|preference", "subject": "...", "predicate": "...", "object": "...", "confidence": 85 }],
  "complete_task_texts": ["exact text of tasks to mark done"],
  "new_tasks": [{ "text": "...", "priority": 7 }],
  "trigger_reminder_texts": ["exact text of reminders to mark done"],
  "new_conversation": [
    { "role": "user", "content": "Roger, ...", "intent": "INTENT_NAME" },
    { "role": "assistant", "content": "...", "intent": null }
  ]
}`
    : `Persona: ${name} (${archetype}) — ${profession}
Current time of day: ${tod} — ${rhythmNote}
Memory facts in graph: ${factsCount}

Open tasks:\n${openTasks}
Pending reminders:\n${pendingReminders}
Recent conversation:\n${recentConv}

Generate ONE realistic life event appropriate for ${tod}.
This should feel like something ${name} would naturally do and talk to Roger about.

Return JSON:
{
  "event_narrative": "1-2 sentence description of what happened",
  "new_memories": [{ "type": "note|observation|capture", "text": "...", "tags": ["..."] }],
  "new_facts": [{ "fact_type": "person|project|habit|goal|company|location|relationship|preference", "subject": "...", "predicate": "...", "object": "...", "confidence": 82 }],
  "complete_task_texts": ["exact text of tasks to mark done (only if naturally completed)"],
  "new_tasks": [{ "text": "...", "priority": 6 }],
  "trigger_reminder_texts": ["exact text of reminders now done"],
  "new_conversation": [
    { "role": "user", "content": "Roger, ...", "intent": "INTENT_NAME" },
    { "role": "assistant", "content": "...", "intent": null }
  ]
}`;

  const { text, tokens, cost } = await gpt(model, systemPrompt, userPrompt, userId);
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(text);
  } catch {
    console.error('[advance-persona-life] JSON parse failed. Raw text:', text.slice(0, 500));
    event = { event_narrative: `Life event (parse error — ${text.slice(0, 80)})`, new_memories: [], new_facts: [], complete_task_texts: [], new_tasks: [], trigger_reminder_texts: [], new_conversation: [] };
  }

  const now       = new Date();
  const sessionId = `sim-${crypto.randomUUID().slice(0, 8)}`;
  let eventsApplied = 0;

  // Apply new memories
  const newMems = (event.new_memories as Record<string, unknown>[]) ?? [];
  if (newMems.length > 0) {
    await sb('memories', 'POST', newMems.map(m => ({
      user_id: userId, type: String(m.type ?? 'note'), text: String(m.text ?? ''), tags: Array.isArray(m.tags) ? m.tags : [], is_admin_test: true,
    })));
    eventsApplied += newMems.length;
  }

  // Apply new memory graph facts
  const newFacts = (event.new_facts as Record<string, unknown>[]) ?? [];
  if (newFacts.length > 0) {
    await sb('memory_graph', 'POST', newFacts.map(f => ({
      user_id: userId, fact_type: String(f.fact_type ?? 'person'), subject: String(f.subject ?? ''),
      predicate: String(f.predicate ?? ''), object: String(f.object ?? ''),
      confidence: Number(f.confidence ?? 80), is_draft: false, source_tx: 'advance-persona-life',
    })));
    eventsApplied += newFacts.length;
  }

  // Complete tasks
  const completedTaskTexts = (event.complete_task_texts as string[]) ?? [];
  if (completedTaskTexts.length > 0 && Array.isArray(taskRows)) {
    for (const text of completedTaskTexts) {
      const match = (taskRows as { text: string; id: string }[]).find(t => t.text === text || t.text.toLowerCase().includes(text.toLowerCase().slice(0, 20)));
      if (match) {
        await sb(`tasks?id=eq.${match.id}`, 'PATCH', { status: 'done', updated_at: now.toISOString() });
        eventsApplied++;
      }
    }
  }

  // New tasks
  const newTasks = (event.new_tasks as Record<string, unknown>[]) ?? [];
  if (newTasks.length > 0) {
    await sb('tasks', 'POST', newTasks.map(t => ({
      user_id: userId, text: String(t.text ?? ''), priority: Number(t.priority ?? 5), status: 'open', is_admin_test: true,
    })));
    eventsApplied += newTasks.length;
  }

  // Trigger reminders
  const triggerRems = (event.trigger_reminder_texts as string[]) ?? [];
  if (triggerRems.length > 0 && Array.isArray(reminderRows)) {
    for (const text of triggerRems) {
      const match = (reminderRows as { text: string; id: string }[]).find(r => r.text === text || r.text.toLowerCase().includes(text.toLowerCase().slice(0, 20)));
      if (match) {
        await sb(`reminders?id=eq.${match.id}`, 'PATCH', { status: 'done', updated_at: now.toISOString() });
        eventsApplied++;
      }
    }
  }

  // New conversation turns
  const newConv = (event.new_conversation as Record<string, unknown>[]) ?? [];
  if (newConv.length > 0) {
    await sb('conversation_history', 'POST', newConv.map((c, i) => ({
      user_id: userId, session_id: sessionId, role: String(c.role ?? 'user'), content: String(c.content ?? ''),
      intent: c.role === 'user' ? String((c as Record<string, unknown>).intent ?? '') : null,
      is_admin_test: true,
      created_at: new Date(now.getTime() - (newConv.length - i) * 30000).toISOString(),
    })));
    eventsApplied += newConv.length;
  }

  // Update last_advanced_at
  await sb(`user_preferences?user_id=eq.${userId}`, 'PATCH', {
    last_advanced_at: now.toISOString(), updated_at: now.toISOString(),
  });

  const summary = [
    newMems.length > 0      ? `+${newMems.length} memor${newMems.length === 1 ? 'y' : 'ies'}` : null,
    newFacts.length > 0     ? `+${newFacts.length} fact${newFacts.length === 1 ? '' : 's'}` : null,
    completedTaskTexts.length > 0 ? `✓ ${completedTaskTexts.length} task${completedTaskTexts.length === 1 ? '' : 's'} done` : null,
    newTasks.length > 0     ? `+${newTasks.length} new task${newTasks.length === 1 ? '' : 's'}` : null,
    triggerRems.length > 0  ? `✓ ${triggerRems.length} reminder${triggerRems.length === 1 ? '' : 's'} fired` : null,
    newConv.length > 0      ? `+${newConv.length} conv turn${newConv.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ') || 'No changes';

  return {
    summary,
    detail: {
      event_narrative: event.event_narrative,
      new_memories:    newMems.map(m => m.text),
      new_facts:       newFacts.map(f => `${f.subject} ${f.predicate} ${f.object}`),
      completed_tasks: completedTaskTexts,
      new_tasks:       newTasks.map(t => t.text),
      new_conv_preview: newConv.length > 0 ? String((newConv[0] as Record<string, unknown>).content ?? '') : null,
      events_applied:  eventsApplied,
      model_used:      model,
    },
    tokens,
    cost,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // Determine if this is a manual call (with auth) or a cron call (service key)
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '').trim();
    let isCron = false;
    let manualUserId: string | null = null;
    let manualScenario: string | null = null;

    if (token === SERVICE_ROLE_KEY) {
      isCron = true;
    } else if (token) {
      // Manual call from admin panel — verify JWT
      const anonClient = createClient(SUPABASE_URL, ANON_KEY);
      const { data: { user }, error } = await anonClient.auth.getUser(token);
      if (error || !user?.email) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
      if (ADMIN_EMAILS.length > 0 && !ADMIN_EMAILS.includes(user.email.toLowerCase()))
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

      let body: { userId?: string; scenario?: string } = {};
      try { body = await req.json(); } catch { /* ok */ }
      manualUserId = body.userId ?? null;
      manualScenario = body.scenario ?? null;
    }

    // ── Manual single-persona advance ─────────────────────────────────────────
    if (!isCron && manualUserId) {
      const { data: prefs } = await db.from('user_preferences')
        .select('ai_persona_identity, is_ai_persona')
        .eq('user_id', manualUserId)
        .maybeSingle();

      if (!prefs?.is_ai_persona) return new Response(JSON.stringify({ error: 'Not an AI persona' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

      const result = await advancePersona(manualUserId, (prefs.ai_persona_identity as Record<string, unknown>) ?? {}, manualScenario);

      await db.from('ai_persona_events').insert({
        user_id:    manualUserId,
        event_type: manualScenario ? 'scenario' : 'manual_advance',
        summary:    result.summary,
        detail:     result.detail,
        model_used: manualScenario ? 'gpt-4o' : 'gpt-4o-mini',
        tokens_used: result.tokens,
        cost_usd:    result.cost,
      });

      return new Response(JSON.stringify({
        ok: true,
        summary:       result.summary,
        detail:        result.detail,
        tokens:        result.tokens,
        cost_usd:      result.cost,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── Batch cron advance (max 3 personas, round-robin) ──────────────────────
    const { data: personas } = await db.from('user_preferences')
      .select('user_id, ai_persona_identity, display_name')
      .eq('is_ai_persona', true)
      .order('last_advanced_at', { ascending: true, nullsFirst: true })
      .limit(MAX_PERSONAS_PER_TICK);

    if (!personas || personas.length === 0) {
      return new Response(JSON.stringify({ ok: true, advanced: 0, reason: 'no ai personas' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    let advanced = 0;
    for (const p of personas as { user_id: string; ai_persona_identity: Record<string, unknown>; display_name: string }[]) {
      try {
        const result = await advancePersona(p.user_id, p.ai_persona_identity ?? {}, null);
        await db.from('ai_persona_events').insert({
          user_id:     p.user_id,
          event_type:  'life_advance',
          summary:     result.summary,
          detail:      result.detail,
          model_used:  'gpt-4o-mini',
          tokens_used: result.tokens,
          cost_usd:    result.cost,
        });
        advanced++;
      } catch (err) {
        console.error(`[advance-persona-life] Error for ${p.user_id}:`, err);
      }
    }

    return new Response(JSON.stringify({ ok: true, advanced, total: personas.length }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
