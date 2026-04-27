import { useState, useEffect, useCallback } from 'react';
import { Radio, Copy, Check, PhoneCall, PhoneMissed, Mic, X, Clock, Shield } from 'lucide-react';
import { supabase } from '../lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// NATO phonetic map
const NATO: Record<string, string> = {
  A:'Alpha',B:'Bravo',C:'Charlie',D:'Delta',E:'Echo',F:'Foxtrot',
  G:'Golf',H:'Hotel',J:'Juliet',K:'Kilo',M:'Mike',N:'November',
  P:'Papa',Q:'Quebec',R:'Romeo',S:'Sierra',T:'Tango',U:'Uniform',
  V:'Victor',W:'Whiskey',X:'X-ray',Y:'Yankee',Z:'Zulu',
  '2':'Two','3':'Three','4':'Four','5':'Five','6':'Six',
  '7':'Seven','8':'Eight','9':'Nine',
};
const toNato = (s: string) => s.split('').map(c => NATO[c] ?? c).join(' · ');

async function callEdge(fn: string, body: object): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

type SessionState = 'idle' | 'requesting' | 'incoming' | 'active' | 'ended';

interface IncomingPayload {
  requestId: string;
  from: string;
  callsign: string;
  reason: string | null;
  expiresAt: string;
  rogerSpeak: string;
}

export default function TuneIn() {
  const [myCallsign, setMyCallsign]   = useState<string | null>(null);
  const [copied, setCopied]           = useState(false);
  const [dialCode, setDialCode]       = useState('');
  const [dialReason, setDialReason]   = useState('');
  const [state, setState]             = useState<SessionState>('idle');
  const [incoming, setIncoming]       = useState<IncomingPayload | null>(null);
  const [countdown, setCountdown]     = useState(120);
  const [sessionId, setSessionId]     = useState<string | null>(null);
  const [withName, setWithName]       = useState<string | null>(null);
  const [sessionSecs, setSessionSecs] = useState(0);
  const [ghostHours, setGhostHours]   = useState(0);
  const [status, setStatus]           = useState('');

  // Load my callsign
  const loadCallsign = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase.from('user_callsigns')
      .select('callsign').eq('user_id', session.user.id).maybeSingle();
    if (data?.callsign) setMyCallsign(data.callsign);
  }, []);

  useEffect(() => { loadCallsign(); }, [loadCallsign]);

  // Realtime: listen for incoming tune-in requests
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      ch = supabase.channel(`tunein-${session.user.id}`)
        .on('broadcast', { event: 'tune_in_request' }, ({ payload }) => {
          const p = payload as IncomingPayload;
          setIncoming(p);
          setState('incoming');
          setCountdown(120);
          // Speak
          window.speechSynthesis?.cancel();
          const u = new SpeechSynthesisUtterance(p.rogerSpeak);
          window.speechSynthesis?.speak(u);
        })
        .on('broadcast', { event: 'tune_in_accepted' }, ({ payload }) => {
          const p = payload as { sessionId: string; withName: string; rogerSpeak: string };
          setSessionId(p.sessionId);
          setWithName(p.withName);
          setState('active');
          setSessionSecs(0);
          setStatus(`Channel open with ${p.withName}`);
          window.speechSynthesis?.cancel();
          const u = new SpeechSynthesisUtterance(p.rogerSpeak);
          window.speechSynthesis?.speak(u);
        })
        .on('broadcast', { event: 'tune_in_declined' }, ({ payload }) => {
          const p = payload as { rogerSpeak: string };
          setState('idle');
          setStatus('Request declined');
          window.speechSynthesis?.cancel();
          const u = new SpeechSynthesisUtterance(p.rogerSpeak);
          window.speechSynthesis?.speak(u);
        })
        .subscribe();
    });
    return () => { if (ch) supabase.removeChannel(ch); };
  }, []);

  // Incoming countdown
  useEffect(() => {
    if (state !== 'incoming') return;
    const t = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(t); setIncoming(null); setState('idle'); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [state]);

  // Active session timer
  useEffect(() => {
    if (state !== 'active') return;
    const t = setInterval(() => setSessionSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const handleDial = async () => {
    if (!dialCode.trim()) return;
    setState('requesting');
    setStatus('Requesting tune-in...');
    const res = await callEdge('request-tune-in', { targetCallsign: dialCode.toUpperCase(), reason: dialReason || undefined });
    if (res.ok) {
      setMyCallsign(res.myCallsign as string || myCallsign);
      setStatus(res.rogerResponse as string);
      // Stay in requesting state — wait for accepted/declined broadcast
    } else {
      setState('idle');
      setStatus(res.rogerResponse as string || 'Request failed');
    }
    setDialCode('');
    setDialReason('');
  };

  const handleAccept = async () => {
    if (!incoming) return;
    const res = await callEdge('accept-tune-in', { requestId: incoming.requestId });
    if (res.ok) {
      setSessionId(res.sessionId as string);
      setWithName(incoming.from);
      setState('active');
      setSessionSecs(0);
      setStatus(res.rogerResponse as string);
      setIncoming(null);
      const u = new SpeechSynthesisUtterance(res.rogerResponse as string);
      window.speechSynthesis?.speak(u);
    }
  };

  const handleDecline = async () => {
    if (!incoming) return;
    await callEdge('decline-tune-in', { requestId: incoming.requestId });
    setIncoming(null);
    setState('idle');
    setStatus('Declined');
  };

  const handleEnd = async () => {
    if (!sessionId) return;
    const res = await callEdge('end-tune-in', { sessionId });
    setState('ended');
    setStatus(res.rogerResponse as string || 'Session ended');
    window.speechSynthesis?.cancel();
    const u = new SpeechSynthesisUtterance(res.rogerResponse as string);
    window.speechSynthesis?.speak(u);
    setTimeout(() => setState('idle'), 4000);
  };

  const handleGhostMode = async () => {
    const hrs = ghostHours || 2;
    const until = new Date(Date.now() + hrs * 3_600_000).toISOString();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase.from('user_preferences')
      .upsert({ user_id: session.user.id, ghost_mode_until: until }, { onConflict: 'user_id' });
    setStatus(`Ghost mode: ${hrs}h — all requests will be declined automatically`);
  };

  const copyCallsign = () => {
    if (!myCallsign) return;
    navigator.clipboard?.writeText(myCallsign);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <Radio size={15} style={{ color: 'var(--amber)' }} />
        <div style={{ flex: 1 }}>
          <h1 style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.18em', color: 'var(--amber)', textTransform: 'uppercase', margin: 0 }}>
            TUNE IN
          </h1>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            LIVE PEER-TO-PEER · ROGER LISTENS
          </p>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── MY CALLSIGN ── */}
        <div style={{ padding: '20px 18px', background: 'rgba(212,160,68,0.06)', border: '1px solid rgba(212,160,68,0.3)', textAlign: 'center' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 10 }}>
            YOUR CALLSIGN
          </div>
          {myCallsign ? (
            <>
              <div style={{ fontFamily: 'monospace', fontSize: 32, fontWeight: 900, color: 'var(--amber)', letterSpacing: '0.25em', marginBottom: 6 }}>
                {myCallsign}
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginBottom: 14, letterSpacing: '0.05em' }}>
                {toNato(myCallsign)}
              </div>
              <button onClick={copyCallsign} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 16px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase',
                letterSpacing: '0.12em', cursor: 'pointer',
                background: copied ? 'rgba(16,185,129,0.12)' : 'rgba(212,160,68,0.1)',
                border: `1px solid ${copied ? '#10b981' : 'rgba(212,160,68,0.4)'}`,
                color: copied ? '#10b981' : 'var(--amber)',
              }}>
                {copied ? <Check size={10} /> : <Copy size={10} />}
                {copied ? 'COPIED' : 'COPY CODE'}
              </button>
              <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', marginTop: 10, opacity: 0.6 }}>
                Share this code with anyone to let them tune in with you
              </div>
            </>
          ) : (
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
              Sign in to get your callsign
            </div>
          )}
        </div>

        {/* ── INCOMING REQUEST ── */}
        {state === 'incoming' && incoming && (
          <div style={{
            padding: '16px 18px',
            background: 'rgba(59,130,246,0.08)', border: '2px solid rgba(59,130,246,0.5)',
            animation: 'pulse 1.2s infinite',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700 }}>
                INCOMING TUNE-IN REQUEST
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: countdown < 30 ? '#ef4444' : 'var(--text-muted)', fontWeight: 700 }}>
                {fmtTime(countdown)}
              </span>
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--text-primary)', marginBottom: 4, fontWeight: 700 }}>
              {incoming.from}
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginBottom: incoming.reason ? 8 : 14 }}>
              Callsign: {incoming.callsign}
            </div>
            {incoming.reason && (
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', fontStyle: 'italic', marginBottom: 14, padding: '8px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-subtle)' }}>
                "{incoming.reason}"
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleAccept} style={{
                flex: 1, padding: '9px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
                letterSpacing: '0.12em', cursor: 'pointer',
                background: 'rgba(16,185,129,0.15)', border: '1px solid #10b981', color: '#10b981',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <PhoneCall size={12} /> ACCEPT
              </button>
              <button onClick={handleDecline} style={{
                flex: 1, padding: '9px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
                letterSpacing: '0.12em', cursor: 'pointer',
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.5)', color: '#ef4444',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <PhoneMissed size={12} /> DECLINE
              </button>
            </div>
          </div>
        )}

        {/* ── ACTIVE SESSION BANNER ── */}
        {state === 'active' && sessionId && (
          <div style={{ padding: '16px 18px', background: 'rgba(16,185,129,0.08)', border: '2px solid rgba(16,185,129,0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', animation: 'pulse 1s infinite' }} />
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700 }}>
                  LIVE — {withName?.toUpperCase()}
                </span>
              </div>
              <span style={{ fontFamily: 'monospace', fontSize: 14, color: '#10b981', fontWeight: 900 }}>
                {fmtTime(sessionSecs)}
              </span>
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Roger is listening · Use PTT in Roger AI · Say "Roger, flag this" to mark key moments
            </p>
            <button onClick={handleEnd} style={{
              width: '100%', padding: '8px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
              letterSpacing: '0.12em', cursor: 'pointer',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.5)', color: '#ef4444',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <X size={11} /> END SESSION · CLOSE CHANNEL
            </button>
          </div>
        )}

        {/* ── DIAL A CALLSIGN ── */}
        {(state === 'idle' || state === 'requesting') && (
          <div style={{ padding: '16px 18px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: 12 }}>
              DIAL A CALLSIGN
            </div>

            <div style={{ marginBottom: 8 }}>
              <div style={fieldLabel}>CALLSIGN CODE</div>
              <input
                value={dialCode}
                onChange={e => setDialCode(e.target.value.toUpperCase().slice(0, 7))}
                placeholder="e.g. A2F34AC"
                maxLength={7}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 18, fontWeight: 900, letterSpacing: '0.3em', textTransform: 'uppercase', textAlign: 'center' }}
              />
              {dialCode.length === 7 && (
                <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', marginTop: 4, textAlign: 'center' }}>
                  {toNato(dialCode)}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={fieldLabel}>REASON (OPTIONAL — shown to recipient)</div>
              <input
                value={dialReason}
                onChange={e => setDialReason(e.target.value)}
                placeholder={`"About the Q2 project", "Quick question"`}
                onKeyDown={e => e.key === 'Enter' && handleDial()}
                style={inputStyle}
              />
            </div>

            <button
              onClick={handleDial}
              disabled={state === 'requesting' || dialCode.length !== 7}
              style={{
                width: '100%', padding: '9px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
                letterSpacing: '0.15em', cursor: 'pointer',
                background: state === 'requesting' ? 'rgba(212,160,68,0.05)' : 'rgba(212,160,68,0.14)',
                border: '1px solid var(--amber)', color: 'var(--amber)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: dialCode.length !== 7 ? 0.4 : 1,
              }}>
              {state === 'requesting'
                ? <><Clock size={11} style={{ animation: 'spin 1s linear infinite' }} /> WAITING FOR RESPONSE...</>
                : <><Mic size={11} /> REQUEST TUNE-IN</>
              }
            </button>
          </div>
        )}

        {/* ── STATUS LINE ── */}
        {status && (
          <div style={{ padding: '10px 14px', background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
              {status}
            </span>
          </div>
        )}

        {/* ── GHOST MODE ── */}
        {state === 'idle' && (
          <div style={{ padding: '14px 18px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Shield size={10} /> GHOST MODE
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: '0 0 10px' }}>
              All tune-in requests will be auto-declined. Callers see "unavailable".
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {[1, 2, 4, 8].map(h => (
                <button key={h} onClick={() => { setGhostHours(h); handleGhostMode(); }} style={{
                  flex: 1, padding: '5px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase',
                  cursor: 'pointer', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-muted)',
                }}>
                  {h}H
                </button>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)',
  padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)',
  outline: 'none', width: '100%', boxSizing: 'border-box',
};
