// ─── Roger AI — Radio Mini Player ───────────────────────────────────────────
// Compact now-playing strip shown above the PTT button when internet radio is active.
// Follows Roger's amber/dark/monospace brutalist aesthetic.
// Listens to 'roger:radio-state-change' CustomEvents from radioBrowser.ts.

import { useState, useEffect, useCallback } from 'react';
import { Radio, Square, Play, SkipForward, X, Loader } from 'lucide-react';
import {
  getRadioState, toggleRadio, stopRadio, playNextStation,
  type RadioPlaybackState,
} from '../../lib/radioBrowser';

// Country code → flag emoji
const flagEmoji = (cc: string): string => {
  if (!cc || cc.length !== 2) return '';
  const code = cc.toUpperCase();
  return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
};

// Truncate tags to first N
const formatTags = (tags: string, max = 2): string => {
  if (!tags) return '';
  return tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, max).join(' · ');
};

export default function RadioMiniPlayer() {
  const [state, setState] = useState<RadioPlaybackState>(getRadioState);
  const [loading, setLoading] = useState(false);

  // Listen for playback state changes
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as RadioPlaybackState;
      setState(detail);
    };
    window.addEventListener('roger:radio-state-change', handler);
    return () => window.removeEventListener('roger:radio-state-change', handler);
  }, []);

  const handleToggle = useCallback(async () => {
    setLoading(true);
    try { toggleRadio(); } finally { setLoading(false); }
  }, []);

  const handleNext = useCallback(async () => {
    setLoading(true);
    try { await playNextStation(); } finally { setLoading(false); }
  }, []);

  const handleStop = useCallback(() => {
    stopRadio();
  }, []);

  // Don't render if no station is loaded
  if (!state.station) return null;

  const station = state.station;
  const tags = formatTags(station.tags);
  const flag = flagEmoji(station.countrycode);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 14px',
      background: 'rgba(212, 160, 68, 0.04)',
      border: '1px solid rgba(212, 160, 68, 0.18)',
      borderBottom: 'none',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Animated radio wave bar at top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 2,
        background: state.isPlaying
          ? 'linear-gradient(90deg, transparent, rgba(212,160,68,0.7), transparent)'
          : 'rgba(212,160,68,0.15)',
        animation: state.isPlaying ? 'radioWave 2s ease-in-out infinite' : 'none',
      }} />

      {/* Radio icon */}
      <div style={{
        width: 32, height: 32, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(212,160,68,0.08)',
        border: '1px solid rgba(212,160,68,0.15)',
      }}>
        {state.isLoading ? (
          <Loader size={13} style={{ color: 'var(--amber)', animation: 'spin 1s linear infinite' }} />
        ) : (
          <Radio size={13} style={{ color: 'var(--amber)', opacity: state.isPlaying ? 1 : 0.5 }} />
        )}
      </div>

      {/* Station info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'monospace', fontSize: 11, fontWeight: 600,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {flag} {station.name}
        </div>
        <div style={{
          fontFamily: 'monospace', fontSize: 8,
          color: 'var(--text-muted)', letterSpacing: '0.06em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {[tags, station.codec, station.bitrate > 0 ? `${station.bitrate}kbps` : '']
            .filter(Boolean).join(' · ')}
        </div>

        {/* Error message */}
        {state.error && (
          <div style={{
            fontFamily: 'monospace', fontSize: 8, color: '#ef4444',
            marginTop: 2, letterSpacing: '0.04em',
          }}>
            {state.error}
          </div>
        )}
      </div>

      {/* LIVE badge */}
      {state.isPlaying && (
        <span style={{
          fontFamily: 'monospace', fontSize: 7, color: 'var(--amber)',
          textTransform: 'uppercase', letterSpacing: '0.18em', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: 'var(--amber)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }} />
          LIVE
        </span>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {/* Play / Pause */}
        <button
          onClick={handleToggle}
          disabled={loading || state.isLoading}
          aria-label={state.isPlaying ? 'Pause radio' : 'Resume radio'}
          style={{
            background: 'rgba(212,160,68,0.1)',
            border: '1px solid rgba(212,160,68,0.3)',
            padding: '4px 6px', cursor: 'pointer',
            color: 'var(--amber)', display: 'flex',
          }}
        >
          {state.isPlaying
            ? <Square size={10} />
            : <Play size={10} />
          }
        </button>

        {/* Next station */}
        <button
          onClick={handleNext}
          disabled={loading}
          aria-label="Next station"
          style={{
            background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', color: 'rgba(212,160,68,0.7)', display: 'flex',
          }}
        >
          <SkipForward size={13} />
        </button>

        {/* Stop / Close */}
        <button
          onClick={handleStop}
          aria-label="Stop radio"
          style={{
            background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', color: 'rgba(239,68,68,0.6)', display: 'flex',
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Inline keyframes for radio wave animation */}
      <style>{`
        @keyframes radioWave {
          0%, 100% { background-position: -200% center; }
          50% { background-position: 200% center; }
        }
      `}</style>
    </div>
  );
}
