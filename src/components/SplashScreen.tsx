import { useEffect, useState } from 'react';

interface SplashScreenProps {
  onDone: () => void;
}

export default function SplashScreen({ onDone }: SplashScreenProps) {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in');

  useEffect(() => {
    // Phase 1: fade in (600ms)
    const t1 = setTimeout(() => setPhase('hold'), 600);
    // Phase 2: hold (1800ms)
    const t2 = setTimeout(() => setPhase('out'), 2400);
    // Phase 3: fade out complete → notify parent (500ms)
    const t3 = setTimeout(() => onDone(), 2900);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#0d0d0a',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 0,
        opacity:    phase === 'out' ? 0 : 1,
        transition: phase === 'out' ? 'opacity 500ms ease' : phase === 'in' ? 'opacity 600ms ease' : 'none',
      }}
    >
      {/* Ambient glow behind mascot */}
      <div style={{
        position: 'absolute',
        width: 320, height: 320,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(212,160,68,0.15) 0%, transparent 70%)',
        filter: 'blur(40px)',
        transform: `scale(${phase === 'hold' ? 1.1 : 0.9})`,
        transition: 'transform 1.2s ease',
      }} />

      {/* Mascot image */}
      <div style={{
        transform: `translateY(${phase === 'in' ? 24 : 0}px) scale(${phase === 'in' ? 0.92 : 1})`,
        transition: 'transform 700ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        zIndex: 1,
      }}>
        <img
          src="/mascot.png"
          alt="Roger AI mascot"
          style={{ width: 220, height: 'auto', filter: 'drop-shadow(0 0 32px rgba(212,160,68,0.3))' }}
        />
      </div>

      {/* Tagline */}
      <div style={{
        zIndex: 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 6, marginTop: -8,
        opacity: phase === 'in' ? 0 : 1,
        transition: 'opacity 400ms ease 200ms',
      }}>
        <p style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11, letterSpacing: '0.3em',
          color: 'rgba(212,160,68,0.6)',
          textTransform: 'uppercase',
          margin: 0,
        }}>
          COMMAND CENTER
        </p>
      </div>

      {/* Loader bar */}
      <div style={{
        position: 'absolute', bottom: 60,
        width: 120, height: 2,
        background: 'rgba(212,160,68,0.15)',
        borderRadius: 1,
        overflow: 'hidden',
        zIndex: 1,
        opacity: phase === 'in' ? 0 : 1,
        transition: 'opacity 300ms ease',
      }}>
        <div style={{
          height: '100%',
          background: 'linear-gradient(90deg, var(--amber, #d4a044), #f0c060)',
          width: phase === 'hold' ? '100%' : phase === 'out' ? '100%' : '0%',
          transition: phase === 'hold' ? 'width 1.8s linear' : 'none',
        }} />
      </div>

      {/* MomenCrafts credit */}
      <div style={{
        position: 'absolute', bottom: 24,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        zIndex: 1,
        opacity: phase === 'hold' ? 0.5 : 0,
        transition: 'opacity 600ms ease 400ms',
      }}>
        <p style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9, letterSpacing: '0.25em',
          color: 'rgba(212,160,68,0.6)',
          textTransform: 'uppercase', margin: 0,
        }}>
          Crafted by Momen Pharaon
        </p>
        <p style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9, letterSpacing: '0.2em',
          color: 'rgba(212,160,68,0.35)',
          textTransform: 'uppercase', margin: 0,
        }}>
          MomenCrafts ✦ 2026
        </p>
      </div>
    </div>
  );
}
