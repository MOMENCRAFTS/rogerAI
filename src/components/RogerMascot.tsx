/**
 * RogerMascot.tsx — Standardized mascot component for brand consistency.
 *
 * Two variants:
 *   - "badge"  (56×56) — LanguageGate, Onboarding, PermissionGate
 *   - "hero"   (100×100) — LoginScreen, SplashScreen
 *
 * Always includes: glow, blend mode, subtle scale pulse animation.
 * Optional: speaking ring, label below.
 */

import { type CSSProperties } from 'react';

interface Props {
  variant?: 'badge' | 'hero';
  /** Show pulsing ring around mascot (e.g. when Roger is speaking) */
  speaking?: boolean;
  /** Show "▸ ROGER AI" label below */
  showLabel?: boolean;
  /** Optional subtitle below the label */
  subtitle?: string;
  /** Extra styles on the outer wrapper */
  style?: CSSProperties;
}

const SIZES = { badge: 56, hero: 100 } as const;

const GLOW = {
  badge: 'drop-shadow(0 0 16px rgba(212,160,68,0.4))',
  hero: 'drop-shadow(0 0 32px rgba(212,160,68,0.6))',
} as const;

export default function RogerMascot({
  variant = 'badge',
  speaking = false,
  showLabel = true,
  subtitle,
  style,
}: Props) {
  const size = SIZES[variant];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        ...style,
      }}
    >
      <div style={{ position: 'relative' }}>
        <img
          src="/mascot.png"
          alt="Roger AI"
          style={{
            width: size,
            height: size,
            objectFit: 'contain',
            mixBlendMode: 'screen',
            filter: GLOW[variant],
            animation: 'rogerMascotPulse 4s ease-in-out infinite',
          }}
        />
        {/* Speaking ring */}
        {speaking && (
          <div
            style={{
              position: 'absolute',
              inset: -8,
              borderRadius: '50%',
              border: '2px solid rgba(212,160,68,0.4)',
              animation: 'rogerMascotRing 1.5s ease-in-out infinite',
            }}
          />
        )}
      </div>

      {showLabel && (
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontFamily: '"SF Mono","Fira Code","Cascadia Code",monospace',
              fontSize: 8,
              color: 'rgba(212,160,68,0.5)',
              textTransform: 'uppercase',
              letterSpacing: '0.25em',
            }}
          >
            ▸ ROGER AI
          </div>
          {subtitle && (
            <div
              style={{
                fontFamily: '"SF Mono","Fira Code","Cascadia Code",monospace',
                fontSize: 9,
                color: 'rgba(255,255,255,0.3)',
                textTransform: 'uppercase',
                letterSpacing: '0.15em',
                marginTop: 2,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Inject these keyframes once in your global CSS or a <style> tag:
 *
 * @keyframes rogerMascotPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
 * @keyframes rogerMascotRing { 0%{opacity:.6;transform:scale(1)} 100%{opacity:0;transform:scale(1.3)} }
 */
