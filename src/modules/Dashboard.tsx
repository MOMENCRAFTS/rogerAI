import { useState, useEffect, useRef } from 'react';
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import StatCard from '../components/shared/StatCard';
import { fetchLatestPlatformStat, fetchTransmissions } from '../lib/api';
import type { DbPlatformStat, DbTransmission } from '../lib/api';
import type { StatCardData } from '../types';

const ALERTS = [
  { level: 'warning' as const, message: 'Ambiguity rate elevated in EU region (+2.3%)', time: '14 MIN AGO' },
  { level: 'info'    as const, message: 'Device firmware 2.4.1 rolling out (34% complete)', time: '1 HR AGO' },
];

const HEALTH = [
  { label: 'AI PIPELINE',  value: 99.2 },
  { label: 'DEVICE SYNC',  value: 97.8 },
  { label: 'BRIEFING GEN', value: 98.5 },
  { label: 'MEMORY GRAPH', value: 99.8 },
];

function generateChartData(n = 30) {
  return Array.from({ length: n }, (_, i) => ({
    t: i,
    tx:  Math.floor(400 + Math.random() * 300),
    err: Math.floor(Math.random() * 15),
  }));
}

function buildKpis(stat: DbPlatformStat | null, txCount: number): StatCardData[] {
  return [
    {
      label: 'ACTIVE USERS',
      value: stat ? `${(stat.active_users / 1000).toFixed(1)}K` : '—',
      trend: '+12.5%', trendUp: true, status: 'success', icon: 'Users',
    },
    {
      label: 'CONNECTED DEVICES',
      value: stat ? `${(stat.connected_devices / 1000).toFixed(1)}K` : '—',
      trend: '+8.2%', trendUp: true, status: 'success', icon: 'Smartphone',
    },
    {
      label: 'TX TODAY',
      value: `${(txCount / 1000).toFixed(1)}K`,
      trend: '+15.8%', trendUp: true, status: 'neutral', icon: 'Radio',
    },
    {
      label: 'SUCCESS RATE',
      value: stat ? `${stat.success_rate}%` : '—',
      trend: '+0.3%', trendUp: true,
      status: stat && stat.success_rate >= 98 ? 'success' : 'warning',
      icon: 'ShieldCheck',
    },
  ];
}

function buildBottomKpis(stat: DbPlatformStat | null): StatCardData[] {
  return [
    { label: 'SMART MOMENTUM',     value: '94.2%',                                       trend: '+1.8%',  trendUp: true,  status: 'neutral', icon: 'Zap' },
    { label: 'CLARIFICATION RATE', value: stat ? `${stat.clarification_rate}%` : '—',    trend: '-0.5%',  trendUp: false, status: 'neutral', icon: 'HelpCircle' },
    { label: 'AVG NODE LATENCY',   value: stat ? `${stat.avg_latency_ms}ms` : '—',       trend: '-12ms',  trendUp: false, status: 'success', icon: 'Timer' },
    { label: 'BRIEFING SUCCESS',   value: '99.1%',                                       trend: '+0.2%',  trendUp: true,  status: 'success', icon: 'Newspaper' },
  ];
}

export default function Dashboard() {
  const [stat, setStat]           = useState<DbPlatformStat | null>(null);
  const [recentTx, setRecentTx]   = useState<DbTransmission[]>([]);
  const [loading, setLoading]     = useState(true);
  const [chartData, setChartData] = useState(generateChartData());
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [latestStat, txData] = await Promise.all([
        fetchLatestPlatformStat(),
        fetchTransmissions(50),
      ]);
      setStat(latestStat);
      setRecentTx(txData);
    } catch {
      // silently fall back to animated mock if DB unreachable
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Animate chart + tx ticker
  useEffect(() => {
    animRef.current = setInterval(() => {
      setChartData(prev => {
        const next = [...prev.slice(1), { t: prev[prev.length - 1].t + 1, tx: Math.floor(400 + Math.random() * 300), err: Math.floor(Math.random() * 15) }];
        return next;
      });
    }, 3000);
    return () => { if (animRef.current) clearInterval(animRef.current); };
  }, []);

  // Compute live TX count from real data + animate upward
  const [txCount, setTxCount] = useState<number>(0);
  useEffect(() => {
    if (stat) setTxCount(stat.tx_today);
    else if (recentTx.length > 0) setTxCount(recentTx.length);
  }, [stat, recentTx]);

  useEffect(() => {
    const ticker = setInterval(() => setTxCount(c => c + Math.floor(Math.random() * 8 + 1)), 3000);
    return () => clearInterval(ticker);
  }, []);

  const topKpis    = buildKpis(stat, txCount);
  const bottomKpis = buildBottomKpis(stat);

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
        {/* System Health */}
        <div className="border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <div className="flex items-center gap-3">
            <Activity size={14} style={{ color: 'var(--amber)' }} />
            <span className="font-mono text-mini tracking-wider uppercase" style={{ color: 'var(--amber)' }}>SYSTEM HEALTH</span>
            <div className="ml-auto px-2 py-0.5 border font-mono text-micro tracking-wider uppercase"
              style={{ borderColor: 'var(--green-border)', color: 'var(--green)', background: 'var(--green-dim)' }}>
              OPERATIONAL
            </div>
          </div>
          {HEALTH.map(m => (
            <div key={m.label} className="space-y-1">
              <div className="flex justify-between">
                <span className="font-mono text-mini uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{m.label}</span>
                <span className="font-mono text-mini" style={{ color: 'var(--green)' }}>{m.value}%</span>
              </div>
              <div className="h-px w-full" style={{ background: 'var(--bg-recessed)' }}>
                <div className="h-full transition-all duration-1000" style={{ width: `${m.value}%`, background: 'var(--green)' }} />
              </div>
            </div>
          ))}
        </div>

        {/* Alerts */}
        <div className="border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <div className="flex items-center gap-3">
            <AlertTriangle size={14} style={{ color: 'var(--amber)' }} />
            <span className="font-mono text-mini tracking-wider uppercase" style={{ color: 'var(--amber)' }}>ALERTS & INCIDENTS</span>
            <span className="ml-auto font-mono text-nano" style={{ color: 'var(--text-muted)' }}>2 ACTIVE</span>
          </div>
          {ALERTS.map((a, i) => {
            const stripColor = a.level === 'warning' ? 'var(--amber)' : a.level === 'info' ? 'var(--green)' : 'var(--rust)';
            return (
              <div key={i} className="relative pl-3 py-2 pr-3 border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)' }}>
                <div className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ background: stripColor }} />
                <p className="font-mono text-nano" style={{ color: 'var(--text-primary)' }}>{a.message}</p>
                <p className="font-mono text-micro mt-0.5" style={{ color: 'var(--text-muted)' }}>{a.time}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {bottomKpis.map(kpi => <StatCard key={kpi.label} {...kpi} />)}
      </div>
    </div>
  );
}
