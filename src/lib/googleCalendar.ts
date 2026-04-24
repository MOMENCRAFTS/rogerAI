// ─── Roger AI — Google Calendar Integration ──────────────────────────────────
// Wraps the google-calendar Supabase Edge Function.
// OAuth tokens are stored server-side; client only knows if connected.

import { supabase } from './supabase';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const GOOGLE_CLIENT_ID  = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;

export interface CalendarEvent {
  id:          string;
  title:       string;
  start:       string;         // ISO
  end:         string;         // ISO
  location?:   string | null;
  attendees?:  string[];
  description?: string | null;
  htmlLink?:   string;
}

export interface CalendarListResult {
  events:      CalendarEvent[];
  totalToday:  number;
  nextEvent?:  CalendarEvent | null;
}

// ─── OAuth Flow ────────────────────────────────────────────────────────────────

/** Redirect user to Google OAuth — opens consent screen */
export function connectGoogleCalendar(redirectUri: string): void {
  const scopes = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ].join(' ');

  const params = new URLSearchParams({
    client_id:    GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope:        scopes,
    access_type:  'offline',
    prompt:       'consent',
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Disconnect Google Calendar — clears stored tokens */
export async function disconnectGoogleCalendar(userId: string): Promise<void> {
  await supabase.from('user_preferences').update({
    gcal_connected: false,
    gcal_access_token: null,
    gcal_refresh_token: null,
    gcal_token_expiry: null,
  }).eq('user_id', userId);
}

// ─── Calendar Data Fetching ────────────────────────────────────────────────────

async function callCalendarFn(action: string, payload: object): Promise<unknown> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON_KEY;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/google-calendar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) throw new Error(`Calendar function error ${res.status}`);
  return res.json();
}

/** Fetch today's calendar events */
export async function fetchTodayEvents(userId: string): Promise<CalendarListResult> {
  const data = await callCalendarFn('list_events', { userId, daysAhead: 0 }) as CalendarListResult;
  return data;
}

/** Fetch tomorrow's events too */
export async function fetchUpcomingEvents(userId: string, daysAhead = 1): Promise<CalendarListResult> {
  const data = await callCalendarFn('list_events', { userId, daysAhead }) as CalendarListResult;
  return data;
}

/** Create a calendar event */
export async function createCalendarEvent(userId: string, event: {
  title: string;
  startIso: string;
  endIso: string;
  attendees?: string[];
  description?: string;
  location?: string;
}): Promise<{ eventId: string; htmlLink: string }> {
  const data = await callCalendarFn('create_event', { userId, event }) as { eventId: string; htmlLink: string };
  return data;
}

/** Delete / cancel a calendar event by fuzzy title or exact ID */
export async function deleteCalendarEvent(userId: string, titleOrId: string): Promise<boolean> {
  const data = await callCalendarFn('delete_event', { userId, titleOrId }) as { ok: boolean };
  return data.ok;
}

// ─── Context Injection ─────────────────────────────────────────────────────────

/** Format events list for GPT-4o injection into morning brief or PTT context. */
export function eventsToContext(events: CalendarEvent[]): string {
  if (!events.length) return 'No calendar events today.';
  const lines = events.map(e => {
    const start = new Date(e.start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const attendees = e.attendees?.length ? ` (with: ${e.attendees.slice(0, 3).join(', ')})` : '';
    const loc = e.location ? ` @ ${e.location}` : '';
    return `${start} — ${e.title}${loc}${attendees}`;
  });
  return `Today's calendar (${events.length} events): ${lines.join('; ')}`;
}

/** Format a single event for Roger voice response. */
export function eventToSpeech(e: CalendarEvent): string {
  const start = new Date(e.start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const attendees = e.attendees?.length ? ` with ${e.attendees.slice(0, 2).join(' and ')}` : '';
  const loc = e.location ? ` at ${e.location}` : '';
  return `${e.title}${loc}${attendees} at ${start}`;
}
