import { useState, useEffect, useCallback } from 'react';
import { CheckSquare, CheckCircle2, XCircle, Zap, Plus, ChevronUp, Pencil, Check, X, Calendar } from 'lucide-react';
import { fetchTasks, updateTaskStatus, insertTask, type DbTask } from '../../lib/api';
import { useI18n } from '../../context/I18nContext';

type Filter = 'all' | 'open' | 'done' | 'cancelled';

interface NewTask { text: string; priority: number; due_date: string; }
const EMPTY_NEW: NewTask = { text: '', priority: 5, due_date: '' };

const priorityColor = (p: number) => p >= 8 ? '#f87171' : p >= 5 ? 'var(--amber)' : 'rgba(255,255,255,0.35)';
const priorityLabel = (p: number) => p >= 8 ? 'HIGH' : p >= 5 ? 'MED' : 'LOW';

export default function TasksView({ userId }: { userId: string }) {
  const { t: _t } = useI18n();
  const [tasks, setTasks]     = useState<DbTask[]>([]);
  const [filter, setFilter]   = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newT, setNewT]       = useState<NewTask>(EMPTY_NEW);
  const [saving, setSaving]   = useState(false);
  const [editId, setEditId]   = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const loadTasks = useCallback(() => {
    fetchTasks(userId).then(d => { setTasks(d); setLoading(false); }).catch(() => setLoading(false));
  }, [userId]);

  useEffect(() => { setLoading(true); loadTasks(); }, [loadTasks]);

  useEffect(() => {
    const handler = () => loadTasks();
    window.addEventListener('roger:refresh', handler);
    return () => window.removeEventListener('roger:refresh', handler);
  }, [loadTasks]);

  const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);
  const open     = tasks.filter(t => t.status === 'open');

  const markDone   = async (id: string) => { await updateTaskStatus(id, 'done').catch(() => {}); setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'done' } : t)); };
  const markCancel = async (id: string) => { await updateTaskStatus(id, 'cancelled').catch(() => {}); setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'cancelled' } : t)); };

  const markAllDone = async () => {
    const openIds = tasks.filter(t => t.status === 'open').map(t => t.id);
    await Promise.all(openIds.map(id => updateTaskStatus(id, 'done').catch(() => {})));
    setTasks(prev => prev.map(t => t.status === 'open' ? { ...t, status: 'done' } : t));
  };

  const handleCreate = async () => {
    if (!newT.text.trim()) return;
    setSaving(true);
    const due_at = newT.due_date ? new Date(`${newT.due_date}T09:00`).toISOString() : null;
    try {
      const created = await insertTask({ user_id: userId, text: newT.text.trim(), priority: newT.priority, status: 'open', due_at, source_tx_id: null, is_admin_test: false });
      if (created) setTasks(prev => [created, ...prev]);
    } catch { /* silent */ }
    setNewT(EMPTY_NEW); setShowForm(false); setSaving(false);
  };

  const cyclePriority = async (id: string, current: number) => {
    const next = current >= 8 ? 1 : current >= 5 ? 8 : 5;
    await import('../../lib/supabase').then(({ supabase }) =>
      supabase.from('tasks').update({ priority: next }).eq('id', id)
    ).catch(() => {});
    setTasks(prev => prev.map(t => t.id === id ? { ...t, priority: next } : t));
  };

  const saveEdit = async (id: string) => {
    if (!editText.trim()) return;
    await import('../../lib/supabase').then(({ supabase }) =>
      supabase.from('tasks').update({ text: editText.trim() }).eq('id', id)
    ).catch(() => {});
    setTasks(prev => prev.map(t => t.id === id ? { ...t, text: editText.trim() } : t));
    setEditId(null);
  };

  const FILTERS: Filter[] = ['all', 'open', 'done', 'cancelled'];

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
        <CheckSquare size={16} style={{ color: 'var(--amber)' }} />
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>Tasks</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>{open.length} OPEN · {tasks.length} TOTAL</span>
        {open.length > 1 && (
          <button onClick={markAllDone} style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'transparent', border: '1px solid var(--green-border)', color: 'var(--green)', cursor: 'pointer' }}>
            All Done
          </button>
        )}
        <button
          onClick={() => { setShowForm(f => !f); setNewT(EMPTY_NEW); }}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', background: showForm ? 'rgba(212,160,68,0.12)' : 'transparent', border: `1px solid ${showForm ? 'var(--amber)' : 'var(--border-subtle)'}`, color: showForm ? 'var(--amber)' : 'var(--text-muted)', cursor: 'pointer', transition: 'all 150ms' }}
        >
          {showForm ? <ChevronUp size={12} /> : <Plus size={12} />}
          {showForm ? 'Cancel' : 'New'}
        </button>
      </div>

      {/* ── Create Form ── */}
      {showForm && (
        <div style={{ marginBottom: 16, padding: '14px 16px', background: 'rgba(212,160,68,0.04)', border: '1px solid rgba(212,160,68,0.2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            autoFocus rows={2}
            value={newT.text}
            onChange={e => setNewT(p => ({ ...p, text: e.target.value }))}
            placeholder="What needs to be done?"
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleCreate(); }}
            style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
          />

          {/* Priority selector */}
          <div>
            <label style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Priority</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ val: 1, label: 'LOW' }, { val: 5, label: 'MED' }, { val: 9, label: 'HIGH' }].map(({ val, label }) => (
                <button key={val} onClick={() => setNewT(p => ({ ...p, priority: val }))}
                  style={{ flex: 1, padding: '6px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', transition: 'all 150ms',
                    border: `1px solid ${newT.priority === val ? priorityColor(val) : 'var(--border-subtle)'}`,
                    background: newT.priority === val ? `${priorityColor(val)}18` : 'transparent',
                    color: newT.priority === val ? priorityColor(val) : 'var(--text-muted)',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Due date */}
          <div>
            <label style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>
              <Calendar size={9} style={{ display: 'inline', marginRight: 3 }} />Due Date (optional)
            </label>
            <input type="date" value={newT.due_date} onChange={e => setNewT(p => ({ ...p, due_date: e.target.value }))} style={inputStyle} />
          </div>

          <button onClick={handleCreate} disabled={saving || !newT.text.trim()}
            style={{ padding: '8px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', background: newT.text.trim() ? 'rgba(212,160,68,0.12)' : 'transparent', border: `1px solid ${newT.text.trim() ? 'var(--amber)' : 'var(--border-subtle)'}`, color: newT.text.trim() ? 'var(--amber)' : 'var(--text-muted)', cursor: newT.text.trim() ? 'pointer' : 'not-allowed', transition: 'all 150ms' }}>
            {saving ? 'Saving...' : '＋ Add Task'}
          </button>
        </div>
      )}

      {/* Auto-enrich callout */}
      {open.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, padding: '6px 10px', background: 'rgba(212,160,68,0.06)', border: '1px solid rgba(212,160,68,0.15)' }}>
          <Zap size={10} style={{ color: 'var(--amber)' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Roger auto-enriches tasks from every conversation</span>
        </div>
      )}

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 12px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
            border: `1px solid ${filter === f ? 'var(--amber)' : 'var(--border-subtle)'}`,
            background: filter === f ? 'rgba(212,160,68,0.1)' : 'transparent',
            color: filter === f ? 'var(--amber)' : 'var(--text-muted)',
          }}>{f}</button>
        ))}
      </div>

      {loading && <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>Loading...</p>}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', opacity: 0.4 }}>
          <CheckSquare size={28} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>No tasks yet</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(t => {
          const isEditing = editId === t.id;
          const isOverdue = t.due_at && new Date(t.due_at) < new Date() && t.status === 'open';
          const pColor    = priorityColor(t.priority);

          return (
            <div key={t.id} style={{
              padding: '12px 14px', background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderLeft: `3px solid ${t.status !== 'open' ? 'var(--border-subtle)' : pColor}`,
              opacity: t.status !== 'open' ? 0.5 : 1,
              transition: 'opacity 200ms',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>

                {/* Priority bar — click to cycle */}
                {t.status === 'open' && (
                  <button
                    onClick={() => cyclePriority(t.id, t.priority)}
                    title="Click to change priority"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 2, background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0 }}
                  >
                    <span style={{ fontFamily: 'monospace', fontSize: 7, color: pColor, textTransform: 'uppercase' }}>{priorityLabel(t.priority)}</span>
                    <div style={{ width: 4, height: 22, background: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: '100%', height: `${(t.priority / 10) * 100}%`, background: pColor, marginTop: `${100 - (t.priority / 10) * 100}%`, transition: 'height 200ms, background 200ms' }} />
                    </div>
                  </button>
                )}

                {/* Text — editable inline */}
                {isEditing ? (
                  <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                    <input
                      autoFocus value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(t.id); if (e.key === 'Escape') setEditId(null); }}
                      style={{ flex: 1, padding: '5px 8px', fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-recessed)', border: '1px solid var(--amber)', color: 'var(--text-primary)', outline: 'none' }}
                    />
                    <button onClick={() => saveEdit(t.id)} style={{ padding: '4px 8px', background: 'rgba(212,160,68,0.1)', border: '1px solid var(--amber)', color: 'var(--amber)', cursor: 'pointer' }}><Check size={12} /></button>
                    <button onClick={() => setEditId(null)} style={{ padding: '4px 8px', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={12} /></button>
                  </div>
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <p style={{ flex: 1, fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4, textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                      {t.text}
                    </p>
                    {t.status === 'open' && (
                      <button onClick={() => { setEditId(t.id); setEditText(t.text); }} style={{ flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.4, padding: 2 }}>
                        <Pencil size={11} style={{ color: 'var(--text-muted)' }} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Meta row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: t.status === 'open' ? 8 : 0 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)' }}>
                  {new Date(t.created_at).toLocaleDateString()} {new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {t.source_tx_id && (
                  <span style={{ fontFamily: 'monospace', fontSize: 8, padding: '1px 6px', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    From conversation
                  </span>
                )}
                {t.due_at && (
                  <span style={{ fontFamily: 'monospace', fontSize: 8, color: isOverdue ? '#f87171' : 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {isOverdue ? '' : ''}Due {new Date(t.due_at).toLocaleDateString()}
                  </span>
                )}
              </div>

              {/* Actions */}
              {t.status === 'open' && !isEditing && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => markDone(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', background: 'transparent', border: '1px solid var(--green-border)', color: 'var(--green)', cursor: 'pointer' }}>
                    <CheckCircle2 size={10} /> Done
                  </button>
                  <button onClick={() => markCancel(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer' }}>
                    <XCircle size={10} /> Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
