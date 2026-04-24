import { useAuth } from '../context/AuthContext';

export default function LoginScreen() {
  const { signInWithGoogle, authError } = useAuth();

  return (
    <div
      id="login-screen"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#0a0a08',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        overflow: 'hidden',
      }}
    >
      {/* ── Ambient glows ── */}
      <div style={{
        position: 'absolute',
        top: '20%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 500,
        height: 500,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(212,160,68,0.06) 0%, transparent 65%)',
        pointerEvents: 'none',
        animation: 'loginGlow 6s ease-in-out infinite',
      }} />
      <div style={{
        position: 'absolute',
        bottom: '15%',
        right: '10%',
        width: 300,
        height: 300,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(74,222,128,0.04) 0%, transparent 65%)',
        pointerEvents: 'none',
      }} />

      {/* ── Scanlines overlay ── */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)',
        pointerEvents: 'none',
        opacity: 0.6,
      }} />

      {/* ── Card ── */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0,
        maxWidth: 380,
        width: '100%',
        border: '1px solid rgba(212,160,68,0.2)',
        background: 'rgba(212,160,68,0.03)',
        backdropFilter: 'blur(12px)',
        padding: '48px 40px 40px',
      }}>

        {/* Corner accents */}
        <div style={{ position: 'absolute', top: -1, left: -1, width: 20, height: 20, borderTop: '2px solid rgba(212,160,68,0.7)', borderLeft: '2px solid rgba(212,160,68,0.7)' }} />
        <div style={{ position: 'absolute', top: -1, right: -1, width: 20, height: 20, borderTop: '2px solid rgba(212,160,68,0.7)', borderRight: '2px solid rgba(212,160,68,0.7)' }} />
        <div style={{ position: 'absolute', bottom: -1, left: -1, width: 20, height: 20, borderBottom: '2px solid rgba(212,160,68,0.7)', borderLeft: '2px solid rgba(212,160,68,0.7)' }} />
        <div style={{ position: 'absolute', bottom: -1, right: -1, width: 20, height: 20, borderBottom: '2px solid rgba(212,160,68,0.7)', borderRight: '2px solid rgba(212,160,68,0.7)' }} />

        {/* Logo */}
        <div style={{ position: 'relative', marginBottom: 24 }}>
          <img
            src="/mascot.png"
            alt="Roger AI"
            style={{
              width: 80,
              height: 80,
              objectFit: 'contain',
              filter: 'drop-shadow(0 0 24px rgba(212,160,68,0.5))',
              animation: 'loginGlow 4s ease-in-out infinite',
            }}
          />
          {/* Pulsing ring */}
          <div style={{
            position: 'absolute',
            inset: -10,
            borderRadius: '50%',
            border: '1px solid rgba(212,160,68,0.3)',
            animation: 'loginRing 3s ease-in-out infinite',
          }} />
        </div>

        {/* Title */}
        <p style={{
          fontFamily: 'monospace',
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--amber)',
          textTransform: 'uppercase',
          letterSpacing: '0.3em',
          margin: '0 0 4px',
          textShadow: '0 0 20px rgba(212,160,68,0.4)',
        }}>
          ROGER AI
        </p>
        <p style={{
          fontFamily: 'monospace',
          fontSize: 10,
          color: 'rgba(255,255,255,0.3)',
          textTransform: 'uppercase',
          letterSpacing: '0.25em',
          margin: '0 0 40px',
        }}>
          Chief of Staff · Command Interface
        </p>

        {/* Divider */}
        <div style={{
          width: '100%',
          height: 1,
          background: 'linear-gradient(to right, transparent, rgba(212,160,68,0.2), transparent)',
          marginBottom: 32,
        }} />

        {/* Auth label */}
        <p style={{
          fontFamily: 'monospace',
          fontSize: 9,
          color: 'rgba(255,255,255,0.25)',
          textTransform: 'uppercase',
          letterSpacing: '0.2em',
          margin: '0 0 16px',
        }}>
          Secure Authentication
        </p>

        {/* Auth error */}
        {authError && (
          <div style={{ width: '100%', padding: '10px 14px', marginBottom: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 13, marginTop: 1 }}>⚠</span>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#f87171', margin: 0, lineHeight: 1.6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {authError}
            </p>
          </div>
        )}

        {/* Google OAuth button */}
        <button
          id="btn-google-signin"
          onClick={signInWithGoogle}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '13px 20px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: 12,
            color: 'rgba(255,255,255,0.85)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            transition: 'all 200ms',
            position: 'relative',
            overflow: 'hidden',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.25)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.12)';
          }}
        >
          {/* Google G SVG */}
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        {/* Footer note */}
        <p style={{
          fontFamily: 'monospace',
          fontSize: 9,
          color: 'rgba(255,255,255,0.18)',
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          margin: '24px 0 0',
          textAlign: 'center',
          lineHeight: 1.8,
        }}>
          Your data is end-to-end encrypted<br />and stored in your personal vault.
        </p>
      </div>

      {/* ── CSS animations ── */}
      <style>{`
        @keyframes loginGlow {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
        @keyframes loginRing {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.12); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
