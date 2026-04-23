import { useState, useEffect } from 'react';
import { RadioTower, CheckCircle2, AlertCircle, XCircle, User, Smartphone, Clock, Radio, RefreshCw, Wifi } from 'lucide-react';
import FilterChip from '../components/shared/FilterChip';
import MetricBadge from '../components/shared/MetricBadge';
import { fetchTransmissions, subscribeToTransmissions } from '../lib/api';
import type { DbTransmission } from '../lib/api';
import type { StatusTier } from '../types';

type FilterKey = 'ALL' | 'SUCCESS' | 'CLARIFICATION' | 'ERROR' | 'HIGH_AMBIGUITY';

function statusIcon(s: DbTransmission['status']) {
  if (s === 'SUCCESS')       return <CheckCircle2 size={14} style={{ color: 'var(--green)' }} />;
  if (s === 'CLARIFICATION') return <AlertCircle  size={14} style={{ color: 'var(--amber)' }} />;
  return                            <XCircle      size={14} style={{ color: 'var(--rust)'  }} />;
}
function statusBorderColor(s: DbTransmission['status']) {
  if (s === 'SUCCESS')       return 'var(--green-border)';
  if (s === 'CLARIFICATION') return 'var(--amber-border)';
  return 'var(--rust-border)';
}
function statusBg(s: DbTransmission['status']) {
  if (s === 'SUCCESS')       return 'var(--green-dim)';
  if (s === 'CLARIFICATION') return 'var(--amber-warn-dim)';
  return 'var(--rust-dim)';
}
function statusTextColor(s: DbTransmission['status']) {
  if (s === 'SUCCESS')       return 'var(--green)';
  if (s === 'CLARIFICATION') return 'var(--amber)';
  return 'var(--rust)';
}
function confStatus(v: number): StatusTier { return v > 90 ? 'success' : v > 70 ? 'warning' : 'error'; }
function ambigStatus(v: number): StatusTier { return v < 30 ? 'success' : v < 60 ? 'warning' : 'error'; }

function matchesFilter(tx: DbTransmission, filter: FilterKey) {
  if (filter === 'ALL')            return true;
  if (filter === 'HIGH_AMBIGUITY') return tx.ambiguity > 60;
  return tx.status === filter;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'JUST NOW';
  if (mins < 60) return `${mins} MIN AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} HR AGO`;
  return `${Math.floor(hrs / 24)}D AGO`;
}

const FILTERS: FilterKey[] = ['ALL', 'SUCCESS', 'CLARIFICATION', 'ERROR', 'HIGH_AMBIGUITY'];
const FILTER_LABELS: Record<FilterKey, string> = {
  ALL: 'ALL', SUCCESS: 'SUCCESS', CLARIFICATION: 'INTERCEPTS', ERROR: 'ERRORS', HIGH_AMBIGUITY: 'HIGH AMBIGUITY',
};

export default function Transmissions() {
  const [transmissions, setTransmissions] = useState<DbTransmission[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [activeFilter, setActiveFilter]   = useState<FilterKey>('ALL');
  const [liveCount, setLiveCount]         = useState(0);

  // Initial fetch
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTransmissions(100);
      setTransmissions(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load transmissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Realtime subscription — prepend new transmissions as they arrive
  useEffect(() => {
    const channel = subscribeToTransmissions((tx) => {
      setTransmissions(prev => [tx, ...prev]);
      setLiveCount(c => c + 1);
    });
    return () => { channel.unsubscribe(); };
  }, []);

  const filtered = transmissions.filter(tx => matchesFilter(tx, activeFilter));

  const countFor = (f: FilterKey) => {
    if (f === 'ALL')           return transmissions.length;
    if (f === 'HIGH_AMBIGUITY') return transmissions.filter(t => t.ambiguity > 60).length;
    return transmissions.filter(t => t.status === f).length;
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <RadioTower size={14} style={{ color: 'var(--amber)' }} />
            <h1 className="font-mono text-mini tracking-widest uppercase" style={{ color: 'var(--amber)' }}>
              TRANSMISSION MONITOR
            </h1>
            {/* Live badge */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 border" style={{ borderColor: 'var(--green-border)', background: 'var(--green-dim)' }}>
              <div className="w-1.5 h-1.5 led-pulse" style={{ background: 'var(--green)', borderRadius:'50%' }} />
              <Wifi size={9} style={{ color: 'var(--green)' }} />
              <span className="font-mono text-nano" style={{ color: 'var(--green)' }}>LIVE</span>
            </div>
            {liveCount > 0 && (
              <span className="font-mono text-nano border px-1.5 py-0.5" style={{ borderColor: 'var(--amber-border)', color: 'var(--amber)' }}>
                +{liveCount} NEW
              </span>
            )}
          </div>
          <p className="font-mono text-nano tracking-wider" style={{ color: 'var(--text-muted)' }}>
            LIVE PTT VOICE STREAM / SYSTEM-WIDE · {transmissions.length} TX LOADED
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 border px-2 py-1 font-mono text-nano uppercase tracking-wider"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> REFRESH
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="border px-4 py-3 font-mono text-nano" style={{ borderColor: 'var(--rust-border)', background: 'var(--rust-dim)', color: 'var(--rust)' }}>
          ⚠ {error}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <FilterChip
            key={f}
            label={FILTER_LABELS[f]}
            count={countFor(f)}
            active={activeFilter === f}
            onClick={() => setActiveFilter(f)}
          />
        ))}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="border p-4 h-24 animate-pulse" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }} />
          ))}
        </div>
      )}

      {/* Transmission list */}
      {!loading && (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <span className="font-mono text-mini tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>
                {transmissions.length === 0 ? 'NO TRANSMISSIONS IN DATABASE' : 'NO TRANSMISSIONS MATCH FILTER'}
              </span>
            </div>
          )}

          {filtered.map(tx => (
            <div
              key={tx.id}
              className="border p-4 space-y-3"
              style={{ borderColor: statusBorderColor(tx.status), background: statusBg(tx.status) }}
            >
              {/* Header row */}
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center p-1.5 border shrink-0" style={{ borderColor: statusBorderColor(tx.status), background: 'var(--bg-recessed)' }}>
                  {statusIcon(tx.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{tx.id}</span>
                    <span className="font-mono text-nano" style={{ color: 'var(--text-muted)' }}>{relativeTime(tx.created_at)}</span>
                    {tx.is_simulated && (
                      <span className="font-mono text-micro border px-1" style={{ borderColor: 'var(--olive-border)', color: 'var(--olive)' }}>SIM</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1 flex-wrap">
                    <span className="flex items-center gap-1 font-mono text-nano" style={{ color: 'var(--text-secondary)' }}>
                      <User size={10} />{tx.user_id}
                    </span>
                    {tx.device_id && (
                      <span className="flex items-center gap-1 font-mono text-nano" style={{ color: 'var(--text-secondary)' }}>
                        <Smartphone size={10} />{tx.device_id}
                      </span>
                    )}
                    <span className="flex items-center gap-1 font-mono text-nano" style={{ color: 'var(--text-secondary)' }}>
                      <Clock size={10} />{tx.latency_ms}ms
                    </span>
                    <span className="font-mono text-nano" style={{ color: 'var(--text-muted)' }}>{tx.region}</span>
                  </div>
                </div>
                <div className="shrink-0 px-2 py-0.5 font-mono text-nano tracking-wider uppercase border"
                  style={{ borderColor: statusBorderColor(tx.status), border: '1px solid', color: statusTextColor(tx.status) }}>
                  {tx.status}
                </div>
              </div>

              {/* Transcript */}
              <div className="pl-11 flex items-start gap-2">
                <Radio size={12} style={{ color: 'var(--text-muted)', marginTop: 2, flexShrink: 0 }} />
                <p className="text-sm italic" style={{ color: 'var(--text-primary)' }}>"{tx.transcript}"</p>
              </div>

              {/* Metrics */}
              <div className="pl-11 grid grid-cols-3 gap-2">
                <MetricBadge label="INTENT" value={tx.intent.replace('_', ' ')} status="neutral" />
                <MetricBadge label="SIGNAL STR" value={`${tx.confidence}%`} status={confStatus(tx.confidence)} />
                <MetricBadge label="AMBIGUITY"  value={`${tx.ambiguity}%`}  status={ambigStatus(tx.ambiguity)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
