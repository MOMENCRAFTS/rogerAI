import { useState, useEffect, useCallback } from 'react';
import { FlaskConical, RefreshCw, Zap } from 'lucide-react';
import {
  fetchAllEntityMentions, fetchMemoryInsights, fetchSurfaceQueue,
  insertSurfaceItem, markEntitySurfaced,
  type DbEntityMention, type DbMemoryInsight, type DbSurfaceItem,
} from '../lib/api';

const USER_ID = 'ADMIN-TEST';

type Tab = 'entities' | 'insights' | 'surface';

export default function PatternLab() {
  const [tab, setTab]           = useState<Tab>('entities');
  const [entities, setEntities] = useState<DbEntityMention[]>([]);
  const [insights, setInsights] = useState<DbMemoryInsight[]>([]);
  const [surface, setSurface]   = useState<DbSurfaceItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [surfacing, setSurfacing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchAllEntityMentions(USER_ID).catch(() => []),
      fetchMemoryInsights(USER_ID).catch(() => []),
      fetchSurfaceQueue(USER_ID).catch(() => []),
    ]).then(([e, i, s]) => {
      setEntities(e);
      setInsights(i);
      setSurface(s);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSurfaceNow = async (entity: DbEntityMention) => {
    setSurfacing(entity.id);
    try {
      await insertSurfaceItem({
        user_id: USER_ID,
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
        <button onClick={load} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)' }}>
          <RefreshCw size={12} />
        </button>
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
              Pattern observations extracted by GPT-4o-mini
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
