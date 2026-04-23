import { useState, useEffect } from 'react';
import { Brain, User, MessageSquare, TrendingUp, Lightbulb, RefreshCw } from 'lucide-react';
import {
  fetchAllEntityMentions, fetchMemoryGraph, fetchConversationSessions,
  fetchMemoryInsights, fetchOnboardingState,
  type DbEntityMention, type DbMemoryFact, type DbMemoryInsight,
} from '../lib/api';

const USER_ID = 'ADMIN-TEST'; // replaced when auth lands

const FACT_COLORS: Record<string, string> = {
  person: '#f59e0b', company: '#3b82f6', project: '#8b5cf6',
  preference: '#ec4899', goal: '#ef4444', habit: '#10b981',
  relationship: '#f97316', location: '#6366f1',
};

interface MemoryHealth {
  entities: DbEntityMention[];
  facts: DbMemoryFact[];
  sessions: { session_id: string; created_at: string; role: string; content: string }[];
  insights: DbMemoryInsight[];
  onboarding: { complete: boolean; step: number; displayName?: string };
}

export default function MemoryMonitor() {
  const [data, setData]     = useState<MemoryHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [factFilter, setFactFilter] = useState('all');

  const load = () => {
    setLoading(true);
    Promise.all([
      fetchAllEntityMentions(USER_ID).catch(() => []),
      fetchMemoryGraph(USER_ID).catch(() => []),
      fetchConversationSessions(USER_ID).catch(() => []),
      fetchMemoryInsights(USER_ID).catch(() => []),
      fetchOnboardingState(USER_ID).catch(() => ({ complete: false, step: 0 })),
    ]).then(([entities, facts, sessions, insights, onboarding]) => {
      setData({ entities, facts, sessions, insights, onboarding });
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const mono = (v: number, color = 'var(--amber)') => (
    <span style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 700, color }}>{v}</span>
  );

  if (loading) return (
    <div style={{ padding: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
        Loading memory health...
      </span>
    </div>
  );

  if (!data) return null;

  const sessionIds = new Set(data.sessions.map(s => s.session_id));
  const userTurns  = data.sessions.filter(s => s.role === 'user');
  const factTypes  = ['all', ...Array.from(new Set(data.facts.map(f => f.fact_type)))];
  const filteredFacts = data.facts.filter(f => factFilter === 'all' || f.fact_type === factFilter);

  const onboardingColor = data.onboarding.complete ? 'var(--green)' : data.onboarding.step > 0 ? 'var(--amber)' : '#f87171';
  const onboardingLabel = data.onboarding.complete ? '✅ Complete' : data.onboarding.step > 0 ? `🔄 Step ${data.onboarding.step}/5` : '❌ Not started';

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px 24px', background: 'var(--bg-primary)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Brain size={16} style={{ color: 'var(--amber)' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
            Memory Monitor
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
            {USER_ID}
          </span>
        </div>
        <button onClick={load} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)' }}>
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Onboarding status */}
      <div style={{ padding: '12px 16px', border: `1px solid ${onboardingColor}44`, background: `${onboardingColor}0a`, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
        <User size={13} style={{ color: onboardingColor }} />
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: onboardingColor, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Onboarding: {onboardingLabel}
        </span>
        {data.onboarding.displayName && (
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
            {data.onboarding.displayName}
          </span>
        )}
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { icon: MessageSquare, label: 'Turns', value: userTurns.length, color: 'var(--amber)' },
          { icon: Brain, label: 'Facts', value: data.facts.length, color: '#a78bfa' },
          { icon: TrendingUp, label: 'Entities', value: data.entities.length, color: '#3b82f6' },
          { icon: Lightbulb, label: 'Insights', value: data.insights.length, color: '#10b981' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} style={{ padding: '14px 16px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Icon size={11} style={{ color, opacity: 0.7 }} />
              <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{label}</span>
            </div>
            {mono(value, color)}
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: '4px 0 0', textTransform: 'uppercase' }}>
              {label === 'Turns' ? `${sessionIds.size} sessions` : ''}
            </p>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Top entities */}
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>
            Top Entities
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.entities.slice(0, 10).map(e => {
              const typeColor = e.entity_type === 'PERSON' ? '#f59e0b' : e.entity_type === 'COMPANY' ? '#3b82f6' : e.entity_type === 'PROJECT' ? '#8b5cf6' : '#10b981';
              const pct = Math.min(100, (e.mention_count / (data.entities[0]?.mention_count ?? 1)) * 100);
              return (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: typeColor, minWidth: 56, textTransform: 'uppercase' }}>{e.entity_type.slice(0,4)}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.entity_text}</span>
                  <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: typeColor, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: typeColor, minWidth: 24, textAlign: 'right' }}>{e.mention_count}×</span>
                </div>
              );
            })}
            {data.entities.length === 0 && <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>No entities yet</p>}
          </div>
        </div>

        {/* Recent insights */}
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>
            Recent Insights
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.insights.slice(0, 8).map(i => (
              <div key={i.id} style={{ padding: '8px 12px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', borderLeft: '3px solid #10b981' }}>
                <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', margin: '0 0 4px', lineHeight: 1.4 }}>{i.insight}</p>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{new Date(i.created_at).toLocaleString()}</span>
              </div>
            ))}
            {data.insights.length === 0 && <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>No insights yet — start talking to Roger</p>}
          </div>
        </div>
      </div>

      {/* Memory graph facts */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', margin: 0 }}>
            Memory Graph — {data.facts.length} facts
          </p>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
            {factTypes.map(t => {
              const color = FACT_COLORS[t] ?? 'var(--amber)';
              return (
                <button key={t} onClick={() => setFactFilter(t)} style={{
                  flexShrink: 0, padding: '3px 10px', fontFamily: 'monospace', fontSize: 9,
                  textTransform: 'uppercase', cursor: 'pointer',
                  border: `1px solid ${factFilter === t ? color : 'var(--border-subtle)'}`,
                  background: factFilter === t ? `${color}18` : 'transparent',
                  color: factFilter === t ? color : 'var(--text-muted)',
                }}>{t}</button>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filteredFacts.map(f => {
            const color = FACT_COLORS[f.fact_type] ?? 'var(--amber)';
            return (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', borderLeft: `3px solid ${color}` }}>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color, textTransform: 'uppercase', minWidth: 80 }}>{f.fact_type}</span>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)', flex: 1 }}>
                  {f.subject} {f.predicate} <strong style={{ color: 'var(--text-primary)' }}>{f.object}</strong>
                </span>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {f.is_confirmed && <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#10b981' }}>✓</span>}
                  {f.source_tx === 'onboarding' && <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>ONBOARDING</span>}
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{f.confidence}%</span>
                </div>
              </div>
            );
          })}
          {filteredFacts.length === 0 && <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', padding: '16px 0' }}>No facts yet</p>}
        </div>
      </div>
    </div>
  );
}
