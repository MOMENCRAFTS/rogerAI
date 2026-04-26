// ─── Roger AI — Morning Briefing Edge Function ────────────────────────────────
// Generates a personalised spoken briefing for each user at their preferred
// briefing time (stored in user_preferences.briefing_time).
// Sends via Web Push notification — tapping opens the app.
//
// Deploy: supabase functions deploy morning-briefing --no-verify-jwt
// Cron:   supabase functions schedule morning-briefing "*/30 * * * *"
// (Runs every 30 min, checks each user's preferred time window internally)

import webpush from 'npm:web-push';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY       = Deno.env.get('OPENAI_API_KEY')!;
const VAPID_PUBLIC_KEY     = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY    = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_EMAIL          = Deno.env.get('VAPID_EMAIL') ?? 'mailto:admin@rogerai.app';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

async function sb(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY },
  });
  return res.json();
}

async function generateBriefing(userId: string, displayName: string, timeOfDay: string): Promise<string> {
  // Fetch context in parallel
  const [history, facts, reminders, tasks, surface, academyStreak] = await Promise.all([
    sb(`conversation_history?user_id=eq.${userId}&order=created_at.desc&limit=6&select=role,content`),
    sb(`memory_graph?user_id=eq.${userId}&order=confidence.desc&limit=8&select=subject,predicate,object`),
    sb(`reminders?user_id=eq.${userId}&status=eq.pending&order=due_at.asc&limit=5&select=text,due_at`),
    sb(`tasks?user_id=eq.${userId}&status=eq.open&order=priority.desc&limit=5&select=text,priority,due_at`),
    sb(`surface_queue?user_id=eq.${userId}&dismissed=eq.false&snooze_count=lt.5&order=priority.desc&limit=3&select=content`),
    sb(`academy_streaks?user_id=eq.${userId}&select=current_streak,total_words,target_locale,accuracy_pct,streak_freezes`),
  ]);

  const factLines    = Array.isArray(facts)    ? facts.map((f: {subject: string; predicate: string; object: string}) => `${f.subject} ${f.predicate} ${f.object}`).join('; ') : '';
  const remLines     = Array.isArray(reminders) ? reminders.slice(0,5).map((r: {text: string; due_at: string|null}) => `• ${r.text}${r.due_at ? ` (due ${new Date(r.due_at).toLocaleDateString()})` : ''}`).join('\n') : '';
  const taskLines    = Array.isArray(tasks)    ? tasks.sort((a: {priority: number}, b: {priority: number}) => b.priority - a.priority).slice(0,5).map((t: {text: string; priority: number}) => `• [P${t.priority}] ${t.text}`).join('\n') : '';
  const surfaceLines = Array.isArray(surface)   ? surface.map((s: {content: string}) => `• ${s.content}`).join('\n') : '';
  const histLines    = Array.isArray(history)   ? [...history].reverse().slice(-4).map((h: {role: string; content: string}) => `[${h.role}]: ${h.content}`).join('\n') : '';
  const streakData   = Array.isArray(academyStreak) && academyStreak.length > 0
    ? (academyStreak[0] as { current_streak: number; total_words: number; target_locale: string; accuracy_pct: number; streak_freezes: number })
    : null;
  const academyLine  = streakData
    ? `Language learning: ${streakData.current_streak}-day streak, ${streakData.total_words} words learned (${streakData.target_locale}), ${Math.round(streakData.accuracy_pct)}% accuracy, ${streakData.streak_freezes} streak freeze${streakData.streak_freezes !== 1 ? 's' : ''} available`
    : '';

  const prompt = `You are Roger AI delivering a ${timeOfDay} briefing to ${displayName ?? 'Commander'}.
Generate a crisp spoken briefing (90–140 words). Be warm, direct, like a trusted aide.

USER FACTS: ${factLines || 'none yet'}

PENDING REMINDERS:
${remLines || 'none'}

OPEN TASKS (by priority):
${taskLines || 'none'}

SURFACE ITEMS:
${surfaceLines || 'none'}

RECENT CONVERSATION:
${histLines || 'none'}

LANGUAGE ACADEMY:
${academyLine || 'not enrolled'}

Rules:
- Start with a warm ${timeOfDay} opener using their name
- Cover 2-3 most important items
- End with ONE proactive suggestion
- Close with "Standing by. Over."
- Plain text only, no markdown`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-5.5',
      temperature: 0.5,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? `Good ${timeOfDay}, ${displayName}. Standing by. Over.`;
}

Deno.serve(async () => {
  try {
    const now     = new Date();
    const hour    = now.getUTCHours();
    const minute  = now.getUTCMinutes();
    const hhmm    = `${String(hour).padStart(2,'0')}:${String(Math.round(minute/30)*30).padStart(2,'0')}`;
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

    // Fetch users whose briefing time matches current 30-min window
    const prefs = await sb(
      `user_preferences?onboarding_complete=eq.true&select=user_id,display_name,briefing_time,briefing_time2,timezone`
    );

    if (!Array.isArray(prefs) || prefs.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'no users' }));
    }

    let sent = 0;
    for (const pref of prefs as { user_id: string; display_name: string; briefing_time: string; briefing_time2: string }[]) {
      // Check if this user's briefing time matches current window (±15 min)
      const isTime = [pref.briefing_time, pref.briefing_time2].some(t => t && t.slice(0,5) === hhmm);
      if (!isTime) continue;

      // Get push subscriptions
      const subs = await sb(`push_subscriptions?user_id=eq.${pref.user_id}&select=endpoint,p256dh,auth`);
      if (!Array.isArray(subs) || subs.length === 0) continue;

      // Generate briefing
      const briefingText = await generateBriefing(pref.user_id, pref.display_name, timeOfDay);

      // Truncate for notification body (Web Push limit)
      const notifBody = briefingText.slice(0, 180) + (briefingText.length > 180 ? '...' : '');

      for (const sub of subs as { endpoint: string; p256dh: string; auth: string }[]) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({
              title:  `📡 Roger — ${timeOfDay.charAt(0).toUpperCase() + timeOfDay.slice(1)} Briefing`,
              body:   notifBody,
              icon:   '/mascot.png',
              tag:    `briefing-${pref.user_id}-${hhmm}`,
              type:   'briefing',
              userId: pref.user_id,
            })
          );
          sent++;
        } catch (err) {
          if ((err as { statusCode?: number }).statusCode === 410) {
            await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${pref.user_id}&endpoint=eq.${encodeURIComponent(sub.endpoint)}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY },
            });
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, window: hhmm }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});
