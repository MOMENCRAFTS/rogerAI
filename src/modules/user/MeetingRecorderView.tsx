/**
 * MeetingRecorderView.tsx — Meeting history screen.
 * Lists all past meetings with summary, action items, decisions, and transcript.
 */

import { useState, useEffect } from 'react';
import { FileText, CheckSquare, Zap, Users, Clock, ChevronDown, ChevronUp, Trash2, Mic } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useI18n } from '../../context/I18nContext';

interface ActionItem { text: string; owner: string | null; due_date: string | null }
interface Decision   { text: string }
interface Participant { name: string; role: string }

interface MeetingRecord {
  id: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  duration_s: number | null;
  summary: string | null;
  transcript: string | null;
  action_items: ActionItem[];
  decisions: Decision[];
  participants: Participant[];
  chunk_count: number;
  status: string;
}

interface Props { userId: string }

function formatDuration(s: number | null) {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function MeetingRecorderView({ userId }: Props) {
  const { t: _t } = useI18n();
  const [meetings, setMeetings]     = useState<MeetingRecord[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [showTx, setShowTx]         = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('meeting_recordings')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(50);
    if (!error) setMeetings((data as MeetingRecord[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteMeeting = async (id: string) => {
    await supabase.from('meeting_recordings').delete().eq('id', id);
    setMeetings(prev => prev.filter(m => m.id !== id));
  };

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: 'var(--text-primary)', maxWidth: 700, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Mic size={18} style={{ color: 'var(--amber)' }} />
        <h1 style={{ fontSize: 14, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--amber)', margin: 0 }}>
          Meeting Archive
        </h1>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {meetings.length} recording{meetings.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Voice hint */}
      <div style={{
        background: 'rgba(212,160,68,0.06)', border: '1px solid rgba(212,160,68,0.15)',
        borderRadius: 4, padding: '10px 14px', marginBottom: 20,
        fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em',
      }}>
        📡 Say <span style={{ color: 'var(--amber)' }}>"Roger, record meeting"</span> to start ·
        <span style={{ color: 'var(--amber)' }}> "End meeting"</span> to stop and generate notes
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 11 }}>
          Loading...
        </div>
      )}

      {!loading && meetings.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          <FileText size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p style={{ fontSize: 12, letterSpacing: '0.1em' }}>No meetings recorded yet.</p>
          <p style={{ fontSize: 10, opacity: 0.6 }}>Say "Roger, record meeting" to start your first session.</p>
        </div>
      )}

      {meetings.map(m => {
        const isExpanded = expanded === m.id;
        const actionItems: ActionItem[]  = Array.isArray(m.action_items)  ? m.action_items  : [];
        const decisions:   Decision[]    = Array.isArray(m.decisions)     ? m.decisions     : [];
        const participants: Participant[] = Array.isArray(m.participants)  ? m.participants  : [];

        return (
          <div key={m.id} style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            borderRadius: 6, marginBottom: 12, overflow: 'hidden',
            boxShadow: isExpanded ? '0 0 0 1px rgba(212,160,68,0.2)' : 'none',
            transition: 'box-shadow 150ms',
          }}>
            {/* Row header */}
            <div
              onClick={() => setExpanded(isExpanded ? null : m.id)}
              style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 3 }}>
                  {m.title || 'Untitled Meeting'}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span>📅 {formatDate(m.started_at)}</span>
                  <span><Clock size={9} style={{ verticalAlign: 'middle' }} /> {formatDuration(m.duration_s)}</span>
                  {participants.length > 0 && <span><Users size={9} style={{ verticalAlign: 'middle' }} /> {participants.length} participant{participants.length !== 1 ? 's' : ''}</span>}
                  {actionItems.length > 0 && <span>✅ {actionItems.length} action item{actionItems.length !== 1 ? 's' : ''}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteMeeting(m.id); }}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'rgba(239,68,68,0.5)' }}
                >
                  <Trash2 size={12} />
                </button>
                {isExpanded ? <ChevronUp size={14} style={{ color: 'var(--amber)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
              </div>
            </div>

            {/* Expanded body */}
            {isExpanded && (
              <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '14px' }}>

                {/* Summary */}
                {m.summary && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 9, color: 'var(--amber)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 6 }}>Summary</div>
                    <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{m.summary}</p>
                  </div>
                )}

                {/* Action Items */}
                {actionItems.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 9, color: 'var(--amber)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckSquare size={10} /> Action Items
                    </div>
                    {actionItems.map((a, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                        <span style={{ color: 'var(--amber)', fontSize: 10, marginTop: 1, flexShrink: 0 }}>→</span>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-primary)' }}>{a.text}</span>
                          {(a.owner || a.due_date) && (
                            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                              {a.owner && <span>Owner: {a.owner}</span>}
                              {a.owner && a.due_date && <span> · </span>}
                              {a.due_date && <span>Due: {a.due_date}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Decisions */}
                {decisions.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 9, color: 'var(--amber)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Zap size={10} /> Decisions Made
                    </div>
                    {decisions.map((d, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
                        <span style={{ color: '#22c55e', fontSize: 10, flexShrink: 0 }}>✓</span>
                        <span style={{ fontSize: 11, color: 'var(--text-primary)' }}>{d.text}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Participants */}
                {participants.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 9, color: 'var(--amber)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Users size={10} /> Participants
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {participants.map((p, i) => (
                        <div key={i} style={{
                          background: 'rgba(212,160,68,0.06)', border: '1px solid rgba(212,160,68,0.15)',
                          borderRadius: 4, padding: '3px 8px', fontSize: 10,
                        }}>
                          <span style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                          {p.role && <span style={{ color: 'var(--text-muted)' }}> · {p.role}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Transcript toggle */}
                {m.transcript && (
                  <div>
                    <button
                      onClick={() => setShowTx(showTx === m.id ? null : m.id)}
                      style={{
                        background: 'transparent', border: '1px solid var(--border-subtle)',
                        color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.1em',
                        textTransform: 'uppercase', padding: '5px 10px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 5,
                      }}
                    >
                      <FileText size={9} />
                      {showTx === m.id ? 'Hide Transcript' : 'Show Full Transcript'}
                    </button>
                    {showTx === m.id && (
                      <div style={{
                        marginTop: 10, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
                        borderRadius: 4, padding: '12px 14px',
                        maxHeight: 300, overflowY: 'auto',
                        fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.7,
                        whiteSpace: 'pre-wrap',
                      }}>
                        {m.transcript}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
