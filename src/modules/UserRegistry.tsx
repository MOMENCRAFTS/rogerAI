import { useState, useEffect, useCallback } from 'react';
import { Users, ChevronRight, RefreshCw, Globe, Brain, Bell, ListChecks, Radio, MessageSquare, Moon, Shield, Trash2, AlertTriangle } from 'lucide-react';
import { fetchAllUserProfiles, fetchUserStats, flushAllMemory, fullUserReset, type DbUserProfile } from '../lib/api';

const LANG: Record<string, string> = { en: 'English', ar: 'العربية', fr: 'Français', es: 'Español' };
const MC: Record<string, string> = { active: 'var(--green)', quiet: 'var(--text-muted)', briefing: 'var(--amber)' };

function rel(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'NOW'; if (m < 60) return `${m}m`; const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

type Stats = { memories: number; reminders: number; tasks: number; transmissions: number; conversations: number };

export default function UserRegistry() {
  const [users, setUsers] = useState<DbUserProfile[]>([]);
  const [sel, setSel] = useState<DbUserProfile | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sLoad, setSLoad] = useState(false);
  const [confirm, setConfirm] = useState<'flush' | 'reset' | null>(null);
  const [acting, setActing] = useState(false);

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
    fetchUserStats(sel.user_id).then(s => { setStats(s); setSLoad(false); }).catch(() => setSLoad(false));
  }, [sel]);

  const filtered = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.user_id.toLowerCase().includes(q) || (u.display_name ?? '').toLowerCase().includes(q);
  });

  const doAction = async (type: 'flush' | 'reset') => {
    if (!sel) return;
    setActing(true);
    try { type === 'flush' ? await flushAllMemory(sel.user_id) : await fullUserReset(sel.user_id); } catch {}
    setConfirm(null); setActing(false);
    if (type === 'reset') load();
    else fetchUserStats(sel.user_id).then(setStats).catch(() => {});
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Users size={16} style={{ color: 'var(--amber)' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>User Registry</span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>{users.length} registered</span>
        </div>
        <button onClick={load} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)' }}><RefreshCw size={12} /></button>
      </div>

      {/* Search */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or ID…"
          style={{ width: '100%', padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }} />
      </div>

      {/* Split */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* List */}
        <div style={{ width: 320, borderRight: '1px solid var(--border-subtle)', overflowY: 'auto', flexShrink: 0 }}>
          {loading && <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', padding: 16 }}>Loading…</p>}
          {error && <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#f87171', padding: '8px 16px', background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.2)', wordBreak: 'break-all' }}>⚠ {error}</p>}
          {filtered.map(u => {
            const act = sel?.user_id === u.user_id;
            return (
              <button key={u.user_id} onClick={() => { setSel(u); setConfirm(null); }}
                style={{ width: '100%', padding: '12px 16px', textAlign: 'left', cursor: 'pointer', background: act ? 'rgba(212,160,68,0.08)' : 'transparent', borderLeft: `2px solid ${act ? 'var(--amber)' : 'transparent'}`, borderBottom: '1px solid var(--border-subtle)', borderTop: 'none', borderRight: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--amber)', fontWeight: 700 }}>{(u.display_name ?? u.user_id)?.[0]?.toUpperCase() ?? '?'}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: 'monospace', fontSize: 11, color: act ? 'var(--amber)' : 'var(--text-primary)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.display_name || 'Unnamed'}</p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: MC[u.roger_mode] ?? 'var(--text-muted)', textTransform: 'uppercase' }}>{u.roger_mode}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{LANG[u.language] ?? u.language}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{rel(u.updated_at)}</span>
                  </div>
                </div>
                <ChevronRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              </button>
            );
          })}
          {!loading && filtered.length === 0 && <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', padding: 16, textAlign: 'center', textTransform: 'uppercase' }}>No users</p>}
        </div>

        {/* Detail */}
        {sel ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            <h2 style={{ fontFamily: 'monospace', fontSize: 16, color: 'var(--amber)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{sel.display_name || 'Unnamed'}</h2>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: '0 0 16px', wordBreak: 'break-all' }}>{sel.user_id}</p>

            {/* Badges */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: `1px solid ${sel.onboarding_complete ? 'var(--green-border)' : 'var(--amber-border)'}`, background: sel.onboarding_complete ? 'var(--green-dim)' : 'var(--amber-warn-dim)' }}>
                <Shield size={10} style={{ color: sel.onboarding_complete ? 'var(--green)' : 'var(--amber)' }} />
                <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', color: sel.onboarding_complete ? 'var(--green)' : 'var(--amber)' }}>{sel.onboarding_complete ? 'Onboarded' : 'Pending'}</span>
              </div>
              {sel.islamic_mode && <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: '1px solid var(--olive-border)', background: 'var(--olive-dim)' }}><Moon size={10} style={{ color: 'var(--text-secondary)' }} /><span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Islamic</span></div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                <Globe size={10} style={{ color: 'var(--text-muted)' }} />
                <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{LANG[sel.language] ?? sel.language} · {sel.timezone}</span>
              </div>
            </div>

            {/* Profile grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 24 }}>
              {[['Mode', sel.roger_mode.toUpperCase()], ['Language', LANG[sel.language] ?? sel.language], ['Timezone', sel.timezone], ['Tour', sel.tour_seen ? 'Yes' : 'No'], ['Islamic', sel.islamic_mode ? 'On' : 'Off'], ['Active', rel(sel.updated_at)]].map(([l, v]) => (
                <div key={l} style={{ padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                  <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 4px' }}>{l}</p>
                  <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0 }}>{v}</p>
                </div>
              ))}
            </div>

            {/* Stats */}
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>User Data</p>
            {sLoad ? <div className="animate-pulse" style={{ height: 60, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }} /> : stats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 24 }}>
                {[{ l: 'MEM', v: stats.memories, I: Brain, c: 'var(--amber)' }, { l: 'REM', v: stats.reminders, I: Bell, c: 'var(--green)' }, { l: 'TASK', v: stats.tasks, I: ListChecks, c: 'var(--olive)' }, { l: 'TX', v: stats.transmissions, I: Radio, c: 'var(--text-secondary)' }, { l: 'CONV', v: stats.conversations, I: MessageSquare, c: 'var(--text-secondary)' }].map(s => (
                  <div key={s.l} style={{ padding: '10px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                    <s.I size={14} style={{ color: s.c, marginBottom: 4 }} />
                    <p style={{ fontFamily: 'monospace', fontSize: 16, color: 'var(--text-primary)', margin: '0 0 2px', fontWeight: 700 }}>{s.v}</p>
                    <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0 }}>{s.l}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Danger */}
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>Danger Zone</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => setConfirm('flush')} style={{ padding: '7px 16px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#f87171' }}><Brain size={11} style={{ marginRight: 6, verticalAlign: -1 }} />Flush Memory</button>
              <button onClick={() => setConfirm('reset')} style={{ padding: '7px 16px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.1)', color: '#f87171' }}><Trash2 size={11} style={{ marginRight: 6, verticalAlign: -1 }} />Factory Reset</button>
            </div>
            {confirm && (
              <div style={{ marginTop: 12, padding: '14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <AlertTriangle size={12} style={{ color: '#f87171' }} />
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#f87171' }}>{confirm === 'flush' ? 'Erase all memory & conversations?' : 'Full factory reset — all data wiped?'}</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => doAction(confirm)} disabled={acting} style={{ padding: '6px 16px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.15)', color: '#f87171', opacity: acting ? 0.5 : 1 }}>{acting ? 'Working…' : 'Confirm'}</button>
                  <button onClick={() => setConfirm(null)} style={{ padding: '6px 16px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-muted)' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.35 }}>
            <div style={{ textAlign: 'center' }}><Users size={32} style={{ color: 'var(--text-muted)', marginBottom: 12 }} /><p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Select a user to inspect</p></div>
          </div>
        )}
      </div>
    </div>
  );
}
