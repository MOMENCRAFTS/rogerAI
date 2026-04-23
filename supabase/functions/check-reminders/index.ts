// ─── Roger AI — Check Reminders Edge Function ─────────────────────────────────
// Runs every minute via Supabase cron.
// Finds reminders/tasks due within the next 15 minutes and sends Web Push.
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

async function query(sql: string, params?: unknown[]) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey':        SUPABASE_SERVICE_KEY,
    },
    body: JSON.stringify({ query: sql, params }),
  });
  return res.json();
}

async function supabaseSelect(table: string, filter: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey':        SUPABASE_SERVICE_KEY,
    },
  });
  return res.json();
}

async function supabasePatch(table: string, filter: string, body: unknown) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey':        SUPABASE_SERVICE_KEY,
    },
    body: JSON.stringify(body),
  });
}

Deno.serve(async () => {
  const now    = new Date();
  const window = new Date(now.getTime() + 15 * 60_000); // 15 min window

  try {
    // Find due reminders
    const reminders = await supabaseSelect(
      'reminders',
      `status=eq.pending&due_at=gte.${now.toISOString()}&due_at=lte.${window.toISOString()}&select=id,user_id,text,due_at`
    );

    // Find due tasks
    const tasks = await supabaseSelect(
      'tasks',
      `status=eq.open&due_at=gte.${now.toISOString()}&due_at=lte.${window.toISOString()}&select=id,user_id,text,due_at,priority`
    );

    const items = [
      ...(Array.isArray(reminders) ? reminders.map((r: { id: string; user_id: string; text: string; due_at: string }) => ({ ...r, kind: 'reminder' })) : []),
      ...(Array.isArray(tasks)     ? tasks.map((t: { id: string; user_id: string; text: string; due_at: string; priority: number })     => ({ ...t, kind: 'task'     })) : []),
    ];

    let sent = 0;
    for (const item of items) {
      // Get push subscriptions for this user
      const subs = await supabaseSelect(
        'push_subscriptions',
        `user_id=eq.${item.user_id}&select=endpoint,p256dh,auth`
      );
      if (!Array.isArray(subs) || subs.length === 0) continue;

      const dueIn = Math.round((new Date(item.due_at).getTime() - now.getTime()) / 60_000);
      const title = item.kind === 'reminder' ? '⏰ Reminder Due Soon' : `📋 Task Due [P${item.priority ?? 5}]`;
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

    return new Response(JSON.stringify({ ok: true, checked: items.length, sent }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});
