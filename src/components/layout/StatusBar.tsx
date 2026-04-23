import { useState, useEffect, useRef } from 'react';
import { Radio, Shield, Signal, Wifi, BatteryFull, Menu, X, UserCheck, ShieldCheck } from 'lucide-react';
import { useViewMode } from '../../context/ViewModeContext';

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
  const [uptime, setUptime]   = useState(86412);
  const [clock, setClock]     = useState(formatClock(new Date()));
  const intervalRef           = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setUptime(u => u + 1);
      setClock(formatClock(new Date()));
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

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

        {/* Test as User toggle */}
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

        {/* Battery */}
        <BatteryFull size={16} style={{ color: 'var(--green)' }} />
      </div>
    </header>
  );
}
