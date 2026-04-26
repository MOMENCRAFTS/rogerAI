import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

interface SplashScreenProps {
  onDone: () => void;
}

// ─── CRT Scanline overlay ────────────────────────────────────────────────────
function CRTScanlines() {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', inset: 0, zIndex: 10,
        pointerEvents: 'none',
        backgroundImage:
          'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px)',
        backgroundSize: '100% 4px',
        mixBlendMode: 'multiply',
      }}
    />
  );
}

// ─── Film grain canvas (refreshed every frame) ───────────────────────────────
function FilmGrain({ primary }: { primary: [number, number, number] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const imageData = ctx.createImageData(W, H);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 40;
      d[i]     = Math.max(0, Math.min(255, primary[0] * 0.14 + n));
      d[i + 1] = Math.max(0, Math.min(255, primary[1] * 0.14 + n));
      d[i + 2] = Math.max(0, Math.min(255, primary[2] * 0.14 + n));
      d[i + 3] = Math.abs(n) * 2.0;
    }
    ctx.putImageData(imageData, 0, 0);
    rafRef.current = requestAnimationFrame(paint);
  }, [primary[0], primary[1], primary[2]]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    rafRef.current = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [paint]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: 'absolute', inset: 0, zIndex: 11,
        opacity: 0.22, pointerEvents: 'none', mixBlendMode: 'screen',
      }}
    />
  );
}

// ─── Chromatic aberration / glitch flicker ───────────────────────────────────
function GlitchFlicker({ isAdmin }: { isAdmin: boolean }) {
  const [glitchOn, setGlitchOn] = useState(false);
  const [glitchX,  setGlitchX]  = useState(0);
  const [tearY,    setTearY]    = useState(40);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = 2500 + Math.random() * 5000;
      timer = setTimeout(() => {
        setGlitchX((Math.random() - 0.5) * 7);
        setTearY(20 + Math.random() * 60);
        setGlitchOn(true);
        setTimeout(() => { setGlitchOn(false); schedule(); }, 70 + Math.random() * 130);
      }, delay);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  if (!glitchOn) return null;

  const col  = isAdmin ? 'rgba(212,160,68,0.16)' : 'rgba(56,189,248,0.16)';
  const colR = isAdmin ? 'rgba(212,60,30,0.11)'  : 'rgba(240,40,210,0.11)';
  const tearCol = isAdmin ? 'rgba(240,192,96,0.4)' : 'rgba(34,211,238,0.4)';

  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 12, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, background: colR,    transform: `translateX(${glitchX + 3}px)`, mixBlendMode: 'screen' }} />
      <div style={{ position: 'absolute', inset: 0, background: col,     transform: `translateX(${glitchX - 2}px)`, mixBlendMode: 'screen' }} />
      <div style={{
        position: 'absolute', top: `${tearY}%`, left: 0, right: 0,
        height: 2 + Math.random() * 4,
        background: tearCol,
        transform: `translateX(${glitchX * 2}px)`,
        mixBlendMode: 'screen',
      }} />
    </div>
  );
}

// ─── Rotating SVG rings ───────────────────────────────────────────────────────
function RotatingRings({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 3,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <svg width={500} height={500} style={{ position: 'absolute', animation: 'ring-slow 20s linear infinite' }}>
        <circle cx={250} cy={250} r={230} fill="none" stroke={primary}   strokeWidth={0.7} strokeDasharray="14 28" strokeOpacity={0.3} />
        <circle cx={250} cy={250} r={230} fill="none" stroke={secondary} strokeWidth={1.2} strokeDasharray="4 70"  strokeOpacity={0.55} />
      </svg>
      <svg width={370} height={370} style={{ position: 'absolute', animation: 'ring-rev 13s linear infinite' }}>
        <circle cx={185} cy={185} r={170} fill="none" stroke={primary}   strokeWidth={0.5} strokeDasharray="6 20"  strokeOpacity={0.2} />
        <circle cx={185} cy={185} r={170} fill="none" stroke={secondary} strokeWidth={1.6} strokeDasharray="3 50"  strokeOpacity={0.6} />
      </svg>
      <svg width={240} height={240} style={{ position: 'absolute', animation: 'ring-fast 7s linear infinite' }}>
        <circle cx={120} cy={120} r={108} fill="none" stroke={secondary} strokeWidth={0.9} strokeDasharray="2 14"  strokeOpacity={0.35} />
      </svg>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
const TOTAL_MS = 25_000;

export default function SplashScreen({ onDone }: SplashScreenProps) {
  const { isAdmin } = useAuth();

  const [_progress, setProgress]  = useState(0);
  const [exiting,   setExiting]   = useState(false);
  const [textIndex, setTextIndex] = useState(0);
  const exitingRef = useRef(false);

  // Role palette
  const primaryHex   = isAdmin ? '#d4a044' : '#38bdf8';
  const secondaryHex = isAdmin ? '#f0c060' : '#22d3ee';
  const primaryRGB: [number, number, number] = isAdmin ? [212, 160, 68] : [56, 189, 248];

  // Status messages that rotate every 5 s
  const statusTexts = isAdmin
    ? ['INITIALISING COMMAND CENTER', 'LOADING ADMIN PROTOCOLS', 'SYNCING MISSION DATA', 'ESTABLISHING SECURE LINK', 'ROGER THAT — STANDING BY']
    : ['ESTABLISHING COMMS LINK', 'SYNCING YOUR PROFILE', 'LOADING MISSION BRIEF', 'TUNING FREQUENCY', 'ROGER — ON STANDBY'];

  useEffect(() => {
    const iv = setInterval(() => setTextIndex(i => (i + 1) % statusTexts.length), 5000);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Skip on any key press
  useEffect(() => {
    const onKey = () => handleDone();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 25-second countdown
  useEffect(() => {
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min((now - start) / TOTAL_MS, 1);
      setProgress(p);
      if (p < 1) { raf = requestAnimationFrame(tick); }
      else { handleDone(); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDone = () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setExiting(true);
    setTimeout(onDone, 650);
  };


  return (
    <>
      <style>{`
        @keyframes ring-slow { to { transform: rotate(360deg);  } }
        @keyframes ring-rev  { to { transform: rotate(-360deg); } }
        @keyframes ring-fast { to { transform: rotate(360deg);  } }
        @keyframes orb-pulse {
          0%,100% { transform: scale(1);    opacity: 0.75; }
          50%      { transform: scale(1.2);  opacity: 1;    }
        }
        @keyframes txt-in {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        @keyframes blink    { 0%,100% { opacity:1; } 50% { opacity:0; } }
        @keyframes badge-in {
          from { opacity:0; transform: scale(0.8) translateY(-4px); }
          to   { opacity:1; transform: scale(1)   translateY(0);    }
        }
        @keyframes vignette-breathe {
          0%,100% { opacity:0.85; } 50% { opacity:1; }
        }
        @keyframes hud-flicker {
          0%,100%{opacity:1} 8%{opacity:0.82} 9%{opacity:1} 43%{opacity:0.9} 44%{opacity:1} 77%{opacity:0.85} 78%{opacity:1}
        }
        @keyframes scanline-move {
          from { background-position: 0 0; }
          to   { background-position: 0 8px; }
        }
        @keyframes mascot-vibrate {
          0%,7%,100% { transform: translate(-50%,-50%) rotate(0deg); }
          1%  { transform: translate(-47%,-51.5%) rotate(-2deg); }
          2%  { transform: translate(-53%,-48.5%) rotate( 2deg); }
          3%  { transform: translate(-47%,-51%)   rotate(-1.5deg); }
          4%  { transform: translate(-53%,-49%)   rotate( 1.5deg); }
          5%  { transform: translate(-48%,-51%)   rotate(-1deg); }
          6%  { transform: translate(-52%,-49%)   rotate( 1deg); }
        }
        @keyframes mascot-glow-pulse {
          0%,100% { filter: drop-shadow(0 0 18px rgba(56,189,248,0.55)) drop-shadow(0 0 40px rgba(168,85,247,0.35)); }
          50%      { filter: drop-shadow(0 0 32px rgba(56,189,248,0.85)) drop-shadow(0 0 70px rgba(168,85,247,0.65)); }
        }
        @keyframes brand-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>

      {/* ── Root container — click/tap anywhere to skip ── */}
      <div
        onClick={handleDone}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          overflow: 'hidden',
          opacity: exiting ? 0 : 1,
          transition: 'opacity 650ms ease',
          background: '#050505',
          cursor: 'pointer',
        }}
      >

        {/* ══ LAYER 0 — Background image (user's dark metallic texture) ══ */}
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0,
            zIndex: 0,
            backgroundImage: 'url(/splash_bg.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />

        {/* ══ LAYER 1 — Dark overlay so text stays readable ══ */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 1,
          background: 'linear-gradient(to bottom, rgba(5,5,5,0.55) 0%, rgba(5,5,5,0.30) 50%, rgba(5,5,5,0.72) 100%)',
        }} />

        {/* ══ LAYER 2 — Breathing vignette ══ */}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 68% 68% at 50% 50%, transparent 38%, #050505 100%)',
          animation: 'vignette-breathe 5s ease-in-out infinite',
        }} />


        {/* ══ LAYER 3 — SVG rotating rings ══ */}
        <RotatingRings primary={primaryHex} secondary={secondaryHex} />

        {/* ══ LAYER 4 — Glow orb ══ */}
        <div style={{
          position: 'absolute',
          width: 440, height: 440,
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          borderRadius: '50%',
          background: isAdmin
            ? 'radial-gradient(circle, rgba(212,160,68,0.18) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(56,189,248,0.18) 0%, transparent 70%)',
          filter: 'blur(20px)',
          animation: 'orb-pulse 4s ease-in-out infinite',
          zIndex: 4, pointerEvents: 'none',
        }} />

        {/* ══ LAYER 5 — HUD edge bars ══ */}
        {/* Top bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          height: 3, zIndex: 5, pointerEvents: 'none',
          background: `linear-gradient(90deg, transparent 0%, ${primaryHex}99 40%, ${secondaryHex}dd 60%, transparent 100%)`,
          boxShadow: `0 0 20px 3px ${primaryHex}55`,
          animation: 'hud-flicker 4.5s ease-in-out infinite',
        }} />
        {/* Bottom bar */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: 1, zIndex: 5, pointerEvents: 'none',
          background: `linear-gradient(90deg, transparent 10%, ${primaryHex}55 50%, transparent 90%)`,
        }} />







        {/* ══ LAYER 55 — Momen Pharaon branding (bottom centre, ABOVE post-fx) ══ */}
        <div style={{
          position: 'absolute', bottom: 32, left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 55,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          pointerEvents: 'none',
          animation: 'brand-fade-in 1.8s ease 0.6s both',
        }}>
          {/* Decorative separator line */}
          <div style={{
            width: 48, height: 1,
            background: `linear-gradient(90deg, transparent, ${primaryHex}66, transparent)`,
            marginBottom: 2,
          }} />
          <p style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11, fontWeight: 600, letterSpacing: '0.22em',
            color: `${primaryHex}cc`, textTransform: 'uppercase', margin: 0,
            textShadow: `0 0 12px ${primaryHex}55, 0 0 24px ${primaryHex}22`,
          }}>
            Crafted by Momen Pharaon
          </p>
          <p style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9, fontWeight: 500, letterSpacing: '0.24em',
            color: `${primaryHex}88`, textTransform: 'uppercase', margin: 0,
            textShadow: `0 0 8px ${primaryHex}33`,
          }}>
            MomenCrafts Co ✦ 2026
          </p>
        </div>

        {/* ══ LAYER 8-10 — Cinematic post-processing filters ══ */}
        {/* CRT scanlines */}
        <CRTScanlines />
        {/* Film grain */}
        <FilmGrain primary={primaryRGB} />
        {/* Chromatic aberration glitch */}
        <GlitchFlicker isAdmin={isAdmin} />



        {/* ══ LAYER 50B — Mascot pinned to exact screen centre ══ */}
        <img
          src="/mascot.png"
          alt="Roger AI Mascot"
          style={{
            position: 'absolute',
            top: '50%', left: '50%',
            zIndex: 50,
            pointerEvents: 'none',
            width: 'min(280px, 56vw)', height: 'auto',
            objectFit: 'contain',
            mixBlendMode: 'screen',
            animation: 'mascot-vibrate 8s ease-in-out infinite, mascot-glow-pulse 2.4s ease-in-out infinite',
          }}
        />

        {/* ══ LAYER 50C — Branding text (below mascot centre) ══ */}
        <div style={{
          position: 'absolute',
          top: '74%', left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 50,
          pointerEvents: 'none',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 8,
          textAlign: 'center',
          whiteSpace: 'nowrap',
        }}>
          <p style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 28, fontWeight: 700, letterSpacing: '0.24em',
            color: 'rgba(255,255,255,0.92)', margin: 0,
            textShadow: `0 0 32px ${primaryHex}aa`,
          }}>
            ROGER<span style={{ color: primaryHex }}>·</span>AI
          </p>
          <p style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9, letterSpacing: '0.34em',
            color: `${secondaryHex}88`, textTransform: 'uppercase', margin: 0,
          }}>
            YOUR AI CHIEF OF STAFF
          </p>
          <div style={{ height: 16 }}>
            <span
              key={textIndex}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9, letterSpacing: '0.28em',
                color: `${primaryHex}66`, textTransform: 'uppercase',
                display: 'inline-block',
                animation: 'txt-in 0.5s ease both',
              }}
            >
              {statusTexts[textIndex]}
              <span style={{ animation: 'blink 1s step-end infinite', marginLeft: 3 }}>_</span>
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
