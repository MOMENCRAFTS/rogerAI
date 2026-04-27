import { useState, useEffect } from 'react';
import { BarChart3, Mic, Brain, User, TrendingUp, Clock, Newspaper, Loader } from 'lucide-react';
import {
  fetchAllEntityMentions, fetchMemoryGraph, fetchConversationSessions,
  fetchTasks, fetchReminders, fetchAcademyStreak, fetchVocabWords,
  type DbEntityMention, type DbMemoryFact, type DbAcademyStreak,
} from '../../lib/api';
import { speakResponse } from '../../lib/tts';
import { useI18n } from '../../context/I18nContext';



interface Stats {
  totalTransmissions: number;
  totalMemories: number;
  totalEntities: number;
  totalFacts: number;
  topEntities: DbEntityMention[];
  recentFacts: DbMemoryFact[];
  sessionCount: number;
  todayCount: number;
  dailyCounts: number[]; // last 7 days, index 0 = oldest
  dayLabels: string[];   // e.g. ['Mon','Tue',...]
  academy: DbAcademyStreak | null;
  vocabDistribution: number[]; // mastery levels 0-5 counts
}

const FACT_COLORS: Record<string, string> = {
  person: '#f59e0b',
  company: '#3b82f6',
  project: '#8b5cf6',
  preference: '#ec4899',
  goal: '#ef4444',
  habit: '#10b981',
  relationship: '#f97316',
  location: '#6366f1',
  language_vocab: '#06b6d4',
};

export default function UserAnalytics({ userId }: { userId: string }) {
  const { t: _t } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [digestState, setDigestState] = useState<'idle' | 'loading' | 'speaking' | 'done'>('idle');
  const [digestText, setDigestText] = useState('');

  const generateWeeklyDigest = async () => {
    if (!stats) return;
    setDigestState('loading');
    try {
      const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      const [tasks, reminders] = await Promise.all([
        fetchTasks(userId).catch(() => []),
        fetchReminders(userId).catch(() => []),
      ]);
      const recentTasks     = tasks.filter(t => t.created_at > weekAgo);
      const doneTasks       = recentTasks.filter(t => t.status === 'done');
      const openTasks       = recentTasks.filter(t => t.status === 'open');
      const recentReminders = reminders.filter(r => r.created_at > weekAgo);
      const topPeople       = stats.topEntities
        .filter(e => e.entity_type === 'PERSON').slice(0, 5)
        .map(e => `${e.entity_text} (${e.mention_count}×)`).join(', ');

      const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
      const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/weekly-digest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({
          stats: {
            totalTransmissions: stats.totalTransmissions,
            totalFacts: stats.totalFacts,
            topPeople,
            tasksCreated: recentTasks.length,
            tasksDone: doneTasks.length,
            tasksOpen: openTasks.length,
            remindersSet: recentReminders.length,
          },
        }),
      });

      const data = await res.json() as { text?: string; error?: string };
      const text = data.text ?? 'Weekly digest unavailable. Over.';
      setDigestText(text);
      setDigestState('speaking');
      try { await speakResponse(text); } catch { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }
      setDigestState('done');
    } catch { setDigestState('idle'); }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchAllEntityMentions(userId).catch(() => []),
      fetchMemoryGraph(userId).catch(() => []),
      fetchConversationSessions(userId).catch(() => []),
      fetchAcademyStreak(userId).catch(() => null),
      fetchVocabWords(userId).catch(() => []),
    ]).then(([entities, facts, sessions, academy, vocabWords]) => {
      const today = new Date().toDateString();
      const todaySessions = sessions.filter(s => new Date(s.created_at).toDateString() === today);
      const userTurns = sessions.filter(s => s.role === 'user');
      const todayTurns = todaySessions.filter(s => s.role === 'user');

      // Group sessions by session_id
      const sessionIds = new Set(sessions.map(s => s.session_id));

      setStats({
        totalTransmissions: userTurns.length,
        totalMemories: facts.filter(f => f.source_tx !== 'onboarding').length,
        totalEntities: entities.length,
        totalFacts: facts.length,
        topEntities: entities.slice(0, 8),
        recentFacts: facts.slice(0, 6),
        sessionCount: sessionIds.size,
        todayCount: todayTurns.length,
        dailyCounts: Array.from({ length: 7 }, (_, i) => {
          const d = new Date(); d.setDate(d.getDate() - (6 - i));
          const ds = d.toDateString();
          return sessions.filter(s => s.role === 'user' && new Date(s.created_at).toDateString() === ds).length;
        }),
        dayLabels: Array.from({ length: 7 }, (_, i) => {
          const d = new Date(); d.setDate(d.getDate() - (6 - i));
          return d.toLocaleDateString('en', { weekday: 'short' });
        }),
        academy,
        vocabDistribution: [0, 1, 2, 3, 4, 5].map(level => vocabWords.filter((w: { mastery: number }) => w.mastery === level).length),
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [userId]);

  const mono = (s: string | number, size = 28, color = 'var(--amber)') => (
    <span style={{ fontFamily: 'monospace', fontSize: size, fontWeight: 700, color, letterSpacing: '-0.02em' }}>
      {s}
    </span>
  );

  if (loading) return (
    <div style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
      <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
        Loading stats...
      </span>
    </div>
  );

  if (!stats) return null;

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BarChart3 size={15} style={{ color: 'var(--amber)' }} />
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
          Your Stats
        </span>
      </div>

      {/* Weekly Digest */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)', padding: '12px 0' }}>
        {digestState === 'idle' && (
          <button onClick={generateWeeklyDigest} style={{ width: '100%', padding: '10px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.15em', background: 'rgba(212,160,68,0.06)', border: '1px solid rgba(212,160,68,0.25)', color: 'var(--amber)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Newspaper size={13} /> Request Weekly Digest
          </button>
        )}
        {digestState === 'loading' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px' }}>
            <Loader size={13} style={{ color: 'var(--amber)', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Compiling weekly digest...</span>
          </div>
        )}
        {(digestState === 'speaking' || digestState === 'done') && digestText && (
          <div>
            <div style={{ padding: '12px 14px', border: '1px solid rgba(212,160,68,0.2)', background: 'rgba(212,160,68,0.04)', marginBottom: 8 }}>
              <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0, lineHeight: 1.7 }}>
                {digestText}
                {digestState === 'speaking' && <span style={{ color: 'var(--amber)', animation: 'blink 1s infinite' }}>▌</span>}
              </p>
            </div>
            {digestState === 'done' && (
              <button onClick={() => { setDigestState('idle'); setDigestText(''); }} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', padding: '5px 14px', fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>

      {/* 7-day activity bar chart */}
      <div style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
          <BarChart3 size={11} style={{ color: 'var(--amber)', opacity: 0.7 }} />
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>7-Day Transmission Activity</span>
        </div>
        {(() => {
          const max = Math.max(...stats.dailyCounts, 1);
          const W = 240, H = 56, barW = 24, gap = (W - 7 * barW) / 6;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
                {stats.dailyCounts.map((count, i) => {
                  const barH = Math.max(3, (count / max) * H);
                  const x    = i * (barW + gap);
                  const y    = H - barH;
                  const isToday = i === 6;
                  return (
                    <g key={i}>
                      <rect x={x} y={y} width={barW} height={barH}
                        fill={isToday ? 'var(--amber)' : 'rgba(212,160,68,0.3)'}
                        rx={2}
                      />
                      {count > 0 && (
                        <text x={x + barW / 2} y={y - 4} textAnchor="middle"
                          style={{ fontFamily: 'monospace', fontSize: 7, fill: isToday ? 'var(--amber)' : 'rgba(255,255,255,0.4)' }}>
                          {count}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
              <div style={{ display: 'flex', gap: 0 }}>
                {stats.dayLabels.map((label, i) => (
                  <span key={i} style={{ flex: 1, textAlign: 'center', fontFamily: 'monospace', fontSize: 8, color: i === 6 ? 'var(--amber)' : 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Key metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          { icon: Mic, label: 'Transmissions', value: stats.totalTransmissions, sub: `${stats.todayCount} today` },
          { icon: Brain, label: 'Memory Facts', value: stats.totalFacts, sub: `${stats.totalEntities} entities tracked` },
          { icon: User, label: 'People Tracked', value: stats.topEntities.filter(e => e.entity_type === 'PERSON').length, sub: 'in your orbit' },
          { icon: Clock, label: 'Sessions', value: stats.sessionCount, sub: 'total conversations' },
        ].map(({ icon: Icon, label, value, sub }) => (
          <div key={label} style={{ padding: '14px 16px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Icon size={11} style={{ color: 'var(--amber)', opacity: 0.7 }} />
              <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{label}</span>
            </div>
            {mono(value, 26)}
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: '4px 0 0', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Top entities */}
      {stats.topEntities.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <TrendingUp size={11} style={{ color: 'var(--amber)', opacity: 0.7 }} />
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
              Most Mentioned
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stats.topEntities.map(e => {
              const pct = Math.min(100, (e.mention_count / (stats.topEntities[0]?.mention_count ?? 1)) * 100);
              const typeColor = e.entity_type === 'PERSON' ? '#f59e0b'
                : e.entity_type === 'COMPANY' ? '#3b82f6'
                : e.entity_type === 'PROJECT' ? '#8b5cf6' : '#10b981';
              return (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', minWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.entity_text}
                  </span>
                  <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: typeColor, borderRadius: 2, transition: 'width 600ms ease' }} />
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: typeColor, minWidth: 28, textAlign: 'right' }}>
                    {e.mention_count}×
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent memory facts */}
      {stats.recentFacts.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Brain size={11} style={{ color: '#a78bfa', opacity: 0.8 }} />
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
              Roger Knows
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stats.recentFacts.map(f => {
              const color = FACT_COLORS[f.fact_type] ?? 'var(--amber)';
              return (
                <div key={f.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', borderLeft: `3px solid ${color}` }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color, textTransform: 'uppercase', letterSpacing: '0.1em', minWidth: 70, paddingTop: 1 }}>
                    {f.fact_type}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {f.subject} {f.predicate} <strong style={{ color }}>{f.object}</strong>
                    {f.is_confirmed && <span style={{ color: '#10b981', marginLeft: 4 }}>✓</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Academy stats */}
      {stats.academy && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 11, opacity: 0.8 }}></span>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
              Language Academy
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {[
              { label: 'Streak', value: `${stats.academy.current_streak}d`, color: '#ef4444' },
              { label: 'Words', value: String(stats.academy.total_words), color: '#06b6d4' },
              { label: 'Sessions', value: String(stats.academy.total_sessions), color: '#8b5cf6' },
              { label: 'Accuracy', value: stats.academy.accuracy_pct > 0 ? `${Math.round(stats.academy.accuracy_pct)}%` : '—', color: '#10b981' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center', padding: '10px 6px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderTop: `2px solid ${s.color}` }}>
                <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
          {stats.academy.longest_streak > 1 && (
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center', opacity: 0.5 }}>
              Best streak: {stats.academy.longest_streak} days · Target: {stats.academy.target_locale.toUpperCase()}
            </div>
          )}
        </div>
      )}

      {/* Academy mastery distribution */}
      {stats.academy && stats.vocabDistribution.some(n => n > 0) && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 11, opacity: 0.8 }}></span>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
              Word Mastery Distribution
            </span>
          </div>
          {[
            { label: 'New',            color: 'rgba(255,255,255,0.2)', count: stats.vocabDistribution[0] },
            { label: 'Seen',           color: '#64748b',               count: stats.vocabDistribution[1] },
            { label: 'Practiced',      color: '#f59e0b',               count: stats.vocabDistribution[2] },
            { label: 'Drilled',        color: '#3b82f6',               count: stats.vocabDistribution[3] },
            { label: 'Conversational', color: '#8b5cf6',               count: stats.vocabDistribution[4] },
            { label: 'Mastered',       color: '#10b981',               count: stats.vocabDistribution[5] },
          ].filter(l => l.count > 0).map(l => {
            const maxCount = Math.max(...stats.vocabDistribution, 1);
            return (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 9, width: 80, textAlign: 'right', color: 'var(--text-muted)', opacity: 0.6 }}>{l.label}</span>
                <div style={{ flex: 1, height: 10, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${(l.count / maxCount) * 100}%`,
                    height: '100%',
                    background: l.color,
                    borderRadius: 3,
                    transition: 'width 600ms ease',
                  }} />
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: 10, width: 24, color: l.color, fontWeight: 700 }}>{l.count}</span>
              </div>
            );
          })}
          {/* Freezes & milestone info */}
          <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center', opacity: 0.5, display: 'flex', justifyContent: 'center', gap: 12 }}>
            <span>{stats.academy.streak_freezes} freeze{stats.academy.streak_freezes !== 1 ? 's' : ''}</span>
            {stats.academy.last_milestone > 0 && <span>{stats.academy.last_milestone}d milestone</span>}
          </div>
        </div>
      )}

      {/* Empty state */}
      {stats.totalTransmissions === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', opacity: 0.4 }}>
          <Mic size={28} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
            Start talking to Roger to build your stats
          </p>
        </div>
      )}
    </div>
  );
}
