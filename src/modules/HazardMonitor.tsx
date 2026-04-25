// ─── Admin · Hazard Monitor (Full Control) ────────────────────────────────────
// Complete admin panel for the Roger Radar unified hazard layer.
// Controls: view, inject, vote, force-expire, delete, bulk-clear, source status.

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, Clock, Radio, AlertTriangle, Plus, Zap, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { HAZARD_META } from '../types/hazard';
import type { HazardType } from '../types/hazard';

interface HazardRow {
  id:              string;
  type:            HazardType;
  lat:             number;
  lng:             number;
  source:          string;
  confirmed_count: number;
  denied_count:    number;
  expires_at:      string | null;
  created_at:      string;
  reported_by:     string | null;
}

const HAZARD_TYPES: HazardType[] = ['police','speed_cam','accident','road_works','debris','flood','closure'];
const SOURCE_COLOR: Record<string, string> = {
  community: '#d4a044',
  osm:       '#3b82f6',
  tomtom:    '#8b5cf6',
};

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
function isExpired(row: HazardRow): boolean {
  if (row.denied_count >= 3) return true;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return true;
  return false;
}

// ── Shared field + button styles ────────────────────────────────────────────
const inputSt: React.CSSProperties = {
  background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)',
  padding: '6px 10px', fontFamily: 'monospace', fontSize: 10,
  color: 'var(--text-primary)', outline: 'none', width: '100%',
};
const labelSt: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, display: 'block',
};
const cardSt: React.CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '14px 16px',
};
const cardHeaderSt: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
  fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)',
  textTransform: 'uppercase', letterSpacing: '0.15em',
};

export default function HazardMonitor() {
  const [rows,     setRows]     = useState<HazardRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState<'all' | 'live' | 'expired'>('live');
  const [busy,     setBusy]     = useState<string | null>(null);

  // ── Inject form ──────────────────────────────────────────────────────────
  const [injectType, setInjectType] = useState<HazardType>('police');
  const [injectLat,  setInjectLat]  = useState('');
  const [injectLng,  setInjectLng]  = useState('');
  const [injecting,  setInjecting]  = useState(false);
  const [injectMsg,  setInjectMsg]  = useState('');

  // ── Bulk controls ─────────────────────────────────────────────────────────
  const [bulkType,   setBulkType]   = useState<HazardType | 'all'>('all');
  const [bulkSrc,    setBulkSrc]    = useState<'all' | 'community' | 'osm' | 'tomtom'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('road_hazards').select('*')
        .order('created_at', { ascending: false }).limit(300);
      setRows((data as HazardRow[]) ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Realtime live feed
  useEffect(() => {
    const ch = supabase.channel('hazard_monitor_admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'road_hazards' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const injectHazard = async () => {
    const lat = parseFloat(injectLat);
    const lng = parseFloat(injectLng);
    if (isNaN(lat) || isNaN(lng)) { setInjectMsg('Invalid coordinates'); return; }
    setInjecting(true);
    setInjectMsg('');
    try {
      const meta      = HAZARD_META[injectType];
      const expiresAt = new Date(Date.now() + meta.expiryMs).toISOString();
      await supabase.from('road_hazards').insert({
        type: injectType, lat, lng,
        source: 'community', confirmed_count: 1, denied_count: 0, expires_at: expiresAt,
      });
      setInjectMsg(`✓ ${meta.label} injected at ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      setInjectLat(''); setInjectLng('');
      load();
    } catch (e) {
      setInjectMsg(`Error: ${(e as Error).message}`);
    } finally { setInjecting(false); }
  };

  const vote = async (id: string, field: 'confirmed_count' | 'denied_count', cur: number) => {
    setBusy(id);
    await supabase.from('road_hazards').update({ [field]: cur + 1 }).eq('id', id);
    setBusy(null);
    load();
  };

  const forceExpire = async (id: string) => {
    setBusy(id + '_expire');
    await supabase.from('road_hazards').update({ expires_at: new Date().toISOString() }).eq('id', id);
    setBusy(null);
    load();
  };

  const deleteRow = async (id: string) => {
    setBusy(id + '_del');
    await supabase.from('road_hazards').delete().eq('id', id);
    setRows(prev => prev.filter(r => r.id !== id));
    setBusy(null);
  };

  const bulkExpire = async () => {
    setBusy('bulk');
    let q = supabase.from('road_hazards').update({ expires_at: new Date().toISOString() });
    if (bulkType !== 'all') q = q.eq('type', bulkType);
    if (bulkSrc  !== 'all') q = q.eq('source', bulkSrc);
    await q;
    setBusy(null);
    load();
  };

  const bulkDelete = async () => {
    if (!confirm('Delete selected hazards? This cannot be undone.')) return;
    setBusy('bulk');
    let q = supabase.from('road_hazards').delete();
    if (bulkType !== 'all') q = q.eq('type', bulkType);
    if (bulkSrc  !== 'all') q = q.eq('source', bulkSrc);
    await q;
    setBusy(null);
    load();
  };

  const clearAll = async () => {
    if (!confirm('Delete ALL road hazards? Cannot be undone.')) return;
    setBusy('clearall');
    await supabase.from('road_hazards').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    setBusy(null);
    setRows([]);
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const live    = rows.filter(r => !isExpired(r));
  const expired = rows.filter(r =>  isExpired(r));
  const visible = filter === 'live' ? live : filter === 'expired' ? expired : rows;

  const byType  = rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.type]: (a[r.type] ?? 0) + 1 }), {});

  const ttActive = !!(import.meta.env.VITE_TOMTOM_API_KEY);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <Radio size={15} style={{ color: 'var(--amber)' }} />
        <div style={{ flex: 1 }}>
          <h1 style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.18em', color: 'var(--amber)', textTransform: 'uppercase', margin: 0 }}>HAZARD MONITOR</h1>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.12em' }}>UNIFIED ROAD HAZARD LAYER · ADMIN CONTROL</p>
        </div>
        <button onClick={load} disabled={loading} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', padding: '5px 8px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── Stats ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
          {[
            { label: 'TOTAL',   value: rows.length,   color: 'var(--text-primary)' },
            { label: 'LIVE',    value: live.length,    color: '#5a9c69' },
            { label: 'EXPIRED', value: expired.length, color: '#a84832' },
            { label: 'TOMTOM',  value: ttActive ? 'ON' : 'OFF', color: ttActive ? '#8b5cf6' : '#6b6a5e' },
          ].map(s => (
            <div key={s.label} style={cardSt}>
              <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Inject hazard ── */}
        <div style={cardSt}>
          <div style={cardHeaderSt}><Plus size={11} /> INJECT HAZARD</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={labelSt}>LATITUDE</label>
              <input value={injectLat} onChange={e => setInjectLat(e.target.value)}
                placeholder="e.g. 25.20450" style={inputSt} />
            </div>
            <div>
              <label style={labelSt}>LONGITUDE</label>
              <input value={injectLng} onChange={e => setInjectLng(e.target.value)}
                placeholder="e.g. 55.27050" style={inputSt} />
            </div>
          </div>
          <label style={labelSt}>TYPE</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 10 }}>
            {HAZARD_TYPES.map(t => {
              const meta = HAZARD_META[t];
              const sel  = injectType === t;
              return (
                <button key={t} onClick={() => setInjectType(t)} style={{ padding: '6px 4px', fontFamily: 'monospace', fontSize: 8, textTransform: 'uppercase', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: sel ? `${meta.color}22` : 'transparent', border: `1px solid ${sel ? meta.color : 'var(--border-subtle)'}`, color: sel ? meta.color : 'var(--text-muted)', transition: 'all 0.12s' }}>
                  <span style={{ fontSize: 14 }}>{meta.icon}</span>
                  {meta.label.split(' ')[0]}
                </button>
              );
            })}
          </div>
          <button onClick={injectHazard} disabled={injecting || !injectLat || !injectLng} style={{ width: '100%', padding: '8px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', cursor: injecting ? 'wait' : 'pointer', background: 'rgba(212,160,68,0.12)', border: '1px solid var(--amber)', color: 'var(--amber)', opacity: !injectLat || !injectLng ? 0.5 : 1 }}>
            {injecting ? 'INJECTING...' : '⚡ INJECT & BROADCAST'}
          </button>
          {injectMsg && (
            <div style={{ fontFamily: 'monospace', fontSize: 9, marginTop: 6, color: injectMsg.startsWith('✓') ? '#5a9c69' : '#a84832' }}>{injectMsg}</div>
          )}
        </div>

        {/* ── Bulk controls ── */}
        <div style={cardSt}>
          <div style={cardHeaderSt}><Zap size={11} /> BULK CONTROLS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <label style={labelSt}>FILTER BY TYPE</label>
              <select value={bulkType} onChange={e => setBulkType(e.target.value as HazardType | 'all')}
                style={{ ...inputSt, cursor: 'pointer' }}>
                <option value="all">ALL TYPES</option>
                {HAZARD_TYPES.map(t => <option key={t} value={t}>{HAZARD_META[t].label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>FILTER BY SOURCE</label>
              <select value={bulkSrc} onChange={e => setBulkSrc(e.target.value as typeof bulkSrc)}
                style={{ ...inputSt, cursor: 'pointer' }}>
                <option value="all">ALL SOURCES</option>
                <option value="community">COMMUNITY</option>
                <option value="osm">OSM</option>
                <option value="tomtom">TOMTOM</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={bulkExpire} disabled={busy === 'bulk'} style={{ flex: 1, padding: '7px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', cursor: 'pointer', background: 'rgba(212,160,68,0.08)', border: '1px solid rgba(212,160,68,0.35)', color: 'var(--amber)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <Clock size={11} /> EXPIRE SELECTION
            </button>
            <button onClick={bulkDelete} disabled={busy === 'bulk'} style={{ flex: 1, padding: '7px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', cursor: 'pointer', background: 'rgba(168,72,50,0.08)', border: '1px solid rgba(168,72,50,0.4)', color: '#a84832', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <Trash2 size={11} /> DELETE SELECTION
            </button>
            <button onClick={clearAll} disabled={busy === 'clearall'} style={{ padding: '7px 12px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', cursor: 'pointer', background: 'rgba(168,72,50,0.15)', border: '1px solid rgba(168,72,50,0.6)', color: '#ef4444', display: 'flex', alignItems: 'center', gap: 5 }}>
              <XCircle size={11} /> CLEAR ALL
            </button>
          </div>
        </div>

        {/* ── Type breakdown ── */}
        {Object.keys(byType).length > 0 && (
          <div style={{ ...cardSt, padding: '10px 16px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(byType).map(([type, count]) => {
                const meta = HAZARD_META[type as HazardType];
                return (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', background: `${meta.color}11`, border: `1px solid ${meta.color}44` }}>
                    <span>{meta.icon}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: meta.color, textTransform: 'uppercase' }}>{meta.label}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: meta.color }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Filter bar ── */}
        <div style={{ display: 'flex', gap: 6 }}>
          {(['all','live','expired'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: '5px 14px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: filter === f ? 'rgba(212,160,68,0.12)' : 'transparent', border: `1px solid ${filter === f ? 'var(--amber)' : 'var(--border-subtle)'}`, color: filter === f ? 'var(--amber)' : 'var(--text-muted)' }}>
              {f} ({f === 'all' ? rows.length : f === 'live' ? live.length : expired.length})
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', alignSelf: 'center', textTransform: 'uppercase' }}>
            {loading ? 'SYNCING...' : `${visible.length} SHOWN`}
          </span>
        </div>

        {/* ── Hazard table ── */}
        <div style={cardSt}>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '22px 1fr 70px 70px 70px 80px', gap: 8, padding: '6px 0 8px', borderBottom: '1px solid var(--border-subtle)', fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            <span></span><span>TYPE · COORDS</span><span>SOURCE</span><span>VOTES</span><span>STATUS</span><span>ACTIONS</span>
          </div>

          {!loading && visible.length === 0 && (
            <div style={{ padding: '20px 0', textAlign: 'center', fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              {filter === 'live' ? 'NO ACTIVE HAZARDS' : 'NO RECORDS'}
            </div>
          )}

          {visible.map(row => {
            const meta = HAZARD_META[row.type];
            const exp  = isExpired(row);
            return (
              <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '22px 1fr 70px 70px 70px 80px', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border-dim)', alignItems: 'center', opacity: exp ? 0.45 : 1 }}>

                <span style={{ fontSize: 14 }}>{meta.icon}</span>

                <div>
                  <div style={{ fontFamily: 'monospace', fontSize: 9, color: meta.color, textTransform: 'uppercase' }}>{meta.label}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)' }}>
                    {row.lat.toFixed(5)}, {row.lng.toFixed(5)} · {timeAgo(row.created_at)}
                  </div>
                </div>

                <span style={{ fontFamily: 'monospace', fontSize: 8, padding: '2px 5px', background: `${SOURCE_COLOR[row.source] ?? '#888'}18`, border: `1px solid ${SOURCE_COLOR[row.source] ?? '#888'}44`, color: SOURCE_COLOR[row.source] ?? '#888', textTransform: 'uppercase' }}>
                  {row.source}
                </span>

                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => vote(row.id, 'confirmed_count', row.confirmed_count)} disabled={!!busy} style={{ flex: 1, padding: '3px 4px', fontFamily: 'monospace', fontSize: 8, cursor: 'pointer', background: 'rgba(90,156,105,0.1)', border: '1px solid rgba(90,156,105,0.4)', color: '#5a9c69' }}>
                    {row.confirmed_count}✓
                  </button>
                  <button onClick={() => vote(row.id, 'denied_count', row.denied_count)} disabled={!!busy} style={{ flex: 1, padding: '3px 4px', fontFamily: 'monospace', fontSize: 8, cursor: 'pointer', background: 'rgba(168,72,50,0.1)', border: '1px solid rgba(168,72,50,0.4)', color: '#a84832' }}>
                    {row.denied_count}✗
                  </button>
                </div>

                <span style={{ fontFamily: 'monospace', fontSize: 8, padding: '2px 5px', background: exp ? 'rgba(168,72,50,0.1)' : 'rgba(90,156,105,0.1)', border: `1px solid ${exp ? 'rgba(168,72,50,0.4)' : 'rgba(90,156,105,0.35)'}`, color: exp ? '#a84832' : '#5a9c69', textTransform: 'uppercase' }}>
                  {exp ? 'EXPIRED' : 'LIVE'}
                </span>

                <div style={{ display: 'flex', gap: 4 }}>
                  {!exp && (
                    <button onClick={() => forceExpire(row.id)} disabled={busy === row.id + '_expire'} title="Force expire" style={{ padding: '3px 5px', cursor: 'pointer', background: 'rgba(212,160,68,0.08)', border: '1px solid rgba(212,160,68,0.3)', color: 'var(--amber)' }}>
                      <Clock size={9} />
                    </button>
                  )}
                  <button onClick={() => deleteRow(row.id)} disabled={busy === row.id + '_del'} title="Delete" style={{ padding: '3px 5px', cursor: 'pointer', background: 'rgba(168,72,50,0.08)', border: '1px solid rgba(168,72,50,0.3)', color: '#a84832' }}>
                    <Trash2 size={9} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Data Source Status ── */}
        <div style={cardSt}>
          <div style={cardHeaderSt}><AlertTriangle size={11} /> DATA SOURCE STATUS</div>
          {[
            { name: 'COMMUNITY (SUPABASE)', active: true, desc: 'Real-time PTT reports · Realtime channel subscribed' },
            { name: 'OSM OVERPASS (FIXED CAMS)', active: true, desc: 'Static speed cameras · 6h session cache per bbox' },
            { name: 'TOMTOM TRAFFIC INCIDENTS', active: ttActive, desc: ttActive ? 'Live accidents & closures · 90s poll' : '→ Add VITE_TOMTOM_API_KEY to .env.local' },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg-recessed)', border: '1px solid var(--border-dim)', marginBottom: 6 }}>
              <span className="led-pulse" style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: s.active ? '#5a9c69' : '#a84832' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 9, color: s.active ? 'var(--text-primary)' : 'var(--text-muted)', textTransform: 'uppercase' }}>{s.name}</div>
                <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)' }}>{s.desc}</div>
              </div>
              <span style={{ fontFamily: 'monospace', fontSize: 8, padding: '2px 6px', border: `1px solid ${s.active ? 'rgba(90,156,105,0.4)' : 'rgba(168,72,50,0.4)'}`, color: s.active ? '#5a9c69' : '#a84832', textTransform: 'uppercase' }}>
                {s.active ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </div>
          ))}
        </div>

      </div>
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  );
}
