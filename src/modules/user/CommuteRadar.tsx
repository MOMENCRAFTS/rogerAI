import { useState, useEffect, useRef } from 'react';
import { Car, Navigation } from 'lucide-react';
import RadarView from './RadarView';
import { fetchCommuteProfile, fetchErrands, getCommute, type DbCommuteProfile, type DbErrandItem } from '../../lib/api';
import { speakResponse } from '../../lib/tts';
import type { UserLocation } from '../../lib/useLocation';

interface Props { userId: string; location?: UserLocation | null; }

const KMH = (ms: number) => Math.round(ms * 3.6);
const DRIVE_ENTRY_MS = 5.56; // 20 km/h
const DRIVE_EXIT_MS  = 1.39; // 5 km/h
const EXIT_DELAY_MS  = 10_000;

export default function CommuteRadar({ userId, location = null }: Props) {

  const [innerTab, setInnerTab] = useState<'radar' | 'route'>('radar');
  const [driveMode, setDriveMode] = useState(false);
  const [profile, setProfile]   = useState<DbCommuteProfile | null>(null);
  const [errands, setErrands]   = useState<DbErrandItem[]>([]);
  const [eta, setEta]           = useState<{ duration: string; distance: string } | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const etaRef    = useRef(0);

  // Load route data
  useEffect(() => {
    fetchCommuteProfile(userId).then(p => { setProfile(p); }).catch(() => {});
    fetchErrands(userId, 'pending').then(setErrands).catch(() => {});
  }, [userId]);

  // ETA — throttled 60s
  useEffect(() => {
    if (!profile?.work_address || !location) return;
    const now = Date.now();
    if (now - etaRef.current < 60_000) return;
    etaRef.current = now;
    getCommute(location.latitude, location.longitude, profile.work_address, profile.commute_mode ?? 'driving')
      .then(r => { if (r) setEta(r); }).catch(() => {});
  }, [profile, location]);

  // Drive mode auto-detect
  useEffect(() => {
    const speed = location?.speed ?? 0;
    if (speed >= DRIVE_ENTRY_MS && !driveMode) {
      setDriveMode(true);
      if (exitTimer.current) clearTimeout(exitTimer.current);
    } else if (speed < DRIVE_EXIT_MS && driveMode) {
      exitTimer.current = setTimeout(() => setDriveMode(false), EXIT_DELAY_MS);
    } else if (speed >= DRIVE_EXIT_MS && exitTimer.current) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
  }, [location?.speed, driveMode]);

  const speedKmh = KMH(location?.speed ?? 0);
  const heading  = location?.heading ?? 0;

  const speakBrief = async () => {
    const parts: string[] = [];
    if (eta)            parts.push(`ETA ${eta.duration}, ${eta.distance}`);
    if (errands.length) parts.push(`${errands.length} errand${errands.length > 1 ? 's' : ''} on route`);
    parts.push('Roger standing by.');
    await speakResponse(parts.join('. '));
  };

  // ── Drive Mode ─────────────────────────────────────────────────────────────
  if (driveMode) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#080806', display: 'flex', flexDirection: 'column' }}>
        {/* Speed HUD */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid rgba(212,160,68,0.15)' }}>
          <span style={{ fontFamily: 'monospace', fontSize: 28, fontWeight: 700, color: 'var(--amber)' }}>{speedKmh}<span style={{ fontSize: 11, marginLeft: 4 }}>km/h</span></span>
          {eta && <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)' }}>{eta.duration}</span>}
          <button onClick={() => setDriveMode(false)} style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', padding: '4px 10px', cursor: 'pointer', textTransform: 'uppercase' }}>EXIT</button>
        </div>
        {/* Radar fills rest */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <RadarViewWithHeading userId={userId} location={location} heading={heading} />
        </div>
        {/* Bottom strip */}
        {errands.length > 0 && (
          <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(212,160,68,0.15)', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            📋 {errands[0].item}{errands.length > 1 ? ` +${errands.length - 1} more` : ''}
          </div>
        )}
      </div>
    );
  }

  // ── Normal Mode ────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 16px 8px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Car size={14} style={{ color: 'var(--amber)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.18em', color: 'var(--amber)', textTransform: 'uppercase' }}>COMMUTE COMMAND</div>
          <div style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {location ? `${speedKmh} km/h · GPS LIVE` : 'NO GPS'}
          </div>
        </div>
        <button onClick={speakBrief} style={{ padding: '4px 12px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', cursor: 'pointer', background: 'rgba(212,160,68,0.1)', border: '1px solid var(--amber)', color: 'var(--amber)' }}>
          🚦 BRIEF
        </button>
      </div>

      {/* Tab Pills */}
      <div style={{ display: 'flex', padding: '8px 16px', gap: 8, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {(['radar', 'route'] as const).map(t => (
          <button key={t} onClick={() => setInnerTab(t)} style={{
            fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.15em',
            padding: '4px 14px', cursor: 'pointer', border: 'none',
            background: innerTab === t ? 'rgba(212,160,68,0.12)' : 'transparent',
            color: innerTab === t ? 'var(--amber)' : 'var(--text-muted)',
            borderBottom: `2px solid ${innerTab === t ? 'var(--amber)' : 'transparent'}`,
          }}>
            {t === 'radar' ? '◎ RADAR' : '🗺 ROUTE'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {innerTab === 'radar' && <RadarView userId={userId} location={location ?? null} />}
        {innerTab === 'route' && <RouteTab profile={profile} eta={eta} errands={errands} />}
      </div>
    </div>
  );
}

// ── Radar with heading arrow injected ─────────────────────────────────────────
function RadarViewWithHeading({ userId, location }: Props & { heading: number }) {
  return <RadarView userId={userId} location={location ?? null} />;
}

// ── Route Tab ─────────────────────────────────────────────────────────────────
function RouteTab({ profile, eta, errands }: { profile: DbCommuteProfile | null; eta: { duration: string; distance: string } | null; errands: DbErrandItem[] }) {
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ETA Banner */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '14px 16px' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 8 }}>
          <Navigation size={10} style={{ display: 'inline', marginRight: 6 }} />ROUTE INTEL
        </div>
        {profile?.home_address && <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>🏠 {profile.home_address}</div>}
        {profile?.work_address && <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', marginBottom: 10 }}>🏢 {profile.work_address}</div>}
        {eta
          ? <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color: 'var(--amber)' }}>{eta.duration} <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{eta.distance}</span></div>
          : <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>{profile?.work_address ? 'Calculating ETA...' : 'No route set — say "My work is at [address]"'}</div>
        }
      </div>

      {/* Errands */}
      {errands.length > 0 && (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '14px 16px' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 8 }}>
            📋 ERRANDS · {errands.length} PENDING
          </div>
          {errands.map(e => (
            <div key={e.id} style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', padding: '5px 0', borderBottom: '1px solid var(--border-dim)' }}>
              {e.item}{e.location_hint ? <span style={{ color: 'var(--text-muted)', fontSize: 9 }}> · {e.location_hint}</span> : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
