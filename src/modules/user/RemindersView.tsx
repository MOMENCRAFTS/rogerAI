import { useState, useEffect, useRef } from 'react';
import { Bell, CheckCircle2, X, Clock, MapPin, Plus, ChevronUp, Pencil, Check, Repeat } from 'lucide-react';
import { fetchReminders, updateReminderStatus, updateReminderRecurrence, subscribeToReminders, insertReminder, type DbReminder } from '../../lib/api';
import { useI18n } from '../../context/I18nContext';

type Filter = 'all' | 'pending' | 'geo' | 'recurring' | 'done' | 'dismissed';
type RecurrenceRule = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom' | null;
const RECURRENCE_OPTIONS: { value: RecurrenceRule; label: string }[] = [
  { value: null,       label: 'None' },
  { value: 'daily',    label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly',   label: 'Weekly' },
  { value: 'monthly',  label: 'Monthly' },
  { value: 'custom',   label: 'Custom Days' },
];
const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

interface NewReminder {
  text: string;
  due_date: string;
  due_time: string;
  due_location: string;
  recurrence_rule: RecurrenceRule;
  recurrence_days: number[];
}

const EMPTY_NEW: NewReminder = { text: '', due_date: '', due_time: '', due_location: '', recurrence_rule: null, recurrence_days: [] };

export default function RemindersView({ userId }: { userId: string }) {
  const { t: _t } = useI18n();
  const [reminders, setReminders] = useState<DbReminder[]>([]);
  const [filter, setFilter]       = useState<Filter>('all');
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [newR, setNewR]           = useState<NewReminder>(EMPTY_NEW);
  const [saving, setSaving]       = useState(false);
  const [editId, setEditId]       = useState<string | null>(null);
  const [editText, setEditText]   = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);

  const loadReminders = () => {
    setLoading(true);
    fetchReminders(userId)
      .then(data => { setReminders(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadReminders();
    const sub = subscribeToReminders(userId, r => setReminders(prev => [r, ...prev]));
    // Also refresh on roger:refresh (fired after voice-confirmed writes)
    const onRefresh = () => loadReminders();
    window.addEventListener('roger:refresh', onRefresh);
    return () => { sub.unsubscribe(); window.removeEventListener('roger:refresh', onRefresh); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (showForm) setTimeout(() => textRef.current?.focus(), 50);
  }, [showForm]);

  const filtered = (() => {
    if (filter === 'geo')       return reminders.filter(r => !!r.due_location);
    if (filter === 'recurring') return reminders.filter(r => !!r.recurrence_rule);
    if (filter === 'all')       return reminders;
    return reminders.filter(r => r.status === filter);
  })();
  const recurringCount = reminders.filter(r => !!r.recurrence_rule && r.status === 'pending').length;

  const pendingCount = reminders.filter(r => r.status === 'pending').length;
  const geoWatching  = reminders.filter(r => !!r.due_location && !r.geo_triggered && r.status === 'pending').length;

  const markDone    = async (id: string) => {
    await updateReminderStatus(id, 'done').catch(() => {});
    setReminders(prev => prev.map(r => r.id === id ? { ...r, status: 'done' } : r));
  };
  const markDismiss = async (id: string) => {
    await updateReminderStatus(id, 'dismissed').catch(() => {});
    setReminders(prev => prev.map(r => r.id === id ? { ...r, status: 'dismissed' } : r));
  };

  const handleCreate = async () => {
    if (!newR.text.trim()) return;
    setSaving(true);
    const due_at = newR.due_date
      ? new Date(`${newR.due_date}T${newR.due_time || '09:00'}`).toISOString()
      : null;
    try {
      const created = await insertReminder({
        user_id: userId, text: newR.text.trim(),
        entities: null, due_at, status: 'pending',
        source_tx_id: null, is_admin_test: false,
        due_location: newR.due_location.trim() || null,
        due_location_lat: null, due_location_lng: null,
        due_radius_m: 300, geo_triggered: false,
        recurrence_rule: newR.recurrence_rule,
        recurrence_time: newR.due_time || null,
        recurrence_days: newR.recurrence_rule === 'custom' && newR.recurrence_days.length > 0 ? newR.recurrence_days : null,
      });
      if (created) setReminders(prev => [created, ...prev]);
    } catch { /* silent */ }
    setNewR(EMPTY_NEW);
    setShowForm(false);
    setSaving(false);
  };

  const stopRecurring = async (id: string) => {
    await updateReminderRecurrence(id, null, null, null).catch(() => {});
    setReminders(prev => prev.map(r => r.id === id ? { ...r, recurrence_rule: null, recurrence_time: null, recurrence_days: null } : r));
  };

  const startEdit = (r: DbReminder) => { setEditId(r.id); setEditText(r.text); };
  const saveEdit  = async (id: string) => {
    if (!editText.trim()) return;
    await import('../../lib/supabase').then(({ supabase }) =>
      supabase.from('reminders').update({ text: editText.trim() }).eq('id', id)
    ).catch(() => {});
    setReminders(prev => prev.map(r => r.id === id ? { ...r, text: editText.trim() } : r));
    setEditId(null);
  };

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all',       label: 'All' },
    { key: 'pending',   label: 'Pending' },
    { key: 'geo',       label: `Geo${geoWatching > 0 ? ` (${geoWatching})` : ''}` },
    { key: 'recurring', label: `Recurring${recurringCount > 0 ? ` (${recurringCount})` : ''}` },
    { key: 'done',      label: 'Done' },
    { key: 'dismissed', label: 'Dismissed' },
  ];

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '8px 10px',
    fontFamily: 'monospace', fontSize: 12,
    background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)',
    color: 'var(--text-primary)', outline: 'none',
  };

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
        <button
          onClick={() => { setShowForm(f => !f); setNewR(EMPTY_NEW); }}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', background: showForm ? 'rgba(212,160,68,0.12)' : 'transparent', border: `1px solid ${showForm ? 'var(--amber)' : 'var(--border-subtle)'}`, color: showForm ? 'var(--amber)' : 'var(--text-muted)', cursor: 'pointer', transition: 'all 150ms' }}
        >
          {showForm ? <ChevronUp size={12} /> : <Plus size={12} />}
          {showForm ? 'Cancel' : 'New'}
        </button>
      </div>

      {/* ── Create Form ── */}
      {showForm && (
        <div style={{ marginBottom: 16, padding: '14px 16px', background: 'rgba(212,160,68,0.04)', border: '1px solid rgba(212,160,68,0.2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            ref={textRef}
            rows={2}
            value={newR.text}
            onChange={e => setNewR(p => ({ ...p, text: e.target.value }))}
            placeholder="What should Roger remind you about?"
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleCreate(); }}
            style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>
                Due Date
              </label>
              <input type="date" value={newR.due_date} onChange={e => setNewR(p => ({ ...p, due_date: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>
                Time
              </label>
              <input type="time" value={newR.due_time} onChange={e => setNewR(p => ({ ...p, due_time: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>
              <MapPin size={9} style={{ display: 'inline', marginRight: 3 }} />Location Trigger (optional)
            </label>
            <input type="text" value={newR.due_location} onChange={e => setNewR(p => ({ ...p, due_location: e.target.value }))} placeholder="e.g. Office, Supermarket..." style={inputStyle} />
          </div>
          {/* ── Recurrence Picker ── */}
          <div>
            <label style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>
              <Repeat size={9} style={{ display: 'inline', marginRight: 3 }} />Repeat
            </label>
            <select
              value={newR.recurrence_rule ?? ''}
              onChange={e => setNewR(p => ({ ...p, recurrence_rule: (e.target.value || null) as RecurrenceRule, recurrence_days: [] }))}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {RECURRENCE_OPTIONS.map(o => (
                <option key={o.value ?? ''} value={o.value ?? ''}>{o.label}</option>
              ))}
            </select>
          </div>
          {newR.recurrence_rule === 'custom' && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {DAY_LABELS.map((label, i) => {
                const dayNum = i + 1; // 1=Mon … 7=Sun
                const isOn = newR.recurrence_days.includes(dayNum);
                return (
                  <button key={dayNum} type="button" onClick={() => setNewR(p => ({ ...p, recurrence_days: isOn ? p.recurrence_days.filter(d => d !== dayNum) : [...p.recurrence_days, dayNum] }))}
                    style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: 10, border: `1px solid ${isOn ? 'var(--amber)' : 'var(--border-subtle)'}`, background: isOn ? 'rgba(212,160,68,0.15)' : 'transparent', color: isOn ? 'var(--amber)' : 'var(--text-muted)', cursor: 'pointer' }}
                  >{label}</button>
                );
              })}
            </div>
          )}
          <button
            onClick={handleCreate}
            disabled={saving || !newR.text.trim()}
            style={{ padding: '8px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', background: newR.text.trim() ? 'rgba(212,160,68,0.12)' : 'transparent', border: `1px solid ${newR.text.trim() ? 'var(--amber)' : 'var(--border-subtle)'}`, color: newR.text.trim() ? 'var(--amber)' : 'var(--text-muted)', cursor: newR.text.trim() ? 'pointer' : 'not-allowed', transition: 'all 150ms' }}
          >
            {saving ? 'Saving...' : '＋ Add Reminder'}
          </button>
        </div>
      )}

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto' }}>
        {FILTERS.map(({ key, label }) => {
          const isActive = filter === key;
          const isGeo    = key === 'geo';
          return (
            <button key={key} onClick={() => setFilter(key)} style={{
              flexShrink: 0, padding: '4px 12px', fontFamily: 'monospace', fontSize: 10,
              textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
              border: `1px solid ${(isActive && isGeo) ? 'rgba(74,222,128,0.6)' : (isActive && key === 'recurring') ? 'rgba(147,130,255,0.6)' : isActive ? 'var(--amber)' : 'var(--border-subtle)'}`,
              background: (isActive && isGeo) ? 'rgba(74,222,128,0.1)' : (isActive && key === 'recurring') ? 'rgba(147,130,255,0.1)' : isActive ? 'rgba(212,160,68,0.1)' : 'transparent',
              color: (isActive && isGeo) ? '#4ade80' : (isActive && key === 'recurring') ? '#9382ff' : isActive ? 'var(--amber)' : 'var(--text-muted)',
            }}>
              {label}
            </button>
          );
        })}
      </div>

      {loading && <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>Loading...</p>}
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
          const isEditing      = editId === r.id;
          const isOverdue      = r.due_at && new Date(r.due_at) < new Date() && r.status === 'pending';

          return (
            <div key={r.id} style={{
              padding: '12px 14px',
              border: `1px solid ${isGeoActive ? 'rgba(74,222,128,0.35)' : isOverdue ? 'rgba(239,68,68,0.3)' : r.status === 'done' ? 'rgba(74,222,128,0.15)' : 'var(--border-subtle)'}`,
              background: isGeoActive ? 'rgba(74,222,128,0.05)' : isOverdue ? 'rgba(239,68,68,0.04)' : r.status === 'done' ? 'rgba(74,222,128,0.04)' : 'var(--bg-elevated)',
              opacity: r.status !== 'pending' ? 0.55 : 1,
              transition: 'border-color 0.2s, background 0.2s',
            }}>

              {/* Status + time row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: r.status === 'done' ? 'var(--green)' : r.status === 'dismissed' ? 'var(--text-muted)' : isOverdue ? '#f87171' : 'var(--amber)' }}>
                  {isOverdue ? 'OVERDUE' : r.status}
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                  {new Date(r.created_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {/* Text — editable inline */}
              {isEditing ? (
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input
                    autoFocus
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(r.id); if (e.key === 'Escape') setEditId(null); }}
                    style={{ flex: 1, padding: '6px 8px', fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-recessed)', border: '1px solid var(--amber)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                  <button onClick={() => saveEdit(r.id)} style={{ padding: '4px 8px', background: 'rgba(212,160,68,0.1)', border: '1px solid var(--amber)', color: 'var(--amber)', cursor: 'pointer' }}>
                    <Check size={12} />
                  </button>
                  <button onClick={() => setEditId(null)} style={{ padding: '4px 8px', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 8 }}>
                  <p style={{ flex: 1, fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4 }}>
                    {r.text}
                  </p>
                  {r.status === 'pending' && (
                    <button onClick={() => startEdit(r)} style={{ flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.4, padding: 2 }}>
                      <Pencil size={11} style={{ color: 'var(--text-muted)' }} />
                    </button>
                  )}
                </div>
              )}

              {/* Due date/time */}
              {r.due_at && !r.due_location && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                  <Clock size={10} style={{ color: isOverdue ? '#f87171' : 'var(--amber)' }} />
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: isOverdue ? '#f87171' : 'var(--amber)' }}>
                    {new Date(r.due_at).toLocaleString()}
                  </span>
                </div>
              )}

              {/* Geo badges */}
              {isGeoActive && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: '#4ade80', animation: 'geo-pulse 1.8s ease-in-out infinite' }} />
                  <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#4ade80', padding: '2px 7px', border: '1px solid rgba(74,222,128,0.4)', background: 'rgba(74,222,128,0.08)' }}>
                    WATCHING · {r.due_location}
                  </span>
                </div>
              )}
              {isGeoTriggered && (
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>
                    GEO FIRED · {r.due_location}
                  </span>
                </div>
              )}

              {/* Recurrence badge */}
              {r.recurrence_rule && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Repeat size={10} style={{ color: '#9382ff' }} />
                  <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#9382ff', padding: '2px 7px', border: '1px solid rgba(147,130,255,0.4)', background: 'rgba(147,130,255,0.08)' }}>
                    🔁 {r.recurrence_rule}{r.recurrence_time ? ` · ${r.recurrence_time}` : ''}
                  </span>
                </div>
              )}

              {/* Actions */}
              {r.status === 'pending' && !isEditing && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button onClick={() => markDone(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', background: 'transparent', border: '1px solid var(--green-border)', color: 'var(--green)', cursor: 'pointer' }}>
                    <CheckCircle2 size={10} /> Done
                  </button>
                  <button onClick={() => markDismiss(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <X size={10} /> Dismiss
                  </button>
                  {r.recurrence_rule && (
                    <button onClick={() => stopRecurring(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', background: 'transparent', border: '1px solid rgba(147,130,255,0.4)', color: '#9382ff', cursor: 'pointer' }}>
                      <Repeat size={10} /> Stop Recurring
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

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
