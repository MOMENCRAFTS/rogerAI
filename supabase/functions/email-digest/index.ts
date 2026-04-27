// ─── Roger AI — Email Digest ─────────────────────────────────────────────────
// Cron-triggered: reads unread Gmail messages, extracts action items,
// and auto-creates tasks/reminders in Roger.
//
// Requires: Google OAuth token with gmail.readonly scope.
// Cron: every 30 minutes
// Deploy: supabase functions deploy email-digest --no-verify-jwt

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

const EMAIL_PROMPT = `You are Roger AI's email analyst. Extract actionable items from these emails.

For each email, determine:
1. Is there an action required from the user?
2. Is there a deadline mentioned?
3. Is there a meeting invitation?
4. Is this urgent?

Return JSON:
{
  "items": [
    {
      "type": "task" | "reminder" | "meeting" | "info",
      "text": "Brief action description (max 20 words)",
      "urgency": "low" | "medium" | "high" | "critical",
      "deadline": "ISO date string or null",
      "from": "sender name",
      "subject": "email subject"
    }
  ],
  "summary": "1-2 sentence overall summary of what came in"
}

Only include items that require USER ACTION. Skip newsletters, promotions, and automated notifications.
If no actionable emails, return { "items": [], "summary": "No actionable emails." }`;

async function getGmailToken(userId: string): Promise<string | null> {
  // Try to get stored OAuth token from user's provider tokens
  const { data } = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users/${userId}`,
    {
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
      },
    }
  ).then(r => r.json()) as { data?: { identities?: { provider: string; identity_data?: { provider_token?: string } }[] } };

  const googleIdentity = data?.identities?.find(i => i.provider === 'google');
  return googleIdentity?.identity_data?.provider_token ?? null;
}

async function fetchUnreadEmails(token: string, maxResults = 10): Promise<{ from: string; subject: string; snippet: string; date: string }[]> {
  // Fetch unread message IDs
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=${maxResults}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );

  if (!listRes.ok) return [];

  const listData = await listRes.json() as { messages?: { id: string }[] };
  if (!listData.messages?.length) return [];

  // Fetch message details (batch — parallel)
  const emails: { from: string; subject: string; snippet: string; date: string }[] = [];

  for (const msg of listData.messages.slice(0, maxResults)) {
    try {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (!msgRes.ok) continue;

      const msgData = await msgRes.json() as {
        snippet: string;
        payload: { headers: { name: string; value: string }[] };
      };

      const headers = msgData.payload?.headers ?? [];
      emails.push({
        from: headers.find(h => h.name === 'From')?.value ?? 'Unknown',
        subject: headers.find(h => h.name === 'Subject')?.value ?? '(no subject)',
        snippet: msgData.snippet ?? '',
        date: headers.find(h => h.name === 'Date')?.value ?? '',
      });
    } catch {
      // Skip failed individual messages
    }
  }

  return emails;
}

async function processUser(userId: string): Promise<{ items: number; summary: string }> {
  // Check if user has email_digest_enabled
  const prefs = await sb(`user_preferences?user_id=eq.${userId}&select=email_digest_enabled`);
  if (!Array.isArray(prefs) || !prefs[0]?.email_digest_enabled) {
    return { items: 0, summary: 'disabled' };
  }

  // Get Gmail token
  const token = await getGmailToken(userId);
  if (!token) return { items: 0, summary: 'no_token' };

  // Fetch unread emails
  const emails = await fetchUnreadEmails(token);
  if (!emails.length) return { items: 0, summary: 'no_emails' };

  // Format for GPT
  const emailText = emails
    .map((e, i) => `[Email ${i + 1}]\nFrom: ${e.from}\nSubject: ${e.subject}\nPreview: ${e.snippet}\nDate: ${e.date}`)
    .join('\n\n');

  const start = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: EMAIL_PROMPT },
        { role: 'user', content: `Analyze these ${emails.length} unread emails:\n\n${emailText}` },
      ],
    }),
  });

  const data = await res.json() as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  await trackUsage({
    functionName: 'email-digest',
    model: 'gpt-5.4-mini',
    userId,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
    latencyMs: Date.now() - start,
    success: true,
  });

  const raw = data.choices?.[0]?.message?.content ?? '{"items":[],"summary":"parse error"}';
  const result = JSON.parse(raw) as { items: { type: string; text: string; urgency: string; deadline: string | null }[]; summary: string };

  // Create tasks/reminders from items
  let created = 0;
  for (const item of result.items) {
    if (item.type === 'task') {
      await sb('tasks', 'POST', {
        user_id: userId,
        text: `📧 ${item.text}`,
        priority: item.urgency === 'critical' ? 10 : item.urgency === 'high' ? 8 : item.urgency === 'medium' ? 5 : 3,
        status: 'open',
        due_at: item.deadline,
        source_tx_id: null,
      });
      created++;
    } else if (item.type === 'reminder' || item.type === 'meeting') {
      await sb('reminders', 'POST', {
        user_id: userId,
        text: `📧 ${item.text}`,
        due_at: item.deadline,
        status: 'pending',
        source_tx_id: null,
      });
      created++;
    }
  }

  // Surface summary via proactive engine
  if (result.items.length > 0) {
    await sb('surface_queue', 'POST', {
      user_id: userId,
      content: `Email digest: ${result.summary}`,
      type: 'email_digest',
      priority: result.items.some(i => i.urgency === 'critical') ? 10 : 5,
      dismissed: false,
    });
  }

  return { items: created, summary: result.summary };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async () => {
  try {
    const users = await sb('user_preferences?email_digest_enabled=eq.true&select=user_id');

    if (!Array.isArray(users) || users.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, reason: 'no users with email digest' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let processed = 0;
    let totalItems = 0;

    for (const user of users as { user_id: string }[]) {
      try {
        const result = await processUser(user.user_id);
        processed++;
        totalItems += result.items;
      } catch (err) {
        console.error(`[email-digest] Error for ${user.user_id}:`, err);
      }
    }

    return new Response(JSON.stringify({ ok: true, processed, totalItems }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[email-digest] Fatal:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});
