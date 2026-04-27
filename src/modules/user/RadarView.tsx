import { useState, useEffect, useRef } from 'react';
import { RefreshCw, Radio, X, CheckCircle, XCircle } from 'lucide-react';
import { useHazards } from '../../lib/useHazards';
import { polarToSVG } from '../../lib/hazardMath';
import { HAZARD_META } from '../../types/hazard';
import type { HazardEvent, HazardType } from '../../types/hazard';
import type { UserLocation } from '../../lib/useLocation';
import { useI18n } from '../../context/I18nContext';

interface Props {
  userId:   string;
  location: UserLocation | null;
}

const HAZARD_TYPES: HazardType[] = ['police','speed_cam','accident','road_works','debris','flood','closure'];
const SVG_SIZE  = 280;
const CX        = SVG_SIZE / 2;
const CY        = SVG_SIZE / 2;
const RADIUS    = 120;
const MAX_DIST  = 600; // metres shown at outer ring

// ── Radar sweep animation ─────────────────────────────────────────────────────
function RadarSweep({ angle }: { angle: number }) {
  const x2 = CX + RADIUS * Math.cos((angle - 90) * Math.PI / 180);
  const y2 = CY + RADIUS * Math.sin((angle - 90) * Math.PI / 180);
  return (
    <g>
      <defs>
        <radialGradient id="sweepGrad" cx="0%" cy="50%" r="100%">
          <stop offset="0%" stopColor="#d4a044" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#d4a044" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        d={`M ${CX} ${CY} L ${x2} ${y2} A ${RADIUS} ${RADIUS} 0 0 1 ${CX} ${CY - RADIUS} Z`}
        fill="url(#sweepGrad)"
        style={{ transformOrigin: `${CX}px ${CY}px`, transform: `rotate(${angle}deg)` }}
        opacity={0.35}
      />
      <line x1={CX} y1={CY} x2={x2} y2={y2}
        stroke="#d4a044" strokeWidth="1.5" strokeOpacity="0.9"
        style={{ transformOrigin: `${CX}px ${CY}px`, transform: `rotate(${angle}deg)` }}
      />
    </g>
  );
}

// ── Hazard pin on radar ───────────────────────────────────────────────────────
function HazardPin({ h, onClick }: { h: HazardEvent; onClick: () => void }) {
  const dist = h.distanceM ?? 999;
  const { x, y } = polarToSVG(dist, h.bearingDeg ?? 0, CX, CY, RADIUS, MAX_DIST);
  const meta  = HAZARD_META[h.type];
  const pulse = dist < 300;
  return (
    <g
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      {pulse && (
        <circle cx={x} cy={y} r="10" fill="none" stroke={meta.color}
          strokeWidth="1" strokeOpacity="0.5"
          style={{ animation: 'radarPing 1.4s ease-out infinite' }} />
      )}
      <circle cx={x} cy={y} r="6" fill={meta.color} fillOpacity="0.2" stroke={meta.color} strokeWidth="1.5" />
      <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle"
        fontSize="7" fill={meta.color} style={{ pointerEvents: 'none' }}>
        {meta.icon.length <= 2 ? meta.icon : '●'}
      </text>
      {h.mergedSources && h.mergedSources.length > 0 && (
        <circle cx={x + 7} cy={y - 7} r="4" fill="#10b981" stroke="#0a0a08" strokeWidth="1" />
      )}
    </g>
  );
}

export default function RadarView({ userId, location }: Props) {
  const { t: _t } = useI18n();
  const userLat = location?.latitude  ?? null;
  const userLng = location?.longitude ?? null;

  const { hazards, alertHazard, loading, reportHazard, voteHazard, refresh } =
    useHazards(userId, userLat, userLng);

  const [sweepAngle,  setSweepAngle]  = useState(0);
  const [showReport,  setShowReport]  = useState(false);
  const [reportType,  setReportType]  = useState<HazardType>('police');
  const [reporting,   setReporting]   = useState(false);
  const [selected,    setSelected]    = useState<HazardEvent | null>(null);
  const [muteZone,    setMuteZone]    = useState(false);
  const [reported,    setReported]    = useState(false);
  const rafRef = useRef<number>(0);

  // Radar sweep animation
  useEffect(() => {
    let angle = 0;
    const tick = () => {
      angle = (angle + 1.5) % 360;
      setSweepAngle(angle);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const handleReport = async () => {
    setReporting(true);
    try {
      await reportHazard(reportType);
      setReported(true);
      setTimeout(() => { setShowReport(false); setReported(false); }, 1500);
    } finally {
      setReporting(false);
    }
  };

  const nearby = hazards.filter(h => (h.distanceM ?? 999) <= MAX_DIST);
  const beyond = hazards.filter(h => (h.distanceM ?? 999) > MAX_DIST).slice(0, 5);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden', position: 'relative' }}>

      {/* ── Header ── */}
      <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Radio size={14} style={{ color: 'var(--amber)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.18em', color: 'var(--amber)', textTransform: 'uppercase' }}>
            ROGER RADAR
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            UNIFIED HAZARD LAYER
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="led-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: location ? '#5a9c69' : '#a84832', display: 'inline-block' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            {location ? 'LIVE' : 'NO GPS'}
          </span>
        </div>
        <button onClick={refresh} disabled={loading} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <RefreshCw size={11} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px' }}>

        {/* ── Radar Canvas ── */}
        <div style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
          <svg width={SVG_SIZE} height={SVG_SIZE} style={{ overflow: 'visible' }}>
            {/* Grid rings */}
            {[1/6, 0.5, 1].map((ratio, i) => (
              <circle key={i} cx={CX} cy={CY} r={RADIUS * ratio}
                fill="none" stroke="rgba(212,160,68,0.12)" strokeWidth={i === 2 ? 1.5 : 1}
                strokeDasharray={i === 2 ? 'none' : '3 4'} />
            ))}
            {/* Ring labels */}
            {[{ r: 1/6, label: '100m' }, { r: 0.5, label: '300m' }, { r: 1, label: '600m' }].map(({ r, label }) => (
              <text key={label} x={CX + 4} y={CY - RADIUS * r + 10}
                fill="rgba(212,160,68,0.35)" fontSize="7" fontFamily="monospace">{label}</text>
            ))}
            {/* Cross hairs */}
            <line x1={CX} y1={CY - RADIUS} x2={CX} y2={CY + RADIUS} stroke="rgba(212,160,68,0.08)" strokeWidth="1" />
            <line x1={CX - RADIUS} y1={CY} x2={CX + RADIUS} y2={CY} stroke="rgba(212,160,68,0.08)" strokeWidth="1" />
            {/* Cardinal labels */}
            {[['N',CX,CY-RADIUS-10],['S',CX,CY+RADIUS+16],['E',CX+RADIUS+14,CY+4],['W',CX-RADIUS-14,CY+4]].map(([d,x,y]) => (
              <text key={d} x={x} y={y} textAnchor="middle" fill="rgba(212,160,68,0.4)" fontSize="8" fontFamily="monospace">{d}</text>
            ))}
            {/* Sweep arm */}
            <RadarSweep angle={sweepAngle} />
            {/* User position */}
            <circle cx={CX} cy={CY} r="5" fill="#d4a044" />
            <circle cx={CX} cy={CY} r="9" fill="none" stroke="#d4a044" strokeWidth="1" strokeOpacity="0.4" />
            {/* Hazard pins */}
            {nearby.map(h => (
              <HazardPin key={h.id} h={h} onClick={() => setSelected(s => s?.id === h.id ? null : h)} />
            ))}
          </svg>

          {/* Mute badge */}
          {muteZone && (
            <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(168,72,50,0.15)', border: '1px solid var(--rust-border)', padding: '2px 8px', fontFamily: 'monospace', fontSize: 8, color: '#a84832', textTransform: 'uppercase' }}>
              MUTED
            </div>
          )}
        </div>

        {/* ── Selected pin detail ── */}
        {selected && (
          <div style={{ background: 'var(--bg-elevated)', border: `1px solid ${HAZARD_META[selected.type].color}44`, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>{HAZARD_META[selected.type].icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: HAZARD_META[selected.type].color }}>
                  {HAZARD_META[selected.type].label}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                  {Math.round(selected.distanceM ?? 0)}m {selected.bearingLabel}
                  {selected.mergedSources ? ` · ✓ ${selected.mergedSources.length + 1} sources` : ` · ${selected.source.toUpperCase()}`}
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={12} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => voteHazard(selected.id, 'confirm').then(refresh)} style={{ flex: 1, padding: '5px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', cursor: 'pointer', background: 'rgba(90,156,105,0.1)', border: '1px solid rgba(90,156,105,0.4)', color: '#5a9c69', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <CheckCircle size={10} /> THANK ROGER ({selected.confirmedCount})
              </button>
              <button onClick={() => voteHazard(selected.id, 'deny').then(refresh)} style={{ flex: 1, padding: '5px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', cursor: 'pointer', background: 'rgba(168,72,50,0.1)', border: '1px solid rgba(168,72,50,0.4)', color: '#a84832', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <XCircle size={10} /> NOT THERE ({selected.deniedCount})
              </button>
            </div>
          </div>
        )}

        {/* ── Sector Intel list ── */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '10px 14px' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 8 }}>
            SECTOR INTEL · {hazards.length} ACTIVE
          </div>
          {hazards.length === 0 && (
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'center', padding: '12px 0' }}>
              {loading ? 'SCANNING...' : location ? 'ZONE CLEAR' : 'GPS REQUIRED'}
            </div>
          )}
          {[...nearby, ...beyond].map(h => {
            const meta = HAZARD_META[h.type];
            return (
              <div key={h.id}
                onClick={() => setSelected(s => s?.id === h.id ? null : h)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-dim)', cursor: 'pointer' }}>
                <span style={{ fontSize: 14, minWidth: 20 }}>{meta.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 10, color: meta.color }}>{meta.label}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)' }}>
                    {h.distanceM !== undefined ? `${Math.round(h.distanceM)}m · ${h.bearingLabel}` : 'POSITION UNKNOWN'}
                    {h.mergedSources ? ' · ✓ MULTI-SOURCE' : ''}
                  </div>
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textAlign: 'right' }}>
                  <div>{h.confirmedCount}✓ {h.deniedCount}✗</div>
                  <div style={{ textTransform: 'uppercase' }}>{h.source}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Action Bar ── */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '10px 16px', display: 'flex', gap: 8, flexShrink: 0, background: 'var(--bg-elevated)' }}>
        <button
          onClick={() => { setShowReport(true); setReported(false); }}
          style={{ flex: 1, padding: '8px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: 'rgba(212,160,68,0.12)', border: '1px solid var(--amber)', color: 'var(--amber)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          REPORT HAZARD
        </button>
        <button
          onClick={() => setMuteZone(m => !m)}
          style={{ flex: 1, padding: '8px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: muteZone ? 'rgba(168,72,50,0.12)' : 'transparent', border: `1px solid ${muteZone ? 'var(--rust-border)' : 'var(--border-subtle)'}`, color: muteZone ? '#a84832' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          {muteZone ? 'MUTED' : 'MUTE ZONE'}
        </button>
      </div>

      {/* ── Report Sheet ── */}
      {showReport && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderBottom: 'none', padding: '20px 20px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.18em', flex: 1 }}>
                CONFIRM HAZARD REPORT
              </span>
              <button onClick={() => setShowReport(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={14} />
              </button>
            </div>

            {reported ? (
              <div style={{ textAlign: 'center', padding: '20px 0', fontFamily: 'monospace', fontSize: 12, color: '#5a9c69' }}>
                ✓ MERGED & BROADCAST
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 14 }}>
                  {HAZARD_TYPES.map(t => {
                    const meta = HAZARD_META[t];
                    const active = reportType === t;
                    return (
                      <button key={t} onClick={() => setReportType(t)} style={{ padding: '8px 4px', fontFamily: 'monospace', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: active ? `${meta.color}22` : 'transparent', border: `1px solid ${active ? meta.color : 'var(--border-subtle)'}`, color: active ? meta.color : 'var(--text-muted)', transition: 'all 0.15s' }}>
                        <span style={{ fontSize: 16 }}>{meta.icon}</span>
                        {meta.label.split(' ')[0]}
                      </button>
                    );
                  })}
                </div>

                {location && (
                  <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginBottom: 12, padding: '6px 10px', background: 'var(--bg-recessed)', border: '1px solid var(--border-dim)' }}>
                    {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                    {' · '}POSITION CONFIRMED
                  </div>
                )}

                <button
                  onClick={handleReport}
                  disabled={reporting || !location}
                  style={{ width: '100%', padding: '10px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.15em', cursor: reporting || !location ? 'not-allowed' : 'pointer', background: 'rgba(90,156,105,0.15)', border: '1px solid rgba(90,156,105,0.5)', color: '#5a9c69', opacity: !location ? 0.5 : 1 }}>
                  {reporting ? 'BROADCASTING...' : '✓ MERGE & BROADCAST'}
                </button>
                {!location && (
                  <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#a84832', textAlign: 'center', marginTop: 6 }}>
                    GPS REQUIRED TO REPORT
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Proximity Alert Overlay ── */}
      {alertHazard && !muteZone && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px solid rgba(168,72,50,0.6)', animation: 'alertPulse 1s ease-in-out infinite' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>{HAZARD_META[alertHazard.type].icon}</div>
          <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: HAZARD_META[alertHazard.type].color, textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 6 }}>
            ⚠ {HAZARD_META[alertHazard.type].label}
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            {Math.round(alertHazard.distanceM ?? 0)}m · {alertHazard.bearingLabel} · APPROACHING
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginBottom: 24 }}>
            CONFIRMED BY {alertHazard.confirmedCount} USER{alertHazard.confirmedCount !== 1 ? 'S' : ''}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => voteHazard(alertHazard.id, 'confirm')} style={{ padding: '8px 20px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', cursor: 'pointer', background: 'rgba(90,156,105,0.15)', border: '1px solid rgba(90,156,105,0.5)', color: '#5a9c69' }}>
              ✓ THANK ROGER
            </button>
            <button onClick={() => voteHazard(alertHazard.id, 'deny')} style={{ padding: '8px 20px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', cursor: 'pointer', background: 'rgba(168,72,50,0.1)', border: '1px solid rgba(168,72,50,0.4)', color: '#a84832' }}>
              ✗ NOT THERE
            </button>
          </div>
          <div style={{ position: 'absolute', top: 12, right: 12 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'rgba(212,160,68,0.6)', textTransform: 'uppercase' }}>
              VOICE ALERT SENT
            </span>
          </div>
        </div>
      )}

      <style>{`
        @keyframes radarPing { 0%{r:8;opacity:0.8} 100%{r:18;opacity:0} }
        @keyframes alertPulse { 0%,100%{border-color:rgba(168,72,50,0.6)} 50%{border-color:rgba(168,72,50,0.2)} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
}
