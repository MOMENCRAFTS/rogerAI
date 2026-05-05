// supabase/functions/simulate-persona-session/index.ts
//
// UserAI ↔ RogerAI — Reactive Multi-Turn Simulation Engine
//
// 4-Node Pipeline:
//   Node 1: PLANNER      — GPT-4o-mini decides 3-5 engagement topics
//   Node 2: FIRE_PTT     — calls real process-transmission (full pipeline)
//   Node 3: USERAI_REACT — GPT-4o-mini reads Roger's response, decides next action
//   Node 4: COMMIT       — stores full trace to ai_persona_events
//
// Deploy: supabase functions deploy simulate-persona-session --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { trackUsage } from '../_shared/tokenTracker.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;
const OPENAI_API_KEY   = Deno.env.get('OPENAI_API_KEY')!;
const ADMIN_EMAILS     = (Deno.env.get('ADMIN_EMAILS') ?? '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

// ── Types ──────────────────────────────────────────────────────────────────────

interface Engagement {
  topic:            string;   // what this engagement is about
  opener:           string;   // first utterance UserAI says
  goal:             string;   // what UserAI wants to achieve
}

type UserAIAction = 'continue' | 'accept' | 'next';

interface UserAIDecision {
  action:          UserAIAction;
  next_utterance?: string;   // if action = 'continue'
  reasoning:       string;
}

interface TurnRecord {
  engagement:      number;
  turn:            number;
  utterance:       string;
  roger_response:  string;
  intent:          string;
  confidence:      number;
  outcome:         string;
  proposed_tasks:  { text: string; priority: number }[];
  userai_action:   UserAIAction;
  userai_reasoning:string;
  latency_ms:      number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function gptMini(system: string, user: string, maxTokens = 600): Promise<{ text: string; pt: number; ct: number }> {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
      temperature: 0.85,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  const d = await r.json() as { choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  return {
    text: d.choices?.[0]?.message?.content ?? '{}',
    pt:   d.usage?.prompt_tokens ?? 0,
    ct:   d.usage?.completion_tokens ?? 0,
  };
}

async function callProcessTransmission(payload: {
  transcript:    string;
  history:       { role: string; content: string }[];
  userId:        string;
  memoryContext: string;
  langHint:      string;
}): Promise<{
  intent:         string;
  confidence:     number;
  outcome:        string;
  roger_response: string;
  proposed_tasks?: { text: string; priority: number }[];
}> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/process-transmission`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`PTT ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sb(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
  });
  if (!res.ok) return [];
  if (res.status === 204) return [];
  return res.json();
}

// ── Node 1: PLANNER ────────────────────────────────────────────────────────────
// GPT-4o-mini decides what this persona wants to accomplish in this session.
// Returns 3-5 engagement topics, each with an opener and a goal.

async function planSession(identity: Record<string, unknown>, prefs: Record<string, unknown>, memoryContext: string, openTasks: { text: string }[], pendingReminders: { text: string }[], scenario: string | null, numEngagements: number): Promise<{ engagements: Engagement[]; pt: number; ct: number }> {
  const now    = new Date();
  const hour   = now.getHours();
  const period = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const dow    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
  const rhythm = (identity.daily_rhythm as Record<string,string>) ?? {};
  const lang   = (prefs.language as string) ?? 'en';

  const system = `You are a simulation planner for a realistic AI persona test.
Your job is to decide what ${identity.name} would want to accomplish in a Roger AI session right now.
Roger AI is a voice assistant (PTT) that handles tasks, reminders, memory capture, briefings, and queries.
Return JSON: { "engagements": [ { "topic": "...", "opener": "...", "goal": "..." }, ... ] }
Rules:
- Each "opener" is the FIRST thing ${identity.name} says to Roger (natural, spoken, under 20 words)
- Each "goal" describes what ${identity.name} wants Roger to do (used later for reaction logic)
- Mix types: task management, reminders, memory capture, information queries, casual updates
- Make openers realistic — how a ${identity.profession} from ${identity.city} actually speaks
- If a scenario is given, make at least one engagement address it directly
${lang !== 'en' ? `- Write openers in ${lang === 'ar' ? 'Arabic' : lang}` : ''}`;

  const user = `PERSONA: ${identity.name} (${identity.archetype}), ${identity.profession}, ${identity.city}, ${identity.nationality}
TIME: ${period} on ${dow}
TYPICAL ${period.toUpperCase()}: ${rhythm[period] ?? 'regular work'}
OPEN TASKS (${openTasks.length}): ${openTasks.slice(0,5).map(t => t.text).join(' | ') || 'none'}
PENDING REMINDERS: ${pendingReminders.slice(0,4).map(r => r.text).join(' | ') || 'none'}
${memoryContext ? `WHAT ROGER KNOWS: ${memoryContext.split('\n').slice(1,5).join(', ')}` : ''}
${scenario ? `SCENARIO: ${scenario}` : ''}

Plan exactly ${numEngagements} realistic engagement topics for this session.`;

  const { text, pt, ct } = await gptMini(system, user, 800);
  try {
    const parsed = JSON.parse(text) as { engagements?: Engagement[] };
    return { engagements: (parsed.engagements ?? []).slice(0, numEngagements), pt, ct };
  } catch {
    // Fallback single engagement
    return {
      engagements: [{ topic: 'morning briefing', opener: `Roger, give me a quick briefing`, goal: 'Get morning update' }],
      pt, ct,
    };
  }
}

// ── Node 3: USERAI_REACT ───────────────────────────────────────────────────────
// GPT-4o-mini plays the persona and decides what to do after reading Roger's response.
// Returns: continue (with next utterance) | accept | next

async function userAiReact(
  identity:        Record<string, unknown>,
  prefs:           Record<string, unknown>,
  engagement:      Engagement,
  turnCount:       number,
  maxTurns:        number,
  rogerResponse:   string,
  outcome:         string,
  convHistory:     { role: string; content: string }[],
): Promise<{ decision: UserAIDecision; pt: number; ct: number }> {
  const lang = (prefs.language as string) ?? 'en';

  const system = `You are ${identity.name}, a ${identity.profession} from ${identity.city}.
You are having a real voice conversation with Roger AI, your AI Chief of Staff.
You just heard Roger's response. Decide what to do next.

Return JSON:
{
  "action": "continue" | "accept" | "next",
  "next_utterance": "...",   (ONLY if action=continue — what you say next, natural speech, under 20 words)
  "reasoning": "..."         (1 sentence explaining your decision)
}

DECISION RULES:
- "continue": Roger asked you a clarification question → you answer it
- "continue": Roger gave a partial answer and your goal is NOT fully met
- "continue": Roger's response triggers a natural, direct follow-up question  
- "continue": Roger said he needs more info → provide it
- "accept":   Roger confirmed the action or gave a complete answer — goal met
- "accept":   Simple acknowledgement is all that's needed (Roger said "Done", "Noted", etc.)
- "next":     This topic is fully exhausted — nothing more to add
- "next":     You are on turn ${turnCount}/${maxTurns} — MUST use "next" if turn >= max
- NEVER "continue" for pure confirmations like "Done. Over." or "Noted. Over."
${lang !== 'en' ? `- Write next_utterance in ${lang === 'ar' ? 'Arabic' : lang}` : ''}`;

  const historyText = convHistory.slice(-6).map(h => `${h.role === 'user' ? identity.name : 'Roger'}: ${h.content}`).join('\n');

  const user = `YOUR GOAL THIS ENGAGEMENT: "${engagement.goal}"
YOUR ORIGINAL REQUEST: "${engagement.opener}"
TURN: ${turnCount}/${maxTurns}${turnCount >= maxTurns ? ' — YOU MUST USE action: "next"' : ''}

ROGER JUST SAID: "${rogerResponse}"
OUTCOME TAG: ${outcome}

RECENT CONVERSATION:
${historyText}

What do you do next?`;

  const { text, pt, ct } = await gptMini(system, user, 200);
  try {
    const parsed = JSON.parse(text) as Partial<UserAIDecision>;
    // Force 'next' if at max turns
    if (turnCount >= maxTurns) {
      return { decision: { action: 'next', reasoning: 'Max turns reached — moving on.', next_utterance: undefined }, pt, ct };
    }
    return {
      decision: {
        action:          (parsed.action as UserAIAction) ?? 'accept',
        next_utterance:  parsed.next_utterance,
        reasoning:       parsed.reasoning ?? '',
      },
      pt, ct,
    };
  } catch {
    return { decision: { action: 'accept', reasoning: 'Parse error — defaulting to accept.' }, pt, ct };
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Admin-only auth gate
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  const anonClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !user?.email) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!ADMIN_EMAILS.length || !ADMIN_EMAILS.includes(user.email.toLowerCase()))
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json() as { userId: string; scenario?: string; turns?: number; engagements?: number };
    if (!body.userId) return new Response(JSON.stringify({ error: 'userId required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const uid           = body.userId;
    const scenario      = body.scenario?.trim() || null;
    const maxTurns      = Math.min(body.turns ?? 5, 5);
    const numEngagements= Math.min(body.engagements ?? 3, 5);

    // ── Load persona state ─────────────────────────────────────────────────────
    const [prefsArr, factsArr, tasksArr, remindersArr, recentConvArr] = await Promise.all([
      sb(`user_preferences?user_id=eq.${uid}&select=*`),
      sb(`memory_graph?user_id=eq.${uid}&select=subject,predicate,object,confidence,is_draft&order=confidence.desc&limit=20`),
      sb(`tasks?user_id=eq.${uid}&status=eq.open&select=text,priority&order=priority.desc&limit=10`),
      sb(`reminders?user_id=eq.${uid}&status=eq.pending&select=text,due_at&order=due_at.asc&limit=8`),
      sb(`conversation_history?user_id=eq.${uid}&select=role,content,intent,created_at&order=created_at.desc&limit=10`),
    ]);

    const prefs = Array.isArray(prefsArr) ? prefsArr[0] : null;
    if (!prefs?.is_ai_persona) return new Response(JSON.stringify({ error: 'Not an AI persona' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const identity        = (prefs.ai_persona_identity as Record<string, unknown>) ?? {};
    const lang            = (prefs.language as string) ?? 'en';
    const confirmedFacts  = (Array.isArray(factsArr) ? factsArr : []) as { subject: string; predicate: string; object: string; confidence: number; is_draft: boolean }[];
    const openTasks       = (Array.isArray(tasksArr) ? tasksArr : []) as { text: string; priority: number }[];
    const pendingReminders= (Array.isArray(remindersArr) ? remindersArr : []) as { text: string; due_at: string }[];
    const recentConv      = (Array.isArray(recentConvArr) ? [...recentConvArr].reverse() : []) as { role: string; content: string }[];

    const memoryContext = confirmedFacts.filter(f => !f.is_draft && f.confidence >= 65).length > 0
      ? '=== ROGER KNOWS ===\n' + confirmedFacts.filter(f => !f.is_draft && f.confidence >= 65)
          .map(f => `${f.subject} ${f.predicate} ${f.object}`).join('\n')
      : '';
    const langHint = lang !== 'en' ? `Language: ${lang}. ` : '';
    const sessionId = `sim-userai-${crypto.randomUUID().slice(0, 8)}`;

    // ── Token tracking ─────────────────────────────────────────────────────────
    let totalPt = 0, totalCt = 0;

    // ── Node 1: PLANNER ────────────────────────────────────────────────────────
    const planStart = Date.now();
    const { engagements, pt: planPt, ct: planCt } = await planSession(
      identity, prefs, memoryContext, openTasks, pendingReminders, scenario, numEngagements
    );
    totalPt += planPt; totalCt += planCt;

    await trackUsage({
      functionName: 'simulate-persona-session/planner',
      model: 'gpt-4o-mini', userId: uid,
      promptTokens: planPt, completionTokens: planCt, totalTokens: planPt + planCt,
      latencyMs: Date.now() - planStart, success: true,
    });

    // ── Node 2+3 Loop: FIRE_PTT + USERAI_REACT per engagement ─────────────────
    const allTurns: TurnRecord[] = [];
    const sessionHistory: { role: string; content: string }[] = [...recentConv.slice(-6)];

    for (let eIdx = 0; eIdx < engagements.length; eIdx++) {
      const engagement = engagements[eIdx];
      let utterance    = engagement.opener;
      let turnCount    = 0;

      while (turnCount < maxTurns) {
        turnCount++;
        const turnStart = Date.now();

        // Node 2: FIRE_PTT — real process-transmission
        let pttResult: Awaited<ReturnType<typeof callProcessTransmission>>;
        try {
          pttResult = await callProcessTransmission({
            transcript:    utterance,
            history:       sessionHistory.slice(-8),
            userId:        uid,
            memoryContext,
            langHint,
          });
        } catch (e) {
          pttResult = { intent: 'ERROR', confidence: 0, outcome: 'error', roger_response: 'Internal error.', proposed_tasks: [] };
        }

        // Persist to conversation_history
        const ts = new Date();
        await Promise.allSettled([
          db.from('conversation_history').insert({
            user_id: uid, session_id: sessionId, role: 'user',
            content: utterance, intent: pttResult.intent ?? null,
            created_at: ts.toISOString(),
          }),
          db.from('conversation_history').insert({
            user_id: uid, session_id: sessionId, role: 'assistant',
            content: pttResult.roger_response ?? '',
            created_at: new Date(ts.getTime() + 1).toISOString(),
          }),
        ]);

        // Persist proposed tasks
        for (const task of (pttResult.proposed_tasks ?? [])) {
          await db.from('tasks').insert({ user_id: uid, text: task.text, priority: task.priority ?? 5, status: 'open' })
            .then(() => {}, () => {});
        }

        // Update rolling history
        sessionHistory.push({ role: 'user',      content: utterance });
        sessionHistory.push({ role: 'assistant',  content: pttResult.roger_response ?? '' });

        // Node 3: USERAI_REACT
        const reactStart = Date.now();
        const { decision, pt: rxPt, ct: rxCt } = await userAiReact(
          identity, prefs, engagement, turnCount, maxTurns,
          pttResult.roger_response ?? '', pttResult.outcome ?? '',
          sessionHistory.slice(-8),
        );
        totalPt += rxPt; totalCt += rxCt;

        await trackUsage({
          functionName: 'simulate-persona-session/userai-react',
          model: 'gpt-4o-mini', userId: uid,
          promptTokens: rxPt, completionTokens: rxCt, totalTokens: rxPt + rxCt,
          latencyMs: Date.now() - reactStart, success: true,
        });

        allTurns.push({
          engagement:       eIdx + 1,
          turn:             turnCount,
          utterance,
          roger_response:   pttResult.roger_response ?? '',
          intent:           pttResult.intent ?? 'UNKNOWN',
          confidence:       pttResult.confidence ?? 0,
          outcome:          pttResult.outcome ?? 'unknown',
          proposed_tasks:   pttResult.proposed_tasks ?? [],
          userai_action:    decision.action,
          userai_reasoning: decision.reasoning,
          latency_ms:       Date.now() - turnStart,
        });

        // Decide loop continuation
        if (decision.action === 'continue' && decision.next_utterance && turnCount < maxTurns) {
          utterance = decision.next_utterance;
          await new Promise(r => setTimeout(r, 250)); // brief pause between turns
        } else {
          break; // accept or next → move to next engagement
        }
      }

      // Pause between engagements
      if (eIdx < engagements.length - 1) {
        await new Promise(r => setTimeout(r, 400));
      }
    }

    // ── Node 4: COMMIT session trace ───────────────────────────────────────────
    const totalLatency   = allTurns.reduce((s, t) => s + t.latency_ms, 0);
    const intentList     = allTurns.map(t => t.intent).join(', ');
    const continuedTurns = allTurns.filter(t => t.userai_action === 'continue').length;
    const summary        = `UserAI session: ${engagements.length} engagements · ${allTurns.length} total turns · ${continuedTurns} reactive turns · intents: ${intentList}`;

    await db.from('ai_persona_events').insert({
      user_id:    uid,
      event_type: 'ptt_session',
      summary,
      detail: {
        session_id:         sessionId,
        scenario:           scenario ?? null,
        engagements:        engagements.map((e, i) => ({
          ...e,
          turns: allTurns.filter(t => t.engagement === i + 1),
        })),
        all_turns:          allTurns,
        total_turns:        allTurns.length,
        reactive_turns:     continuedTurns,
        model_used:         'gpt-4o-mini (UserAI) + gpt-4o (Roger)',
        engine_version:     'userai-v1',
      },
      model_used:  'gpt-4o-mini',
      tokens_used: totalPt + totalCt,
      cost_usd:    ((totalPt / 1000) * 0.00015 + (totalCt / 1000) * 0.0006),
    });

    return new Response(JSON.stringify({
      ok:                true,
      session_id:        sessionId,
      engagements:       engagements.length,
      total_turns:       allTurns.length,
      reactive_turns:    continuedTurns,
      trace:             allTurns,
      engagement_plan:   engagements,
      summary,
      total_latency_ms:  totalLatency,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('[simulate-persona-session]', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
