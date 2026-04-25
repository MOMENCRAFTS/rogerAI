import { useState, useEffect } from 'react';
import { Settings, Bell, BellOff, MapPin, Loader, Volume2, Zap, Radio, Copy, Check, LogOut, Moon } from 'lucide-react';
import { fetchUserPreferences, upsertUserPreferences, savePushSubscription, deletePushSubscription, fetchPushSubscription, flushTourSeen, resetOrientationSeen, type DbUserPreferences } from '../../lib/api';
import { useLocation } from '../../lib/useLocation';
import { setHapticsEnabled } from '../../lib/haptics';
import { setSfxEnabled, setSfxVolume } from '../../lib/sfx';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

type Mode = 'quiet' | 'active' | 'briefing';

const MODE_INFO: Record<Mode, { emoji: string; desc: string }> = {
  quiet:    { emoji: '🔇', desc: 'Only respond when you press PTT. Never speaks first.' },
  active:   { emoji: '📡', desc: 'Responds to PTT + proactively surfaces items when idle.' },
  briefing: { emoji: '🎙', desc: 'Scheduled summaries only (8am & 6pm). Quiet between them.' },
};

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

export default function RogerSettings({ userId, onReplayTour, onReplayOrientation }: { userId: string; onReplayTour?: () => void; onReplayOrientation?: () => void }) {
  const { user, signOut }         = useAuth();
  const [prefs, setPrefs]         = useState<Partial<DbUserPreferences>>({ roger_mode: 'active', language: 'en', briefing_time: '08:00', briefing_time2: '18:00', haptic_enabled: true, sfx_enabled: true });
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [pushState, setPushState] = useState<'unknown' | 'subscribed' | 'denied' | 'unsupported' | 'subscribing'>('unknown');
  const [sfxVol, setSfxVol]       = useState<number>(() => Number(localStorage.getItem('sfxVolume') ?? 0.35));
  const [callsign, setCallsign]   = useState<string | null>(null);
  const [copied, setCopied]       = useState(false);
  const { locationLabel, permissionState: locPerm } = useLocation(userId);

  useEffect(() => {
    fetchUserPreferences(userId).then(p => { if (p) setPrefs(p); }).catch(() => {});
    checkPushState();
    // Load callsign
    (async () => {
      try {
        const { data } = await supabase.from('user_callsigns').select('callsign').eq('user_id', userId).maybeSingle();
        if (data?.callsign) setCallsign(data.callsign);
      } catch { /* silent */ }
    })();
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyCallsign = () => {
    if (!callsign) return;
    navigator.clipboard.writeText(callsign).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const checkPushState = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setPushState('unsupported'); return; }
    const existing = await fetchPushSubscription(userId).catch(() => null);
    setPushState(existing ? 'subscribed' : 'unknown');
  };

  const subscribeToPush = async () => {
    if (!VAPID_PUBLIC_KEY) { alert('Add VITE_VAPID_PUBLIC_KEY to .env.local. Run: npx web-push generate-vapid-keys'); return; }
    setPushState('subscribing');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });
      await savePushSubscription(userId, sub);
      setPushState('subscribed');
    } catch (err) {
      console.error('[Push] Subscribe failed:', err);
      const perm = await navigator.permissions.query({ name: 'notifications' });
      setPushState(perm.state === 'denied' ? 'denied' : 'unknown');
    }
  };

  const unsubscribeFromPush = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await deletePushSubscription(userId, sub.endpoint);
        await sub.unsubscribe();
      }
      setPushState('unknown');
    } catch { /* silent */ }
  };

  const saveMode = async (mode: Mode) => {
    setPrefs(p => ({ ...p, roger_mode: mode }));
    setSaving(true);
    await upsertUserPreferences(userId, { roger_mode: mode }).catch(() => {});
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const saveTime = async (field: 'briefing_time' | 'briefing_time2', val: string) => {
    setPrefs(p => ({ ...p, [field]: val }));
    await upsertUserPreferences(userId, { [field]: val }).catch(() => {});
  };

  const saveToggle = async (field: 'haptic_enabled' | 'sfx_enabled', val: boolean) => {
    setPrefs(p => ({ ...p, [field]: val }));
    if (field === 'haptic_enabled') setHapticsEnabled(val);
    if (field === 'sfx_enabled')   setSfxEnabled(val);
    await upsertUserPreferences(userId, { [field]: val }).catch(() => {});
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  };

  const handleSfxVolume = (v: number) => {
    setSfxVol(v); setSfxVolume(v);
    localStorage.setItem('sfxVolume', String(v));
  };

  const locColor = locPerm === 'granted' ? 'var(--green)' : locPerm === 'denied' ? '#ef4444' : 'var(--text-muted)';

  return (
    <div style={{ padding: '16px' }}>

      {/* ── Replay Orientation ── */}
      {onReplayOrientation && (
        <div style={{ marginBottom: 10, padding: '14px 16px', background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.2)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <Zap size={18} style={{ color: '#a855f7', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px', fontWeight: 600 }}>Orientation</p>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Walk through all 10 capability chapters again.</p>
          </div>
          <button
            onClick={() => { resetOrientationSeen(userId).catch(() => {}); onReplayOrientation(); }}
            style={{ flexShrink: 0, padding: '8px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7', cursor: 'pointer', transition: 'background 150ms' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(168,85,247,0.2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(168,85,247,0.1)')}
          >
            Replay
          </button>
        </div>
      )}

      {/* ── Replay Mission Brief ── */}
      {onReplayTour && (
        <div style={{ marginBottom: 20, padding: '14px 16px', background: 'rgba(212,160,68,0.05)', border: '1px solid rgba(212,160,68,0.2)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <Radio size={18} style={{ color: 'var(--amber)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px', fontWeight: 600 }}>Mission Brief</p>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Review Roger's capabilities from the beginning.</p>
          </div>
          <button
            onClick={() => { flushTourSeen(userId).catch(() => {}); onReplayTour(); }}
            style={{ flexShrink: 0, padding: '8px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'rgba(212,160,68,0.1)', border: '1px solid rgba(212,160,68,0.3)', color: 'var(--amber)', cursor: 'pointer', transition: 'background 150ms' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(212,160,68,0.2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(212,160,68,0.1)')}
          >
            Replay
          </button>
        </div>
      )}

      {/* ── Account Card ── */}
      <div style={{ marginBottom: 24, padding: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          {/* Avatar */}
          {user?.user_metadata?.avatar_url ? (
            <img src={user.user_metadata.avatar_url} alt="avatar" style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid rgba(212,160,68,0.3)' }} />
          ) : (
            <div style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid rgba(212,160,68,0.3)', background: 'rgba(212,160,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 18, color: 'var(--amber)' }}>
                {(user?.user_metadata?.full_name ?? user?.email ?? 'U')[0].toUpperCase()}
              </span>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--text-primary)', margin: '0 0 2px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.user_metadata?.full_name ?? 'Roger User'}
            </p>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email}
            </p>
          </div>
        </div>

        {/* Callsign row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'rgba(212,160,68,0.06)', border: '1px solid rgba(212,160,68,0.2)', marginBottom: 12 }}>
          <Radio size={13} style={{ color: 'var(--amber)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', margin: '0 0 2px' }}>Your Roger Callsign</p>
            <p style={{ fontFamily: 'monospace', fontSize: 16, color: 'var(--amber)', margin: 0, fontWeight: 700, letterSpacing: '0.1em' }}>
              {callsign ?? '—'}
            </p>
          </div>
          {callsign && (
            <button onClick={copyCallsign} title="Copy callsign" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', background: copied ? 'rgba(74,222,128,0.1)' : 'transparent', border: `1px solid ${copied ? 'var(--green-border)' : 'var(--border-subtle)'}`, color: copied ? 'var(--green)' : 'var(--text-muted)', cursor: 'pointer', transition: 'all 150ms' }}>
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>

        {/* Sign out */}
        <button onClick={signOut} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', background: 'transparent', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', cursor: 'pointer', transition: 'background 150ms' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.06)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <LogOut size={12} /> Sign Out
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <Settings size={16} style={{ color: 'var(--amber)' }} />
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
          Roger Settings
        </span>

        {saving && <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>Saving...</span>}
        {saved  && <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 10, color: 'var(--green)' }}>✓ Saved</span>}
      </div>

      {/* ── Language ── */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>Response Language</p>
        <div style={{ display: 'flex', gap: 8 }}>
          {([
            { code: 'en', label: '🇬🇧  English' },
            { code: 'ar', label: '🇸🇦  العربية' },
            { code: 'fr', label: '🇫🇷  Français' },
          ] as { code: string; label: string }[]).map(({ code, label }) => {
            const active = (prefs.language ?? 'en') === code;
            return (
              <button key={code}
                onClick={() => setPrefs(p => ({ ...p, language: code }))}
                style={{ flex: 1, padding: '10px 6px', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', transition: 'all 150ms',
                  border: `1px solid ${active ? 'var(--amber)' : 'var(--border-subtle)'}`,
                  background: active ? 'rgba(212,160,68,0.1)' : 'var(--bg-elevated)',
                  color: active ? 'var(--amber)' : 'var(--text-muted)',
                  letterSpacing: '0.04em',
                }}>
                {label}
              </button>
            );
          })}
        </div>
        <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: '6px 0 0', letterSpacing: '0.1em' }}>
          Roger will reply in this language — save to apply.
        </p>
      </div>

      {/* Location Status */}
      <div style={{ marginBottom: 24, padding: '12px 14px', border: `1px solid ${locColor}33`, background: `${locColor}0a`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <MapPin size={13} style={{ color: locColor, flexShrink: 0 }} />
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 2px' }}>Location Awareness</p>
          <p style={{ fontFamily: 'monospace', fontSize: 12, color: locColor, margin: 0 }}>{locationLabel}</p>
        </div>
        {locPerm === 'denied' && (
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#ef4444', margin: '0 0 0 auto', lineHeight: 1.4, maxWidth: 180, textAlign: 'right' }}>
            Allow location in browser settings so Roger knows where you are.
          </p>
        )}
      </div>

      {/* Push Notifications */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>Notifications</p>
        <div style={{ padding: '14px 16px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 12 }}>
          {pushState === 'subscribed'
            ? <Bell size={18} style={{ color: 'var(--green)', flexShrink: 0 }} />
            : pushState === 'denied'
            ? <BellOff size={18} style={{ color: '#ef4444', flexShrink: 0 }} />
            : <Bell size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          }
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: pushState === 'subscribed' ? 'var(--green)' : pushState === 'denied' ? '#ef4444' : 'var(--text-primary)', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {pushState === 'subscribed'   ? 'Push Notifications Active'
               : pushState === 'denied'     ? 'Notifications Blocked'
               : pushState === 'unsupported'? 'Not Supported'
               :                             'Push Notifications Off'}
            </p>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              {pushState === 'subscribed'   ? 'Roger will alert you for reminders, tasks, and briefings.'
               : pushState === 'denied'     ? 'Allow notifications in your browser settings.'
               : pushState === 'unsupported'? 'Your browser does not support Web Push.'
               :                             'Enable to receive reminders and morning briefings.'}
            </p>
          </div>
          {pushState === 'subscribing' && <Loader size={14} style={{ color: 'var(--amber)', animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
          {pushState === 'unknown'     && <button onClick={subscribeToPush} style={{ flexShrink: 0, padding: '8px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'rgba(212,160,68,0.1)', border: '1px solid rgba(212,160,68,0.3)', color: 'var(--amber)', cursor: 'pointer' }}>Enable</button>}
          {pushState === 'subscribed'  && <button onClick={unsubscribeFromPush} style={{ flexShrink: 0, padding: '8px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}>Disable</button>}
        </div>
      </div>

      {/* ── Feedback & Sound ── */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>Feedback &amp; Sound</p>

        {/* Haptic Feedback toggle */}
        <div style={{ padding: '14px 16px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Zap size={14} style={{ color: prefs.haptic_enabled ? 'var(--amber)' : 'var(--text-muted)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>Haptic Feedback</p>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Vibration on PTT press, response, and alerts</p>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[true, false].map(val => (
              <button key={String(val)} onClick={() => saveToggle('haptic_enabled', val)}
                style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
                  border: `1px solid ${prefs.haptic_enabled === val ? 'var(--amber)' : 'var(--border-subtle)'}`,
                  background: prefs.haptic_enabled === val ? 'rgba(212,160,68,0.12)' : 'transparent',
                  color: prefs.haptic_enabled === val ? 'var(--amber)' : 'var(--text-muted)' }}>
                {val ? 'On' : 'Off'}
              </button>
            ))}
          </div>
        </div>

        {/* PTT Sound Effects toggle */}
        <div style={{ padding: '14px 16px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Volume2 size={14} style={{ color: prefs.sfx_enabled ? 'var(--amber)' : 'var(--text-muted)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>PTT Sound Effects</p>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Radio clicks and channel tones on PTT events</p>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[true, false].map(val => (
              <button key={String(val)} onClick={() => saveToggle('sfx_enabled', val)}
                style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
                  border: `1px solid ${prefs.sfx_enabled === val ? 'var(--amber)' : 'var(--border-subtle)'}`,
                  background: prefs.sfx_enabled === val ? 'rgba(212,160,68,0.12)' : 'transparent',
                  color: prefs.sfx_enabled === val ? 'var(--amber)' : 'var(--text-muted)' }}>
                {val ? 'On' : 'Off'}
              </button>
            ))}
          </div>
        </div>

        {/* SFX Volume slider — only shown when SFX is on */}
        {prefs.sfx_enabled && (
          <div style={{ padding: '12px 16px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Volume2 size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>SFX Volume</span>
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--amber)' }}>{Math.round(sfxVol * 100)}%</span>
              </div>
              <input type="range" min={0} max={1} step={0.05} value={sfxVol}
                onChange={e => handleSfxVolume(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--amber)' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Mode selector */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>Operating Mode</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(Object.entries(MODE_INFO) as [Mode, typeof MODE_INFO[Mode]][]).map(([mode, info]) => {
            const active = prefs.roger_mode === mode;
            return (
              <button key={mode} onClick={() => saveMode(mode)} style={{ padding: '14px 16px', textAlign: 'left', cursor: 'pointer', border: `1px solid ${active ? 'var(--amber)' : 'var(--border-subtle)'}`, background: active ? 'rgba(212,160,68,0.08)' : 'var(--bg-elevated)', display: 'flex', alignItems: 'flex-start', gap: 12, transition: 'all 150ms' }}>
                <span style={{ fontSize: 20 }}>{info.emoji}</span>
                <div>
                  <p style={{ fontFamily: 'monospace', fontSize: 12, color: active ? 'var(--amber)' : 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 4px', fontWeight: active ? 600 : 400 }}>{mode}</p>
                  <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{info.desc}</p>
                </div>
                {active && <span style={{ marginLeft: 'auto', color: 'var(--amber)', fontSize: 14 }}>●</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Briefing times */}
      {prefs.roger_mode === 'briefing' && (
        <div style={{ marginBottom: 28 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>Briefing Times</p>
          <div style={{ display: 'flex', gap: 16 }}>
            {(['briefing_time', 'briefing_time2'] as const).map((field, i) => (
              <div key={field} style={{ flex: 1 }}>
                <label style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>{i === 0 ? 'Morning' : 'Evening'}</label>
                <input type="time" value={prefs[field] ?? (i === 0 ? '08:00' : '18:00')}
                  onChange={e => saveTime(field, e.target.value)}
                  style={{ width: '100%', padding: '8px', fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Language */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>Language</p>
        <select value={prefs.language ?? 'en'}
          onChange={e => { setPrefs(p => ({ ...p, language: e.target.value })); upsertUserPreferences(userId, { language: e.target.value }).catch(() => {}); }}
          style={{ width: '100%', padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }}>
          <option value="en">English (Auto-detect)</option>
          <option value="ar">Arabic</option>
          <option value="fr">French</option>
          <option value="es">Spanish</option>
        </select>
      </div>


      {/* ── Islamic Mode ── */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>Islamic Mode</p>

        <div style={{ padding: '14px 16px', border: `1px solid ${(prefs as Record<string, unknown>).islamic_mode ? 'rgba(16,185,129,0.35)' : 'var(--border-subtle)'}`, background: (prefs as Record<string, unknown>).islamic_mode ? 'rgba(16,185,129,0.07)' : 'var(--bg-elevated)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, transition: 'all 200ms' }}>
          <Moon size={18} style={{ color: (prefs as Record<string, unknown>).islamic_mode ? '#10b981' : 'var(--text-muted)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: (prefs as Record<string, unknown>).islamic_mode ? '#10b981' : 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px', fontWeight: 600 }}>Islamic Mode</p>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Prayer times, Qibla compass, salah reminders, and verse of the day</p>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[true, false].map(val => {
              const active = !!(prefs as Record<string, unknown>).islamic_mode === val;
              return (
                <button key={String(val)}
                  id={`islamic-mode-toggle-${val ? 'on' : 'off'}`}
                  onClick={() => {
                    const next = { ...prefs, islamic_mode: val } as Record<string, unknown>;
                    setPrefs(next as typeof prefs);
                    upsertUserPreferences(userId, { islamic_mode: val } as Parameters<typeof upsertUserPreferences>[1]).catch(() => {});
                    setSaved(true); setTimeout(() => setSaved(false), 1500);
                  }}
                  style={{
                    padding: '6px 12px', fontFamily: 'monospace', fontSize: 10,
                    textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
                    border: `1px solid ${active ? 'rgba(16,185,129,0.5)' : 'var(--border-subtle)'}`,
                    background: active ? 'rgba(16,185,129,0.15)' : 'transparent',
                    color: active ? '#10b981' : 'var(--text-muted)',
                  }}>
                  {val ? 'On' : 'Off'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Prayer notifications sub-toggle — shown only when Islamic Mode is on */}
        {!!(prefs as Record<string, unknown>).islamic_mode && (
          <div style={{ padding: '12px 16px', border: '1px solid rgba(16,185,129,0.15)', background: 'rgba(16,185,129,0.04)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Bell size={14} style={{ color: '#10b981', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>Prayer Notifications</p>
              <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Voice alert 10 minutes before each prayer</p>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[true, false].map(val => {
                const active = (prefs as Record<string, unknown>).prayer_notifications !== false ? val === true : val === false;
                return (
                  <button key={String(val)}
                    id={`prayer-notif-toggle-${val ? 'on' : 'off'}`}
                    onClick={() => {
                      const next = { ...prefs, prayer_notifications: val } as Record<string, unknown>;
                      setPrefs(next as typeof prefs);
                      upsertUserPreferences(userId, { prayer_notifications: val } as Parameters<typeof upsertUserPreferences>[1]).catch(() => {});
                    }}
                    style={{
                      padding: '5px 10px', fontFamily: 'monospace', fontSize: 10,
                      textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
                      border: `1px solid ${active ? 'rgba(16,185,129,0.4)' : 'var(--border-subtle)'}`,
                      background: active ? 'rgba(16,185,129,0.1)' : 'transparent',
                      color: active ? '#10b981' : 'var(--text-muted)',
                    }}>
                    {val ? 'On' : 'Off'}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Prayer calculation method */}
        {!!(prefs as Record<string, unknown>).islamic_mode && (
          <div style={{ padding: '12px 16px', border: '1px solid rgba(16,185,129,0.12)', background: 'rgba(16,185,129,0.03)' }}>
            <label style={{ display: 'block', fontFamily: 'monospace', fontSize: 9, color: 'rgba(16,185,129,0.7)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 6 }}>Prayer Calculation Method</label>
            <select
              id="prayer-method-select"
              value={String((prefs as Record<string, unknown>).prayer_method ?? 3)}
              onChange={e => {
                const method = Number(e.target.value);
                const next = { ...prefs, prayer_method: method } as Record<string, unknown>;
                setPrefs(next as typeof prefs);
                upsertUserPreferences(userId, { prayer_method: method } as Parameters<typeof upsertUserPreferences>[1]).catch(() => {});
              }}
              style={{ width: '100%', padding: '8px 10px', fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-recessed)', border: '1px solid rgba(16,185,129,0.2)', color: 'var(--text-primary)', outline: 'none' }}>
              <option value="3">Muslim World League (MWL) — Global</option>
              <option value="2">ISNA — North America</option>
              <option value="4">Umm Al-Qura — Saudi Arabia / Makkah</option>
              <option value="5">Egyptian General Authority</option>
            </select>
          </div>
        )}
      </div>

      {/* ── Integrations ── */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>Integrations</p>

        {/* Google Calendar */}
        <div style={{ padding: '14px 16px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>📅</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px', fontWeight: 600 }}>Google Calendar</p>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: prefs.gcal_connected ? 'var(--green)' : 'var(--text-muted)', margin: 0 }}>
              {prefs.gcal_connected ? '● Connected — Roger reads & books events' : 'Not connected — speak "book a meeting" to test'}
            </p>
          </div>
          <button
            onClick={() => {
              if (prefs.gcal_connected) {
                import('../../lib/googleCalendar').then(({ disconnectGoogleCalendar }) => {
                  disconnectGoogleCalendar(userId).then(() => setPrefs(p => ({ ...p, gcal_connected: false }))).catch(() => {});
                });
              } else {
                import('../../lib/googleCalendar').then(({ connectGoogleCalendar }) => {
                  connectGoogleCalendar(`${window.location.origin}/gcal-callback`);
                });
              }
            }}
            style={{ flexShrink: 0, padding: '7px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer',
              background: prefs.gcal_connected ? 'rgba(239,68,68,0.08)' : 'rgba(212,160,68,0.08)',
              border: `1px solid ${prefs.gcal_connected ? 'rgba(239,68,68,0.3)' : 'rgba(212,160,68,0.3)'}`,
              color: prefs.gcal_connected ? '#f87171' : 'var(--amber)',
            }}
          >{prefs.gcal_connected ? 'Disconnect' : 'Connect'}</button>
        </div>

        {/* Finnhub Finance */}
        <div style={{ padding: '14px 16px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: prefs.finnhub_tickers?.length ? 10 : 0 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>📈</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px', fontWeight: 600 }}>Finnhub Finance</p>
              <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Add API key to .env.local · Say "what's Apple at?" or "market brief"</p>
            </div>
          </div>
          {prefs.finnhub_tickers?.length ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {prefs.finnhub_tickers.map(t => (
                <span key={t} style={{ fontFamily: 'monospace', fontSize: 9, padding: '2px 8px', border: '1px solid rgba(212,160,68,0.3)', color: 'var(--amber)' }}>{t}</span>
              ))}
            </div>
          ) : (
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(212,160,68,0.4)', margin: '6px 0 0' }}>
              Say "watch Apple" to add to watchlist
            </p>
          )}
        </div>

        {/* AviationStack */}
        <div style={{ padding: '14px 16px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>✈️</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px', fontWeight: 600 }}>Flight Tracking</p>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Add VITE_AVIATIONSTACK_API_KEY to .env.local · Say "status of EK204"</p>
          </div>
          <span style={{ fontFamily: 'monospace', fontSize: 8, padding: '2px 8px', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', flexShrink: 0 }}>AviationStack</span>
        </div>

        {/* Twilio SMS */}
        <div style={{ padding: '14px 16px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>💬</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px', fontWeight: 600 }}>Twilio SMS</p>
              <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Say "text Ahmad I'll be late" to send real SMS</p>
            </div>
          </div>
          <label style={{ display: 'block', fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 5 }}>Your sending phone number (Twilio number)</label>
          <input
            type="tel"
            placeholder="+12025551234"
            value={prefs.twilio_phone ?? ''}
            onChange={e => setPrefs(p => ({ ...p, twilio_phone: e.target.value }))}
            onBlur={e => { if (e.target.value) upsertUserPreferences(userId, { twilio_phone: e.target.value }).catch(() => {}); }}
            style={{ width: '100%', padding: '8px 10px', fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* Spotify */}
        <div style={{ padding: '14px 16px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>🎵</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px', fontWeight: 600 }}>Spotify</p>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>
              {prefs.spotify_connected ? '● Session active — say "play focused music" or "pause"' : 'Connect to control music by voice (Premium required for playback)'}
            </p>
          </div>
          <button
            onClick={() => {
              if (prefs.spotify_connected) {
                import('../../lib/spotify').then(({ disconnectSpotify }) => { disconnectSpotify(); setPrefs(p => ({ ...p, spotify_connected: false })); });
              } else {
                import('../../lib/spotify').then(({ connectSpotify }) => { connectSpotify().catch(() => {}); });
              }
            }}
            style={{ flexShrink: 0, padding: '7px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer',
              background: prefs.spotify_connected ? 'rgba(239,68,68,0.08)' : 'rgba(30,215,96,0.08)',
              border: `1px solid ${prefs.spotify_connected ? 'rgba(239,68,68,0.3)' : 'rgba(30,215,96,0.3)'}`,
              color: prefs.spotify_connected ? '#f87171' : 'rgb(30,215,96)',
            }}
          >{prefs.spotify_connected ? 'Disconnect' : 'Connect'}</button>
        </div>

        {/* Notion */}
        <div style={{ padding: '14px 16px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>📓</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px', fontWeight: 600 }}>Notion</p>
              <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Say "log this to Notion" to push session notes and tasks</p>
            </div>
          </div>
          <label style={{ display: 'block', fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 5 }}>Internal Integration Token</label>
          <input
            type="password"
            placeholder="secret_..."
            value={prefs.notion_token ?? ''}
            onChange={e => setPrefs(p => ({ ...p, notion_token: e.target.value }))}
            onBlur={e => { if (e.target.value) upsertUserPreferences(userId, { notion_token: e.target.value }).catch(() => {}); }}
            style={{ width: '100%', padding: '8px 10px', fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
          />
          <label style={{ display: 'block', fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 5 }}>Database / Page ID (for tasks)</label>
          <input
            type="text"
            placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            value={prefs.notion_db_id ?? ''}
            onChange={e => setPrefs(p => ({ ...p, notion_db_id: e.target.value }))}
            onBlur={e => { if (e.target.value) upsertUserPreferences(userId, { notion_db_id: e.target.value }).catch(() => {}); }}
            style={{ width: '100%', padding: '8px 10px', fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
          />
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(212,160,68,0.4)', margin: '6px 0 0', lineHeight: 1.4 }}>
            Create a Notion Integration at notion.so/my-integrations · Share your database with the integration
          </p>
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: '12px', background: 'rgba(212,160,68,0.04)', border: '1px solid rgba(212,160,68,0.15)', marginTop: 8 }}>
        <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          Changes apply immediately. Voice commands also work:<br />
          <span style={{ color: 'var(--amber)' }}>"Go quiet"</span> · <span style={{ color: 'var(--amber)' }}>"Stay active"</span> · <span style={{ color: 'var(--amber)' }}>"Brief me at 8am"</span> · <span style={{ color: 'var(--amber)' }}>"How long to [place]?"</span>
        </p>
      </div>
    </div>
  );
}
