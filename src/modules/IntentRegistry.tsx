import { useState, useEffect, useCallback } from 'react';
import { Cpu, CheckCircle2, XCircle, MinusCircle, Clock, ChevronRight, AlertTriangle, RefreshCw } from 'lucide-react';
import {
  fetchIntentRegistry, updateIntentStatus, fetchIntentAuditLog,
  subscribeToIntentRegistry,
  type DbIntent, type DbIntentAuditLog,
} from '../lib/api';

const STATUS_COLORS: Record<DbIntent['status'], string> = {
  active:         'var(--green)',
  pending_review: 'var(--amber)',
  disabled:       'var(--text-muted)',
  blocked:        '#f87171',
};

const STATUS_ICONS: Record<DbIntent['status'], typeof CheckCircle2> = {
  active:         CheckCircle2,
  pending_review: Clock,
  disabled:       MinusCircle,
  blocked:        XCircle,
};

const STATUS_LABELS: Record<DbIntent['status'], string> = {
  active:         '● Active',
  pending_review: '◌ Pending Review',
  disabled:       '⊘ Disabled',
  blocked:        '✕ Blocked',
};

const TIER_COLORS: Record<DbIntent['execution_tier'], string> = {
  hard:                'var(--amber)',
  soft:                'var(--green)',
  pending_integration: 'var(--text-muted)',
};

export default function IntentRegistry() {
  const [intents, setIntents]         = useState<DbIntent[]>([]);
  const [selected, setSelected]       = useState<DbIntent | null>(null);
  const [auditLog, setAuditLog]       = useState<DbIntentAuditLog[]>([]);
  const [filterStatus, setFilterStatus] = useState<DbIntent['status'] | 'all'>('all');
  const [loading, setLoading]         = useState(true);
  const [blockReason, setBlockReason] = useState('');
  const [showBlockInput, setShowBlockInput] = useState(false);
  const [saving, setSaving]           = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchIntentRegistry().then(data => { setIntents(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const sub = subscribeToIntentRegistry(load);
    return () => { sub.unsubscribe(); };
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    fetchIntentAuditLog(selected.name).then(setAuditLog).catch(() => {});
  }, [selected]);

  const newThisWeek = intents.filter(i => {
    const d = new Date(i.created_at);
    return Date.now() - d.getTime() < 7 * 86400_000 && i.status === 'pending_review';
  });

  const filtered = intents.filter(i => filterStatus === 'all' || i.status === filterStatus);

  const handleStatusChange = async (newStatus: DbIntent['status'], reason?: string) => {
    if (!selected) return;
    setSaving(true);
    await updateIntentStatus(selected.name, newStatus, reason, 'ADMIN').catch(() => {});
    setIntents(prev => prev.map(i => i.name === selected.name ? { ...i, status: newStatus } : i));
    setSelected(prev => prev ? { ...prev, status: newStatus } : null);
    setShowBlockInput(false);
    setBlockReason('');
    setSaving(false);
    // Reload audit log
    fetchIntentAuditLog(selected.name).then(setAuditLog).catch(() => {});
  };

  const FILTERS: (DbIntent['status'] | 'all')[] = ['all', 'pending_review', 'active', 'disabled', 'blocked'];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>

      {/* ── Header ── */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Cpu size={16} style={{ color: 'var(--amber)' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
            Intent Registry
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
            {intents.length} total
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {newThisWeek.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: 'rgba(212,160,68,0.1)', border: '1px solid rgba(212,160,68,0.3)' }}>
              <AlertTriangle size={11} style={{ color: 'var(--amber)' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--amber)', textTransform: 'uppercase' }}>
                {newThisWeek.length} new this week — review required
              </span>
            </div>
          )}
          <button onClick={load} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* ── Filter chips ── */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 8, flexShrink: 0, overflowX: 'auto' }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilterStatus(f)} style={{
            flexShrink: 0, padding: '4px 14px', fontFamily: 'monospace', fontSize: 10,
            textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
            border: `1px solid ${filterStatus === f ? 'var(--amber)' : 'var(--border-subtle)'}`,
            background: filterStatus === f ? 'rgba(212,160,68,0.1)' : 'transparent',
            color: filterStatus === f ? 'var(--amber)' : 'var(--text-muted)',
          }}>{f.replace('_', ' ')}</button>
        ))}
      </div>

      {/* ── Split: list + detail ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>

        {/* List */}
        <div style={{ width: 320, borderRight: '1px solid var(--border-subtle)', overflowY: 'auto', flexShrink: 0 }}>
          {loading && <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', padding: 16 }}>Loading...</p>}
          {filtered.map(intent => {
            const StatusIcon = STATUS_ICONS[intent.status];
            const isActive = selected?.name === intent.name;
            return (
              <button key={intent.name} onClick={() => setSelected(intent)}
                style={{
                  width: '100%', padding: '12px 16px', textAlign: 'left', cursor: 'pointer',
                  background: isActive ? 'rgba(212,160,68,0.08)' : 'transparent',
                  borderLeft: `2px solid ${isActive ? 'var(--amber)' : 'transparent'}`,
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                <StatusIcon size={12} style={{ color: STATUS_COLORS[intent.status], flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: 'monospace', fontSize: 11, color: isActive ? 'var(--amber)' : 'var(--text-primary)', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.08em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {intent.name}
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: TIER_COLORS[intent.execution_tier], textTransform: 'uppercase' }}>
                      {intent.execution_tier}
                    </span>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                      {intent.use_count}× used
                    </span>
                  </div>
                </div>
                <ChevronRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              </button>
            );
          })}
          {!loading && filtered.length === 0 && (
            <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', padding: 16, textAlign: 'center', textTransform: 'uppercase' }}>No intents</p>
          )}
        </div>

        {/* Detail panel */}
        {selected ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

            {/* Name + status */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h2 style={{ fontFamily: 'monospace', fontSize: 16, color: 'var(--amber)', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                  {selected.name}
                </h2>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: STATUS_COLORS[selected.status], textTransform: 'uppercase' }}>
                    {STATUS_LABELS[selected.status]}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: TIER_COLORS[selected.execution_tier], textTransform: 'uppercase' }}>
                    {selected.execution_tier} tier
                  </span>
                  {selected.ambient_mode && (
                    <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#f87171', textTransform: 'uppercase' }}>AMBIENT</span>
                  )}
                </div>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textAlign: 'right' }}>
                <p style={{ margin: '0 0 2px' }}>Used {selected.use_count}× total</p>
                <p style={{ margin: 0 }}>Last: {new Date(selected.last_used_at).toLocaleDateString()}</p>
              </div>
            </div>

            {/* Description */}
            {selected.description && (
              <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 20, padding: '12px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                {selected.description}
              </p>
            )}

            {/* Action buttons */}
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 10 }}>Change Status</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {selected.status !== 'active' && (
                  <button onClick={() => handleStatusChange('active')} disabled={saving}
                    style={{ padding: '7px 16px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid var(--green-border)', background: 'rgba(74,222,128,0.08)', color: 'var(--green)' }}>
                    ✓ Enable
                  </button>
                )}
                {selected.status !== 'disabled' && (
                  <button onClick={() => handleStatusChange('disabled')} disabled={saving}
                    style={{ padding: '7px 16px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-muted)' }}>
                    ⊘ Disable
                  </button>
                )}
                {selected.status !== 'blocked' && (
                  <button onClick={() => setShowBlockInput(true)} disabled={saving}
                    style={{ padding: '7px 16px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.06)', color: '#f87171' }}>
                    ✕ Block
                  </button>
                )}
              </div>

              {/* Block reason input */}
              {showBlockInput && (
                <div style={{ marginTop: 12, padding: '14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#f87171', textTransform: 'uppercase', marginBottom: 8 }}>Block reason (required)</p>
                  <input value={blockReason} onChange={e => setBlockReason(e.target.value)}
                    placeholder="e.g. Privacy risk — collects ambient audio without consent"
                    style={{ width: '100%', padding: '8px', fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-recessed)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => blockReason.trim() && handleStatusChange('blocked', blockReason.trim())} disabled={!blockReason.trim() || saving}
                      style={{ padding: '6px 16px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)', color: '#f87171', opacity: blockReason.trim() ? 1 : 0.4 }}>
                      Confirm Block
                    </button>
                    <button onClick={() => { setShowBlockInput(false); setBlockReason(''); }}
                      style={{ padding: '6px 16px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', cursor: 'pointer', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-muted)' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Metadata grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
              {[
                ['Group', selected.suggested_group ?? '—'],
                ['Ambient', selected.ambient_mode ? 'Yes' : 'No'],
                ['Requires Consent', selected.requires_consent ? 'Yes' : 'No'],
                ['Max Duration', selected.max_duration_seconds ? `${selected.max_duration_seconds}s` : '—'],
                ['Handler', selected.handler_function ?? '— (not connected)'],
                ['Created', new Date(selected.created_at).toLocaleDateString()],
              ].map(([label, value]) => (
                <div key={label} style={{ padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                  <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 4px' }}>{label}</p>
                  <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0 }}>{value}</p>
                </div>
              ))}
            </div>

            {/* Audit log */}
            {auditLog.length > 0 && (
              <div>
                <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 8 }}>Audit Log</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {auditLog.map(log => (
                    <div key={log.id} style={{ padding: '8px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 10, color: STATUS_COLORS[log.new_status as DbIntent['status']] ?? 'var(--text-muted)' }}>
                          {log.old_status} → {log.new_status}
                        </span>
                        {log.reason && <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)', margin: '2px 0 0' }}>{log.reason}</p>}
                      </div>
                      <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
                        {new Date(log.changed_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.35 }}>
            <div style={{ textAlign: 'center' }}>
              <Cpu size={32} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
              <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Select an intent to inspect</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
