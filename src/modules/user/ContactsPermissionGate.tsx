/**
 * ContactsPermissionGate.tsx — Premium pre-permission screen.
 *
 * Shown BEFORE the native OS dialog to explain WHY Roger needs contacts.
 * Follows Apple & Google's best practice of providing justification context
 * before triggering the system prompt.
 *
 * Design: Military/Roger aesthetic with scanlines, amber accents, and a
 * prominent 🔒 PRIVACY GUARANTEE box.
 *
 * Trigger points:
 * 1. After onboarding completes — before Orientation starts
 * 2. In Settings → "Connect Contacts" button
 * 3. When user says "Text Ahmad" but contacts aren't connected yet
 */

import { useState } from 'react';
import { requestContactsPermission, fetchDeviceContacts } from '../../lib/deviceContacts';
import { invalidateWhisperHint } from '../../lib/whisperHint';

// ── Storage key — tracks whether we've already prompted ────────────────────
const PROMPTED_KEY = 'roger_contacts_prompted';

export function hasBeenPromptedForContacts(): boolean {
  return localStorage.getItem(PROMPTED_KEY) === 'true';
}

function markAsPrompted(): void {
  localStorage.setItem(PROMPTED_KEY, 'true');
}

// ── Props ──────────────────────────────────────────────────────────────────

interface Props {
  /** Called after user makes a choice (grant or skip) */
  onComplete: (granted: boolean) => void;
  /** Optional: show as a compact modal instead of full-screen */
  compact?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ContactsPermissionGate({ onComplete, compact }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleGrant() {
    setLoading(true);
    try {
      const granted = await requestContactsPermission();
      if (granted) {
        // Pre-fetch contacts immediately so they're cached
        await fetchDeviceContacts();
        // Invalidate whisper hint so it rebuilds with new contacts
        invalidateWhisperHint();
      }
      markAsPrompted();
      onComplete(granted);
    } catch {
      markAsPrompted();
      onComplete(false);
    } finally {
      setLoading(false);
    }
  }

  function handleSkip() {
    markAsPrompted();
    onComplete(false);
  }

  return (
    <div style={compact ? compactOverlayStyle : fullScreenStyle}>
      {!compact && <ScanlineOverlay />}

      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        maxWidth: compact ? 380 : 480,
        width: '90%',
        margin: compact ? undefined : '0 auto',
        ...(compact ? compactBoxStyle : {}),
      }}>

        {/* ── Header bar ── */}
        <div style={headerBarStyle}>
          <span style={mono(8, 'rgba(212,160,68,0.45)', '0.3em')}>◈ CLASSIFIED</span>
          <span style={mono(9, '#d4a044', '0.25em')}>NETWORK EXPANSION</span>
          <span style={mono(8, 'rgba(212,160,68,0.45)', '0.3em')}>CLASSIFIED ◈</span>
        </div>

        {/* ── Content ── */}
        <div style={{ padding: compact ? '20px 20px 0' : '28px 28px 0', textAlign: 'center' }}>

          {/* Icon */}
          <div style={{ fontSize: 42, marginBottom: 12, opacity: 0.9 }}></div>

          {/* Title */}
          <p style={mono(compact ? 16 : 20, 'rgba(255,255,255,0.92)', '0.25em')}>
            ROGER<span style={{ color: '#d4a044' }}>·</span>NETWORK
          </p>
          <p style={mono(9, '#d4a044', '0.2em')}>CONTACT BOOK ACCESS</p>

          {/* Divider */}
          <div style={dividerStyle} />

          {/* Benefits */}
          <div style={{ textAlign: 'left', margin: '16px 0' }}>
            {BENEFITS.map(b => (
              <div key={b.title} style={benefitRowStyle}>
                <span style={{ fontSize: 16, marginRight: 10, flexShrink: 0 }}>{b.icon}</span>
                <div>
                  <p style={mono(10, '#d4a044', '0.15em')}>{b.title}</p>
                  <p style={bodyTextStyle}>{b.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── 🔒 PRIVACY GUARANTEE BOX ── */}
          <div style={privacyBoxStyle}>
            <p style={mono(10, '#22c55e', '0.18em')}>PRIVACY GUARANTEE</p>
            <ul style={privacyListStyle}>
              <li>Only display names are read</li>
              <li>Phone numbers stay <strong>ON DEVICE</strong></li>
              <li>Nothing is uploaded to servers</li>
              <li>No emails or photos accessed</li>
              <li>Disconnect at any time in Settings</li>
            </ul>
          </div>

          {/* ── Legal reference ── */}
          <div style={legalRefStyle}>
            <p style={{ ...bodyTextStyle, fontSize: 10, opacity: 0.5 }}>
              By granting access, you agree to the data practices described in our
              Terms &amp; Conditions (§02 Data Collection &amp; Privacy).
            </p>
          </div>
        </div>

        {/* ── Buttons ── */}
        <div style={footerStyle}>
          <button
            id="btn-contacts-skip"
            style={btnStyle('ghost')}
            onClick={handleSkip}
            disabled={loading}
          >
            NOT NOW
          </button>
          <button
            id="btn-contacts-grant"
            style={{
              ...btnStyle('primary'),
              opacity: loading ? 0.5 : 1,
              cursor: loading ? 'wait' : 'pointer',
            }}
            onClick={handleGrant}
            disabled={loading}
          >
            {loading ? 'CONNECTING…' : 'GRANT ACCESS'}
          </button>
        </div>

        {/* ── Footer note ── */}
        <p style={{
          ...mono(7, 'rgba(255,255,255,0.12)', '0.12em'),
          textAlign: 'center', padding: '8px 20px 12px',
        }}>
          OPTIONAL · YOU CAN ENABLE THIS LATER IN SETTINGS
        </p>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes contactsGlow {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Benefits Data ─────────────────────────────────────────────────────────────

const BENEFITS = [
  {
    icon: '',
    title: 'VOICE RECOGNITION',
    desc: 'Roger learns contact names so Whisper never mishears "Ahmad" as "Akhmad" again.',
  },
  {
    icon: '',
    title: 'HANDS-FREE MESSAGING',
    desc: 'Say "Roger, text Mom I\'m on my way" and the message opens ready to send.',
  },
  {
    icon: '',
    title: 'SMART MEMORY',
    desc: 'Roger remembers who matters to you and builds context from your world.',
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function ScanlineOverlay() {
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
      backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)',
      opacity: 0.6,
    }} />
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const fullScreenStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9998,
  background: '#0a0a08',
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  overflow: 'auto',
};

const compactOverlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9998,
  background: 'rgba(0,0,0,0.7)',
  backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const compactBoxStyle: React.CSSProperties = {
  background: '#141817',
  border: '1px solid rgba(212,160,68,0.25)',
  overflow: 'hidden',
};

function mono(size: number, color: string, spacing: string): React.CSSProperties {
  return {
    fontFamily: "'JetBrains Mono', 'Space Mono', monospace",
    fontSize: size,
    color,
    letterSpacing: spacing,
    textTransform: 'uppercase',
    margin: 0,
    lineHeight: 1.5,
  };
}

const bodyTextStyle: React.CSSProperties = {
  fontFamily: "'Inter', system-ui, sans-serif",
  fontSize: 11,
  color: 'rgba(232,229,216,0.65)',
  lineHeight: 1.7,
  margin: '4px 0 0',
};

const headerBarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 16px',
  borderBottom: '1px solid rgba(212,160,68,0.15)',
  background: 'rgba(212,160,68,0.03)',
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: 'linear-gradient(90deg, transparent, rgba(212,160,68,0.3), transparent)',
  margin: '14px 0',
};

const benefitRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start',
  marginBottom: 14,
};

const privacyBoxStyle: React.CSSProperties = {
  border: '1px solid rgba(34,197,94,0.25)',
  background: 'rgba(34,197,94,0.04)',
  padding: '14px 16px',
  textAlign: 'left',
  margin: '8px 0 12px',
};

const privacyListStyle: React.CSSProperties = {
  fontFamily: "'Inter', system-ui, sans-serif",
  fontSize: 10,
  color: 'rgba(232,229,216,0.6)',
  lineHeight: 2,
  margin: '8px 0 0',
  paddingLeft: 18,
  listStyleType: "'→ '",
};

const legalRefStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid rgba(255,255,255,0.06)',
  background: 'rgba(255,255,255,0.02)',
  margin: '0 0 4px',
};

const footerStyle: React.CSSProperties = {
  display: 'flex', gap: 12, padding: '14px 20px',
  borderTop: '1px solid rgba(212,160,68,0.12)',
  background: 'rgba(0,0,0,0.3)',
};

function btnStyle(variant: 'ghost' | 'primary'): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    padding: '11px 18px',
    border: '1px solid',
    cursor: 'pointer',
    transition: 'all 0.25s ease',
    background: 'transparent',
  };
  if (variant === 'ghost') {
    return {
      ...base,
      color: 'rgba(255,255,255,0.4)',
      borderColor: 'rgba(255,255,255,0.12)',
      flex: 0,
    };
  }
  return {
    ...base,
    color: '#d4a044',
    borderColor: 'rgba(212,160,68,0.5)',
    background: 'rgba(212,160,68,0.08)',
    flex: 1,
  };
}
