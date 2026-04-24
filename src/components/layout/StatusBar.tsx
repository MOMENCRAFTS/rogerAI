import { useState, useEffect, useRef } from 'react';
import { Radio, Shield, Signal, Wifi, BatteryFull, Menu, X, UserCheck, ShieldCheck, LogOut, ChevronDown } from 'lucide-react';
import { useViewMode } from '../../context/ViewModeContext';
import { useAuth } from '../../context/AuthContext';

interface StatusBarProps {
  onMenuToggle: () => void;
  menuOpen: boolean;
}

function pad(n: number) { return String(n).padStart(2, '0'); }

function formatUptime(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `UP ${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatClock(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function StatusBar({ onMenuToggle, menuOpen }: StatusBarProps) {
  const { viewMode, setViewMode } = useViewMode();
  const { user, isAdmin, signOut } = useAuth();
  const [uptime, setUptime]   = useState(86412);
  const [clock, setClock]     = useState(formatClock(new Date()));
  const [avatarOpen, setAvatarOpen] = useState(false);
  const intervalRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  const avatarRef             = useRef<HTMLDivElement>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setUptime(u => u + 1);
      setClock(formatClock(new Date()));
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Close avatar dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const displayName = (user?.user_metadata?.full_name as string | undefined)
    ?? user?.email
    ?? 'User';
  const initials = displayName
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <header
      style={{ background: 'var(--bg-recessed)', borderBottom: '1px solid var(--border-subtle)' }}
      className="flex items-center justify-between px-4 py-3 shrink-0 z-50"
    >
      {/* ── Left ── */}
      <div className="flex items-center gap-3">
        {/* Mobile menu toggle */}
        <button
          className="md:hidden p-2.5 rounded"
          style={{ color: 'var(--amber)' }}
          onClick={onMenuToggle}
          aria-label="Toggle menu"
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        {/* Brand */}
        <div className="flex items-center gap-2 relative">
          {/* Glow blur behind icon */}
          <Radio
            size={16}
            className="absolute opacity-40 blur-sm led-pulse"
            style={{ color: 'var(--green)' }}
          />
          <Radio
            size={16}
            className="relative led-pulse"
            style={{ color: 'var(--green)' }}
          />
          <span
            className="font-mono text-sm tracking-widest uppercase font-semibold text-glow-amber amber-flicker"
            style={{ color: 'var(--amber)' }}
          >
            ROGER AI
          </span>
        </div>

        {/* Separator */}
        <div style={{ width: 1, height: 16, background: 'var(--border-subtle)' }} />

        {/* Status */}
        <div className="hidden sm:flex items-center gap-1">
          <span
            className="font-mono text-nano tracking-wider uppercase"
            style={{ color: 'var(--text-secondary)' }}
          >
            SYS-ACTIVE
          </span>
        </div>

        {/* Separator */}
        <div style={{ width: 1, height: 16, background: 'var(--border-subtle)' }} className="hidden md:block" />

        {/* TLS */}
        <div className="hidden md:flex items-center gap-1.5">
          <Shield size={12} style={{ color: 'var(--text-secondary)' }} />
          <span className="font-mono text-xs tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            TLS 1.3
          </span>
        </div>
      </div>

      {/* ── Right ── */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Uptime */}
        <div
          className="hidden sm:flex items-center px-2 py-0.5 border font-mono text-nano tracking-wider"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
        >
          {formatUptime(uptime)}
        </div>

        {/* Clock */}
        <div
          className="flex items-center px-2 py-0.5 border font-mono text-mini tracking-wider tabular-nums amber-flicker"
          style={{ borderColor: 'var(--amber-border)', color: 'var(--amber)' }}
        >
          {clock}
        </div>

        {/* Signal */}
        <div className="hidden sm:flex items-center gap-1">
          <Signal size={14} style={{ color: 'var(--green)' }} />
          <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>98%</span>
        </div>

        {/* WiFi */}
        <Wifi size={14} style={{ color: 'var(--green)' }} />

        {/* Admin-only: Test as User toggle */}
        {isAdmin && (
          <button
            onClick={() => setViewMode(viewMode === 'admin' ? 'user' : 'admin')}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 10px', fontFamily: 'monospace', fontSize: 9,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              cursor: 'pointer', transition: 'all 150ms',
              border: `1px solid ${viewMode === 'user' ? 'rgba(212,160,68,0.5)' : 'var(--border-subtle)'}`,
              background: viewMode === 'user' ? 'rgba(212,160,68,0.12)' : 'transparent',
              color: viewMode === 'user' ? 'var(--amber)' : 'var(--text-muted)',
            }}
          >
            {viewMode === 'user'
              ? <><ShieldCheck size={10} /> Admin</>
              : <><UserCheck size={10} /> Test User</>
            }
          </button>
        )}

        {/* Battery */}
        <BatteryFull size={16} style={{ color: 'var(--green)' }} />

        {/* ── User avatar + dropdown ── */}
        {user && (
          <div ref={avatarRef} style={{ position: 'relative' }}>
            <button
              id="btn-user-avatar"
              onClick={() => setAvatarOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'transparent', border: '1px solid var(--border-subtle)',
                padding: '2px 6px 2px 2px', cursor: 'pointer',
                transition: 'border-color 150ms',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(212,160,68,0.4)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
            >
              {/* Avatar image or initials fallback */}
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  style={{ width: 22, height: 22, borderRadius: '50%', display: 'block' }}
                />
              ) : (
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: 'rgba(212,160,68,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)',
                }}>
                  {initials}
                </div>
              )}
              <ChevronDown
                size={10}
                style={{
                  color: 'var(--text-muted)',
                  transform: avatarOpen ? 'rotate(180deg)' : 'rotate(0)',
                  transition: 'transform 200ms',
                }}
              />
            </button>

            {/* Dropdown */}
            {avatarOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                minWidth: 200, zIndex: 200,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              }}>
                {/* User info */}
                <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
                  <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', margin: '0 0 2px', fontWeight: 600 }}>
                    {(user.user_metadata?.full_name as string) ?? 'User'}
                  </p>
                  <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0, wordBreak: 'break-all' }}>
                    {user.email}
                  </p>
                  {isAdmin && (
                    <span style={{
                      display: 'inline-block', marginTop: 6,
                      padding: '1px 6px', background: 'rgba(212,160,68,0.12)',
                      border: '1px solid rgba(212,160,68,0.3)',
                      fontFamily: 'monospace', fontSize: 8,
                      color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.12em',
                    }}>
                      Admin
                    </span>
                  )}
                </div>

                {/* Sign out */}
                <button
                  id="btn-sign-out"
                  onClick={async () => { setAvatarOpen(false); await signOut(); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 14px', background: 'transparent', border: 'none',
                    cursor: 'pointer', fontFamily: 'monospace', fontSize: 10,
                    color: 'var(--text-muted)', textTransform: 'uppercase',
                    letterSpacing: '0.1em', transition: 'color 150ms, background 150ms',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.color = '#ef4444';
                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.06)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  }}
                >
                  <LogOut size={12} />
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
