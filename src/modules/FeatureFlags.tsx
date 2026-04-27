import { useState, useEffect, useCallback } from 'react';
import { Flag, RefreshCw, Plus, Trash2, ToggleLeft, ToggleRight, ChevronRight } from 'lucide-react';
import { fetchFeatureFlags, updateFeatureFlag, insertFeatureFlag, deleteFeatureFlag, type DbFeatureFlag } from '../lib/api';

const ENV_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  production:  { border: 'var(--green-border)', bg: 'var(--green-dim)', text: 'var(--green)' },
  staging:     { border: 'var(--amber-border)', bg: 'var(--amber-warn-dim)', text: 'var(--amber)' },
  development: { border: 'var(--border-subtle)', bg: 'var(--bg-elevated)', text: 'var(--text-muted)' },
};
const CAT_COLORS: Record<string, string> = { general: 'var(--text-secondary)', ui: 'var(--amber)', ai: '#a78bfa', hardware: 'var(--olive)', experiment: '#f87171' };

export default function FeatureFlags() {
  const [flags, setFlags] = useState<DbFeatureFlag[]>([]);
  const [sel, setSel] = useState<DbFeatureFlag | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterEnv, setFilterEnv] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [newFlag, setNewFlag] = useState({ key: '', name: '', description: '', environment: 'staging' as DbFeatureFlag['environment'], category: 'general' as DbFeatureFlag['category'], rollout_pct: 100, enabled: false });
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchFeatureFlags().then(d => { setFlags(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = flags.filter(f => filterEnv === 'all' || f.environment === filterEnv);

  const toggle = async (flag: DbFeatureFlag) => {
    const newVal = !flag.enabled;
    await updateFeatureFlag(flag.id, { enabled: newVal }).catch(() => {});
    setFlags(p => p.map(f => f.id === flag.id ? { ...f, enabled: newVal } : f));
    if (sel?.id === flag.id) setSel(p => p ? { ...p, enabled: newVal } : p);
  };

  const updateRollout = async (flag: DbFeatureFlag, pct: number) => {
    await updateFeatureFlag(flag.id, { rollout_pct: pct }).catch(() => {});
    setFlags(p => p.map(f => f.id === flag.id ? { ...f, rollout_pct: pct } : f));
    if (sel?.id === flag.id) setSel(p => p ? { ...p, rollout_pct: pct } : p);
  };

  const create = async () => {
    if (!newFlag.key.trim() || !newFlag.name.trim()) return;
    setSaving(true);
    try {
      const created = await insertFeatureFlag(newFlag);
      setFlags(p => [created, ...p]);
      setShowCreate(false);
      setNewFlag({ key: '', name: '', description: '', environment: 'staging', category: 'general', rollout_pct: 100, enabled: false });
    } catch {}
    setSaving(false);
  };

  const del = async () => {
    if (!sel) return;
    setSaving(true);
    await deleteFeatureFlag(sel.id).catch(() => {});
    setFlags(p => p.filter(f => f.id !== sel.id));
    setSel(null); setConfirmDel(false); setSaving(false);
  };

  const ENVS = ['all', 'production', 'staging', 'development'];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Flag size={16} style={{ color: 'var(--amber)' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>Feature Flags</span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>{flags.length} flags</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid var(--amber-border)', background: 'rgba(212,160,68,0.08)', color: 'var(--amber)' }}><Plus size={11} /> New</button>
          <button onClick={load} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)' }}><RefreshCw size={12} /></button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>New Feature Flag</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <input value={newFlag.key} onChange={e => setNewFlag(p => ({ ...p, key: e.target.value }))} placeholder="flag_key" style={{ padding: '8px', fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }} />
            <input value={newFlag.name} onChange={e => setNewFlag(p => ({ ...p, name: e.target.value }))} placeholder="Display Name" style={{ padding: '8px', fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }} />
          </div>
          <input value={newFlag.description} onChange={e => setNewFlag(p => ({ ...p, description: e.target.value }))} placeholder="Description" style={{ width: '100%', padding: '8px', fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={newFlag.environment} onChange={e => setNewFlag(p => ({ ...p, environment: e.target.value as DbFeatureFlag['environment'] }))} style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
              <option value="development">Development</option><option value="staging">Staging</option><option value="production">Production</option>
            </select>
            <select value={newFlag.category} onChange={e => setNewFlag(p => ({ ...p, category: e.target.value as DbFeatureFlag['category'] }))} style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
              <option value="general">General</option><option value="ui">UI</option><option value="ai">AI</option><option value="hardware">Hardware</option><option value="experiment">Experiment</option>
            </select>
            <button onClick={create} disabled={saving || !newFlag.key.trim()} style={{ padding: '6px 16px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid var(--green-border)', background: 'var(--green-dim)', color: 'var(--green)', opacity: saving || !newFlag.key.trim() ? 0.4 : 1 }}>Create</button>
            <button onClick={() => setShowCreate(false)} style={{ padding: '6px 16px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-muted)' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Env filters */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 8, flexShrink: 0 }}>
        {ENVS.map(e => (
          <button key={e} onClick={() => setFilterEnv(e)} style={{ padding: '4px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', border: `1px solid ${filterEnv === e ? 'var(--amber)' : 'var(--border-subtle)'}`, background: filterEnv === e ? 'rgba(212,160,68,0.1)' : 'transparent', color: filterEnv === e ? 'var(--amber)' : 'var(--text-muted)' }}>{e}</button>
        ))}
      </div>

      {/* Split */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* List */}
        <div style={{ width: 360, borderRight: '1px solid var(--border-subtle)', overflowY: 'auto', flexShrink: 0 }}>
          {loading && <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', padding: 16 }}>Loading…</p>}
          {filtered.map(f => {
            const act = sel?.id === f.id;
            const env = ENV_COLORS[f.environment] ?? ENV_COLORS.development;
            return (
              <button key={f.id} onClick={() => { setSel(f); setConfirmDel(false); }}
                style={{ width: '100%', padding: '12px 16px', textAlign: 'left', cursor: 'pointer', background: act ? 'rgba(212,160,68,0.08)' : 'transparent', borderLeft: `2px solid ${act ? 'var(--amber)' : 'transparent'}`, borderBottom: '1px solid var(--border-subtle)', borderTop: 'none', borderRight: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                {f.enabled ? <ToggleRight size={16} style={{ color: 'var(--green)', flexShrink: 0 }} /> : <ToggleLeft size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: 'monospace', fontSize: 11, color: act ? 'var(--amber)' : 'var(--text-primary)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{f.key}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, padding: '0 4px', border: `1px solid ${env.border}`, background: env.bg, color: env.text }}>{f.environment.slice(0, 4).toUpperCase()}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: CAT_COLORS[f.category] ?? 'var(--text-muted)' }}>{f.category}</span>
                  </div>
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{f.rollout_pct}%</span>
                <ChevronRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              </button>
            );
          })}
          {!loading && filtered.length === 0 && <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', padding: 16, textAlign: 'center', textTransform: 'uppercase' }}>No flags</p>}
        </div>

        {/* Detail */}
        {sel ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <h2 style={{ fontFamily: 'monospace', fontSize: 16, color: 'var(--amber)', margin: '0 0 4px', letterSpacing: '0.12em' }}>{sel.name}</h2>
                <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>{sel.key}</p>
              </div>
              <button onClick={() => toggle(sel)} style={{ padding: '6px 16px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', cursor: 'pointer', border: `1px solid ${sel.enabled ? 'var(--green-border)' : 'var(--border-subtle)'}`, background: sel.enabled ? 'var(--green-dim)' : 'transparent', color: sel.enabled ? 'var(--green)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {sel.enabled ? <><ToggleRight size={14} /> Enabled</> : <><ToggleLeft size={14} /> Disabled</>}
              </button>
            </div>

            {sel.description && <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 20, padding: '12px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>{sel.description}</p>}

            {/* Rollout slider */}
            <div style={{ marginBottom: 24, padding: '14px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Rollout Percentage</span>
                <span style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--amber)', fontWeight: 700 }}>{sel.rollout_pct}%</span>
              </div>
              <input type="range" min={0} max={100} value={sel.rollout_pct} onChange={e => updateRollout(sel, parseInt(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--amber)' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>0%</span>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>100%</span>
              </div>
            </div>

            {/* Meta grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 24 }}>
              {[['Environment', sel.environment.toUpperCase()], ['Category', sel.category.toUpperCase()], ['Created By', sel.created_by ?? '—'], ['Target Users', sel.target_users?.length ? `${sel.target_users.length} users` : 'All'], ['Updated', new Date(sel.updated_at).toLocaleDateString()], ['Created', new Date(sel.created_at).toLocaleDateString()]].map(([l, v]) => (
                <div key={l} style={{ padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                  <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 4px' }}>{l}</p>
                  <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0 }}>{v}</p>
                </div>
              ))}
            </div>

            {/* Delete */}
            <div>
              <button onClick={() => setConfirmDel(true)} style={{ padding: '7px 16px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#f87171', display: 'flex', alignItems: 'center', gap: 6 }}><Trash2 size={11} /> Delete Flag</button>
              {confirmDel && (
                <div style={{ marginTop: 10, padding: '12px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#f87171' }}>Delete "{sel.key}"?</span>
                  <button onClick={del} disabled={saving} style={{ padding: '5px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>Confirm</button>
                  <button onClick={() => setConfirmDel(false)} style={{ padding: '5px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-muted)' }}>Cancel</button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.35 }}>
            <div style={{ textAlign: 'center' }}><Flag size={32} style={{ color: 'var(--text-muted)', marginBottom: 12 }} /><p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Select a flag to inspect</p></div>
          </div>
        )}
      </div>
    </div>
  );
}
