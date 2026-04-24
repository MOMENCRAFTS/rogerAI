/**
 * PermissionGate.tsx — First-launch permission onboarding for Roger AI
 *
 * Appears once on first install before UserHome. Requests microphone + location
 * permissions in a single branded screen, and primes the Android WebView audio
 * pipeline via unlockAudio() on the same user gesture (critical for TTS to work).
 *
 * Stores roger:perms_granted in localStorage so it never shows again.
 */

import { useState, useEffect } from 'react';
import { Mic, MapPin, Volume2, ChevronDown, ChevronUp, Settings, CheckCircle2, AlertCircle } from 'lucide-react';
import { requestMicPermission, requestLocationPermission, markPermissionsGranted } from '../lib/audioPermission';
import { unlockAudio } from '../lib/tts';
import { unlockSfxContext } from '../lib/sfx';

interface PermissionGateProps {
  onGranted: () => void;
}

type GrantPhase = 'idle' | 'requesting' | 'mic_denied' | 'done';

export default function PermissionGate({ onGranted }: PermissionGateProps) {
  const [phase, setPhase]         = useState<GrantPhase>('idle');
  const [whyOpen, setWhyOpen]     = useState(false);
  const [micOk, setMicOk]         = useState<boolean | null>(null);
  const [locOk, setLocOk]         = useState<boolean | null>(null);

  // Mic icon pulse loop (CSS-driven — state toggle just triggers re-render for randomness)
  useEffect(() => {
    const iv = setInterval(() => {}, 1200);
    return () => clearInterval(iv);
  }, []);

  const handleGrant = async () => {
    setPhase('requesting');

    // Single user gesture → unlock audio pipeline AND request permissions together.
    // This is the critical sequence for Android WebView: the OS dialog tap counts
    // as the gesture that primes HTMLAudio + AudioContext.
    await Promise.all([unlockAudio(), unlockSfxContext()]);

    const mic = await requestMicPermission();
    setMicOk(mic);

    const loc = await requestLocationPermission();
    setLocOk(loc);

    if (!mic) {
      setPhase('mic_denied');
      return;
    }

    markPermissionsGranted();
    setPhase('done');
    // Brief delay so the ✓ state is visible before transition
    setTimeout(onGranted, 800);
  };

  const handleSkip = () => {
    // Allow proceeding without location (non-fatal), but mic is critical
    markPermissionsGranted();
    onGranted();
  };

  const PRIMARY   = '#38bdf8';
  const SECONDARY = '#22d3ee';
  const ACCENT    = '#818cf8';
  const BG        = '#070b12';

  const permissions = [
    {
      icon: <Mic size={18} />,
      label: 'Microphone',
      desc: 'Hold the PTT button and speak — Roger listens.',
      status: micOk,
      color: PRIMARY,
    },
    {
      icon: <Volume2 size={18} />,
      label: 'Audio Playback',
      desc: 'Roger speaks back through your speaker.',
      status: micOk === null ? null : true, // audio unlock happens with mic
      color: SECONDARY,
    },
    {
      icon: <MapPin size={18} />,
      label: 'Location',
      desc: 'Geo-reminders, commute ETA, arrival debriefs.',
      status: locOk,
      color: ACCENT,
    },
  ];

  return (
    <>
      <style>{`
        @keyframes pg-glow {
          0%,100% { box-shadow: 0 0 0 0 ${PRIMARY}00; }
          50%      { box-shadow: 0 0 0 18px ${PRIMARY}22; }
        }
        @keyframes pg-mic-pulse {
          0%,100% { transform: scale(1); opacity: 0.85; }
          50%      { transform: scale(1.18); opacity: 1; }
        }
        @keyframes pg-fade-in {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pg-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pg-check {
          from { transform: scale(0.5); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
        .pg-card {
          animation: pg-fade-in 0.55s cubic-bezier(0.22,1,0.36,1) both;
        }
        .pg-btn-primary {
          transition: all 0.2s ease;
          animation: pg-glow 2.4s ease-in-out infinite;
        }
        .pg-btn-primary:hover:not(:disabled) {
          filter: brightness(1.12);
          transform: translateY(-1px);
        }
        .pg-btn-primary:active:not(:disabled) {
          transform: translateY(0);
        }
        .pg-mic-icon {
          animation: pg-mic-pulse 2s ease-in-out infinite;
        }
        .pg-row { animation: pg-fade-in 0.4s cubic-bezier(0.22,1,0.36,1) both; }
        .pg-row:nth-child(1) { animation-delay: 0.1s; }
        .pg-row:nth-child(2) { animation-delay: 0.2s; }
        .pg-row:nth-child(3) { animation-delay: 0.3s; }
      `}</style>

      <div style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: BG,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '24px 20px',
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      }}>

        {/* Background radial glow */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(ellipse 60% 50% at 50% 40%, ${PRIMARY}0d 0%, transparent 70%)`,
        }} />

        {/* HUD top bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${PRIMARY}88, ${SECONDARY}cc, transparent)`,
          boxShadow: `0 0 16px 2px ${PRIMARY}44`,
        }} />

        {/* ── Main card ── */}
        <div className="pg-card" style={{
          width: '100%', maxWidth: 400,
          background: 'rgba(255,255,255,0.03)',
          border: `1px solid ${PRIMARY}22`,
          borderRadius: 20,
          padding: '32px 28px',
          backdropFilter: 'blur(12px)',
          position: 'relative',
          zIndex: 1,
        }}>

          {/* Mic icon hero */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
            <div className="pg-mic-icon" style={{
              width: 72, height: 72, borderRadius: '50%',
              background: `radial-gradient(circle, ${PRIMARY}22 0%, ${PRIMARY}08 70%)`,
              border: `2px solid ${PRIMARY}44`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {phase === 'done'
                ? <CheckCircle2 size={32} color={SECONDARY} style={{ animation: 'pg-check 0.4s cubic-bezier(0.34,1.56,0.64,1) both' }} />
                : phase === 'mic_denied'
                ? <AlertCircle size={32} color='#f87171' />
                : <Mic size={32} color={PRIMARY} />
              }
            </div>
          </div>

          {/* Title */}
          <p style={{
            color: '#ffffff', fontSize: 18, fontWeight: 700,
            letterSpacing: '0.12em', textAlign: 'center',
            margin: '0 0 6px',
          }}>
            ROGER NEEDS ACCESS
          </p>
          <p style={{
            color: `${PRIMARY}99`, fontSize: 10, letterSpacing: '0.22em',
            textAlign: 'center', textTransform: 'uppercase', margin: '0 0 28px',
          }}>
            One tap · Three permissions · Always on standby
          </p>

          {/* Permission rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
            {permissions.map((p, i) => (
              <div key={i} className="pg-row" style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '12px 14px',
                background: `${p.color}08`,
                border: `1px solid ${p.color}20`,
                borderRadius: 12,
              }}>
                {/* Icon bubble */}
                <div style={{
                  width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                  background: `${p.color}18`,
                  border: `1px solid ${p.color}33`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: p.color,
                }}>
                  {p.icon}
                </div>

                {/* Text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600, margin: 0, letterSpacing: '0.06em' }}>
                    {p.label}
                  </p>
                  <p style={{ color: `${p.color}77`, fontSize: 9, margin: '2px 0 0', letterSpacing: '0.04em', lineHeight: 1.4 }}>
                    {p.desc}
                  </p>
                </div>

                {/* Status dot */}
                <div style={{ flexShrink: 0 }}>
                  {p.status === null && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: `${p.color}44` }} />
                  )}
                  {p.status === true && (
                    <CheckCircle2 size={16} color={SECONDARY} style={{ animation: 'pg-check 0.35s cubic-bezier(0.34,1.56,0.64,1) both' }} />
                  )}
                  {p.status === false && (
                    <AlertCircle size={16} color='#fbbf24' />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── DENIED state ── */}
          {phase === 'mic_denied' && (
            <div style={{
              padding: '14px 16px',
              background: 'rgba(251,191,36,0.08)',
              border: '1px solid rgba(251,191,36,0.25)',
              borderRadius: 12,
              marginBottom: 20,
              animation: 'pg-fade-in 0.4s ease both',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Settings size={14} color='#fbbf24' />
                <span style={{ color: '#fbbf24', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>
                  MIC ACCESS DENIED
                </span>
              </div>
              <p style={{ color: '#94a3b8', fontSize: 10, margin: 0, lineHeight: 1.6, letterSpacing: '0.03em' }}>
                To enable: <strong style={{ color: '#fbbf24' }}>Settings → Apps → Roger AI → Permissions → Microphone → Allow</strong>
              </p>
              <button
                onClick={handleSkip}
                style={{
                  marginTop: 12, width: '100%', padding: '9px 0',
                  background: 'rgba(251,191,36,0.12)',
                  border: '1px solid rgba(251,191,36,0.3)',
                  borderRadius: 8, cursor: 'pointer',
                  color: '#fbbf24', fontSize: 10, letterSpacing: '0.15em',
                  fontFamily: 'inherit',
                }}
              >
                CONTINUE ANYWAY (LIMITED MODE)
              </button>
            </div>
          )}

          {/* ── CTA button ── */}
          {phase !== 'mic_denied' && phase !== 'done' && (
            <button
              id="roger-permission-grant-btn"
              className="pg-btn-primary"
              onClick={handleGrant}
              disabled={phase === 'requesting'}
              style={{
                width: '100%', padding: '16px 0',
                background: phase === 'requesting'
                  ? `${PRIMARY}22`
                  : `linear-gradient(135deg, ${PRIMARY}cc 0%, ${SECONDARY}cc 100%)`,
                border: `1px solid ${PRIMARY}55`,
                borderRadius: 12, cursor: phase === 'requesting' ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                fontFamily: 'inherit',
              }}
            >
              {phase === 'requesting' ? (
                <>
                  <div style={{
                    width: 16, height: 16,
                    border: `2px solid ${PRIMARY}55`,
                    borderTopColor: PRIMARY,
                    borderRadius: '50%',
                    animation: 'pg-spin 0.8s linear infinite',
                  }} />
                  <span style={{ color: `${PRIMARY}aa`, fontSize: 11, letterSpacing: '0.22em' }}>
                    REQUESTING…
                  </span>
                </>
              ) : (
                <>
                  <Mic size={16} color='#070b12' />
                  <span style={{
                    color: '#070b12', fontSize: 12, fontWeight: 700,
                    letterSpacing: '0.22em',
                  }}>
                    GRANT ACCESS
                  </span>
                </>
              )}
            </button>
          )}

          {phase === 'done' && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '14px 0',
              animation: 'pg-fade-in 0.3s ease both',
            }}>
              <CheckCircle2 size={18} color={SECONDARY} />
              <span style={{ color: SECONDARY, fontSize: 11, letterSpacing: '0.2em' }}>
                ACCESS GRANTED — LAUNCHING
              </span>
            </div>
          )}

          {/* ── "Why we need this" collapsible ── */}
          <button
            onClick={() => setWhyOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              marginTop: 18, width: '100%',
              background: 'none', border: 'none', cursor: 'pointer',
              color: `${PRIMARY}66`, fontSize: 9, letterSpacing: '0.18em',
              fontFamily: 'inherit', textTransform: 'uppercase',
              padding: '6px 0',
            }}
          >
            {whyOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            WHY WE NEED THESE
          </button>

          {whyOpen && (
            <div style={{
              marginTop: 10, padding: '14px 16px',
              background: 'rgba(255,255,255,0.02)',
              border: `1px solid ${PRIMARY}15`,
              borderRadius: 10,
              animation: 'pg-fade-in 0.3s ease both',
            }}>
              {[
                ['Microphone', 'Your voice is sent to OpenAI Whisper for transcription. No audio is stored by Roger.'],
                ['Audio Playback', 'Roger\'s responses are synthesised by OpenAI TTS and played through your speaker. Requires audio unlock on Android.'],
                ['Location', 'Used only on-device for geo-fenced reminders and commute ETA. Never sent to third parties.'],
              ].map(([title, body]) => (
                <div key={title} style={{ marginBottom: 10 }}>
                  <p style={{ color: PRIMARY, fontSize: 9, letterSpacing: '0.14em', margin: '0 0 3px', fontWeight: 600 }}>
                    {title.toUpperCase()}
                  </p>
                  <p style={{ color: '#64748b', fontSize: 9, margin: 0, lineHeight: 1.6, letterSpacing: '0.02em' }}>
                    {body}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom branding */}
        <p style={{
          position: 'absolute', bottom: 20,
          color: `${PRIMARY}33`, fontSize: 8, letterSpacing: '0.2em',
          textTransform: 'uppercase', margin: 0,
        }}>
          Roger AI · MomenCrafts 2026
        </p>
      </div>
    </>
  );
}
