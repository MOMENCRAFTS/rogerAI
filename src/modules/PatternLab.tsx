import { useState, useEffect, useCallback } from 'react';
import { FlaskConical, RefreshCw, Zap, User, ChevronDown } from 'lucide-react';
import {
  fetchAllEntityMentions, fetchMemoryInsights, fetchSurfaceQueue,
  insertSurfaceItem, markEntitySurfaced, fetchAdminUserList,
  type DbEntityMention, type DbMemoryInsight, type DbSurfaceItem, type DbAdminUser,
} from '../lib/api';

type Tab = 'entities' | 'insights' | 'surface';

export default function PatternLab() {
  const [tab, setTab]           = useState<Tab>('entities');
  const [users, setUsers]       = useState<DbAdminUser[]>([]);
  const [userId, setUserId]     = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [entities, setEntities] = useState<DbEntityMention[]>([]);
  const [insights, setInsights] = useState<DbMemoryInsight[]>([]);
  const [surface, setSurface]   = useState<DbSurfaceItem[]>([]);
  const [loading, setLoading]   = useState(false);
  const [surfacing, setSurfacing] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminUserList()
      .then(list => { setUsers(list); if (list.length > 0) setUserId(list[0].user_id); })
      .catch(() => setUserId('ADMIN-TEST'));
  }, []);

  const load = useCallback((uid = userId) => {
    if (!uid) return;
    setLoading(true);
    Promise.all([
      fetchAllEntityMentions(uid).catch(() => []),
      fetchMemoryInsights(uid).catch(() => []),
      fetchSurfaceQueue(uid).catch(() => []),
    ]).then(([e, i, s]) => {
      setEntities(e);
      setInsights(i);
      setSurface(s);
      setLoading(false);
    }).catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (userId) load(userId); }, [userId, load]);

  const handleSurfaceNow = async (entity: DbEntityMention) => {
    setSurfacing(entity.id);
    try {
      await insertSurfaceItem({
        user_id: userId,
        type: 'PATTERN_DETECTED',
        content: `Admin surfaced: You've mentioned ${entity.entity_text} ${entity.mention_count} times. Want to create a task or set a reminder?`,
        priority: 8, dismissed: false, snooze_count: 0,
        surface_at: new Date().toISOString(),
        context: `Admin forced surface · Entity: ${entity.entity_type}`,
        source_tx_id: null,
      });
      await markEntitySurfaced(entity.id);
      setEntities(prev => prev.map(e => e.id === entity.id ? { ...e, surfaced: true } : e));
    } catch { /* silent */ }
    setSurfacing(null);
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'entities', label: `Entities (${entities.length})` },
    { key: 'insights', label: `Insights (${insights.length})` },
    { key: 'surface',  label: `Surface Queue (${surface.length})` },
  ];

  const typeColor = (t: string) =>
    t === 'PERSON' ? '#f59e0b' : t === 'COMPANY' ? '#3b82f6' : t === 'PROJECT' ? '#8b5cf6' : '#10b981';

  const selectedUser = users.find(u => u.user_id === userId);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>

      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FlaskConical size={16} style={{ color: 'var(--amber)' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
            Pattern Lab
          </span>
        </div>
        <button onClick={() => load()} disabled={!userId} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)' }}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* User Picker */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)', position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => setPickerOpen(p => !p)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={11} style={{ color: 'var(--amber)' }} />
            <span>{selectedUser ? `${selectedUser.display_name} · ${selectedUser.email}` : userId || 'Select user…'}</span>
          </div>
          <ChevronDown size={11} style={{ color: 'var(--text-muted)', transform: pickerOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
        </button>
        {pickerOpen && (
          <div style={{ position: 'absolute', top: '100%', left: 20, right: 20, zIndex: 50, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', maxHeight: 200, overflowY: 'auto' }}>
            {users.map(u => (
              <button key={u.user_id} onClick={() => { setUserId(u.user_id); setPickerOpen(false); }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: u.user_id === userId ? 'rgba(212,160,68,0.08)' : 'transparent', border: 'none', borderBottom: '1px solid var(--border-dim)', cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-primary)', textAlign: 'left' }}
              >
                <span>{u.display_name} · <span style={{ color: 'var(--text-muted)' }}>{u.email}</span></span>
              </button>
            ))}
            {users.length === 0 && <p style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>Run migration 016 to see users</p>}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, padding: '10px 8px', background: 'transparent', border: 'none', cursor: 'pointer',
            borderBottom: tab === t.key ? '2px solid var(--amber)' : '2px solid transparent',
            fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em',
            color: tab === t.key ? 'var(--amber)' : 'var(--text-muted)', transition: 'color 150ms',
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {loading && <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>Loading...</p>}

        {/* Entities tab */}
        {!loading && tab === 'entities' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', margin: '0 0 8px' }}>
              All entity mentions — sorted by frequency
            </p>
            {entities.map(e => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: typeColor(e.entity_type), textTransform: 'uppercase', minWidth: 60 }}>{e.entity_type.slice(0,4)}</span>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', flex: 1 }}>{e.entity_text}</span>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: typeColor(e.entity_type), minWidth: 32, textAlign: 'right' }}>{e.mention_count}×</span>
                {e.surfaced
                  ? <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#10b981', textTransform: 'uppercase' }}>✓ Surfaced</span>
                  : (
                    <button
                      onClick={() => handleSurfaceNow(e)}
                      disabled={!!surfacing}
                      title="Force surface this entity now"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid rgba(212,160,68,0.3)', background: 'rgba(212,160,68,0.08)', color: 'var(--amber)' }}
                    >
                      <Zap size={10} />
                      {surfacing === e.id ? 'Surfacing...' : 'Surface Now'}
                    </button>
                  )
                }
              </div>
            ))}
            {entities.length === 0 && <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>No entities detected yet</p>}
          </div>
        )}

        {/* Insights tab */}
        {!loading && tab === 'insights' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', margin: '0 0 8px' }}>
              Pattern observations extracted by GPT-5.4-mini
            </p>
            {insights.map(i => (
              <div key={i.id} style={{ padding: '12px 14px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', borderLeft: '3px solid #10b981' }}>
                <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: '0 0 6px', lineHeight: 1.5 }}>{i.insight}</p>
                {i.source_turn && <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: '0 0 4px', fontStyle: 'italic' }}>"{i.source_turn}"</p>}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{new Date(i.created_at).toLocaleString()}</span>
                  {i.acted_on && <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#10b981' }}>✓ Acted on</span>}
                </div>
              </div>
            ))}
            {insights.length === 0 && <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>No insights yet — each PTT turn generates them implicitly</p>}
          </div>
        )}

        {/* Surface queue tab */}
        {!loading && tab === 'surface' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', margin: '0 0 8px' }}>
              Live surface queue — items waiting to be surfaced to user
            </p>
            {surface.map(s => {
              const typeColor2 = s.type === 'DEADLINE_ALERT' ? '#ef4444' : s.type === 'MEETING_PREP' ? '#3b82f6' : 'var(--amber)';
              return (
                <div key={s.id} style={{ padding: '12px 14px', border: `1px solid ${typeColor2}33`, background: 'var(--bg-elevated)', borderLeft: `3px solid ${typeColor2}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: typeColor2, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{s.type}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)' }}>P{s.priority}</span>
                      {s.dismissed && <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#ef4444' }}>DISMISSED</span>}
                      {s.snooze_count > 0 && <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>SNOOZED {s.snooze_count}×</span>}
                    </div>
                  </div>
                  <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', margin: '0 0 4px', lineHeight: 1.5 }}>{s.content}</p>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{new Date(s.created_at).toLocaleString()}</span>
                </div>
              );
            })}
            {surface.length === 0 && <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>Surface queue is empty</p>}
          </div>
        )}
      </div>
    </div>
  );
}
