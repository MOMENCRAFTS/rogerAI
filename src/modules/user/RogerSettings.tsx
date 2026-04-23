import { useState, useEffect } from 'react';
import { Settings, Bell, BellOff, MapPin, Loader } from 'lucide-react';
import { fetchUserPreferences, upsertUserPreferences, savePushSubscription, deletePushSubscription, fetchPushSubscription, type DbUserPreferences } from '../../lib/api';
import { useLocation } from '../../lib/useLocation';

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

export default function RogerSettings({ userId }: { userId: string }) {
  const [prefs, setPrefs]         = useState<Partial<DbUserPreferences>>({ roger_mode: 'active', language: 'en', briefing_time: '08:00', briefing_time2: '18:00' });
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [pushState, setPushState] = useState<'unknown' | 'subscribed' | 'denied' | 'unsupported' | 'subscribing'>('unknown');
  const { locationLabel, permissionState: locPerm } = useLocation(userId);

  useEffect(() => {
    fetchUserPreferences(userId).then(p => { if (p) setPrefs(p); }).catch(() => {});
    checkPushState();
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const locColor = locPerm === 'granted' ? 'var(--green)' : locPerm === 'denied' ? '#ef4444' : 'var(--text-muted)';

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <Settings size={16} style={{ color: 'var(--amber)' }} />
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
          Roger Settings
        </span>
        {saving && <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>Saving...</span>}
        {saved  && <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 10, color: 'var(--green)' }}>✓ Saved</span>}
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
