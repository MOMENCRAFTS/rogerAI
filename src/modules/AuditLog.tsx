import { useState, useEffect, useCallback } from 'react';
import { FileText, RefreshCw, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { fetchAuditLog, type DbAuditLogEntry } from '../lib/api';

const ACTION_COLORS: Record<string, string> = {
  STATUS_CHANGE: 'var(--amber)',
  FLAG_TOGGLE: 'var(--green)',
  MEMORY_FLUSH: '#f87171',
  FACTORY_RESET: '#f87171',
  CREATE: 'var(--green)',
  DELETE: '#f87171',
  UPDATE: 'var(--amber)',
};

function relativeDate(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'JUST NOW';
  if (mins < 60) return `${mins}m AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h AGO`;
  const days = Math.floor(hrs / 24);
  return days < 30 ? `${days}d AGO` : new Date(iso).toLocaleDateString();
}

export default function AuditLog() {
  const [entries, setEntries] = useState<DbAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterModule, setFilterModule] = useState<string>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const opts = filterModule !== 'all' ? { module: filterModule } : undefined;
    fetchAuditLog(opts).then(d => { setEntries(d); setLoading(false); }).catch(() => setLoading(false));
  }, [filterModule]);

  useEffect(() => { load(); }, [load]);

  // Discover unique modules from entries
  const modules = ['all', ...Array.from(new Set(entries.map(e => e.module)))];

  const actionColor = (action: string) => ACTION_COLORS[action] ?? 'var(--text-secondary)';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileText size={16} style={{ color: 'var(--amber)' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>Audit Log</span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>{entries.length} entries</span>
        </div>
        <button onClick={load} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)' }}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Module filter */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 8, flexShrink: 0, overflowX: 'auto', alignItems: 'center' }}>
        <Filter size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        {modules.map(m => (
          <button key={m} onClick={() => setFilterModule(m)} style={{
            flexShrink: 0, padding: '4px 14px', fontFamily: 'monospace', fontSize: 10,
            textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
            border: `1px solid ${filterModule === m ? 'var(--amber)' : 'var(--border-subtle)'}`,
            background: filterModule === m ? 'rgba(212,160,68,0.1)' : 'transparent',
            color: filterModule === m ? 'var(--amber)' : 'var(--text-muted)',
          }}>{m.replace('_', ' ')}</button>
        ))}
      </div>

      {/* Entries */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 20px' }}>
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1,2,3,4,5].map(i => <div key={i} className="animate-pulse" style={{ height: 56, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }} />)}
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.35 }}>
            <div style={{ textAlign: 'center' }}>
              <FileText size={32} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
              <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>No audit entries</p>
            </div>
          </div>
        )}

        {!loading && entries.map(entry => {
          const isExpanded = expanded === entry.id;
          const hasDiff = entry.before_state || entry.after_state;
          return (
            <div key={entry.id} style={{ marginBottom: 6, border: '1px solid var(--border-subtle)', background: isExpanded ? 'var(--bg-elevated)' : 'transparent' }}>
              {/* Row */}
              <button onClick={() => setExpanded(isExpanded ? null : entry.id)}
                style={{ width: '100%', padding: '12px 16px', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', border: 'none' }}>
                {/* Time */}
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', width: 60, flexShrink: 0, textTransform: 'uppercase' }}>
                  {relativeDate(entry.created_at)}
                </span>
                {/* Module badge */}
                <span style={{ fontFamily: 'monospace', fontSize: 9, padding: '2px 8px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', textTransform: 'uppercase', flexShrink: 0 }}>
                  {entry.module.replace('_', ' ')}
                </span>
                {/* Action */}
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: actionColor(entry.action), textTransform: 'uppercase', fontWeight: 600, flexShrink: 0 }}>
                  {entry.action.replace('_', ' ')}
                </span>
                {/* Target */}
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.target_label ?? entry.target_id ?? '—'}
                </span>
                {/* Admin */}
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', flexShrink: 0, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {entry.admin_email ?? entry.admin_id.slice(0, 8)}
                </span>
                {/* Expand */}
                {hasDiff && (isExpanded ? <ChevronUp size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : <ChevronDown size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />)}
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border-subtle)' }}>
                  {entry.reason && (
                    <div style={{ padding: '8px 10px', marginTop: 10, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)' }}>
                      <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', margin: '0 0 4px' }}>Reason</p>
                      <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', margin: 0 }}>{entry.reason}</p>
                    </div>
                  )}

                  {/* Before / After */}
                  {hasDiff && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                      {entry.before_state && (
                        <div style={{ padding: '8px 10px', background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.2)' }}>
                          <p style={{ fontFamily: 'monospace', fontSize: 9, color: '#f87171', textTransform: 'uppercase', margin: '0 0 4px' }}>Before</p>
                          <pre style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-secondary)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {JSON.stringify(entry.before_state, null, 2)}
                          </pre>
                        </div>
                      )}
                      {entry.after_state && (
                        <div style={{ padding: '8px 10px', background: 'rgba(74,222,128,0.04)', border: '1px solid rgba(74,222,128,0.2)' }}>
                          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--green)', textTransform: 'uppercase', margin: '0 0 4px' }}>After</p>
                          <pre style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-secondary)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {JSON.stringify(entry.after_state, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Meta */}
                  <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>ID: {entry.id.slice(0, 8)}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>Admin: {entry.admin_id.slice(0, 12)}</span>
                    {entry.ip_address && <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>IP: {entry.ip_address}</span>}
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{new Date(entry.created_at).toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
