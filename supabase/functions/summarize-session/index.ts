// ─── Roger AI — Conversation Summarizer ──────────────────────────────────────
// Compresses long conversation sessions into structured summaries.
// Reduces token usage on subsequent context injection by ~60%.
//
// Triggered: After 10+ turns in a session OR when session goes idle for 30min.
// Deploy: supabase functions deploy summarize-session --no-verify-jwt

import { trackUsage } from '../_shared/tokenTracker.ts';

const OPENAI_API_KEY       = Deno.env.get('OPENAI_API_KEY') ?? '';
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUMMARY_PROMPT = `You are a conversation analyst. Summarize this conversation between a user and Roger AI (their AI aide).

Extract:
1. key_decisions: Important decisions made during the conversation
2. action_items: Tasks, reminders, or follow-ups created or discussed
3. topics_discussed: Main topics covered (2-5 labels)
4. unresolved_questions: Any questions left unanswered or pending
5. mood: Overall user mood during the session (one of: focused, casual, stressed, excited, neutral)
6. key_entities: Important people, places, projects mentioned

Return JSON:
{
  "key_decisions": ["decision 1", "decision 2"],
  "action_items": ["task 1", "task 2"],
  "topics_discussed": ["topic 1", "topic 2"],
  "unresolved_questions": ["question 1"],
  "mood": "focused",
  "key_entities": ["name 1", "project X"]
}

Be concise. Each item max 15 words. Capture what MATTERS, skip small talk.`;

async function sb(path: string, method = 'GET', body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { userId, sessionId, turns } = await req.json() as {
      userId: string;
      sessionId: string;
      turns: { role: string; content: string }[];
    };

    if (!userId || !turns?.length) {
      return new Response(JSON.stringify({ ok: false, error: 'userId and turns required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Format turns for GPT
    const turnsText = turns
      .map((t, i) => `[Turn ${i + 1} - ${t.role}]: ${t.content.slice(0, 300)}`)
      .join('\n');

    const start = Date.now();
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SUMMARY_PROMPT },
          { role: 'user', content: `Summarize this ${turns.length}-turn conversation:\n\n${turnsText}` },
        ],
      }),
    });

    const data = await res.json() as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    // Track usage
    await trackUsage({
      functionName: 'summarize-session',
      model: 'gpt-5.4-mini',
      userId,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
      latencyMs: Date.now() - start,
      success: true,
    });

    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const summary = JSON.parse(raw);

    // Store in conversation_summaries
    await sb('conversation_summaries', 'POST', {
      user_id: userId,
      session_id: sessionId ?? `session-${Date.now()}`,
      summary,
      turn_count: turns.length,
    });

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[summarize-session] Error:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
