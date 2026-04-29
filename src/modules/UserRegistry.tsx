import { useState, useEffect, useCallback } from 'react';
import {
  Users, ChevronRight, ChevronLeft, RefreshCw, Globe,
  Brain, Bell, ListChecks, Radio, MessageSquare,
  Moon, Shield, Trash2, AlertTriangle,
} from 'lucide-react';
import { fetchAllUserProfiles, fetchUserStats, flushAllMemory, fullUserReset, type DbUserProfile } from '../lib/api';

const LANG: Record<string, string> = { en: 'English', ar: 'العربية', fr: 'Français', es: 'Español' };
const MC: Record<string, string> = {
  active:   'var(--green)',
  quiet:    'var(--text-muted)',
  briefing: 'var(--amber)',
};

function rel(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'NOW';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** Sanitise display_name — strip transcripts accidentally stored as names */
function cleanName(raw: string | null): string {
  if (!raw) return 'Unnamed';
  const t = raw.trim();
  // If it contains sentence-ending punctuation or is > 20 chars it's a transcript
  if (t.length > 20 || /[?.!]/.test(t)) {
    // Try to extract first capitalised word
    const m = t.match(/\b([A-Z][a-z]{1,14})\b/);
    return m ? m[1] : 'Unnamed';
  }
  return t;
}

type Stats = { memories: number; reminders: number; tasks: number; transmissions: number; conversations: number };

// ── Monospace stat card ──────────────────────────────────────────────────────
function StatCard({ label, value, color, Icon }: { label: string; value: number; color: string; Icon: React.ElementType }) {
  return (
    <div style={{
      padding: '12px 8px', background: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)', textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    }}>
      <Icon size={15} style={{ color }} />
      <span style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</span>
      <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────
function UserDetail({
  user, onBack, stats, sLoad, confirm, setConfirm, acting, doAction,
}: {
  user: DbUserProfile;
  onBack: () => void;
  stats: Stats | null;
  sLoad: boolean;
  confirm: 'flush' | 'reset' | null;
  setConfirm: (v: 'flush' | 'reset' | null) => void;
  acting: boolean;
  doAction: (t: 'flush' | 'reset') => void;
}) {
  const name = cleanName(user.display_name);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Detail header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: '1px solid var(--border-subtle)',
          padding: '6px 10px', cursor: 'pointer', color: 'var(--text-muted)',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <ChevronLeft size={13} />
          <span style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase' }}>Back</span>
        </button>
        <div style={{
          width: 34, height: 34, borderRadius: '50%',
          background: 'rgba(212,160,68,0.12)', border: '1px solid rgba(212,160,68,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <span style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--amber)', fontWeight: 700 }}>
            {name[0]?.toUpperCase() ?? '?'}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--amber)', margin: 0, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
          <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.user_id}</p>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

        {/* Badges */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: `1px solid ${user.onboarding_complete ? 'var(--green-border)' : 'var(--amber-border)'}`, background: user.onboarding_complete ? 'var(--green-dim)' : 'var(--amber-warn-dim)' }}>
            <Shield size={9} style={{ color: user.onboarding_complete ? 'var(--green)' : 'var(--amber)' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', color: user.onboarding_complete ? 'var(--green)' : 'var(--amber)' }}>
              {user.onboarding_complete ? 'Onboarded' : 'Pending'}
            </span>
          </div>
          {user.islamic_mode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: '1px solid var(--olive-border)', background: 'var(--olive-dim)' }}>
              <Moon size={9} style={{ color: 'var(--text-secondary)' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Islamic</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <Globe size={9} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {LANG[user.language] ?? user.language} · {user.timezone}
            </span>
          </div>
        </div>

        {/* Profile grid — 2 cols on mobile */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
          {([
            ['Mode',     user.roger_mode.toUpperCase()],
            ['Language', LANG[user.language] ?? user.language],
            ['Timezone', user.timezone],
            ['Tour',     user.tour_seen ? 'Yes' : 'No'],
            ['Islamic',  user.islamic_mode ? 'On' : 'Off'],
            ['Active',   rel(user.updated_at)],
          ] as [string, string][]).map(([l, v]) => (
            <div key={l} style={{ padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 3px' }}>{l}</p>
              <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</p>
            </div>
          ))}
        </div>

        {/* Stats */}
        <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 8 }}>User Data</p>
        {sLoad ? (
          <div style={{ height: 72, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 20, opacity: 0.5 }} />
        ) : stats ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 20 }}>
            <StatCard label="MEM"  value={stats.memories}      color="var(--amber)"          Icon={Brain} />
            <StatCard label="REM"  value={stats.reminders}     color="var(--green)"           Icon={Bell} />
            <StatCard label="TASK" value={stats.tasks}         color="var(--olive)"           Icon={ListChecks} />
            <StatCard label="TX"   value={stats.transmissions} color="var(--text-secondary)"  Icon={Radio} />
            <StatCard label="CONV" value={stats.conversations} color="var(--text-secondary)"  Icon={MessageSquare} />
          </div>
        ) : null}

        {/* Danger zone */}
        <p style={{ fontFamily: 'monospace', fontSize: 9, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 8 }}>Danger Zone</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button onClick={() => setConfirm('flush')} style={{
            flex: 1, minWidth: 120, padding: '10px 12px', fontFamily: 'monospace', fontSize: 10,
            textTransform: 'uppercase', cursor: 'pointer',
            border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#f87171',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Brain size={11} />Flush Memory
          </button>
          <button onClick={() => setConfirm('reset')} style={{
            flex: 1, minWidth: 120, padding: '10px 12px', fontFamily: 'monospace', fontSize: 10,
            textTransform: 'uppercase', cursor: 'pointer',
            border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.1)', color: '#f87171',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Trash2 size={11} />Factory Reset
          </button>
        </div>

        {confirm && (
          <div style={{ padding: '14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <AlertTriangle size={12} style={{ color: '#f87171', flexShrink: 0 }} />
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#f87171' }}>
                {confirm === 'flush' ? 'Erase all memory & conversations?' : 'Full factory reset — all data wiped?'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => doAction(confirm)} disabled={acting} style={{
                flex: 1, padding: '9px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase',
                cursor: 'pointer', border: '1px solid rgba(239,68,68,0.5)',
                background: 'rgba(239,68,68,0.15)', color: '#f87171', opacity: acting ? 0.5 : 1,
              }}>
                {acting ? 'Working…' : 'Confirm'}
              </button>
              <button onClick={() => setConfirm(null)} style={{
                flex: 1, padding: '9px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase',
                cursor: 'pointer', border: '1px solid var(--border-subtle)',
                background: 'transparent', color: 'var(--text-muted)',
              }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function UserRegistry() {
  const [users,   setUsers]   = useState<DbUserProfile[]>([]);
  const [sel,     setSel]     = useState<DbUserProfile | null>(null);
  const [stats,   setStats]   = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [search,  setSearch]  = useState('');
  const [sLoad,   setSLoad]   = useState(false);
  const [confirm, setConfirm] = useState<'flush' | 'reset' | null>(null);
  const [acting,  setActing]  = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchAllUserProfiles()
      .then(d => { setUsers(d); setLoading(false); })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load users');
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!sel) { setStats(null); return; }
    setSLoad(true);
    fetchUserStats(sel.user_id)
      .then(s => { setStats(s); setSLoad(false); })
      .catch(() => setSLoad(false));
  }, [sel]);

  const filtered = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.user_id.toLowerCase().includes(q)
      || (u.display_name ?? '').toLowerCase().includes(q)
      || cleanName(u.display_name).toLowerCase().includes(q);
  });

  const doAction = async (type: 'flush' | 'reset') => {
    if (!sel) return;
    setActing(true);
    try {
      type === 'flush' ? await flushAllMemory(sel.user_id) : await fullUserReset(sel.user_id);
    } catch {}
    setConfirm(null);
    setActing(false);
    if (type === 'reset') { setSel(null); load(); }
    else fetchUserStats(sel.user_id).then(setStats).catch(() => {});
  };

  // ── Detail view (full-screen on mobile) ───────────────────────────────────
  if (sel) {
    return (
      <UserDetail
        user={sel}
        onBack={() => { setSel(null); setConfirm(null); }}
        stats={stats}
        sLoad={sLoad}
        confirm={confirm}
        setConfirm={setConfirm}
        acting={acting}
        doAction={doAction}
      />
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Users size={15} style={{ color: 'var(--amber)' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
            User Registry
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
            {users.length} registered
          </span>
        </div>
        <button onClick={load} style={{
          background: 'transparent', border: '1px solid var(--border-subtle)',
          padding: '5px 9px', cursor: 'pointer', color: 'var(--text-muted)',
          display: 'flex', alignItems: 'center',
        }}>
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or ID…"
          style={{
            width: '100%', padding: '9px 12px', fontFamily: 'monospace', fontSize: 12,
            background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', padding: 16 }}>Loading…</p>
        )}
        {error && (
          <div style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.2)' }}>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#f87171', margin: 0, wordBreak: 'break-all' }}>⚠ {error}</p>
          </div>
        )}

        {filtered.map(u => {
          const name = cleanName(u.display_name);
          return (
            <button
              key={u.user_id}
              onClick={() => { setSel(u); setConfirm(null); }}
              style={{
                width: '100%', padding: '14px 16px', textAlign: 'left', cursor: 'pointer',
                background: 'transparent',
                borderLeft: '2px solid transparent',
                borderBottom: '1px solid var(--border-subtle)',
                borderTop: 'none', borderRight: 'none',
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(212,160,68,0.1)', border: '1px solid rgba(212,160,68,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <span style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--amber)', fontWeight: 700 }}>
                  {name[0]?.toUpperCase() ?? '?'}
                </span>
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)',
                  margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontWeight: 500,
                }}>
                  {name}
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{
                    fontFamily: 'monospace', fontSize: 9,
                    color: MC[u.roger_mode] ?? 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}>
                    {u.roger_mode}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                    {LANG[u.language] ?? u.language}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                    {rel(u.updated_at)} ago
                  </span>
                </div>
              </div>

              {/* Onboarding badge */}
              <div style={{
                padding: '2px 7px',
                border: `1px solid ${u.onboarding_complete ? 'var(--green-border)' : 'var(--amber-border)'}`,
                background: u.onboarding_complete ? 'var(--green-dim)' : 'var(--amber-warn-dim)',
                flexShrink: 0,
              }}>
                <span style={{
                  fontFamily: 'monospace', fontSize: 8, textTransform: 'uppercase',
                  color: u.onboarding_complete ? 'var(--green)' : 'var(--amber)',
                }}>
                  {u.onboarding_complete ? 'OK' : 'PEND'}
                </span>
              </div>

              <ChevronRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            </button>
          );
        })}

        {!loading && filtered.length === 0 && (
          <p style={{
            fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)',
            padding: 24, textAlign: 'center', textTransform: 'uppercase',
          }}>
            No users found
          </p>
        )}
      </div>
    </div>
  );
}
