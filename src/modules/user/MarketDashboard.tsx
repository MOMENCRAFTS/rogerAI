import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Loader, TrendingUpIcon, AlertTriangle } from 'lucide-react';
import {
  fetchMarketData, getCachedMarketData, clearMarketCache, cacheAgeMinutes,
  type MarketData, type CryptoAsset, type GoldData, type WeatherDay,
} from '../../lib/marketData';
import { fetchUserPreferences } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import type { UserLocation } from '../../lib/useLocation';

const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** Read auth token inline — avoids async-state race on mount. */
async function getInlineToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? SUPABASE_ANON_KEY;
}

// ── Sparkline SVG ─────────────────────────────────────────────────────────────
function Sparkline({ values, color, height = 32, width = 80 }: {
  values: number[];
  color: string;
  height?: number;
  width?: number;
}) {
  if (!values || values.length < 2) return null;
  const min  = Math.min(...values);
  const max  = Math.max(...values);
  const range = max - min || 1;
  const pts   = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastY = height - ((values[values.length - 1] - min) / range) * height;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      {/* Area fill */}
      <defs>
        <linearGradient id={`sg-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${pts} ${width},${height}`}
        fill={`url(#sg-${color.replace('#','')})`}
      />
      {/* Line */}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Last point dot */}
      <circle cx={width} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

// ── Change badge ──────────────────────────────────────────────────────────────
function ChangeBadge({ pct }: { pct: number }) {
  const pos   = pct > 0;
  const zero  = Math.abs(pct) < 0.01;
  const color = zero ? 'var(--text-muted)' : pos ? '#10b981' : '#ef4444';
  const Icon  = zero ? Minus : pos ? TrendingUp : TrendingDown;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontFamily: 'monospace', fontSize: 10, color }}>
      <Icon size={10} />
      {zero ? '—' : `${pos ? '+' : ''}${pct.toFixed(2)}%`}
    </span>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ emoji, label }: { emoji: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 14 }}>{emoji}</span>
      <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 600 }}>
        {label}
      </span>
    </div>
  );
}

// ── Gold card ─────────────────────────────────────────────────────────────────
function GoldCard({ gold }: { gold: GoldData }) {
  const karats = [
    { label: '24K', value: gold.karat24, color: '#f59e0b' },
    { label: '22K', value: gold.karat22, color: '#d97706' },
    { label: '18K', value: gold.karat18, color: '#92400e' },
  ];
  return (
    <div style={{ border: '1px solid rgba(245,158,11,0.2)', background: 'rgba(245,158,11,0.04)', padding: '14px 16px', marginBottom: 10 }}>
      <SectionHeader emoji="🥇" label={`Gold — ${gold.currency}/gram`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
        {karats.map(k => (
          <div key={k.label} style={{ textAlign: 'center', padding: '10px 6px', background: 'rgba(0,0,0,0.2)', border: `1px solid ${k.color}20` }}>
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{k.label}</div>
            <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: k.color }}>{k.value}</div>
            <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', marginTop: 2 }}>SAR</div>
          </div>
        ))}
      </div>
      {gold.trend7d?.length >= 2 && (
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 6 }}>7-day trend (24K)</div>
          <Sparkline values={gold.trend7d} color="#f59e0b" height={36} width={280} />
        </div>
      )}
    </div>
  );
}

// ── Crypto card ───────────────────────────────────────────────────────────────
const CRYPTO_COLOR: Record<string, string> = {
  BTC: '#f59e0b', ETH: '#6366f1', SOL: '#10b981',
};

function CryptoCard({ asset }: { asset: CryptoAsset }) {
  const color = CRYPTO_COLOR[asset.symbol] ?? '#a78bfa';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: `1px solid ${color}20`, background: 'rgba(0,0,0,0.15)', marginBottom: 6 }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: `${color}18`, border: `1px solid ${color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 8, color, fontWeight: 700 }}>{asset.symbol}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color }}>${asset.price.toLocaleString()}</span>
          <ChangeBadge pct={asset.change24hPct} />
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{asset.name}</div>
      </div>
      {asset.trend7d?.length >= 2 && (
        <Sparkline values={asset.trend7d} color={color} height={28} width={64} />
      )}
    </div>
  );
}

// ── 5-day weather forecast ────────────────────────────────────────────────────
function WeatherForecast({ days }: { days: WeatherDay[] }) {
  const maxHigh = Math.max(...days.map(d => d.high));
  const minLow  = Math.min(...days.map(d => d.low));
  const range   = maxHigh - minLow || 1;

  return (
    <div style={{ border: '1px solid rgba(99,102,241,0.2)', background: 'rgba(99,102,241,0.04)', padding: '14px 16px', marginBottom: 10 }}>
      <SectionHeader emoji="🌡️" label="5-Day Weather" />
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 4 }}>
        {days.map((day, i) => {
          const highPct = ((day.high - minLow) / range) * 100;
          const lowPct  = ((day.low  - minLow) / range) * 100;
          const isToday = i === 0;
          return (
            <div key={i} style={{ textAlign: 'center', padding: '8px 4px', background: isToday ? 'rgba(99,102,241,0.08)' : 'transparent', border: isToday ? '1px solid rgba(99,102,241,0.2)' : '1px solid transparent' }}>
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: isToday ? '#818cf8' : 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                {isToday ? 'Today' : day.day}
              </div>
              <div style={{ fontSize: 18, marginBottom: 6 }}>{day.icon}</div>
              {/* Temp bar */}
              <div style={{ position: 'relative', height: 48, display: 'flex', justifyContent: 'center' }}>
                <div style={{
                  position: 'absolute',
                  bottom: `${lowPct}%`,
                  height: `${Math.max(6, highPct - lowPct)}%`,
                  width: 6,
                  background: `linear-gradient(to top, #6366f180, #818cf8)`,
                  borderRadius: 3,
                }} />
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{day.high}°</div>
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{day.low}°</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function MarketDashboard({ userId, location }: { userId: string; location: UserLocation | null }) {
  const [data, setData]       = useState<MarketData | null>(getCachedMarketData());
  const [loading, setLoading] = useState(false);
  const [ageMin, setAgeMin]   = useState(cacheAgeMinutes());
  const [interests, setInterests] = useState<string[]>([]);
  const [error, setError]     = useState<string | null>(null);

  // Load user interests
  useEffect(() => {
    fetchUserPreferences(userId).then(p => {
      setInterests(p?.briefing_interests ?? []);
    }).catch(() => {});
  }, [userId]);

  const refresh = useCallback(async (force = false) => {
    if (loading) return;
    if (!force && data && ageMin < 30) return;
    setLoading(true);
    setError(null);
    try {
      clearMarketCache();
      // Read token inline — prevents the race where async useState hasn't
      // resolved yet on first mount, causing a 401 with an empty token.
      const token = await getInlineToken();
      const fresh = await fetchMarketData(
        interests,
        location?.latitude,
        location?.longitude,
        token,
      );
      setData(fresh);
      setAgeMin(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load market data');
    } finally { setLoading(false); }
  }, [loading, data, ageMin, interests, location]);

  // Auto-fetch on mount if no cache or stale
  useEffect(() => {
    if (!data || ageMin >= 30) refresh(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh when app is foregrounded after being backgrounded
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && cacheAgeMinutes() >= 30) {
        refresh(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [refresh]);

  const hasGold   = !!(data?.gold);
  const hasCrypto = !!(data?.crypto?.length);
  const hasWeather = !!(data?.weather5d?.length);

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <TrendingUpIcon size={15} style={{ color: '#10b981' }} />
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600, flex: 1 }}>
          Market
        </span>
        <button
          onClick={() => refresh(true)}
          disabled={loading}
          style={{ background: 'transparent', border: '1px solid var(--border-subtle)', padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}
        >
          {loading
            ? <Loader size={11} style={{ color: 'var(--amber)', animation: 'spin 1s linear infinite' }} />
            : <RefreshCw size={11} style={{ color: 'var(--text-muted)' }} />
          }
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {loading ? 'Searching...' : ageMin < Infinity ? `${ageMin}m ago` : 'Refresh'}
          </span>
        </button>
      </div>

      {/* ── Loading state ── */}
      {loading && !data && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '48px 0' }}>
          <Loader size={24} style={{ color: '#10b981', animation: 'spin 1s linear infinite' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
            Searching web for live data...
          </span>
        </div>
      )}

      {/* ── Error state ── */}
      {!loading && !data && error && (
        <div style={{ textAlign: 'center', padding: '40px 16px' }}>
          <AlertTriangle size={28} style={{ color: '#ef4444', marginBottom: 12 }} />
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 6px' }}>
            Failed to load market data
          </p>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: '0 0 16px', opacity: 0.7, lineHeight: 1.5 }}>
            {error}
          </p>
          <button
            onClick={() => refresh(true)}
            style={{ padding: '8px 18px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
              letterSpacing: '0.1em', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#f87171', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Empty state (no error, no data yet) ── */}
      {!loading && !data && !error && (
        <div style={{ textAlign: 'center', padding: '48px 0', opacity: 0.5 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
            Tap refresh to load live market data
          </p>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginTop: 6, opacity: 0.6 }}>
            Searches the web for current prices
          </p>
        </div>
      )}

      {/* ── Data cards ── */}
      {data && (
        <>
          {hasWeather && <WeatherForecast days={data.weather5d!} />}
          {hasGold && <GoldCard gold={data.gold!} />}
          {hasCrypto && (
            <div style={{ border: '1px solid rgba(99,102,241,0.15)', background: 'rgba(99,102,241,0.03)', padding: '14px 16px', marginBottom: 10 }}>
              <SectionHeader emoji="₿" label="Crypto" />
              {data.crypto!.map(asset => <CryptoCard key={asset.symbol} asset={asset} />)}
            </div>
          )}
          {data.forex?.length && (
            <div style={{ border: '1px solid rgba(16,185,129,0.15)', background: 'rgba(16,185,129,0.03)', padding: '14px 16px', marginBottom: 10 }}>
              <SectionHeader emoji="💱" label="Forex" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {data.forex.map(fx => (
                  <div key={fx.pair} style={{ padding: '10px 12px', border: '1px solid rgba(16,185,129,0.15)', background: 'rgba(0,0,0,0.15)', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{fx.pair}</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: '#10b981' }}>{fx.rate.toFixed(4)}</div>
                    <ChangeBadge pct={fx.change24hPct} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Stale notice ── */}
          {ageMin > 0 && (
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', opacity: 0.4, margin: '4px 0 0' }}>
              Data from {ageMin} minute{ageMin !== 1 ? 's' : ''} ago · Refreshes automatically every 30 min
            </p>
          )}
        </>
      )}
    </div>
  );
}
