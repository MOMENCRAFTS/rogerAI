import { useState, useEffect, useCallback } from 'react';
import { Search, Radio, Clock, MessageSquare, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  fetchSessionArchive, searchSessions, fetchSessionTurns,
  type DbSessionSummary, type DbSessionTurn,
} from '../lib/api';

interface SessionArchiveProps { userId?: string }

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'Yesterday ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDur(min: number) {
  if (min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function SessionCard({
  session, userId, isExpanded, onToggle,
}: {
  session: DbSessionSummary;
  userId: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [turns, setTurns] = useState<DbSessionTurn[]>([]);
  const [loadingTurns, setLoadingTurns] = useState(false);

  useEffect(() => {
    if (!isExpanded || turns.length) return;
    setLoadingTurns(true);
    fetchSessionTurns(session.id, userId)
      .then(setTurns)
      .catch(() => {})
      .finally(() => setLoadingTurns(false));
  }, [isExpanded, session.id, userId]);

  const flaggedCount = turns.filter(t => t.is_flagged).length;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 6,
      overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}>
      {/* Header row */}
      <div
        onClick={onToggle}
        style={{
          padding: '14px 18px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Contact + callsign */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Radio size={14} color="white" />
            </div>
            <div>
              <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                {session.contact_name ?? `Callsign ${session.contact_callsign ?? '???????'}`}
              </div>
              {session.contact_callsign && session.contact_name && (
                <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.12em' }}>
                  {session.contact_callsign}
                </div>
              )}
            </div>
          </div>

          {/* Meta row */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
              <Clock size={10} /> {formatDate(session.session_start)}
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
              {formatDur(session.duration_min)}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
              <MessageSquare size={10} /> {session.turn_count} turns
            </span>
            {flaggedCount > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 10, color: 'var(--amber)' }}>
                <Star size={10} /> {flaggedCount} flagged
              </span>
            )}
          </div>

          {/* Roger notes preview */}
          {session.roger_notes && !isExpanded && (
            <p style={{
              fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)',
              margin: '8px 0 0', lineHeight: 1.55,
              overflow: 'hidden', display: '-webkit-box',
              WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            }}>
              {session.roger_notes}
            </p>
          )}
        </div>

        <div style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '16px 18px' }}>
          {/* Roger's debrief */}
          {session.roger_notes && (
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase',
                letterSpacing: '0.18em', color: '#6366f1', marginBottom: 8,
              }}>
                📋 ROGER'S DEBRIEF
              </div>
              <p style={{
                fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)',
                lineHeight: 1.7, margin: 0,
                background: 'rgba(99,102,241,0.05)',
                border: '1px solid rgba(99,102,241,0.15)',
                borderRadius: 4, padding: '12px 14px',
              }}>
                {session.roger_notes}
              </p>
            </div>
          )}

          {/* Transcript */}
          <div>
            <div style={{
              fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase',
              letterSpacing: '0.18em', color: 'var(--text-muted)', marginBottom: 10,
            }}>
              FULL TRANSCRIPT
            </div>

            {loadingTurns && (
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
                Loading transcript...
              </div>
            )}

            {!loadingTurns && turns.length === 0 && (
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                No transcript available.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {turns.map(turn => (
                <div
                  key={turn.id}
                  style={{
                    display: 'flex',
                    flexDirection: turn.is_me ? 'row-reverse' : 'row',
                    gap: 8,
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{
                    maxWidth: '75%',
                    padding: '8px 12px',
                    borderRadius: 4,
                    background: turn.is_me
                      ? 'rgba(99,102,241,0.12)'
                      : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${turn.is_me ? 'rgba(99,102,241,0.25)' : 'var(--border-subtle)'}`,
                    borderTopRightRadius: turn.is_me ? 0 : 4,
                    borderTopLeftRadius: turn.is_me ? 4 : 0,
                  }}>
                    {turn.is_flagged && (
                      <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--amber)', marginBottom: 2 }}>
                        ⭐ FLAGGED
                      </div>
                    )}
                    <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', margin: 0, lineHeight: 1.55 }}>
                      {turn.transcript}
                    </p>
                    <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', marginTop: 4, textAlign: turn.is_me ? 'right' : 'left' }}>
                      {new Date(turn.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SessionArchive({ userId: propUserId }: SessionArchiveProps) {
  const [userId, setUserId] = useState(propUserId ?? '');
  const [sessions, setSessions]       = useState<DbSessionSummary[]>([]);
  const [filtered, setFiltered]       = useState<DbSessionSummary[]>([]);
  const [query, setQuery]             = useState('');
  const [loading, setLoading]         = useState(true);
  const [expandedId, setExpandedId]   = useState<string | null>(null);

  // Resolve userId if not provided as prop
  useEffect(() => {
    if (userId) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) setUserId(session.user.id);
    }).catch(() => {});
  }, [userId]);

  useEffect(() => {
    fetchSessionArchive(userId)
      .then(data => { setSessions(data); setFiltered(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    if (!q.trim()) { setFiltered(sessions); return; }
    searchSessions(userId, q.trim())
      .then(setFiltered)
      .catch(() => {});
  }, [sessions, userId]);

  // Group by contact
  const grouped = filtered.reduce((acc, s) => {
    const key = s.contact_name ?? s.contact_callsign ?? 'Unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {} as Record<string, DbSessionSummary[]>);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{
        padding: '20px 20px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'rgba(255,255,255,0.015)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Radio size={16} color="white" />
          </div>
          <div>
            <h1 style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Session Archive
            </h1>
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0, letterSpacing: '0.12em' }}>
              {sessions.length} COMPLETED SESSION{sessions.length !== 1 ? 'S' : ''} · ROGER AI
            </p>
          </div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={query}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search by name, keyword, or topic..."
            style={{
              width: '100%', padding: '9px 12px 9px 34px',
              fontFamily: 'monospace', fontSize: 12,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 4, color: 'var(--text-primary)',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 32px' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '48px 0', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
            Loading archive...
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 20px' }}>
            <Radio size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              {query ? `No sessions found for "${query}"` : 'No completed sessions yet.\nStart a Tune In to build your archive.'}
            </p>
          </div>
        )}

        {!loading && Object.entries(grouped).map(([contactName, contactSessions]) => (
          <div key={contactName} style={{ marginBottom: 24 }}>
            {/* Contact group header */}
            <div style={{
              fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase',
              letterSpacing: '0.18em', color: 'var(--text-muted)',
              marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
              {contactName} · {contactSessions.length} session{contactSessions.length !== 1 ? 's' : ''}
              <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {contactSessions.map(s => (
                <SessionCard
                  key={s.id}
                  session={s}
                  userId={userId}
                  isExpanded={expandedId === s.id}
                  onToggle={() => setExpandedId(prev => prev === s.id ? null : s.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
