/**
 * PermissionGate.tsx — First-launch permission onboarding for Roger AI
 *
 * Appears once on first install before UserHome. Requests all critical
 * permissions in a single branded screen:
 *
 *   🔴 Mandatory:   Microphone, Audio Playback, Location
 *   🟡 Recommended: Contacts, Push Notifications
 *
 * Mandatory permissions block progress if denied.
 * Recommended permissions can be deferred and re-granted in Settings.
 *
 * Stores roger:perms_granted in localStorage so it never shows again.
 * Stores roger:deferred_permissions as JSON array for Settings banner.
 */

import { useState, useEffect } from 'react';
import { Mic, MapPin, Volume2, ChevronDown, ChevronUp, Settings, CheckCircle2, AlertCircle, Bell, Contact } from 'lucide-react';
import RogerMascot from './RogerMascot';
import { requestMicPermission, requestLocationPermission, markPermissionsGranted } from '../lib/audioPermission';
import { unlockAudio } from '../lib/tts';
import { unlockSfxContext } from '../lib/sfx';

interface PermissionGateProps {
  onGranted: () => void;
}

type GrantPhase = 'idle' | 'requesting' | 'mandatory_denied' | 'done';
type PermStatus = null | true | false | 'mobile_only';

// ── Deferred permissions storage ──────────────────────────────────────────────

const DEFERRED_KEY = 'roger:deferred_permissions';

export type DeferrablePermission = 'contacts' | 'notifications';

export function getDeferredPermissions(): DeferrablePermission[] {
  try {
    const raw = localStorage.getItem(DEFERRED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function setDeferredPermissions(perms: DeferrablePermission[]): void {
  try {
    if (perms.length === 0) localStorage.removeItem(DEFERRED_KEY);
    else localStorage.setItem(DEFERRED_KEY, JSON.stringify(perms));
  } catch { /* storage unavailable */ }
}

export function removeDeferredPermission(perm: DeferrablePermission): void {
  const current = getDeferredPermissions();
  setDeferredPermissions(current.filter(p => p !== perm));
}

// ── Check if running on native (Capacitor) ────────────────────────────────────

function isNativePlatform(): boolean {
  try {
    // Dynamic check without hard import — works even if Capacitor isn't installed
    const cap = (window as unknown as Record<string, unknown>).Capacitor as { isNativePlatform?: () => boolean } | undefined;
    return cap?.isNativePlatform?.() ?? false;
  } catch { return false; }
}

export default function PermissionGate({ onGranted }: PermissionGateProps) {
  const [phase, setPhase]             = useState<GrantPhase>('idle');
  const [whyOpen, setWhyOpen]         = useState(false);
  const [micOk, setMicOk]             = useState<PermStatus>(null);
  const [locOk, setLocOk]             = useState<PermStatus>(null);
  const [contactsOk, setContactsOk]   = useState<PermStatus>(null);
  const [notifOk, setNotifOk]         = useState<PermStatus>(null);
  const [deniedItem, setDeniedItem]    = useState<'mic' | 'location' | null>(null);
  const [isNative]                     = useState(isNativePlatform);

  // Mic icon pulse loop
  useEffect(() => {
    const iv = setInterval(() => {}, 1200);
    return () => clearInterval(iv);
  }, []);

  const handleGrant = async () => {
    setPhase('requesting');
    const deferred: DeferrablePermission[] = [];

    // ── Step 1: Audio unlock (must happen on user gesture) ──────────────
    await Promise.all([unlockAudio(), unlockSfxContext()]);

    // ── Step 2: Microphone (MANDATORY) ──────────────────────────────────
    const mic = await requestMicPermission();
    setMicOk(mic);
    if (!mic) {
      setDeniedItem('mic');
      setPhase('mandatory_denied');
      return;
    }

    // ── Step 3: Location (MANDATORY) ────────────────────────────────────
    const loc = await requestLocationPermission();
    setLocOk(loc);
    if (!loc) {
      setDeniedItem('location');
      setPhase('mandatory_denied');
      return;
    }

    // ── Step 4: Contacts (RECOMMENDED — native only) ────────────────────
    if (isNative) {
      try {
        const { requestContactsPermission } = await import('../lib/deviceContacts');
        const granted = await requestContactsPermission();
        setContactsOk(granted);
        if (!granted) deferred.push('contacts');
      } catch {
        setContactsOk(false);
        deferred.push('contacts');
      }
    } else {
      setContactsOk('mobile_only');
    }

    // ── Step 5: Push Notifications (RECOMMENDED) ────────────────────────
    if ('Notification' in window && 'serviceWorker' in navigator) {
      try {
        const result = await Notification.requestPermission();
        const granted = result === 'granted';
        setNotifOk(granted);
        if (!granted) deferred.push('notifications');
      } catch {
        setNotifOk(false);
        deferred.push('notifications');
      }
    } else {
      setNotifOk(false);
      deferred.push('notifications');
    }

    // ── Persist ─────────────────────────────────────────────────────────
    setDeferredPermissions(deferred);
    markPermissionsGranted();
    setPhase('done');
    setTimeout(onGranted, deferred.length > 0 ? 1800 : 800);
  };

  const PRIMARY   = '#38bdf8';
  const SECONDARY = '#22d3ee';
  const ACCENT    = '#818cf8';
  const GREEN     = '#4ade80';
  const AMBER     = '#fbbf24';
  const BG        = '#070b12';

  interface PermRow {
    icon: React.ReactNode;
    label: string;
    desc: string;
    why: string;
    status: PermStatus;
    color: string;
    mandatory: boolean;
    mobileOnly?: boolean;
  }

  const permissions: PermRow[] = [
    {
      icon: <Mic size={18} />,
      label: 'Microphone',
      desc: 'Hold the PTT button and speak — Roger listens, transcribes, and acts.',
      why: 'Roger is voice-first. Without mic access, the app cannot function.',
      status: micOk,
      color: PRIMARY,
      mandatory: true,
    },
    {
      icon: <Volume2 size={18} />,
      label: 'Audio Playback',
      desc: 'Roger speaks back through your speaker with natural voice synthesis.',
      why: 'Two-way communication. Audio unlocks automatically with microphone access.',
      status: micOk === null ? null : true,
      color: SECONDARY,
      mandatory: true,
    },
    {
      icon: <MapPin size={18} />,
      label: 'Location',
      desc: 'Weather updates, commute ETA, prayer times, and geo-fenced reminders.',
      why: 'Powers 40%+ of Roger\'s features. Without it, weather, commute, and location reminders won\'t work.',
      status: locOk,
      color: ACCENT,
      mandatory: true,
    },
    {
      icon: <Contact size={18} />,
      label: 'Contacts',
      desc: '"Text Mom I\'m on my way" — voice messaging with name recognition.',
      why: 'Roger matches spoken names to your contacts for instant messaging, calling, and WhatsApp.',
      status: contactsOk,
      color: '#3b82f6',
      mandatory: false,
      mobileOnly: true,
    },
    {
      icon: <Bell size={18} />,
      label: 'Notifications',
      desc: 'Morning briefings, prayer alerts, task reminders — even when Roger isn\'t open.',
      why: 'Without notifications, Roger can\'t reach you proactively when you need it most.',
      status: notifOk,
      color: AMBER,
      mandatory: false,
    },
  ];

  const deferredCount = [contactsOk, notifOk].filter(s => s === false).length;

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
        .pg-row:nth-child(1) { animation-delay: 0.08s; }
        .pg-row:nth-child(2) { animation-delay: 0.14s; }
        .pg-row:nth-child(3) { animation-delay: 0.20s; }
        .pg-row:nth-child(4) { animation-delay: 0.26s; }
        .pg-row:nth-child(5) { animation-delay: 0.32s; }
        @keyframes rogerMascotPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
        @keyframes rogerMascotRing{0%{opacity:.6;transform:scale(1)}100%{opacity:0;transform:scale(1.3)}}
        .pg-gate-scroll {
          overflow-y: auto;
          max-height: 100vh;
          -webkit-overflow-scrolling: touch;
        }
        .pg-gate-scroll::-webkit-scrollbar { width: 3px; }
        .pg-gate-scroll::-webkit-scrollbar-thumb { background: ${PRIMARY}33; border-radius: 3px; }
      `}</style>

      <div className="pg-gate-scroll" style={{
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

        {/* Mascot */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <RogerMascot variant="badge" showLabel={false} />
        </div>

        {/* ── Main card ── */}
        <div className="pg-card" style={{
          width: '100%', maxWidth: 420,
          background: 'rgba(255,255,255,0.03)',
          border: `1px solid ${PRIMARY}22`,
          borderRadius: 20,
          padding: '28px 24px',
          backdropFilter: 'blur(12px)',
          position: 'relative',
          zIndex: 1,
        }}>

          {/* Mic icon hero */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <div className="pg-mic-icon" style={{
              width: 64, height: 64, borderRadius: '50%',
              background: `radial-gradient(circle, ${PRIMARY}22 0%, ${PRIMARY}08 70%)`,
              border: `2px solid ${PRIMARY}44`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {phase === 'done'
                ? <CheckCircle2 size={28} color={SECONDARY} style={{ animation: 'pg-check 0.4s cubic-bezier(0.34,1.56,0.64,1) both' }} />
                : phase === 'mandatory_denied'
                ? <AlertCircle size={28} color='#f87171' />
                : <Mic size={28} color={PRIMARY} />
              }
            </div>
          </div>

          {/* Title */}
          <p style={{
            color: '#ffffff', fontSize: 16, fontWeight: 700,
            letterSpacing: '0.12em', textAlign: 'center',
            margin: '0 0 4px',
          }}>
            ROGER NEEDS ACCESS
          </p>
          <p style={{
            color: `${PRIMARY}99`, fontSize: 9, letterSpacing: '0.22em',
            textAlign: 'center', textTransform: 'uppercase', margin: '0 0 22px',
          }}>
            One tap · Five permissions · Always on standby
          </p>

          {/* Permission rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
            {permissions.map((p, i) => (
              <div key={i} className="pg-row" style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px',
                background: `${p.color}08`,
                border: `1px solid ${p.color}20`,
                borderRadius: 12,
                opacity: p.mobileOnly && !isNative ? 0.45 : 1,
              }}>
                {/* Icon bubble */}
                <div style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  background: `${p.color}18`,
                  border: `1px solid ${p.color}33`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: p.color,
                }}>
                  {p.icon}
                </div>

                {/* Text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                    <p style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 600, margin: 0, letterSpacing: '0.06em' }}>
                      {p.label}
                    </p>
                    {p.mandatory && (
                      <span style={{
                        fontSize: 7, letterSpacing: '0.12em', textTransform: 'uppercase',
                        padding: '1px 5px', borderRadius: 4,
                        background: 'rgba(239,68,68,0.12)', color: '#f87171',
                        border: '1px solid rgba(239,68,68,0.25)',
                      }}>Required</span>
                    )}
                    {!p.mandatory && (
                      <span style={{
                        fontSize: 7, letterSpacing: '0.12em', textTransform: 'uppercase',
                        padding: '1px 5px', borderRadius: 4,
                        background: `${AMBER}12`, color: AMBER,
                        border: `1px solid ${AMBER}33`,
                      }}>Recommended</span>
                    )}
                    {p.mobileOnly && !isNative && (
                      <span style={{
                        fontSize: 7, letterSpacing: '0.1em',
                        padding: '1px 5px', borderRadius: 4,
                        background: 'rgba(100,116,139,0.12)', color: '#94a3b8',
                        border: '1px solid rgba(100,116,139,0.25)',
                      }}>📱 Mobile</span>
                    )}
                  </div>
                  <p style={{ color: `${p.color}77`, fontSize: 9, margin: 0, letterSpacing: '0.03em', lineHeight: 1.4 }}>
                    {p.desc}
                  </p>
                </div>

                {/* Status indicator */}
                <div style={{ flexShrink: 0 }}>
                  {p.status === null && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: `${p.color}44` }} />
                  )}
                  {p.status === true && (
                    <CheckCircle2 size={16} color={GREEN} style={{ animation: 'pg-check 0.35s cubic-bezier(0.34,1.56,0.64,1) both' }} />
                  )}
                  {p.status === false && (
                    <AlertCircle size={16} color={AMBER} />
                  )}
                  {p.status === 'mobile_only' && (
                    <span style={{ fontSize: 12 }}>📱</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── MANDATORY DENIED state ── */}
          {phase === 'mandatory_denied' && (
            <div style={{
              padding: '14px 16px',
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 12,
              marginBottom: 18,
              animation: 'pg-fade-in 0.4s ease both',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Settings size={14} color='#f87171' />
                <span style={{ color: '#f87171', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>
                  {deniedItem === 'mic' ? 'MICROPHONE ACCESS DENIED' : 'LOCATION ACCESS DENIED'}
                </span>
              </div>
              <p style={{ color: '#94a3b8', fontSize: 10, margin: 0, lineHeight: 1.6, letterSpacing: '0.03em' }}>
                {deniedItem === 'mic'
                  ? <>Roger is a voice-first assistant — <strong style={{ color: '#f87171' }}>microphone is required</strong> for the app to function. Go to <strong style={{ color: '#f87171' }}>Settings → Apps → Roger AI → Permissions → Microphone → Allow</strong></>
                  : <>Location powers weather, commute, prayer times, and geo-reminders — <strong style={{ color: '#f87171' }}>Roger needs it to be useful</strong>. Go to <strong style={{ color: '#f87171' }}>Settings → Apps → Roger AI → Permissions → Location → Allow</strong></>
                }
              </p>
              <button
                onClick={handleGrant}
                style={{
                  marginTop: 12, width: '100%', padding: '10px 0',
                  background: 'rgba(56,189,248,0.1)',
                  border: `1px solid ${PRIMARY}44`,
                  borderRadius: 8, cursor: 'pointer',
                  color: PRIMARY, fontSize: 10, letterSpacing: '0.15em',
                  fontFamily: 'inherit', textTransform: 'uppercase',
                }}
              >
                TRY AGAIN
              </button>
            </div>
          )}

          {/* ── Done with deferred ── */}
          {phase === 'done' && deferredCount > 0 && (
            <div style={{
              padding: '12px 16px',
              background: `${AMBER}08`,
              border: `1px solid ${AMBER}25`,
              borderRadius: 12,
              marginBottom: 14,
              animation: 'pg-fade-in 0.4s ease both',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={14} color={AMBER} />
                <p style={{ color: AMBER, fontSize: 10, margin: 0, letterSpacing: '0.06em', lineHeight: 1.5 }}>
                  {deferredCount === 1 ? '1 optional permission' : `${deferredCount} optional permissions`} skipped — you can enable {deferredCount === 1 ? 'it' : 'them'} anytime in <strong>Settings</strong>.
                </p>
              </div>
            </div>
          )}

          {/* ── CTA button ── */}
          {phase !== 'mandatory_denied' && phase !== 'done' && (
            <button
              id="roger-permission-grant-btn"
              className="pg-btn-primary"
              onClick={handleGrant}
              disabled={phase === 'requesting'}
              style={{
                width: '100%', padding: '14px 0',
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

          {/* Done — all granted */}
          {phase === 'done' && deferredCount === 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '14px 0',
              animation: 'pg-fade-in 0.3s ease both',
            }}>
              <CheckCircle2 size={18} color={GREEN} />
              <span style={{ color: GREEN, fontSize: 11, letterSpacing: '0.2em' }}>
                ALL ACCESS GRANTED — LAUNCHING
              </span>
            </div>
          )}

          {/* Done — with deferred */}
          {phase === 'done' && deferredCount > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '14px 0',
              animation: 'pg-fade-in 0.3s ease both',
            }}>
              <CheckCircle2 size={18} color={SECONDARY} />
              <span style={{ color: SECONDARY, fontSize: 11, letterSpacing: '0.2em' }}>
                LAUNCHING — SOME FEATURES LIMITED
              </span>
            </div>
          )}

          {/* ── "Why we need this" collapsible ── */}
          <button
            onClick={() => setWhyOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              marginTop: 14, width: '100%',
              background: 'none', border: 'none', cursor: 'pointer',
              color: `${PRIMARY}66`, fontSize: 9, letterSpacing: '0.18em',
              fontFamily: 'inherit', textTransform: 'uppercase',
              padding: '6px 0',
            }}
          >
            {whyOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            WHY ROGER NEEDS THESE
          </button>

          {whyOpen && (
            <div style={{
              marginTop: 10, padding: '14px 16px',
              background: 'rgba(255,255,255,0.02)',
              border: `1px solid ${PRIMARY}15`,
              borderRadius: 10,
              animation: 'pg-fade-in 0.3s ease both',
            }}>
              {permissions.map(p => (
                <div key={p.label} style={{ marginBottom: 10 }}>
                  <p style={{ color: p.color, fontSize: 9, letterSpacing: '0.14em', margin: '0 0 3px', fontWeight: 600 }}>
                    {p.label.toUpperCase()} {p.mandatory ? '(REQUIRED)' : '(RECOMMENDED)'}
                  </p>
                  <p style={{ color: '#64748b', fontSize: 9, margin: 0, lineHeight: 1.6, letterSpacing: '0.02em' }}>
                    {p.why}
                  </p>
                </div>
              ))}
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.15)', borderRadius: 8 }}>
                <p style={{ color: '#4ade80', fontSize: 8, margin: 0, lineHeight: 1.7, letterSpacing: '0.04em' }}>
                  🔒 <strong>Privacy:</strong> Voice is processed by OpenAI Whisper — no audio stored. Location stays on-device for geo features. Contact names are used for Whisper hints — phone numbers never leave your device.
                </p>
              </div>
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
