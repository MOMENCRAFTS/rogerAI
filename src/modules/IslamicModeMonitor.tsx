/**
 * IslamicModeMonitor.tsx — Admin dashboard for Islamic Mode oversight
 *
 * Panels:
 *  1. Adoption Stats — users with Islamic Mode on, % of total
 *  2. User List — table of Islamic Mode users with their settings
 *  3. Prayer Alert Log — last 50 prayer alerts fired across all users
 *  4. Manual Override — admin toggle per user (for QA / support)
 */

import { useState, useEffect } from 'react';
import { Moon, Users, Bell, Shield, RefreshCw, ToggleLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../lib/supabase';

const EMERALD     = '#10b981';
const EMERALD_DIM = 'rgba(16,185,129,0.07)';
const EMERALD_MID = 'rgba(16,185,129,0.15)';

interface IslamicUser {
  user_id: string;
  prayer_method: number | null;
  prayer_notifications: boolean | null;
  prayer_city: string | null;
  updated_at: string;
}

interface AlertLog {
  id: string;
  user_id: string;
  prayer_name: string;
  fired_at: string;
}

interface Stats {
  total: number;
  islamic: number;
  pct: string;
}

const METHOD_LABELS: Record<number, string> = {
  2: 'ISNA',
  3: 'MWL',
  4: 'Makkah',
  5: 'Egypt',
};

export default function IslamicModeMonitor() {
  const [stats, setStats]         = useState<Stats | null>(null);
  const [users, setUsers]         = useState<IslamicUser[]>([]);
  const [alerts, setAlerts]       = useState<AlertLog[]>([]);
  const [loading, setLoading]     = useState(true);
  const [toggling, setToggling]   = useState<string | null>(null);
  const [section, setSection]     = useState<'users' | 'alerts'>('users');
  const [expanded, setExpanded]   = useState<Record<string, boolean>>({});

  const loadData = async () => {
    setLoading(true);
    try {
      // Total user count
      const { count: total } = await supabase
        .from('user_preferences')
        .select('*', { count: 'exact', head: true });

      // Islamic mode users
      const { data: islamicUsers } = await supabase
        .from('user_preferences')
        .select('user_id, prayer_method, prayer_notifications, prayer_city, updated_at')
        .eq('islamic_mode', true)
        .order('updated_at', { ascending: false });

      const islamicCount = islamicUsers?.length ?? 0;
      setStats({
        total:   total ?? 0,
        islamic: islamicCount,
        pct:     total ? ((islamicCount / total) * 100).toFixed(1) : '0.0',
      });
      setUsers(islamicUsers ?? []);

      // Alert log
      const { data: alertData } = await supabase
        .from('islamic_alerts_log')
        .select('id, user_id, prayer_name, fired_at')
        .order('fired_at', { ascending: false })
        .limit(50);
      setAlerts(alertData ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const toggleIslamicMode = async (userId: string, currentlyOn: boolean) => {
    setToggling(userId);
    try {
      await supabase
        .from('user_preferences')
        .update({ islamic_mode: !currentlyOn })
        .eq('user_id', userId);
      await loadData();
    } catch { /* silent */ }
    finally { setToggling(null); }
  };

  const toggleSection = (uid: string) =>
    setExpanded(e => ({ ...e, [uid]: !e[uid] }));

  return (
    <div style={{ padding: 20 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <Moon size={20} color={EMERALD} />
        <div>
          <h1 style={{ fontFamily: 'monospace', fontSize: 15, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', margin: 0, fontWeight: 700 }}>
            Islamic Mode Monitor
          </h1>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: '2px 0 0', letterSpacing: '0.1em' }}>
            User adoption, prayer alerts, and override controls
          </p>
        </div>
        <button onClick={loadData} title="Refresh" disabled={loading}
          style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${EMERALD}30`, borderRadius: 0, padding: '6px 10px', cursor: 'pointer', color: EMERALD, display: 'flex', alignItems: 'center', gap: 5 }}>
          <RefreshCw size={12} style={{ animation: loading ? 'spin 0.8s linear infinite' : 'none' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Refresh</span>
        </button>
      </div>

      {/* ── Adoption Stats ── */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 24 }}>
          <StatCard value={String(stats.islamic)} label="Islamic Mode Users" accent={EMERALD} />
          <StatCard value={`${stats.pct}%`} label="Adoption Rate" accent={EMERALD} />
          <StatCard value={String(stats.total)} label="Total Users" accent="var(--amber)" />
        </div>
      )}

      {/* ── Adoption bar ── */}
      {stats && stats.total > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              Islamic Mode Adoption
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: EMERALD }}>
              {stats.islamic} / {stats.total}
            </span>
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
            <div style={{
              height: '100%',
              width: `${(stats.islamic / stats.total) * 100}%`,
              background: `linear-gradient(90deg, ${EMERALD}, #34d399)`,
              borderRadius: 2, transition: 'width 600ms ease',
            }} />
          </div>
        </div>
      )}

      {/* ── Section toggle ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['users', 'alerts'] as const).map(s => (
          <button key={s} onClick={() => setSection(s)} style={{
            padding: '7px 14px', fontFamily: 'monospace', fontSize: 10,
            textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
            border: `1px solid ${section === s ? EMERALD + '60' : 'rgba(255,255,255,0.07)'}`,
            background: section === s ? EMERALD_MID : 'transparent',
            color: section === s ? EMERALD : 'var(--text-muted)',
            transition: 'all 150ms',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {s === 'users' ? <Users size={11} /> : <Bell size={11} />}
            {s === 'users' ? `Users (${users.length})` : `Alert Log (${alerts.length})`}
          </button>
        ))}
      </div>

      {/* ── User List ── */}
      {section === 'users' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {users.length === 0 && (
            <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>
              No users have enabled Islamic Mode yet.
            </p>
          )}
          {users.map(u => (
            <div key={u.user_id} style={{
              border: `1px solid ${EMERALD}20`,
              background: expanded[u.user_id] ? EMERALD_DIM : 'rgba(255,255,255,0.02)',
              transition: 'background 200ms',
            }}>
              {/* Row header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
                onClick={() => toggleSection(u.user_id)}>
                <Moon size={13} color={EMERALD} style={{ flexShrink: 0 }} />
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.user_id.slice(0, 18)}…
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: `${EMERALD}70`, marginRight: 8, letterSpacing: '0.1em' }}>
                  {METHOD_LABELS[u.prayer_method ?? 3] ?? 'MWL'}
                </span>
                {expanded[u.user_id] ? <ChevronUp size={12} color="var(--text-muted)" /> : <ChevronDown size={12} color="var(--text-muted)" />}
              </div>

              {/* Expanded detail */}
              {expanded[u.user_id] && (
                <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${EMERALD}10` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10, marginTop: 10 }}>
                    <InfoCell label="Method" value={METHOD_LABELS[u.prayer_method ?? 3] ?? 'MWL'} />
                    <InfoCell label="Notifications" value={u.prayer_notifications !== false ? 'On' : 'Off'} color={u.prayer_notifications !== false ? EMERALD : '#f87171'} />
                    <InfoCell label="City Override" value={u.prayer_city ?? 'GPS-based'} />
                    <InfoCell label="Updated" value={new Date(u.updated_at).toLocaleDateString()} />
                  </div>
                  {/* Override toggle */}
                  <button
                    onClick={() => toggleIslamicMode(u.user_id, true)}
                    disabled={toggling === u.user_id}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '8px', fontFamily: 'monospace', fontSize: 10,
                      textTransform: 'uppercase', letterSpacing: '0.1em',
                      cursor: toggling === u.user_id ? 'not-allowed' : 'pointer',
                      background: 'rgba(239,68,68,0.08)',
                      border: '1px solid rgba(239,68,68,0.3)',
                      color: '#f87171',
                      opacity: toggling === u.user_id ? 0.5 : 1,
                      transition: 'all 150ms',
                    }}
                  >
                    <ToggleLeft size={12} />
                    {toggling === u.user_id ? 'Disabling…' : 'Disable Islamic Mode for this user'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Alert Log ── */}
      {section === 'alerts' && (
        <div>
          {alerts.length === 0 && (
            <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: 32 }}>
              No prayer alerts have been fired yet.
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {alerts.map(a => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 14px',
                border: '1px solid rgba(255,255,255,0.04)',
                background: 'rgba(255,255,255,0.02)',
              }}>
                <span style={{
                  fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
                  color: EMERALD, minWidth: 58, letterSpacing: '0.06em',
                }}>
                  {a.prayer_name}
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.user_id.slice(0, 16)}…
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                  {new Date(a.fired_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Admin note ── */}
      <div style={{ marginTop: 24, padding: '12px 14px', background: 'rgba(212,160,68,0.04)', border: '1px solid rgba(212,160,68,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={12} style={{ color: 'var(--amber)', flexShrink: 0 }} />
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
            Islamic Mode is user opt-in only. Admins can disable but not enable on behalf of users. All Islamic content powered by UmmahAPI.com (no API key required).
          </p>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div style={{ padding: '14px 16px', border: `1px solid ${accent}25`, background: `${accent}07` }}>
      <p style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color: accent, margin: '0 0 4px', letterSpacing: '0.04em' }}>
        {value}
      </p>
      <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.12em', lineHeight: 1.4 }}>
        {label}
      </p>
    </div>
  );
}

function InfoCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 2px' }}>{label}</p>
      <p style={{ fontFamily: 'monospace', fontSize: 11, color: color ?? 'var(--text-secondary)', margin: 0 }}>{value}</p>
    </div>
  );
}
