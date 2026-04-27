/**
 * SalahView.tsx — The SALAH tab for Roger AI's Islamic Mode
 *
 * Sections:
 *  1. Next Prayer countdown hero (pulsing ring)
 *  2. Today's 6-prayer times grid (active highlighted)
 *  3. Qibla Compass — animated SVG needle driven by DeviceOrientationEvent
 *  4. Verse of the Day — Arabic text, transliteration, English translation
 *  5. Prayer Tracker — tap to mark each salah done (local state)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Moon, Compass, BookOpen, RefreshCw, MapPin } from 'lucide-react';
import type { UserLocation } from '../../lib/useLocation';
import {
  fetchPrayerTimes, getNextPrayer, getCurrentPrayer, getQiblaDirection,
  bearingToCardinal, fetchVerseOfDay, formatCountdown, PRAYER_METHODS,
  getCurrentPrayerRemaining,
  type PrayerTimes, type VerseOfDay,
} from '../../lib/islamicApi';
import { HijriBanner, HadithCard, DuaCard, AsmaUlHusnaCard, VerseAudioButton } from './SalahExtras';
import { useI18n } from '../../context/I18nContext';

interface Props {
  userId: string;
  location: UserLocation | null;
}

const PRAYERS_DISPLAY = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;
const TRACKABLE       = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;

const EMERALD     = '#10b981';
const EMERALD_DIM = 'rgba(16,185,129,0.08)';
const EMERALD_MID = 'rgba(16,185,129,0.18)';

export default function SalahView({ location }: Props) {
  const { t: _t } = useI18n();
  const [times, setTimes]           = useState<PrayerTimes | null>(null);
  const [verse, setVerse]           = useState<VerseOfDay | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [qibla, setQibla]           = useState<number | null>(null);
  const [heading, setHeading]       = useState<number>(0);
  const [compassSupported, setCompassSupported] = useState(true);
  const [prayed, setPrayed]         = useState<Record<string, boolean>>({});
  const timerRef                    = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Stabilise GPS coordinates to prevent jitter-driven refetches ──────────
  // GPS watchPosition fires every few seconds with sub-metre floating-point
  // changes. Rounding to 2 decimals (~1.1 km) stops the loadData callback
  // from being recreated on every GPS tick, which was causing the
  // loading-spinner flicker.
  const stableLat = useMemo(() => {
    const raw = location?.latitude ?? 24.7136;
    return Math.round(raw * 100) / 100;
  }, [location?.latitude]);
  const stableLng = useMemo(() => {
    const raw = location?.longitude ?? 46.6753;
    return Math.round(raw * 100) / 100;
  }, [location?.longitude]);

  // ── Load prayer times + verse ─────────────────────────────────────────────
  const loadData = useCallback(async (isRefresh = false) => {
    // Only show full-screen loading on the very first load —
    // subsequent refreshes keep the existing data visible.
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const [pTimes, pVerse] = await Promise.all([
        fetchPrayerTimes(stableLat, stableLng),
        fetchVerseOfDay(),
      ]);
      setTimes(pTimes);
      setVerse(pVerse);
      setQibla(getQiblaDirection(stableLat, stableLng));
    } catch {
      // Only show error if we have no cached data to show
      if (!times) setError('Could not load prayer times. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [stableLat, stableLng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadData(); }, [loadData]);

  // ── Countdown ticker ──────────────────────────────────────────────────────
  useEffect(() => {
    timerRef.current = setInterval(() => setQibla(q => q), 1000); // trigger re-render for countdown
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // ── Device compass for Qibla ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: DeviceOrientationEvent) => {
      // webkitCompassHeading is available on iOS Safari; alpha is on Android
      const h = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
        ?? (e.alpha != null ? (360 - e.alpha) : null);
      if (h != null) setHeading(h);
    };

    const attach = () => {
      if ('DeviceOrientationEvent' in window) {
        window.addEventListener('deviceorientation', handler as EventListener, true);
      } else {
        setCompassSupported(false);
      }
    };

    // iOS 13+ requires explicit permission via a user gesture
    type DOEWithPermission = typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    const DOE = DeviceOrientationEvent as DOEWithPermission;
    if (typeof DOE.requestPermission === 'function') {
      DOE.requestPermission()
        .then(state => { if (state === 'granted') attach(); else setCompassSupported(false); })
        .catch(() => setCompassSupported(false));
    } else {
      // Android / desktop — no permission needed
      attach();
    }

    return () => window.removeEventListener('deviceorientation', handler as EventListener, true);
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────
  const next    = times ? getNextPrayer(times) : null;
  const current = times ? getCurrentPrayer(times) : null;

  // Qibla needle angle (relative to device heading)
  const needleAngle = qibla != null ? (qibla - heading + 360) % 360 : 0;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const togglePrayed = (name: string) =>
    setPrayed(p => ({ ...p, [name]: !p[name] }));

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12 }}>
        <div style={{ width: 28, height: 28, border: `3px solid ${EMERALD}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          Loading prayer times…
        </span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: 24 }}>
        <Moon size={32} color={EMERALD} style={{ opacity: 0.5 }} />
        <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>{error}</p>
        <button onClick={() => loadData()} style={btnStyle('sm')}><RefreshCw size={12} /> Retry</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '0 0 80px', background: 'var(--bg-primary)', minHeight: '100%', position: 'relative' }}>

      {/* ── Geometric background texture ── */}
      <svg style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', opacity: 0.025, pointerEvents: 'none', zIndex: 0 }} aria-hidden="true">
        <defs>
          <pattern id="geo" width="60" height="60" patternUnits="userSpaceOnUse">
            <polygon points="30,2 58,15 58,45 30,58 2,45 2,15" fill="none" stroke={EMERALD} strokeWidth="0.8" />
            <polygon points="30,12 50,21 50,39 30,48 10,39 10,21" fill="none" stroke={EMERALD} strokeWidth="0.4" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#geo)" />
      </svg>

      {/* ── Header ── */}
      <div style={{ position: 'relative', zIndex: 1, padding: '16px 16px 0', borderBottom: `1px solid ${EMERALD}20`, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Moon size={16} color={EMERALD} />
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: EMERALD, textTransform: 'uppercase', letterSpacing: '0.22em', fontWeight: 700 }}>
            Salah
          </span>
          <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
            {location
              ? <><MapPin size={9} style={{ verticalAlign: 'middle' }} /> {location.latitude.toFixed(2)}° {location.longitude.toFixed(2)}°</>
              : 'Location unavailable — using Riyadh'}
          </span>
          <button onClick={() => loadData(true)} title="Refresh" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex' }}>
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* ── Hijri Date Banner ── */}
      <HijriBanner />

      <div style={{ padding: '0 16px', position: 'relative', zIndex: 1 }}>

        {/* ── 1. Next Prayer Countdown Hero ──────────────────────────────── */}
        {next && (
          <div style={{
            marginBottom: 20,
            background: EMERALD_DIM,
            border: `1px solid ${EMERALD}30`,
            padding: '24px 20px',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Pulsing ring */}
            <div style={{
              position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)',
              width: 72, height: 72,
            }}>
              <svg width="72" height="72" viewBox="0 0 72 72" style={{ overflow: 'visible' }}>
                {/* Outer pulse ring */}
                <circle cx="36" cy="36" r="32" fill="none" stroke={EMERALD} strokeWidth="1.5" opacity="0.2" />
                <circle cx="36" cy="36" r="32" fill="none" stroke={EMERALD} strokeWidth="1.5" opacity="0.6">
                  <animate attributeName="r" values="28;34;28" dur="2.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.6;0.1;0.6" dur="2.4s" repeatCount="indefinite" />
                </circle>
                {/* Prayer countdown arc — full circle = 100% of time window */}
                <circle cx="36" cy="36" r="28" fill="none" stroke={EMERALD} strokeWidth="3"
                  strokeDasharray={`${2 * Math.PI * 28}`}
                  strokeDashoffset={`${2 * Math.PI * 28 * (1 - Math.min(1, next.secondsUntil / (6 * 3600)))}`}
                  strokeLinecap="round"
                  transform="rotate(-90 36 36)"
                  style={{ transition: 'stroke-dashoffset 1s linear' }}
                />
                <text x="36" y="40" textAnchor="middle" fill={EMERALD} fontSize="11" fontFamily="monospace" fontWeight="700">
                  {/* ☽ crescent symbol */}
                  ☽
                </text>
              </svg>
            </div>

            <p style={{ fontFamily: 'monospace', fontSize: 9, color: EMERALD, textTransform: 'uppercase', letterSpacing: '0.22em', margin: '0 0 6px', opacity: 0.7 }}>
              ◈ Next Prayer
            </p>
            <h2 style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px', letterSpacing: '0.06em' }}>
              {next.name}
            </h2>
            <p style={{ fontFamily: 'monospace', fontSize: 13, color: EMERALD, margin: '0 0 4px', letterSpacing: '0.06em' }}>
              {next.timeStr}
            </p>
            <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
              in <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{formatCountdown(next.secondsUntil)}</span>
              {current && <> · {current} time now</>}
            </p>
          </div>
        )}

        {/* ── 1b. Current Prayer — Time Remaining Indicator ───────────── */}
        {(() => {
          const remaining = times ? getCurrentPrayerRemaining(times) : null;
          if (!remaining) return null;
          const { name: curName, secondsLeft } = remaining;
          // Color coding by urgency
          const isUrgent  = secondsLeft <= 900;   // ≤ 15 min
          const isWarning = secondsLeft <= 1800;  // ≤ 30 min
          const barColor  = isUrgent ? '#ef4444' : isWarning ? '#f59e0b' : EMERALD;
          const bgColor   = isUrgent ? 'rgba(239,68,68,0.08)' : isWarning ? 'rgba(245,158,11,0.08)' : EMERALD_DIM;
          const borderClr = isUrgent ? 'rgba(239,68,68,0.30)' : isWarning ? 'rgba(245,158,11,0.25)' : `${EMERALD}25`;
          // Progress: fraction of a 6-hour max window
          const maxWindow = 6 * 3600;
          const pct = Math.min(1, secondsLeft / maxWindow) * 100;

          return (
            <div id="prayer-time-remaining" style={{
              marginBottom: 16,
              background: bgColor,
              border: `1px solid ${borderClr}`,
              padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
              transition: 'all 400ms ease',
            }}>
              {/* Hourglass icon */}
              <span style={{ fontSize: 14, opacity: isUrgent ? 1 : 0.7 }}>
                {isUrgent ? '🔴' : isWarning ? '🟡' : '⏳'}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
                    color: barColor, textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>
                    {curName}
                  </span>
                  <span style={{
                    fontFamily: 'monospace', fontSize: 10,
                    color: isUrgent ? '#fca5a5' : isWarning ? '#fcd34d' : 'var(--text-muted)',
                  }}>
                    ends in <strong>{formatCountdown(secondsLeft)}</strong>
                  </span>
                  {isUrgent && (
                    <span style={{
                      fontFamily: 'monospace', fontSize: 8, color: '#ef4444',
                      textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700,
                      animation: 'pulse-text 1.5s ease-in-out infinite',
                    }}>
                      Don't miss it!
                    </span>
                  )}
                  {!isUrgent && isWarning && (
                    <span style={{
                      fontFamily: 'monospace', fontSize: 8, color: '#f59e0b',
                      textTransform: 'uppercase', letterSpacing: '0.12em',
                    }}>
                      Ending soon
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                <div style={{
                  width: '100%', height: 3,
                  background: 'rgba(255,255,255,0.06)',
                  borderRadius: 2, overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: barColor, borderRadius: 2,
                    transition: 'width 1s linear, background 400ms',
                  }} />
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── 2. Prayer Times Grid ────────────────────────────────────────── */}
        <SectionHeader icon={Moon} label="Today's Prayer Times" />
        <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {times && PRAYERS_DISPLAY.map(name => {
            const isNext    = name === next?.name;
            const isCurrent = name === current;
            const isDone    = isCurrent && !isNext; // past prayer
            return (
              <div key={name} style={{
                display: 'flex', alignItems: 'center',
                padding: '10px 14px',
                background: isNext ? EMERALD_MID : isCurrent ? EMERALD_DIM : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isNext ? EMERALD + '50' : 'rgba(255,255,255,0.05)'}`,
                transition: 'all 300ms ease',
              }}>
                <span style={{
                  fontFamily: 'monospace', fontSize: 12,
                  color: isNext ? EMERALD : isDone ? 'var(--text-muted)' : 'var(--text-secondary)',
                  fontWeight: isNext ? 700 : 400,
                  flex: 1,
                  letterSpacing: '0.06em',
                }}>
                  {name}
                </span>
                {isNext && (
                  <span style={{ fontFamily: 'monospace', fontSize: 8, color: EMERALD, textTransform: 'uppercase', letterSpacing: '0.15em', marginRight: 12, opacity: 0.8 }}>
                    NEXT
                  </span>
                )}
                <span style={{ fontFamily: 'monospace', fontSize: 13, color: isNext ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: isNext ? 700 : 400 }}>
                  {times[name as keyof PrayerTimes]}
                </span>
              </div>
            );
          })}
        </div>

        {/* ── 3. Qibla Compass ────────────────────────────────────────────── */}
        <SectionHeader icon={Compass} label="Qibla Direction" />
        <div style={{
          marginBottom: 20,
          background: EMERALD_DIM,
          border: `1px solid ${EMERALD}25`,
          padding: '24px 20px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
        }}>
          {/* Compass SVG */}
          <div style={{ position: 'relative', width: 200, height: 200 }}>
            {/* Outer ring */}
            <svg width="200" height="200" viewBox="0 0 200 200" style={{ position: 'absolute', inset: 0 }}>
              {/* Outer decorative ring */}
              <circle cx="100" cy="100" r="95" fill="none" stroke={`${EMERALD}20`} strokeWidth="2" />
              <circle cx="100" cy="100" r="85" fill="none" stroke={`${EMERALD}10`} strokeWidth="1" />

              {/* Cardinal direction ticks */}
              {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => {
                const rad = (deg - 90) * Math.PI / 180;
                const isMajor = deg % 90 === 0;
                const inner = isMajor ? 78 : 82;
                const outer = 90;
                return (
                  <line key={deg}
                    x1={100 + inner * Math.cos(rad)} y1={100 + inner * Math.sin(rad)}
                    x2={100 + outer * Math.cos(rad)} y2={100 + outer * Math.sin(rad)}
                    stroke={`${EMERALD}${isMajor ? '70' : '40'}`}
                    strokeWidth={isMajor ? 2 : 1}
                  />
                );
              })}

              {/* N E S W labels */}
              {[
                { label: 'N', angle: 0 },
                { label: 'E', angle: 90 },
                { label: 'S', angle: 180 },
                { label: 'W', angle: 270 },
              ].map(({ label, angle }) => {
                const rad = (angle - 90) * Math.PI / 180;
                const r = 70;
                return (
                  <text key={label}
                    x={100 + r * Math.cos(rad)} y={100 + r * Math.sin(rad) + 4}
                    textAnchor="middle" fill={angle === 0 ? EMERALD : `${EMERALD}60`}
                    fontSize="11" fontFamily="monospace" fontWeight={angle === 0 ? 700 : 400}
                  >
                    {label}
                  </text>
                );
              })}

              {/* Center dot */}
              <circle cx="100" cy="100" r="6" fill={`${EMERALD}30`} stroke={EMERALD} strokeWidth="1.5" />

              {/* Qibla needle — rotates with device orientation */}
              <g transform={`rotate(${needleAngle}, 100, 100)`} style={{ transition: compassSupported ? 'transform 0.2s ease' : 'none' }}>
                {/* Needle body pointing to Qibla */}
                <polygon points="100,18 95,100 100,104 105,100"
                  fill={EMERALD} opacity="0.9" />
                {/* Tail */}
                <polygon points="100,182 95,100 100,104 105,100"
                  fill={`${EMERALD}30`} />
                {/* Kaaba icon tip */}
                <rect x="94" y="12" width="12" height="10" rx="1"
                  fill={EMERALD} opacity="0.95" />
                <text x="100" y="20" textAnchor="middle" fontSize="6" fill="#0a0a0a" fontWeight="700">
                  🕋
                </text>
              </g>
            </svg>
          </div>

          {/* Bearing info */}
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color: EMERALD, margin: '0 0 4px', letterSpacing: '0.04em' }}>
              {qibla != null ? `${qibla}°` : '—'}
              <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                {qibla != null ? bearingToCardinal(qibla) : ''}
              </span>
            </p>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>
              {compassSupported
                ? 'Compass active — hold phone flat and face the needle'
                : 'Face ' + (qibla != null ? `${qibla}° ${bearingToCardinal(qibla)}` : '—') + ' from your location'}
            </p>
            {!compassSupported && (
              <p style={{ fontFamily: 'monospace', fontSize: 9, color: `${EMERALD}60`, margin: '4px 0 0', letterSpacing: '0.08em' }}>
                Device compass not available — bearing is still accurate
              </p>
            )}
          </div>
        </div>

        {/* ── 4. Verse of the Day ─────────────────────────────────────────── */}
        <SectionHeader icon={BookOpen} label="Verse of the Day" />
        {verse && (
          <div style={{
            marginBottom: 20,
            background: EMERALD_DIM,
            border: `1px solid ${EMERALD}20`,
            padding: '20px',
          }}>
            {/* Arabic */}
            <p style={{
              fontFamily: 'serif',
              fontSize: 20,
              color: 'var(--text-primary)',
              direction: 'rtl',
              textAlign: 'right',
              lineHeight: 2.2,
              margin: '0 0 12px',
            }}>
              {verse.arabic}
            </p>
            {/* Transliteration */}
            <p style={{
              fontFamily: 'monospace',
              fontSize: 11,
              color: EMERALD,
              fontStyle: 'italic',
              lineHeight: 1.6,
              margin: '0 0 8px',
            }}>
              {verse.transliteration}
            </p>
            {/* Translation */}
            <p style={{
              fontFamily: 'monospace',
              fontSize: 11,
              color: 'var(--text-secondary)',
              lineHeight: 1.65,
              margin: '0 0 10px',
            }}>
              "{verse.translation}"
            </p>
            {/* Reference + Audio */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{
                fontFamily: 'monospace', fontSize: 9,
                color: `${EMERALD}70`,
                textTransform: 'uppercase', letterSpacing: '0.15em',
                padding: '2px 8px',
                border: `1px solid ${EMERALD}20`,
              }}>
                {verse.ref}
              </span>
              <VerseAudioButton audioUrl={verse.audioUrl} />
            </div>
          </div>
        )}

        {/* ── 5. Prayer Tracker ───────────────────────────────────────────── */}
        <SectionHeader icon={Moon} label="Today's Tracker" />
        <div style={{
          marginBottom: 20,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
          padding: '14px',
          display: 'flex', gap: 8, flexWrap: 'wrap',
        }}>
          {TRACKABLE.map(name => {
            const done = prayed[name] ?? false;
            return (
              <button
                key={name}
                id={`prayer-tracker-${name.toLowerCase()}`}
                onClick={() => togglePrayed(name)}
                style={{
                  flex: 1, minWidth: 60,
                  padding: '12px 8px',
                  fontFamily: 'monospace', fontSize: 10,
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  cursor: 'pointer',
                  border: `1px solid ${done ? EMERALD + '70' : 'rgba(255,255,255,0.07)'}`,
                  background: done ? EMERALD_MID : 'transparent',
                  color: done ? EMERALD : 'var(--text-muted)',
                  transition: 'all 180ms ease',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                }}
              >
                <span style={{ fontSize: 14 }}>{done ? '✓' : '○'}</span>
                {name}
              </button>
            );
          })}
        </div>

        {/* ── 6. Hadith of the Day ────────────────────────────────────────── */}
        <HadithCard />

        {/* ── 7. Dua of the Day ───────────────────────────────────────────── */}
        <DuaCard />

        {/* ── 8. Name of Allah ────────────────────────────────────────────── */}
        <AsmaUlHusnaCard />

        {/* Provider note */}
        <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(107,106,94,0.4)', textAlign: 'center', letterSpacing: '0.1em', margin: '0 0 40px' }}>
          Powered by UmmahAPI.com · {PRAYER_METHODS[0].label} method · Change in Settings
        </p>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse-text { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label }: { icon: typeof Moon; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <Icon size={13} color={EMERALD} />
      <span style={{ fontFamily: 'monospace', fontSize: 9, color: `${EMERALD}80`, textTransform: 'uppercase', letterSpacing: '0.2em' }}>
        {label}
      </span>
    </div>
  );
}

function btnStyle(size: 'sm' | 'md' = 'md'): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: size === 'sm' ? '7px 14px' : '10px 18px',
    fontFamily: 'monospace', fontSize: size === 'sm' ? 10 : 12,
    textTransform: 'uppercase', letterSpacing: '0.1em',
    cursor: 'pointer',
    background: EMERALD_DIM,
    border: `1px solid ${EMERALD}40`,
    color: EMERALD,
    transition: 'all 150ms',
  };
}
