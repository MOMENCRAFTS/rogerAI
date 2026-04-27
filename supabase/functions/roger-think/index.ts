// ─── Roger AI — Silent Thinking Engine ────────────────────────────────────────
// Cron-triggered edge function that reads the user's full knowledge base,
// reasons about it with GPT-5.5, and decides whether to proactively reach out.
//
// Flow:
//   pg_cron → this function → for each talkative user:
//     1. Read memories, tasks, reminders, history, academy, calendar
//     2. Ask GPT-5.5: "Should I reach out? About what?"
//     3. If yes → generate spoken message → log to roger_thoughts → push notify
//
// Deploy: supabase functions deploy roger-think --no-verify-jwt

import webpush from 'npm:web-push';
import { trackUsage } from '../_shared/tokenTracker.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY       = Deno.env.get('OPENAI_API_KEY')!;
const VAPID_PUBLIC_KEY     = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY    = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_EMAIL          = Deno.env.get('VAPID_EMAIL') ?? 'mailto:admin@rogerai.app';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ── Supabase REST helper (service role — bypasses RLS) ────────────────────────
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
  if (method === 'POST' || method === 'PATCH') return res.json();
  return res.json();
}

// ── Frequency config ──────────────────────────────────────────────────────────
const FREQUENCY_LIMITS: Record<string, { maxPerDay: number; cooldownMinutes: number }> = {
  thoughtful:  { maxPerDay: 3,  cooldownMinutes: 240 },  // every 4h, max 3/day
  active_talk: { maxPerDay: 6,  cooldownMinutes: 120 },  // every 2h, max 6/day
  always_on:   { maxPerDay: 72, cooldownMinutes: 20 },   // every 20min, no practical cap
};

// ── Simple hash for topic deduplication ───────────────────────────────────────
function topicHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return `t_${Math.abs(h).toString(36)}`;
}

// ── GPT call helper (with token tracking) ──────────────────────────────────
async function gpt(systemPrompt: string, userPrompt: string, json = false, userId?: string): Promise<string> {
  const start = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-5.5',
      temperature: 0.6,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  const data = await res.json() as { choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
  // Track usage
  await trackUsage({
    functionName: 'roger-think',
    model: 'gpt-5.5',
    userId: userId ?? null,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
    latencyMs: Date.now() - start,
    success: !!data.choices?.[0]?.message?.content,
  });
  return data.choices?.[0]?.message?.content ?? '';
}

// ── Process a single user ─────────────────────────────────────────────────────
async function processUser(userId: string, displayName: string, frequency: string, delivery: string): Promise<boolean> {
  const limits = FREQUENCY_LIMITS[frequency] ?? FREQUENCY_LIMITS.thoughtful;

  // ── Gate 1: Check cooldown (recent thoughts within cooldown window) ─────
  const cooldownSince = new Date(Date.now() - limits.cooldownMinutes * 60 * 1000).toISOString();
  const recentThoughts = await sb(
    `roger_thoughts?user_id=eq.${userId}&created_at=gte.${cooldownSince}&select=id`
  );
  if (Array.isArray(recentThoughts) && recentThoughts.length > 0) return false;

  // ── Gate 2: Check daily limit ──────────────────────────────────────────
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaysThoughts = await sb(
    `roger_thoughts?user_id=eq.${userId}&created_at=gte.${todayStart.toISOString()}&select=id`
  );
  if (Array.isArray(todaysThoughts) && todaysThoughts.length >= limits.maxPerDay) return false;

  // ── Gather full user context ───────────────────────────────────────────
  const [history, facts, reminders, tasks, surface, academyStreak, recentTopics] = await Promise.all([
    sb(`conversation_history?user_id=eq.${userId}&order=created_at.desc&limit=10&select=role,content,created_at`),
    sb(`memory_graph?user_id=eq.${userId}&order=confidence.desc&limit=15&select=subject,predicate,object,confidence`),
    sb(`reminders?user_id=eq.${userId}&status=eq.pending&order=due_at.asc&limit=8&select=text,due_at,due_location`),
    sb(`tasks?user_id=eq.${userId}&status=eq.open&order=priority.desc&limit=8&select=text,priority,due_at`),
    sb(`surface_queue?user_id=eq.${userId}&dismissed=eq.false&order=priority.desc&limit=5&select=content,type`),
    sb(`academy_streaks?user_id=eq.${userId}&select=current_streak,total_words,target_locale,accuracy_pct`),
    sb(`roger_thoughts?user_id=eq.${userId}&order=created_at.desc&limit=10&select=topic_hash,thought,created_at`),
  ]);

  // Format context strings
  const factLines = Array.isArray(facts)
    ? facts.map((f: { subject: string; predicate: string; object: string; confidence: number }) =>
        `${f.subject} ${f.predicate} ${f.object} (confidence: ${f.confidence})`
      ).join('\n')
    : 'none';

  const histLines = Array.isArray(history)
    ? [...history].reverse().map((h: { role: string; content: string; created_at: string }) =>
        `[${h.role} at ${new Date(h.created_at).toLocaleTimeString()}]: ${h.content.slice(0, 150)}`
      ).join('\n')
    : 'none';

  const remLines = Array.isArray(reminders)
    ? reminders.map((r: { text: string; due_at: string | null; due_location: string | null }) =>
        `• ${r.text}${r.due_at ? ` (due ${new Date(r.due_at).toLocaleDateString()})` : ''}${r.due_location ? ` [at ${r.due_location}]` : ''}`
      ).join('\n')
    : 'none';

  const taskLines = Array.isArray(tasks)
    ? tasks.map((t: { text: string; priority: number; due_at: string | null }) =>
        `• [P${t.priority}] ${t.text}${t.due_at ? ` (due ${new Date(t.due_at).toLocaleDateString()})` : ''}`
      ).join('\n')
    : 'none';

  const surfaceLines = Array.isArray(surface)
    ? surface.map((s: { content: string; type: string }) => `• [${s.type}] ${s.content}`).join('\n')
    : 'none';

  const streakData = Array.isArray(academyStreak) && academyStreak.length > 0
    ? academyStreak[0] as { current_streak: number; total_words: number; target_locale: string; accuracy_pct: number }
    : null;
  const academyLine = streakData
    ? `${streakData.current_streak}-day streak, ${streakData.total_words} words in ${streakData.target_locale}, ${Math.round(streakData.accuracy_pct)}% accuracy`
    : 'not enrolled';

  const previousTopicHashes = Array.isArray(recentTopics)
    ? (recentTopics as { topic_hash: string; thought: string }[]).map(t => t.topic_hash)
    : [];
  const previousTopicSummary = Array.isArray(recentTopics)
    ? (recentTopics as { thought: string; created_at: string }[])
        .slice(0, 5)
        .map(t => `• "${t.thought.slice(0, 80)}..." (${new Date(t.created_at).toLocaleTimeString()})`)
        .join('\n')
    : 'none';

  const now = new Date();
  const timeOfDay = now.getHours() < 12 ? 'morning' : now.getHours() < 17 ? 'afternoon' : 'evening';
  const dayOfWeek = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];

  // ── Step 1: Ask GPT — "Should I reach out?" ────────────────────────────
  const decisionPrompt = `You are Roger AI's inner monologue. You are thinking about ${displayName ?? 'the user'}.
It is ${timeOfDay} on ${dayOfWeek}, ${now.toLocaleDateString()}.

Your job: Review EVERYTHING below and decide if there is something genuinely valuable,
interesting, or helpful you should proactively tell them RIGHT NOW.

WHAT YOU KNOW ABOUT THEM:
${factLines}

THEIR RECENT CONVERSATION WITH YOU:
${histLines}

PENDING REMINDERS:
${remLines}

OPEN TASKS:
${taskLines}

SURFACE QUEUE:
${surfaceLines}

LANGUAGE ACADEMY:
${academyLine}

WHAT YOU ALREADY SAID TO THEM RECENTLY (DO NOT REPEAT):
${previousTopicSummary}

RULES:
- DO NOT reach out about something you already said recently (see above)
- DO NOT reach out if there is nothing genuinely useful to say
- DO reach out if: a deadline is approaching, a pattern is interesting, you noticed
  something in their data they might not realize, you have a helpful suggestion,
  or it's been a while and a warm check-in makes sense
- You are a trusted aide, not a nagging bot. Quality over quantity.
- Consider the time of day — morning is for planning, afternoon for check-ins, evening for reflection

Respond in JSON:
{
  "should_reach_out": true/false,
  "reason": "brief explanation of why",
  "topic": "1-3 word topic label for dedup",
  "tone": "warm|urgent|curious|encouraging|reflective"
}`;

  const decisionRaw = await gpt(
    'You are Roger AI\'s silent inner monologue. Think carefully. Respond in JSON only.',
    decisionPrompt,
    true,
    userId
  );

  let decision: { should_reach_out: boolean; reason: string; topic: string; tone: string };
  try {
    decision = JSON.parse(decisionRaw);
  } catch {
    return false;
  }

  if (!decision.should_reach_out) return false;

  // ── Dedup check: don't repeat same topic ───────────────────────────────
  const hash = topicHash(decision.topic);
  if (previousTopicHashes.includes(hash)) return false;

  // ── Step 2: Generate the spoken message ────────────────────────────────
  const messagePrompt = `You are Roger AI speaking to ${displayName ?? 'Commander'} via walkie-talkie.
You decided to reach out because: ${decision.reason}
Topic: ${decision.topic}
Tone: ${decision.tone}
Time: ${timeOfDay}, ${dayOfWeek}

USER CONTEXT (for reference):
- Facts: ${factLines.slice(0, 500)}
- Reminders: ${remLines.slice(0, 300)}
- Tasks: ${taskLines.slice(0, 300)}
- Academy: ${academyLine}

Generate a natural, spoken message (40-90 words). Be warm, personal, and genuinely helpful.
Start with a casual opener (NOT "Good morning/afternoon" every time — vary it).
End with "Over." or "Standing by. Over."
Plain text only, no markdown.`;

  const spokenMessage = await gpt(
    'You are Roger AI, a trusted AI aide speaking via walkie-talkie. Be warm, direct, and genuinely useful.',
    messagePrompt,
    false,
    userId
  );

  if (!spokenMessage || spokenMessage.length < 20) return false;

  // ── Step 3: Log to roger_thoughts ──────────────────────────────────────
  await sb('roger_thoughts', 'POST', {
    user_id:     userId,
    thought:     spokenMessage,
    topic_hash:  hash,
    trigger_ctx: `${decision.tone}: ${decision.reason}`,
    delivered:   false,
    snoozed:     false,
  });

  // ── Step 4: Send push notification ─────────────────────────────────────
  const subs = await sb(`push_subscriptions?user_id=eq.${userId}&select=endpoint,p256dh,auth`);
  if (Array.isArray(subs) && subs.length > 0) {
    for (const sub of subs as { endpoint: string; p256dh: string; auth: string }[]) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            title:    '🧠 Roger is thinking of you',
            body:     spokenMessage.slice(0, 180) + (spokenMessage.length > 180 ? '...' : ''),
            icon:     '/mascot.png',
            tag:      `think-${userId}-${hash}`,
            type:     'thinking',
            userId:   userId,
            delivery: delivery,
            thought:  spokenMessage,
          })
        );
      } catch (err) {
        // Clean up stale subscriptions (410 Gone)
        if ((err as { statusCode?: number }).statusCode === 410) {
          await fetch(
            `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${userId}&endpoint=eq.${encodeURIComponent(sub.endpoint)}`,
            {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY },
            }
          );
        }
      }
    }
  }

  return true;
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async () => {
  try {
    // Fetch all users with talkative mode enabled
    const users = await sb(
      `user_preferences?talkative_enabled=eq.true&select=user_id,display_name,talkative_frequency,talkative_delivery`
    );

    if (!Array.isArray(users) || users.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, reason: 'no talkative users' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let processed = 0;
    let reached = 0;

    for (const user of users as { user_id: string; display_name: string; talkative_frequency: string; talkative_delivery: string }[]) {
      processed++;
      try {
        const didReach = await processUser(
          user.user_id,
          user.display_name ?? 'Commander',
          user.talkative_frequency ?? 'thoughtful',
          user.talkative_delivery ?? 'ptt_pulse'
        );
        if (didReach) reached++;
      } catch (err) {
        console.error(`[roger-think] Error for user ${user.user_id}:`, err);
      }
    }

    return new Response(JSON.stringify({ ok: true, processed, reached }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[roger-think] Fatal error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});
