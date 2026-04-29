import { useState } from 'react';
import { Newspaper, Mic, Loader, Wind, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { fetchConversationHistory, fetchMemoryGraph, fetchSurfaceQueue, fetchReminders, fetchTasks, fetchUserPreferences } from '../../lib/api';
import { speakResponse } from '../../lib/tts';
import { fetchWeather, weatherToContextString, type WeatherData } from '../../lib/weather';
import { fetchTodayEvents, eventsToContext } from '../../lib/googleCalendar';
import type { UserLocation } from '../../lib/useLocation';
import {
  getCachedMarketData, fetchMarketData, cacheAgeMinutes,
  type MarketData,
} from '../../lib/marketData';

import { getAuthToken } from '../../lib/getAuthToken';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── Compact sparkline for briefing cards ──────────────────────────────────────
function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  if (!values || values.length < 2) return null;
  const w = 80, h = 18;
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ marginTop: 4, overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
    </svg>
  );
}

function MiniChange({ pct }: { pct: number }) {
  const pos = pct > 0;
  const zero = Math.abs(pct) < 0.01;
  const color = zero ? 'var(--text-muted)' : pos ? '#10b981' : '#ef4444';
  const Icon = zero ? Minus : pos ? TrendingUp : TrendingDown;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontFamily: 'monospace', fontSize: 9, color }}>
      <Icon size={8} />
      {zero ? '—' : `${pos ? '+' : ''}${pct.toFixed(1)}%`}
    </span>
  );
}

const BRIEFING_PROMPT = `You are Roger AI delivering a morning briefing to your principal.
You have access to web search. Use it to fetch CURRENT, REAL-TIME data for the user's interests listed below.
Deliver a rich but concise spoken briefing (120–180 words) covering:
1. Live data from user interests FIRST — include specific numbers, prices, and conditions
2. A warm opener referencing the time of day and current weather if available
3. Top 2-3 open items or reminders
4. Any notable patterns or insights from their memory
5. One proactive suggestion (create a task, follow up on someone, etc.)
6. Close with "Standing by. Over."

Speak as a trusted, knowledgeable aide. Warm but professional.
This is SPOKEN ALOUD via text-to-speech — write it as natural speech.
Return plain text only — no JSON, no markdown, no headers.`;

export default function MorningBriefing({ userId, location }: { userId: string; location: UserLocation | null }) {
  const [state, setState]           = useState<'idle' | 'loading' | 'speaking' | 'done'>('idle');
  const [briefingText, setBriefingText] = useState('');
  const [weather, setWeather]       = useState<WeatherData | null>(null);
  const [marketSnapshot, setMarketSnapshot] = useState<MarketData | null>(null);

  // Load market data (cached or fresh) for compact cards
  const loadMarketSnapshot = async () => {
    const cached = getCachedMarketData();
    if (cached && cacheAgeMinutes() < 30) {
      setMarketSnapshot(cached);
      return;
    }
    try {
      const prefs = await fetchUserPreferences(userId).catch(() => null);
      const interests = prefs?.briefing_interests ?? [];
      const token = await getAuthToken().catch(() => SUPABASE_ANON_KEY);
      const data = await fetchMarketData(interests, location?.latitude, location?.longitude, token);
      setMarketSnapshot(data);
    } catch { setMarketSnapshot(cached); }
  };

  const generateBriefing = async () => {
    setState('loading');
    try {
      // Fetch everything in parallel — including user's briefing interests
      const [history, facts, surfaceItems, reminders, tasks, wx, calEvents, prefs] = await Promise.all([
        fetchConversationHistory(userId, 10).catch(() => []),
        fetchMemoryGraph(userId).catch(() => []),
        fetchSurfaceQueue(userId).catch(() => []),
        fetchReminders(userId, 'pending').catch(() => []),
        fetchTasks(userId, 'open').catch(() => []),
        location ? fetchWeather(location.latitude, location.longitude, location.city).catch(() => null) : Promise.resolve(null),
        fetchTodayEvents(userId).catch(() => null),
        fetchUserPreferences(userId).catch(() => null),
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
      const calendarLine = calEvents?.events?.length ? eventsToContext(calEvents.events) : 'No calendar events today.';

      // User's personal briefing interests
      const interests = prefs?.briefing_interests ?? [];
      const interestsSection = interests.length > 0
        ? `LIVE DATA INTERESTS (search the web for current data on each):\n${interests.map((i: string, idx: number) => `${idx + 1}. ${i}`).join('\n')}`
        : '';

      const contextPrompt = `Time of day: ${timeOfDay}
Location: ${location?.city ?? 'unknown'}
Weather: ${weatherLine}
Calendar: ${calendarLine}

${interestsSection}

User facts: ${factLines || 'none yet'}

Pending reminders (${reminders.length} total):
${reminderLines || 'none'}

Open tasks (${tasks.length} total, shown by priority):
${taskLines || 'none'}

Pending surface items:
${surfaceLines || 'none'}

Recent conversation:
${historyLines || 'none'}

Generate the ${timeOfDay} briefing.${interests.length > 0 ? ' Search the web for the latest data on each interest.' : ''}`;

      const token = await getAuthToken().catch(() => SUPABASE_ANON_KEY);

      // Helper: call process-transmission with a timeout
      const callTransmission = async (payload: Record<string, unknown>, timeoutMs: number): Promise<Response> => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          return await fetch(`${SUPABASE_URL}/functions/v1/process-transmission`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            signal: ctrl.signal,
            body: JSON.stringify(payload),
          });
        } finally {
          clearTimeout(timer);
        }
      };

      // Try web-search first (if user has interests); fallback to direct prompt on any failure
      const useWebSearch = interests.length > 0;
      let res: Response;
      if (useWebSearch) {
        try {
          res = await callTransmission({ _web_search: true, system: BRIEFING_PROMPT, user: contextPrompt }, 45_000);
          // If server returned an error, fall through to direct prompt
          if (!res.ok) throw new Error(`web-search ${res.status}`);
        } catch (wsErr) {
          console.warn('[Briefing] Web-search failed, falling back to direct prompt:', wsErr);
          res = await callTransmission({ _direct_prompt: true, system: BRIEFING_PROMPT, user: contextPrompt }, 30_000);
        }
      } else {
        res = await callTransmission({ _direct_prompt: true, system: BRIEFING_PROMPT, user: contextPrompt }, 30_000);
      }

      const data = await res.json() as { roger_response?: string; choices?: { message: { content: string } }[] };
      let text = data.roger_response ?? data.choices?.[0]?.message?.content ?? 'Briefing unavailable at this time. Over.';

      // Safety net: unwrap if GPT still wrapped plain text in {"text": "..."}
      if (text.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed.text === 'string') text = parsed.text;
          else if (typeof parsed.response === 'string') text = parsed.response;
          else if (typeof parsed.briefing === 'string') text = parsed.briefing;
        } catch { /* not JSON, keep as-is */ }
      }

      setBriefingText(text);

      // Fetch market data in background for compact cards
      loadMarketSnapshot();

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
            Searching live data & compiling briefing...
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

          {/* ── Compact Market Snapshot ── */}
          {marketSnapshot && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 6 }}>
                Live Market Snapshot
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
                {/* Gold card */}
                {marketSnapshot.gold && (
                  <div style={{ padding: '8px 10px', border: '1px solid rgba(245,158,11,0.2)', background: 'rgba(245,158,11,0.04)' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>🥇 Gold (SAR/g)</div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: '#f59e0b' }}>{marketSnapshot.gold.karat24}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>24K</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#d97706' }}>{marketSnapshot.gold.karat22}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>22K</span>
                    </div>
                    {marketSnapshot.gold.trend7d?.length >= 2 && <MiniSparkline values={marketSnapshot.gold.trend7d} color="#f59e0b" />}
                  </div>
                )}
                {/* Crypto cards */}
                {marketSnapshot.crypto?.slice(0, 3).map(asset => (
                  <div key={asset.symbol} style={{ padding: '8px 10px', border: '1px solid rgba(99,102,241,0.15)', background: 'rgba(99,102,241,0.03)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, color: asset.symbol === 'BTC' ? '#f59e0b' : asset.symbol === 'ETH' ? '#6366f1' : '#10b981' }}>{asset.symbol}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>${asset.price.toLocaleString()}</span>
                      <MiniChange pct={asset.change24hPct} />
                    </div>
                    {asset.trend7d?.length >= 2 && <MiniSparkline values={asset.trend7d} color={asset.symbol === 'BTC' ? '#f59e0b' : asset.symbol === 'ETH' ? '#6366f1' : '#10b981'} />}
                  </div>
                ))}
                {/* Forex cards */}
                {marketSnapshot.forex?.map(fx => (
                  <div key={fx.pair} style={{ padding: '8px 10px', border: '1px solid rgba(16,185,129,0.15)', background: 'rgba(16,185,129,0.03)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{fx.pair}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#10b981' }}>{fx.rate.toFixed(4)}</span>
                      <MiniChange pct={fx.change24hPct} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {state === 'done' && (
            <button
              onClick={() => { setState('idle'); setBriefingText(''); setWeather(null); setMarketSnapshot(null); }}
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
