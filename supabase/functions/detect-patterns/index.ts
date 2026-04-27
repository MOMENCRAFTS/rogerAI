// ─── Roger AI — Pattern Detector ─────────────────────────────────────────────
// Weekly cron-triggered edge function that analyzes user behavior patterns
// and generates actionable insights Roger can proactively share.
//
// Cron: Monday 9AM UTC (after weekly-digest)
// Deploy: supabase functions deploy detect-patterns --no-verify-jwt

import { trackUsage } from '../_shared/tokenTracker.ts';

const OPENAI_API_KEY       = Deno.env.get('OPENAI_API_KEY') ?? '';
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
  return (await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts)).json();
}

function topicHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return `pattern_${Math.abs(h).toString(36)}`;
}

const PATTERN_PROMPT = `You are Roger AI's behavioral analyst. You have been given one week of user activity data.

Your job: Find 1-3 genuinely useful patterns or insights the user might not have noticed.

GOOD PATTERNS:
- Task creation clustering (e.g., "You create 70% of your tasks on Monday mornings")
- Reminder response patterns (e.g., "You snooze location-based reminders 3x more than time-based ones")
- Communication patterns (e.g., "You message Ahmad most frequently — 12 times this week")
- Productivity patterns (e.g., "Your PTT usage peaks at 9-10 AM — that's your most engaged hour")
- Memory growth (e.g., "Your knowledge base grew by 23 facts this week, mostly about Project Atlas")
- Academy engagement (e.g., "Your accuracy dropped from 85% to 72% — might want a review session")
- Unresolved items (e.g., "3 tasks from last Monday are still open and approaching deadline")

BAD PATTERNS (don't generate these):
- Generic advice ("Stay organized!")
- Restating raw data ("You had 15 transmissions")
- Anything not backed by the actual data below

Return JSON:
{
  "patterns": [
    {
      "insight": "Concise insight (max 20 words)",
      "suggestion": "Actionable suggestion (max 30 words)",
      "tone": "curious" | "encouraging" | "warning" | "celebratory",
      "category": "productivity" | "communication" | "learning" | "health" | "planning"
    }
  ]
}

Return 1-3 patterns. If the data is insufficient, return { "patterns": [] }.`;

async function processUser(userId: string, displayName: string): Promise<number> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Gather week's data
  const [tasks, reminders, history, facts, thoughts, academy] = await Promise.all([
    sb(`tasks?user_id=eq.${userId}&created_at=gte.${weekAgo}&select=text,status,priority,created_at`),
    sb(`reminders?user_id=eq.${userId}&created_at=gte.${weekAgo}&select=text,status,due_at,due_location,created_at`),
    sb(`conversation_history?user_id=eq.${userId}&created_at=gte.${weekAgo}&order=created_at.desc&limit=50&select=role,content,created_at`),
    sb(`memory_graph?user_id=eq.${userId}&created_at=gte.${weekAgo}&select=subject,predicate,object,created_at`),
    sb(`roger_thoughts?user_id=eq.${userId}&created_at=gte.${weekAgo}&select=thought,delivered,snoozed,created_at`),
    sb(`academy_streaks?user_id=eq.${userId}&select=current_streak,total_words,accuracy_pct,target_locale`),
  ]);

  const taskSummary = Array.isArray(tasks) ? `${tasks.length} tasks created. ${tasks.filter((t: {status:string}) => t.status === 'completed').length} completed. ${tasks.filter((t: {status:string}) => t.status === 'open').length} still open.` : 'no tasks';
  const reminderSummary = Array.isArray(reminders) ? `${reminders.length} reminders. ${reminders.filter((r: {status:string}) => r.status === 'dismissed').length} dismissed, ${reminders.filter((r: {due_location:string|null}) => r.due_location).length} location-based.` : 'no reminders';
  const txCount = Array.isArray(history) ? history.filter((h: {role:string}) => h.role === 'user').length : 0;
  const factCount = Array.isArray(facts) ? facts.length : 0;
  const thoughtsSummary = Array.isArray(thoughts) ? `${thoughts.length} proactive thoughts. ${thoughts.filter((t: {delivered:boolean}) => t.delivered).length} delivered, ${thoughts.filter((t: {snoozed:boolean}) => t.snoozed).length} snoozed.` : 'no thoughts';
  const academyData = Array.isArray(academy) && academy.length > 0 ? academy[0] as { current_streak: number; total_words: number; accuracy_pct: number; target_locale: string } : null;
  const academySummary = academyData ? `${academyData.current_streak}-day streak, ${academyData.total_words} words, ${Math.round(academyData.accuracy_pct)}% accuracy in ${academyData.target_locale}` : 'not enrolled';

  // Build time distribution
  let timeDistribution = '';
  if (Array.isArray(history) && history.length > 0) {
    const hourCounts: Record<number, number> = {};
    for (const h of history as { created_at: string }[]) {
      const hour = new Date(h.created_at).getHours();
      hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
    }
    const topHours = Object.entries(hourCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([h, c]) => `${h}:00 (${c} transmissions)`)
      .join(', ');
    timeDistribution = `Most active hours: ${topHours}`;
  }

  const userContext = `User: ${displayName ?? 'User'}
WEEK SUMMARY:
- Tasks: ${taskSummary}
- Reminders: ${reminderSummary}
- Transmissions: ${txCount} voice transmissions this week
- Memory growth: ${factCount} new facts added to knowledge base
- Proactive engagement: ${thoughtsSummary}
- Academy: ${academySummary}
- ${timeDistribution}`;

  const start = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-5.5',
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: PATTERN_PROMPT },
        { role: 'user', content: userContext },
      ],
    }),
  });

  const data = await res.json() as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  await trackUsage({
    functionName: 'detect-patterns',
    model: 'gpt-5.5',
    userId,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
    latencyMs: Date.now() - start,
    success: true,
  });

  const raw = data.choices?.[0]?.message?.content ?? '{"patterns":[]}';
  const result = JSON.parse(raw) as { patterns: { insight: string; suggestion: string; tone: string }[] };

  if (!result.patterns?.length) return 0;

  // Store patterns as roger_thoughts with trigger_ctx = 'pattern_detection'
  let stored = 0;
  for (const p of result.patterns) {
    const message = `${p.insight} — ${p.suggestion}`;
    const hash = topicHash(p.insight);

    await sb('roger_thoughts', 'POST', {
      user_id: userId,
      thought: message,
      topic_hash: hash,
      trigger_ctx: `pattern_detection: ${p.tone}`,
      delivered: false,
      snoozed: false,
    });
    stored++;
  }

  return stored;
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async () => {
  try {
    // Process all active users (anyone with transmissions in the past week)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const users = await sb(
      `user_preferences?select=user_id,display_name`
    );

    if (!Array.isArray(users) || users.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let processed = 0;
    let patternsFound = 0;

    for (const user of users as { user_id: string; display_name: string }[]) {
      try {
        const count = await processUser(user.user_id, user.display_name ?? 'Commander');
        processed++;
        patternsFound += count;
      } catch (err) {
        console.error(`[detect-patterns] Error for ${user.user_id}:`, err);
      }
    }

    return new Response(JSON.stringify({ ok: true, processed, patternsFound }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[detect-patterns] Fatal:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});
