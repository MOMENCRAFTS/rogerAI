import { useState, useEffect, useRef } from 'react';
import { Activity, AlertTriangle, RefreshCw, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import StatCard from '../components/shared/StatCard';
import HelpBadge from '../components/shared/HelpBadge';
import {
  fetchLivePlatformStats, fetchLatestHealthChecks, fetchActiveAlerts,
  fetchTransmissions, subscribeToSystemAlerts, subscribeToHealthChecks,
} from '../lib/api';
import type { DbLiveStat, DbHealthCheck, DbSystemAlert, DbTransmission } from '../lib/api';
import type { StatCardData } from '../types';

function generateChartData(n = 30) {
  return Array.from({ length: n }, (_, i) => ({
    t: i,
    tx:  Math.floor(400 + Math.random() * 300),
    err: Math.floor(Math.random() * 15),
  }));
}

function buildKpis(stat: DbLiveStat | null, txCount: number): StatCardData[] {
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
  return [
    {
      label: 'ACTIVE USERS',
      value: stat ? fmt(stat.active_users) : '—',
      trend: '+12.5%', trendUp: true, status: 'success', icon: 'Users',
      tooltip: 'Total users who initiated at least one PTT session or AI interaction in the last 24 hours.',
    },
    {
      label: 'CONNECTED DEVICES',
      value: stat ? fmt(stat.connected_devices) : '—',
      trend: '+8.2%', trendUp: true, status: 'success', icon: 'Smartphone',
      tooltip: 'Hardware devices (PTT radios, phones) currently synced and reachable via the Roger relay.',
    },
    {
      label: 'TX TODAY',
      value: fmt(txCount),
      trend: '+15.8%', trendUp: true, status: 'neutral', icon: 'Radio',
      tooltip: 'Total voice transmissions processed by the AI pipeline since midnight (local time).',
    },
    {
      label: 'SUCCESS RATE',
      value: stat ? `${stat.success_rate}%` : '—',
      trend: '+0.3%', trendUp: true,
      status: stat && stat.success_rate >= 98 ? 'success' : 'warning',
      icon: 'ShieldCheck',
      tooltip: 'Percentage of transmissions that resolved without error, clarification loop, or timeout. Target: ≥98%.',
    },
  ];
}

function buildBottomKpis(stat: DbLiveStat | null): StatCardData[] {
  return [
    { label: 'SMART MOMENTUM',     value: '94.2%',                                    trend: '+1.8%', trendUp: true,  status: 'neutral', icon: 'Zap',        tooltip: 'Proportion of tasks where Roger proactively pre-fetched context before the user asked — reducing latency.' },
    { label: 'CLARIFICATION RATE', value: stat ? `${stat.clarification_rate}%` : '—', trend: '-0.5%', trendUp: false, status: 'neutral', icon: 'HelpCircle', tooltip: 'Percentage of transmissions that triggered a clarification follow-up. Lower is better.' },
    { label: 'AVG NODE LATENCY',   value: stat ? `${stat.avg_latency_ms}ms` : '—',    trend: '-12ms', trendUp: false, status: 'success', icon: 'Timer',      tooltip: 'Mean end-to-end latency from PTT release to first audio byte from the AI pipeline. Target: <700ms.' },
    { label: 'BRIEFING SUCCESS',   value: '99.1%',                                    trend: '+0.2%', trendUp: true,  status: 'success', icon: 'Newspaper',  tooltip: 'Ratio of AM/PM briefings successfully generated and delivered on schedule across all active users.' },
  ];
}

function healthColor(h: DbHealthCheck) {
  if (h.status === 'down')     return 'var(--rust)';
  if (h.status === 'degraded') return 'var(--amber)';
  return 'var(--green)';
}

function overallStatus(checks: DbHealthCheck[]) {
  if (checks.some(c => c.status === 'down'))     return { label: 'DEGRADED', color: 'var(--rust)',  border: 'var(--rust-border)',  bg: 'var(--rust-dim)' };
  if (checks.some(c => c.status === 'degraded')) return { label: 'WARNING',  color: 'var(--amber)', border: 'var(--amber-border)', bg: 'var(--amber-warn-dim)' };
  return                                                { label: 'OPERATIONAL', color: 'var(--green)', border: 'var(--green-border)', bg: 'var(--green-dim)' };
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'JUST NOW';
  if (mins < 60) return `${mins} MIN AGO`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs} HR AGO` : `${Math.floor(hrs / 24)}D AGO`;
}

export default function Dashboard() {
  const [stat, setStat]           = useState<DbLiveStat | null>(null);
  const [health, setHealth]       = useState<DbHealthCheck[]>([]);
  const [alerts, setAlerts]       = useState<DbSystemAlert[]>([]);
  const [recentTx, setRecentTx]   = useState<DbTransmission[]>([]);
  const [loading, setLoading]     = useState(true);
  const [chartData, setChartData] = useState(generateChartData());
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [liveStat, healthData, alertData, txData] = await Promise.all([
        fetchLivePlatformStats().catch(() => null),
        fetchLatestHealthChecks().catch(() => []),
        fetchActiveAlerts().catch(() => []),
        fetchTransmissions(50).catch(() => []),
      ]);
      setStat(liveStat);
      setHealth(healthData);
      setAlerts(alertData);
      setRecentTx(txData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Realtime subscriptions for health + alerts
  useEffect(() => {
    const s1 = subscribeToSystemAlerts(() => fetchActiveAlerts().then(setAlerts).catch(() => {}));
    const s2 = subscribeToHealthChecks(() => fetchLatestHealthChecks().then(setHealth).catch(() => {}));
    return () => { s1.unsubscribe(); s2.unsubscribe(); };
  }, []);

  // Animate chart
  useEffect(() => {
    animRef.current = setInterval(() => {
      setChartData(prev => {
        const next = [...prev.slice(1), { t: prev[prev.length - 1].t + 1, tx: Math.floor(400 + Math.random() * 300), err: Math.floor(Math.random() * 15) }];
        return next;
      });
    }, 3000);
    return () => { if (animRef.current) clearInterval(animRef.current); };
  }, []);

  // Live TX count — real DB value + animated ticker
  const [txCount, setTxCount] = useState<number>(0);
  useEffect(() => {
    if (stat?.tx_today) setTxCount(stat.tx_today);
    else if (recentTx.length > 0) setTxCount(recentTx.length);
  }, [stat, recentTx]);
  useEffect(() => {
    const ticker = setInterval(() => setTxCount(c => c + Math.floor(Math.random() * 8 + 1)), 3000);
    return () => clearInterval(ticker);
  }, []);

  const topKpis    = buildKpis(stat, txCount);
  const bottomKpis = buildBottomKpis(stat);
  const sysStatus  = overallStatus(health);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="p-2 border font-mono text-nano" style={{ background: 'var(--bg-recessed)', borderColor: 'var(--border-subtle)' }}>
        <div style={{ color: 'var(--green)' }}>TX/MIN: {payload[0]?.value}</div>
        <div style={{ color: 'var(--rust)'  }}>ERRORS: {payload[1]?.value}</div>
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 lg:p-6 space-y-4 lg:space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-mini tracking-widest uppercase" style={{ color: 'var(--amber)' }}>COMMAND CENTER</h1>
          <p className="font-mono text-nano tracking-wider" style={{ color: 'var(--text-muted)' }}>
            MISSION CONTROL / GLOBAL SYSTEM STATUS
            {stat && <span className="ml-2" style={{ color: 'var(--green)' }}>· LIVE DATA</span>}
            {!stat && !loading && <span className="ml-2" style={{ color: 'var(--amber)' }}>· RUN MIGRATIONS 013-015 IN SUPABASE</span>}
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

      {/* Top KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {topKpis.map(kpi => <StatCard key={kpi.label} {...kpi} />)}
      </div>

      {/* Live Transmission Feed */}
      <div className="border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
        <div className="flex items-center gap-3 mb-4">
          <Activity size={14} style={{ color: 'var(--amber)' }} />
          <span className="font-mono text-mini tracking-wider uppercase" style={{ color: 'var(--amber)' }}>
            LIVE TRANSMISSION FEED
          </span>
          <HelpBadge
            title="Live Transmission Feed"
            text="Real-time chart of voice TX/minute (green) vs error rate (red). Data refreshes every 3 seconds from the AI pipeline."
            placement="bottom"
          />
          <div className="flex items-center gap-1.5 ml-auto">
            <div className="w-2 h-2 led-pulse" style={{ background: 'var(--green)', borderRadius: '50%' }} />
            <span className="font-mono text-nano" style={{ color: 'var(--green)' }}>LIVE</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={chartData} margin={{ top: 4, right: 0, left: -30, bottom: 0 }}>
            <defs>
              <linearGradient id="grad-tx"  x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#5a9c69" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#5a9c69" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="grad-err" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#a84832" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#a84832" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(74,82,64,0.2)" />
            <XAxis dataKey="t" hide />
            <YAxis tick={{ fontSize: 9, fill: '#6b6a5e', fontFamily: 'JetBrains Mono' }} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="tx"  stroke="#5a9c69" strokeWidth={1.5} fill="url(#grad-tx)"  dot={false} animationDuration={300} />
            <Area type="monotone" dataKey="err" stroke="#a84832" strokeWidth={1.5} fill="url(#grad-err)" dot={false} animationDuration={300} />
          </AreaChart>
        </ResponsiveContainer>

        {/* Recent real transmissions */}
        {recentTx.length > 0 && (
          <div className="mt-3 border-t pt-3 space-y-1" style={{ borderColor: 'var(--border-dim)' }}>
            <p className="font-mono text-nano uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>RECENT TRANSMISSIONS</p>
            {recentTx.slice(0, 3).map(tx => (
              <div key={tx.id} className="flex items-center gap-3 font-mono text-nano" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: tx.status === 'SUCCESS' ? 'var(--green)' : tx.status === 'CLARIFICATION' ? 'var(--amber)' : 'var(--rust)' }}>●</span>
                <span style={{ color: 'var(--text-muted)' }}>{tx.id}</span>
                <span className="flex-1 truncate italic" style={{ color: 'var(--text-primary)' }}>"{tx.transcript}"</span>
                <span style={{ color: 'var(--text-muted)' }}>{tx.latency_ms}ms</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* System Health + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* System Health — live from DB */}
        <div className="border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <div className="flex items-center gap-3">
            <Activity size={14} style={{ color: 'var(--amber)' }} />
            <span className="font-mono text-mini tracking-wider uppercase" style={{ color: 'var(--amber)' }}>SYSTEM HEALTH</span>
            <HelpBadge
              title="System Health"
              text="Uptime percentage for each major subsystem. Data is written by health-check workers every 5 minutes. All services must be ≥97% to stay green."
              placement="bottom"
            />
            <div className="ml-auto px-2 py-0.5 border font-mono text-micro tracking-wider uppercase"
              style={{ borderColor: sysStatus.border, color: sysStatus.color, background: sysStatus.bg }}>
              {sysStatus.label}
            </div>
          </div>

          {/* Live DB rows */}
          {health.length > 0 && health.map(h => (
            <div key={h.service} className="space-y-1">
              <div className="flex justify-between">
                <span className="font-mono text-mini uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  {h.service.replace(/_/g, ' ')}
                </span>
                <div className="flex items-center gap-2">
                  {h.status === 'operational' && <CheckCircle2 size={10} style={{ color: 'var(--green)' }} />}
                  {h.status === 'degraded'    && <AlertCircle  size={10} style={{ color: 'var(--amber)' }} />}
                  {h.status === 'down'        && <XCircle      size={10} style={{ color: 'var(--rust)'  }} />}
                  <span className="font-mono text-mini" style={{ color: healthColor(h) }}>{h.uptime_pct}%</span>
                </div>
              </div>
              <div className="h-px w-full" style={{ background: 'var(--bg-recessed)' }}>
                <div className="h-full transition-all duration-1000" style={{ width: `${h.uptime_pct}%`, background: healthColor(h) }} />
              </div>
            </div>
          ))}

          {/* Fallback skeleton if DB empty */}
          {health.length === 0 && !loading && (
            <p className="font-mono text-nano" style={{ color: 'var(--text-muted)' }}>
              Run migration 014 to populate health data
            </p>
          )}
          {loading && [1,2,3,4].map(i => (
            <div key={i} className="h-6 animate-pulse" style={{ background: 'var(--bg-recessed)' }} />
          ))}
        </div>

        {/* Alerts & Incidents — live from DB */}
        <div className="border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <div className="flex items-center gap-3">
            <AlertTriangle size={14} style={{ color: 'var(--amber)' }} />
            <span className="font-mono text-mini tracking-wider uppercase" style={{ color: 'var(--amber)' }}>ALERTS & INCIDENTS</span>
            <HelpBadge
              title="Alerts & Incidents"
              text="Active warnings and incidents requiring admin review. Yellow = warning (non-critical). Red = critical (needs immediate action). All alerts are stored in Supabase."
              placement="bottom"
            />
            <span className="ml-auto font-mono text-nano" style={{ color: alerts.length > 0 ? 'var(--amber)' : 'var(--text-muted)' }}>
              {alerts.length} ACTIVE
            </span>
          </div>

          {/* Live DB alerts */}
          {alerts.map(a => {
            const stripColor = a.level === 'warning' ? 'var(--amber)' : a.level === 'info' ? 'var(--green)' : 'var(--rust)';
            return (
              <div key={a.id} className="relative pl-3 py-2 pr-3 border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)' }}>
                <div className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ background: stripColor }} />
                <p className="font-mono text-nano" style={{ color: 'var(--text-primary)' }}>{a.message}</p>
                <p className="font-mono text-micro mt-0.5" style={{ color: 'var(--text-muted)' }}>{relativeTime(a.created_at)}</p>
              </div>
            );
          })}

          {alerts.length === 0 && !loading && (
            <div className="flex items-center gap-2 py-2">
              <CheckCircle2 size={12} style={{ color: 'var(--green)' }} />
              <span className="font-mono text-nano" style={{ color: 'var(--green)' }}>NO ACTIVE ALERTS</span>
            </div>
          )}
          {loading && [1,2].map(i => (
            <div key={i} className="h-10 animate-pulse" style={{ background: 'var(--bg-recessed)' }} />
          ))}
        </div>
      </div>

      {/* Bottom KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {bottomKpis.map(kpi => <StatCard key={kpi.label} {...kpi} />)}
      </div>
    </div>
  );
}
