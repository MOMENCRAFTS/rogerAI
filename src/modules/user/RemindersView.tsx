import { useState, useEffect } from 'react';
import { Bell, CheckCircle2, X, Clock } from 'lucide-react';
import { fetchReminders, updateReminderStatus, subscribeToReminders, type DbReminder } from '../../lib/api';

type Filter = 'all' | 'pending' | 'geo' | 'done' | 'dismissed';

export default function RemindersView({ userId }: { userId: string }) {
  const [reminders, setReminders] = useState<DbReminder[]>([]);
  const [filter, setFilter]       = useState<Filter>('all');
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchReminders(userId)
      .then(data => { setReminders(data); setLoading(false); })
      .catch(() => setLoading(false));
    const sub = subscribeToReminders(userId, r => setReminders(prev => [r, ...prev]));
    return () => { sub.unsubscribe(); };
  }, [userId]);

  const filtered = (() => {
    if (filter === 'geo')  return reminders.filter(r => !!r.due_location);
    if (filter === 'all')  return reminders;
    return reminders.filter(r => r.status === filter);
  })();

  const pendingCount  = reminders.filter(r => r.status === 'pending').length;
  const geoWatching   = reminders.filter(r => !!r.due_location && !r.geo_triggered && r.status === 'pending').length;

  const markDone    = async (id: string) => {
    await updateReminderStatus(id, 'done').catch(() => {});
    setReminders(prev => prev.map(r => r.id === id ? { ...r, status: 'done' } : r));
  };
  const markDismiss = async (id: string) => {
    await updateReminderStatus(id, 'dismissed').catch(() => {});
    setReminders(prev => prev.map(r => r.id === id ? { ...r, status: 'dismissed' } : r));
  };

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all',       label: 'All' },
    { key: 'pending',   label: 'Pending' },
    { key: 'geo',       label: `📍 Geo${geoWatching > 0 ? ` (${geoWatching})` : ''}` },
    { key: 'done',      label: 'Done' },
    { key: 'dismissed', label: 'Dismissed' },
  ];

  return (
    <div style={{ padding: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Bell size={16} style={{ color: 'var(--amber)' }} />
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
          Reminders
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
          {pendingCount} PENDING
        </span>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto' }}>
        {FILTERS.map(({ key, label }) => {
          const isActive = filter === key;
          const isGeo    = key === 'geo';
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                flexShrink: 0, padding: '4px 12px',
                fontFamily: 'monospace', fontSize: 10,
                textTransform: 'uppercase', letterSpacing: '0.1em',
                cursor: 'pointer',
                border: `1px solid ${
                  isActive && isGeo ? 'rgba(74,222,128,0.6)' :
                  isActive          ? 'var(--amber)' :
                  'var(--border-subtle)'
                }`,
                background: isActive && isGeo
                  ? 'rgba(74,222,128,0.1)'
                  : isActive
                    ? 'rgba(212,160,68,0.1)'
                    : 'transparent',
                color: isActive && isGeo
                  ? '#4ade80'
                  : isActive
                    ? 'var(--amber)'
                    : 'var(--text-muted)',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Loading / empty states */}
      {loading && (
        <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>Loading...</p>
      )}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', opacity: 0.4 }}>
          <Bell size={28} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
            No reminders
          </p>
        </div>
      )}

      {/* Reminder cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(r => {
          const isGeoActive    = !!r.due_location && !r.geo_triggered && r.status === 'pending';
          const isGeoTriggered = !!r.due_location && r.geo_triggered;

          return (
            <div
              key={r.id}
              style={{
                padding: '12px 14px',
                border: `1px solid ${
                  isGeoActive         ? 'rgba(74,222,128,0.35)' :
                  r.status === 'done' ? 'rgba(74,222,128,0.15)' :
                  'var(--border-subtle)'
                }`,
                background: isGeoActive
                  ? 'rgba(74,222,128,0.05)'
                  : r.status === 'done'
                    ? 'rgba(74,222,128,0.04)'
                    : 'var(--bg-elevated)',
                opacity: r.status !== 'pending' ? 0.55 : 1,
                transition: 'border-color 0.2s, background 0.2s',
              }}
            >
              {/* Status row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{
                  fontFamily: 'monospace', fontSize: 9,
                  textTransform: 'uppercase', letterSpacing: '0.12em',
                  color: r.status === 'done'      ? 'var(--green)'      :
                         r.status === 'dismissed' ? 'var(--text-muted)' :
                         'var(--amber)',
                }}>
                  {r.status}
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                  {new Date(r.created_at).toLocaleString('en', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {/* Main text */}
              <p style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', margin: '0 0 8px', lineHeight: 1.4 }}>
                {r.text}
              </p>

              {/* Time-based due date (only when no geo location is set) */}
              {r.due_at && !r.due_location && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                  <Clock size={10} style={{ color: 'var(--amber)' }} />
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--amber)' }}>
                    {new Date(r.due_at).toLocaleString()}
                  </span>
                </div>
              )}

              {/* ── GEO BADGES ─────────────────────────────────────────── */}
              {isGeoActive && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  {/* Pulsing green dot */}
                  <span style={{
                    display: 'inline-block',
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: '#4ade80',
                    animation: 'geo-pulse 1.8s ease-in-out infinite',
                  }} />
                  {/* 📍 WATCHING pill */}
                  <span style={{
                    fontFamily: 'monospace', fontSize: 9,
                    textTransform: 'uppercase', letterSpacing: '0.12em',
                    color: '#4ade80',
                    padding: '2px 7px',
                    border: '1px solid rgba(74,222,128,0.4)',
                    background: 'rgba(74,222,128,0.08)',
                  }}>
                    📍 WATCHING · {r.due_location}
                  </span>
                </div>
              )}

              {isGeoTriggered && (
                <div style={{ marginBottom: 8 }}>
                  <span style={{
                    fontFamily: 'monospace', fontSize: 9,
                    textTransform: 'uppercase', letterSpacing: '0.1em',
                    color: 'var(--text-muted)',
                  }}>
                    ✓ GEO FIRED · {r.due_location}
                  </span>
                </div>
              )}
              {/* ──────────────────────────────────────────────────────── */}

              {/* Action buttons */}
              {r.status === 'pending' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => markDone(r.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', background: 'transparent', border: '1px solid var(--green-border)', color: 'var(--green)', cursor: 'pointer' }}
                  >
                    <CheckCircle2 size={10} /> Done
                  </button>
                  <button
                    onClick={() => markDismiss(r.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}
                  >
                    <X size={10} /> Dismiss
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Geo-pulse keyframe */}
      <style>{`
        @keyframes geo-pulse {
          0%   { box-shadow: 0 0 0 0   rgba(74,222,128,0.6); }
          70%  { box-shadow: 0 0 0 7px rgba(74,222,128,0);   }
          100% { box-shadow: 0 0 0 0   rgba(74,222,128,0);   }
        }
      `}</style>
    </div>
  );
}
