import { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare, Search, RefreshCw, ChevronDown, ChevronUp,
  User, Bot, Clock, Filter, AlertCircle,
} from 'lucide-react';
import HelpBadge from '../components/shared/HelpBadge';
import FilterChip from '../components/shared/FilterChip';
import {
  fetchConversationSessionList, fetchAdminSessionTurns,
  fetchAdminUserList,
  type DbConversationTurn, type DbAdminUser,
} from '../lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'JUST NOW';
  if (mins < 60) return `${mins}m AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h AGO`;
  const days = Math.floor(hrs / 24);
  return days < 30 ? `${days}d AGO` : new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function durationBetween(startIso: string, endIso: string) {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '< 1 min';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

type SessionInfo = {
  session_id: string; user_id: string; turn_count: number;
  first_at: string; last_at: string; preview: string;
};

type ViewFilter = 'all' | 'user_only' | 'assistant_only' | 'with_intent';

// ─── Session Card ─────────────────────────────────────────────────────────────

function SessionCard({
  session, userName, isExpanded, onToggle,
}: {
  session: SessionInfo; userName: string;
  isExpanded: boolean; onToggle: () => void;
}) {
  const [turns, setTurns] = useState<DbConversationTurn[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isExpanded || turns.length) return;
    setLoading(true);
    fetchAdminSessionTurns(session.session_id)
      .then(setTurns)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isExpanded, session.session_id, turns.length]);

  const userTurns = turns.filter(t => t.role === 'user');
  const assistantTurns = turns.filter(t => t.role === 'assistant');
  const intents = [...new Set(turns.map(t => t.intent).filter(Boolean))];

  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
      borderRadius: 4, overflow: 'hidden', transition: 'border-color 0.2s',
    }}>
      {/* Header */}
      <div onClick={onToggle} style={{
        padding: '14px 16px', cursor: 'pointer',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* User + session ID */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(212,160,68,0.3), rgba(212,160,68,0.1))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              border: '1px solid rgba(212,160,68,0.25)',
            }}>
              <User size={12} style={{ color: 'var(--amber)' }} />
            </div>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                {userName}
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                {session.session_id.slice(0, 12)}…
              </div>
            </div>
          </div>

          {/* Meta row */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
              <Clock size={10} /> {relativeTime(session.last_at)}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
              <MessageSquare size={10} /> {session.turn_count} turns
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
              {durationBetween(session.first_at, session.last_at)}
            </span>
            {session.turn_count > 20 && (
              <span style={{
                fontFamily: 'monospace', fontSize: 8, padding: '1px 5px',
                border: '1px solid var(--amber-border)', color: 'var(--amber)',
                textTransform: 'uppercase', letterSpacing: '0.1em',
              }}>LONG SESSION</span>
            )}
          </div>

          {/* Preview */}
          {!isExpanded && session.preview && (
            <p style={{
              fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)',
              margin: '8px 0 0', lineHeight: 1.5, overflow: 'hidden',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              fontStyle: 'italic',
            }}>
              "{session.preview}"
            </p>
          )}
        </div>

        <div style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 4 }}>
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Expanded transcript */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '16px' }}>
          {/* Stats bar */}
          {turns.length > 0 && (
            <div style={{
              display: 'flex', gap: 16, marginBottom: 16, padding: '10px 14px',
              background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-dim)',
              borderRadius: 4, flexWrap: 'wrap',
            }}>
              <StatPill label="USER" value={userTurns.length} color="var(--green)" />
              <StatPill label="ROGER" value={assistantTurns.length} color="var(--amber)" />
              <StatPill label="DURATION" value={durationBetween(session.first_at, session.last_at)} color="var(--text-secondary)" />
              {intents.length > 0 && (
                <StatPill label="INTENTS" value={intents.join(', ')} color="rgba(99,102,241,0.9)" />
              )}
            </div>
          )}

          {/* Transcript */}
          <div style={{
            fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase',
            letterSpacing: '0.15em', color: 'var(--text-muted)', marginBottom: 10,
          }}>
            FULL TRANSCRIPT
          </div>

          {loading && (
            <div style={{ textAlign: 'center', padding: '24px 0', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>
              Loading transcript…
            </div>
          )}

          {!loading && turns.length === 0 && (
            <div style={{ textAlign: 'center', padding: '16px 0', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>
              No transcript data found.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 500, overflowY: 'auto' }}>
            {turns.map(turn => (
              <div
                key={turn.id}
                style={{
                  display: 'flex',
                  flexDirection: turn.role === 'user' ? 'row-reverse' : 'row',
                  gap: 8, alignItems: 'flex-start',
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: turn.role === 'user'
                    ? 'rgba(90,156,105,0.15)'
                    : 'rgba(212,160,68,0.12)',
                  border: `1px solid ${turn.role === 'user' ? 'rgba(90,156,105,0.3)' : 'rgba(212,160,68,0.25)'}`,
                }}>
                  {turn.role === 'user'
                    ? <User size={10} style={{ color: 'var(--green)' }} />
                    : <Bot size={10} style={{ color: 'var(--amber)' }} />
                  }
                </div>
                <div style={{
                  maxWidth: '78%', padding: '8px 12px', borderRadius: 4,
                  background: turn.role === 'user'
                    ? 'rgba(90,156,105,0.08)'
                    : 'rgba(212,160,68,0.06)',
                  border: `1px solid ${turn.role === 'user' ? 'rgba(90,156,105,0.15)' : 'rgba(212,160,68,0.12)'}`,
                  borderTopRightRadius: turn.role === 'user' ? 0 : 4,
                  borderTopLeftRadius: turn.role === 'user' ? 4 : 0,
                }}>
                  {turn.intent && (
                    <div style={{
                      fontFamily: 'monospace', fontSize: 8, color: 'rgba(99,102,241,0.8)',
                      marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.1em',
                    }}>
                      ⚡ {turn.intent}
                    </div>
                  )}
                  <p style={{
                    fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)',
                    margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {turn.content}
                  </p>
                  <div style={{
                    fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)',
                    marginTop: 4, textAlign: turn.role === 'user' ? 'right' : 'left',
                  }}>
                    {new Date(turn.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    {turn.is_admin_test && <span style={{ marginLeft: 6, color: 'var(--amber)' }}>SIM</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color }}>
        {value}
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ConversationMonitor() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [filtered, setFiltered] = useState<SessionInfo[]>([]);
  const [users, setUsers] = useState<DbAdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string>('all');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');

  const userMap = new Map(users.map(u => [u.user_id, u]));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionData, userData] = await Promise.all([
        fetchConversationSessionList().catch(() => []),
        fetchAdminUserList().catch(() => []),
      ]);
      setSessions(sessionData);
      setFiltered(sessionData);
      setUsers(userData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filter logic
  useEffect(() => {
    let result = sessions;

    // User filter
    if (selectedUser !== 'all') {
      result = result.filter(s => s.user_id === selectedUser);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s =>
        s.preview.toLowerCase().includes(q) ||
        s.session_id.toLowerCase().includes(q) ||
        (userMap.get(s.user_id)?.display_name ?? '').toLowerCase().includes(q) ||
        (userMap.get(s.user_id)?.email ?? '').toLowerCase().includes(q)
      );
    }

    setFiltered(result);
  }, [sessions, selectedUser, searchQuery, users]);

  // Stats
  const totalTurns = sessions.reduce((a, s) => a + s.turn_count, 0);
  const uniqueUsers = new Set(sessions.map(s => s.user_id)).size;
  const todaySessions = sessions.filter(s => {
    const d = new Date(s.last_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 lg:p-6 space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <MessageSquare size={14} style={{ color: 'var(--amber)' }} />
            <h1 className="font-mono text-mini tracking-widest uppercase" style={{ color: 'var(--amber)' }}>
              CONVERSATION MONITOR
            </h1>
            <HelpBadge
              title="Conversation Monitor"
              text="Admin view of all user-Roger conversations. Browse sessions, read transcripts, search by keyword, and filter by user. All data from conversation_history table."
              placement="bottom"
            />
          </div>
          <p className="font-mono text-nano tracking-wider" style={{ color: 'var(--text-muted)' }}>
            CHECK ALL USER ↔ ROGER CONVERSATIONS · {sessions.length} SESSIONS · {totalTurns} TOTAL TURNS
          </p>
        </div>
        <button
          onClick={load} disabled={loading}
          className="flex items-center gap-1.5 border px-2 py-1 font-mono text-nano uppercase tracking-wider"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> REFRESH
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'TOTAL SESSIONS', value: String(sessions.length), color: 'var(--green)' },
          { label: 'UNIQUE USERS', value: String(uniqueUsers), color: 'var(--amber)' },
          { label: 'TOTAL TURNS', value: totalTurns > 1000 ? `${(totalTurns / 1000).toFixed(1)}K` : String(totalTurns), color: 'var(--text-primary)' },
          { label: 'TODAY', value: String(todaySessions), color: todaySessions > 0 ? 'var(--green)' : 'var(--text-muted)' },
        ].map(s => (
          <div key={s.label} className="border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <div className="font-mono text-micro tracking-widest uppercase" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{s.label}</div>
            <div className="font-mono text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Search + User filter */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search conversations by keyword, user, or session ID…"
            className="w-full font-mono text-mini"
            style={{
              padding: '9px 12px 9px 34px', background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)', color: 'var(--text-primary)',
              outline: 'none', borderRadius: 2,
            }}
          />
        </div>

        {/* User dropdown */}
        <div className="flex items-center gap-2">
          <Filter size={12} style={{ color: 'var(--text-muted)' }} />
          <select
            value={selectedUser}
            onChange={e => setSelectedUser(e.target.value)}
            className="font-mono text-nano uppercase tracking-wider"
            style={{
              padding: '8px 10px', background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)', color: 'var(--text-primary)',
              outline: 'none', minWidth: 180, borderRadius: 2,
            }}
          >
            <option value="all">ALL USERS ({uniqueUsers})</option>
            {users.map(u => (
              <option key={u.user_id} value={u.user_id}>
                {u.display_name || u.email.split('@')[0]} ({sessions.filter(s => s.user_id === u.user_id).length})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {([
          ['all', 'ALL SESSIONS'] as const,
          ['user_only', 'LONG (20+)'] as const,
          ['with_intent', 'RECENT 24H'] as const,
        ]).map(([key, label]) => {
          const count = key === 'all' ? filtered.length
            : key === 'user_only' ? filtered.filter(s => s.turn_count > 20).length
            : filtered.filter(s => (Date.now() - new Date(s.last_at).getTime()) < 86_400_000).length;
          return (
            <FilterChip
              key={key} label={label} count={count}
              active={viewFilter === key}
              onClick={() => setViewFilter(key)}
            />
          );
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="border p-4 h-24 animate-pulse" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <MessageSquare size={32} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
          <span className="font-mono text-mini tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>
            {sessions.length === 0 ? 'NO CONVERSATIONS IN DATABASE' : 'NO CONVERSATIONS MATCH FILTERS'}
          </span>
          {sessions.length === 0 && (
            <div className="flex items-center gap-2 mt-2">
              <AlertCircle size={12} style={{ color: 'var(--amber)' }} />
              <span className="font-mono text-nano" style={{ color: 'var(--amber)' }}>
                Users need to interact with Roger to generate conversation data
              </span>
            </div>
          )}
        </div>
      )}

      {/* Session list */}
      {!loading && (
        <div className="space-y-3">
          {getFilteredSessions(filtered, viewFilter).map(session => (
            <SessionCard
              key={session.session_id}
              session={session}
              userName={
                userMap.get(session.user_id)?.display_name
                || userMap.get(session.user_id)?.email?.split('@')[0]
                || session.user_id.slice(0, 8)
              }
              isExpanded={expandedId === session.session_id}
              onToggle={() => setExpandedId(prev => prev === session.session_id ? null : session.session_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function getFilteredSessions(sessions: SessionInfo[], filter: ViewFilter): SessionInfo[] {
  switch (filter) {
    case 'user_only': return sessions.filter(s => s.turn_count > 20);
    case 'with_intent': return sessions.filter(s => (Date.now() - new Date(s.last_at).getTime()) < 86_400_000);
    default: return sessions;
  }
}
