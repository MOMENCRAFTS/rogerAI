// ─── Roger AI — Google Calendar Edge Function ────────────────────────────────
// Multi-action calendar function: list_events, create_event, delete_event.
// Handles OAuth token refresh automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const CALENDAR_API         = 'https://www.googleapis.com/calendar/v3';

// ─── Token refresh ────────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) return null;
  return res.json();
}

async function getValidToken(supabase: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('gcal_access_token, gcal_refresh_token, gcal_token_expiry')
    .eq('user_id', userId)
    .single();

  if (!prefs?.gcal_refresh_token) return null;

  const expiry = prefs.gcal_token_expiry ? new Date(prefs.gcal_token_expiry).getTime() : 0;
  if (Date.now() < expiry - 60_000) return prefs.gcal_access_token;

  // Refresh
  const refreshed = await refreshAccessToken(prefs.gcal_refresh_token);
  if (!refreshed) return null;

  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await supabase.from('user_preferences').update({
    gcal_access_token: refreshed.access_token,
    gcal_token_expiry: newExpiry,
  }).eq('user_id', userId);

  return refreshed.access_token;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function listEvents(token: string, daysAhead = 0) {
  const now   = new Date();
  const start = now.toISOString();
  const end   = new Date(now.getTime() + (daysAhead + 1) * 86_400_000).toISOString();

  const res = await fetch(
    `${CALENDAR_API}/calendars/primary/events?` +
    new URLSearchParams({
      timeMin: start, timeMax: end,
      singleEvents: 'true', orderBy: 'startTime', maxResults: '20',
    }),
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Google Calendar error ${res.status}`);
  const data = await res.json() as {
    items: {
      id: string; summary: string; location?: string; description?: string;
      start: { dateTime?: string; date?: string };
      end:   { dateTime?: string; date?: string };
      attendees?: { email: string; displayName?: string }[];
      htmlLink: string;
    }[];
  };

  const events = (data.items ?? []).map(e => ({
    id:         e.id,
    title:      e.summary ?? 'Untitled',
    start:      e.start.dateTime ?? e.start.date ?? '',
    end:        e.end.dateTime   ?? e.end.date   ?? '',
    location:   e.location ?? null,
    description: e.description ?? null,
    attendees:  e.attendees?.map(a => a.displayName ?? a.email) ?? [],
    htmlLink:   e.htmlLink,
  }));

  const nextEvent = events.find(ev => new Date(ev.start) > now) ?? null;
  return { events, totalToday: events.length, nextEvent };
}

async function createEvent(token: string, event: {
  title: string; startIso: string; endIso: string;
  attendees?: string[]; description?: string; location?: string;
}) {
  const body = {
    summary:     event.title,
    location:    event.location,
    description: event.description,
    start:       { dateTime: event.startIso, timeZone: 'UTC' },
    end:         { dateTime: event.endIso,   timeZone: 'UTC' },
    attendees:   event.attendees?.map(email => ({ email })) ?? [],
  };

  const res = await fetch(`${CALENDAR_API}/calendars/primary/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Create event error ${res.status}`);
  const data = await res.json() as { id: string; htmlLink: string };
  return { eventId: data.id, htmlLink: data.htmlLink };
}

async function deleteEvent(token: string, titleOrId: string) {
  // Try by ID first
  const direct = await fetch(`${CALENDAR_API}/calendars/primary/events/${titleOrId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (direct.status === 204) return { ok: true };

  // Fall back to search by title
  const searchRes = await fetch(
    `${CALENDAR_API}/calendars/primary/events?q=${encodeURIComponent(titleOrId)}&maxResults=5`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = await searchRes.json() as { items: { id: string; summary: string }[] };
  const match = searchData.items?.[0];
  if (!match) return { ok: false };

  await fetch(`${CALENDAR_API}/calendars/primary/events/${match.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return { ok: true };
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const body = await req.json() as { action: string; userId: string; daysAhead?: number; event?: object; titleOrId?: string };
  const { action, userId, daysAhead = 0 } = body;

  if (user.id !== userId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const token = await getValidToken(supabase, userId);
  if (!token) {
    return new Response(JSON.stringify({ error: 'Google Calendar not connected' }), {
      status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    let result: unknown;
    if (action === 'list_events') result = await listEvents(token, daysAhead);
    else if (action === 'create_event') result = await createEvent(token, body.event as Parameters<typeof createEvent>[1]);
    else if (action === 'delete_event') result = await deleteEvent(token, body.titleOrId ?? '');
    else return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
