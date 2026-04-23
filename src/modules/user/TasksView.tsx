import { useState, useEffect, useCallback } from 'react';
import { CheckSquare, CheckCircle2, XCircle, Zap } from 'lucide-react';
import { fetchTasks, updateTaskStatus, type DbTask } from '../../lib/api';

type Filter = 'all' | 'open' | 'done' | 'cancelled';

export default function TasksView({ userId }: { userId: string }) {
  const [tasks, setTasks]   = useState<DbTask[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(() => {
    fetchTasks(userId).then(d => { setTasks(d); setLoading(false); }).catch(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    loadTasks();
  }, [loadTasks]);

  // Live-refresh whenever Roger creates new tasks after a conversation turn
  useEffect(() => {
    const handler = () => loadTasks();
    window.addEventListener('roger:refresh', handler);
    return () => window.removeEventListener('roger:refresh', handler);
  }, [loadTasks]);

  const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);
  const open = tasks.filter(t => t.status === 'open');

  const markDone   = async (id: string) => { await updateTaskStatus(id, 'done').catch(() => {}); setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'done' } : t)); };
  const markCancel = async (id: string) => { await updateTaskStatus(id, 'cancelled').catch(() => {}); setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'cancelled' } : t)); };

  const priorityColor = (p: number) => p >= 8 ? '#f87171' : p >= 5 ? 'var(--amber)' : 'var(--text-muted)';
  const priorityLabel = (p: number) => p >= 8 ? 'HIGH' : p >= 5 ? 'MED' : 'LOW';

  const FILTERS: Filter[] = ['all', 'open', 'done', 'cancelled'];

  return (
    <div style={{ padding: '16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <CheckSquare size={16} style={{ color: 'var(--amber)' }} />
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>Tasks</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
          {open.length} OPEN · {tasks.length} TOTAL
        </span>
      </div>

      {/* Live indicator — shows when tasks were just auto-created from a conversation */}
      {open.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, padding: '6px 10px', background: 'rgba(212,160,68,0.06)', border: '1px solid rgba(212,160,68,0.15)' }}>
          <Zap size={10} style={{ color: 'var(--amber)' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            Roger auto-enriches tasks from every conversation
          </span>
        </div>
      )}

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 12px', fontFamily: 'monospace', fontSize: 10,
            textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
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
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
            No tasks yet — start talking to Roger
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(t => (
          <div key={t.id} style={{
            padding: '12px 14px', border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)', opacity: t.status !== 'open' ? 0.5 : 1,
            borderLeft: `3px solid ${priorityColor(t.priority)}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
              {/* Priority indicator */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 2 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 8, color: priorityColor(t.priority), textTransform: 'uppercase' }}>
                  {priorityLabel(t.priority)}
                </span>
                <div style={{ width: 4, height: 24, background: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: '100%', height: `${(t.priority / 10) * 100}%`, background: priorityColor(t.priority), marginTop: `${100 - (t.priority / 10) * 100}%` }} />
                </div>
              </div>
              <p style={{ flex: 1, fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4,
                textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.text}</p>
            </div>

            {/* Meta row — date + source indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: t.status === 'open' ? 8 : 0 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)' }}>
                {new Date(t.created_at).toLocaleDateString()} {new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              {t.source_tx_id && (
                <span style={{ fontFamily: 'monospace', fontSize: 8, padding: '1px 6px', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  ⚡ From conversation
                </span>
              )}
              {t.due_at && (
                <span style={{ fontFamily: 'monospace', fontSize: 8, color: new Date(t.due_at) < new Date() ? '#f87171' : 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Due {new Date(t.due_at).toLocaleDateString()}
                </span>
              )}
            </div>

            {t.status === 'open' && (
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
        ))}
      </div>
    </div>
  );
}
