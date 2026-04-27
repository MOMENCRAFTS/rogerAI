import { useState } from 'react';
import { Newspaper, Mic, Loader, Wind } from 'lucide-react';
import { fetchConversationHistory, fetchMemoryGraph, fetchSurfaceQueue, fetchReminders, fetchTasks } from '../../lib/api';
import { speakResponse } from '../../lib/tts';
import { fetchWeather, weatherToContextString, type WeatherData } from '../../lib/weather';
import { fetchMarketContext } from '../../lib/finance';
import { fetchTodayEvents, eventsToContext } from '../../lib/googleCalendar';
import type { UserLocation } from '../../lib/useLocation';

import { getAuthToken } from '../../lib/getAuthToken';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const BRIEFING_PROMPT = `You are Roger AI delivering a morning briefing to your principal.
You have full access to their memory, open tasks, pending items, and current weather.
Deliver a rich but concise spoken briefing (90–150 words) covering:
1. A warm opener referencing the time of day and current weather if available
2. Top 2-3 open items or reminders
3. Any notable patterns or insights from their memory
4. One proactive suggestion (create a task, follow up on someone, etc.)
5. Close with "Standing by. Over."

Speak as a trusted, knowledgeable aide. Warm but professional.
Return plain text only — no JSON, no markdown, no headers.`;

export default function MorningBriefing({ userId, location }: { userId: string; location: UserLocation | null }) {
  const [state, setState]           = useState<'idle' | 'loading' | 'speaking' | 'done'>('idle');
  const [briefingText, setBriefingText] = useState('');
  const [weather, setWeather]       = useState<WeatherData | null>(null);

  const generateBriefing = async () => {
    setState('loading');
    try {
      const [history, facts, surfaceItems, reminders, tasks, wx, marketCtx, calEvents] = await Promise.all([
        fetchConversationHistory(userId, 10).catch(() => []),
        fetchMemoryGraph(userId).catch(() => []),
        fetchSurfaceQueue(userId).catch(() => []),
        fetchReminders(userId, 'pending').catch(() => []),
        fetchTasks(userId, 'open').catch(() => []),
        location ? fetchWeather(location.latitude, location.longitude, location.city).catch(() => null) : Promise.resolve(null),
        fetchMarketContext(['AAPL','MSFT','NVDA']).catch(() => ''),
        fetchTodayEvents(userId).catch(() => null),
      ]);

      if (wx) setWeather(wx);

      const hour      = new Date().getHours();
      const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

      const factLines     = facts.slice(0, 8).map(f => `${f.subject} ${f.predicate} ${f.object}`).join('; ');
      const surfaceLines  = surfaceItems.slice(0, 3).map(s => `• ${s.content}`).join('\n');
      const historyLines  = history.slice(-4).map(t => `[${t.role}]: ${t.content}`).join('\n');
      const reminderLines = reminders.slice(0, 5).map(r =>
        `• ${r.text}${r.due_at ? ` (due ${new Date(r.due_at).toLocaleDateString()})` : ''}`
      ).join('\n');
      const taskLines = tasks.slice(0, 5)
        .sort((a, b) => b.priority - a.priority)
        .map(t => `• [P${t.priority}] ${t.text}${t.due_at ? ` (due ${new Date(t.due_at).toLocaleDateString()})` : ''}`)
        .join('\n');

      const weatherLine  = wx ? weatherToContextString(wx) : 'unavailable';
      const marketLine   = marketCtx || 'unavailable';
      const calendarLine = calEvents?.events?.length ? eventsToContext(calEvents.events) : 'No calendar events today.';

      const contextPrompt = `Time of day: ${timeOfDay}
Location: ${location?.city ?? 'unknown'}
Weather: ${weatherLine}
Market: ${marketLine}
Calendar: ${calendarLine}

User facts: ${factLines || 'none yet'}

Pending reminders (${reminders.length} total):
${reminderLines || 'none'}

Open tasks (${tasks.length} total, shown by priority):
${taskLines || 'none'}

Pending surface items:
${surfaceLines || 'none'}

Recent conversation:
${historyLines || 'none'}

Generate the ${timeOfDay} briefing.`;

      const token = await getAuthToken().catch(() => SUPABASE_ANON_KEY);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/process-transmission`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          _direct_prompt: true,
          system: BRIEFING_PROMPT,
          user: contextPrompt,
        }),
      });

      const data = await res.json() as { roger_response?: string; choices?: { message: { content: string } }[] };
      const text = data.roger_response ?? data.choices?.[0]?.message?.content ?? 'Briefing unavailable at this time. Over.';
      setBriefingText(text);

      setState('speaking');
      try { await speakResponse(text); }
      catch { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }
      setState('done');
    } catch {
      setState('idle');
    }
  };

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Morning Briefing' : hour < 17 ? 'Afternoon Brief' : 'Evening Debrief';

  return (
    <div style={{ padding: '16px', borderTop: '1px solid var(--border-subtle)' }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Newspaper size={13} style={{ color: 'var(--amber)', opacity: 0.8 }} />
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
          {greeting}
        </span>
      </div>

      {state === 'idle' && (
        <button
          onClick={generateBriefing}
          style={{
            width: '100%', padding: '12px', fontFamily: 'monospace', fontSize: 11,
            textTransform: 'uppercase', letterSpacing: '0.15em',
            background: 'rgba(212,160,68,0.08)', border: '1px solid rgba(212,160,68,0.3)',
            color: 'var(--amber)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <Mic size={13} />
          Request Briefing from Roger
        </button>
      )}

      {state === 'loading' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px' }}>
          <Loader size={13} style={{ color: 'var(--amber)', animation: 'spin 1s linear infinite' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            Compiling briefing...
          </span>
        </div>
      )}

      {(state === 'speaking' || state === 'done') && briefingText && (
        <div>
          {/* ── Weather strip (shown when weather data is available) ── */}
          {weather && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 8,
              background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)',
              borderRadius: 2,
            }}>
              <span style={{ fontSize: 16 }}>{weather.icon}</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)' }}>
                  {weather.tempC}°C · {weather.description}
                </span>
                {weather.city && (
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginLeft: 6 }}>
                    {weather.city}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                  {weather.humidity}%
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Wind size={9} /> {weather.windKph}kph
                </span>
              </div>
            </div>
          )}

          {/* ── Briefing text ── */}
          <div style={{ padding: '14px 16px', border: '1px solid rgba(212,160,68,0.2)', background: 'rgba(212,160,68,0.04)', marginBottom: 10 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0, lineHeight: 1.7 }}>
              {briefingText}
              {state === 'speaking' && <span style={{ color: 'var(--amber)', animation: 'blink 1s infinite' }}>▌</span>}
            </p>
          </div>

          {state === 'done' && (
            <button
              onClick={() => { setState('idle'); setBriefingText(''); setWeather(null); }}
              style={{ background: 'transparent', border: '1px solid var(--border-subtle)', padding: '6px 14px', fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.1em' }}
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
