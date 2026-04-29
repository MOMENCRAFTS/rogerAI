// ─── Roger AI — Check Reminders Edge Function ─────────────────────────────────
// Runs every 5 minutes via Supabase cron.
// 1. Finds reminders/tasks due within the next 15 minutes and sends Web Push.
// 2. For recurring reminders that just fired, spawns the next occurrence.
//
// Deploy: supabase functions deploy check-reminders --no-verify-jwt
// Cron:   supabase functions schedule check-reminders "*/5 * * * *"

import webpush from 'npm:web-push';

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY    = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY   = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_EMAIL         = Deno.env.get('VAPID_EMAIL') ?? 'mailto:admin@rogerai.app';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

async function supabaseSelect(table: string, filter: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey':        SUPABASE_SERVICE_KEY,
    },
  });
  return res.json();
}

async function supabaseInsert(table: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey':        SUPABASE_SERVICE_KEY,
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(body),
  });
  return res.ok;
}

// ── Recurrence: compute next due_at ──────────────────────────────────────────

function computeNextDueAt(
  currentDue: string,
  rule: string,
  recurrenceTime: string | null,
  recurrenceDays: number[] | null,
): string | null {
  const base = new Date(currentDue);
  const time = recurrenceTime ?? `${String(base.getUTCHours()).padStart(2,'0')}:${String(base.getUTCMinutes()).padStart(2,'0')}`;
  const [hh, mm] = time.split(':').map(Number);

  const setTime = (d: Date) => {
    d.setUTCHours(hh, mm, 0, 0);
    return d;
  };

  switch (rule) {
    case 'daily': {
      const next = new Date(base);
      next.setUTCDate(next.getUTCDate() + 1);
      return setTime(next).toISOString();
    }
    case 'weekdays': {
      const next = new Date(base);
      do {
        next.setUTCDate(next.getUTCDate() + 1);
      } while (next.getUTCDay() === 0 || next.getUTCDay() === 6); // skip Sat/Sun
      return setTime(next).toISOString();
    }
    case 'weekly': {
      const next = new Date(base);
      next.setUTCDate(next.getUTCDate() + 7);
      return setTime(next).toISOString();
    }
    case 'monthly': {
      const next = new Date(base);
      next.setUTCMonth(next.getUTCMonth() + 1);
      return setTime(next).toISOString();
    }
    case 'custom': {
      if (!recurrenceDays || recurrenceDays.length === 0) return null;
      const sorted = [...recurrenceDays].sort((a, b) => a - b);
      const next = new Date(base);
      // Find next matching ISO weekday (1=Mon … 7=Sun)
      for (let i = 1; i <= 7; i++) {
        next.setUTCDate(next.getUTCDate() + 1);
        const isoDay = next.getUTCDay() === 0 ? 7 : next.getUTCDay(); // JS Sun=0 → ISO Sun=7
        if (sorted.includes(isoDay)) return setTime(next).toISOString();
      }
      return null;
    }
    default:
      return null;
  }
}

Deno.serve(async () => {
  const now    = new Date();
  const window = new Date(now.getTime() + 15 * 60_000); // 15 min window

  try {
    // ── Phase 1: Find due reminders and send push notifications ───────────
    const reminders = await supabaseSelect(
      'reminders',
      `status=eq.pending&due_at=gte.${now.toISOString()}&due_at=lte.${window.toISOString()}&select=id,user_id,text,due_at,recurrence_rule,recurrence_time,recurrence_days`
    );

    // Find due tasks
    const tasks = await supabaseSelect(
      'tasks',
      `status=eq.open&due_at=gte.${now.toISOString()}&due_at=lte.${window.toISOString()}&select=id,user_id,text,due_at,priority`
    );

    const items = [
      ...(Array.isArray(reminders) ? reminders.map((r: { id: string; user_id: string; text: string; due_at: string; recurrence_rule?: string; recurrence_time?: string; recurrence_days?: number[] }) => ({ ...r, kind: 'reminder' as const })) : []),
      ...(Array.isArray(tasks)     ? tasks.map((t: { id: string; user_id: string; text: string; due_at: string; priority: number })     => ({ ...t, kind: 'task' as const     })) : []),
    ];

    let sent = 0;
    const spawnedRecurring: string[] = [];

    for (const item of items) {
      // Get push subscriptions for this user
      const subs = await supabaseSelect(
        'push_subscriptions',
        `user_id=eq.${item.user_id}&select=endpoint,p256dh,auth`
      );
      if (!Array.isArray(subs) || subs.length === 0) continue;

      const dueIn = Math.round((new Date(item.due_at).getTime() - now.getTime()) / 60_000);
      const isRecurring = item.kind === 'reminder' && !!(item as { recurrence_rule?: string }).recurrence_rule;
      const title = item.kind === 'reminder'
        ? (isRecurring ? '🔁 Recurring Reminder Due' : '⏰ Reminder Due Soon')
        : `📋 Task Due [P${(item as { priority?: number }).priority ?? 5}]`;
      const body  = `${item.text} — due in ${dueIn} min. Over.`;

      for (const sub of subs as { endpoint: string; p256dh: string; auth: string }[]) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title, body, icon: '/mascot.png', tag: `due-${item.id}`, type: 'deadline', userId: item.user_id })
          );
          sent++;
        } catch (err) {
          // Subscription expired — remove it
          if ((err as { statusCode?: number }).statusCode === 410) {
            await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${item.user_id}&endpoint=eq.${encodeURIComponent(sub.endpoint)}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY },
            });
          }
        }
      }
    }

    // ── Phase 2: Spawn next occurrence for recurring reminders ────────────
    // Find recurring reminders that were recently marked 'done' (within last 10 min)
    const tenMinAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
    const doneRecurring = await supabaseSelect(
      'reminders',
      `status=eq.done&recurrence_rule=not.is.null&updated_at=gte.${tenMinAgo}&select=id,user_id,text,entities,due_at,source_tx_id,is_admin_test,due_location,due_location_lat,due_location_lng,due_radius_m,recurrence_rule,recurrence_time,recurrence_days`
    );

    if (Array.isArray(doneRecurring)) {
      for (const r of doneRecurring as {
        id: string; user_id: string; text: string; entities: unknown;
        due_at: string; source_tx_id: string | null; is_admin_test: boolean;
        due_location: string | null; due_location_lat: number | null; due_location_lng: number | null;
        due_radius_m: number; recurrence_rule: string; recurrence_time: string | null;
        recurrence_days: number[] | null;
      }[]) {
        // Check if a pending clone already exists (avoid double-spawning)
        const existing = await supabaseSelect(
          'reminders',
          `user_id=eq.${r.user_id}&status=eq.pending&recurrence_rule=eq.${r.recurrence_rule}&text=eq.${encodeURIComponent(r.text)}&select=id&limit=1`
        );
        if (Array.isArray(existing) && existing.length > 0) continue;

        const nextDue = computeNextDueAt(r.due_at, r.recurrence_rule, r.recurrence_time, r.recurrence_days);
        if (!nextDue) continue;

        const ok = await supabaseInsert('reminders', {
          user_id: r.user_id,
          text: r.text,
          entities: r.entities,
          due_at: nextDue,
          status: 'pending',
          source_tx_id: r.source_tx_id,
          is_admin_test: r.is_admin_test,
          due_location: r.due_location,
          due_location_lat: r.due_location_lat,
          due_location_lng: r.due_location_lng,
          due_radius_m: r.due_radius_m,
          geo_triggered: false,
          recurrence_rule: r.recurrence_rule,
          recurrence_time: r.recurrence_time,
          recurrence_days: r.recurrence_days,
        });

        if (ok) spawnedRecurring.push(r.id);
      }
    }

    return new Response(JSON.stringify({ ok: true, checked: items.length, sent, spawned: spawnedRecurring.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});

