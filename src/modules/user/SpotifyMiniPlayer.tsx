// ─── Roger AI — Spotify Mini Player ─────────────────────────────────────────
// Compact now-playing strip shown above the PTT button when Spotify is active.
// Follows Roger's amber/dark/monospace brutalist aesthetic.

import { useState, useEffect, useRef } from 'react';
import { SkipBack, SkipForward, Play, Pause, Volume2 } from 'lucide-react';
import {
  getNowPlaying, pausePlayback, resumePlayback,
  nextTrack, prevTrack, isSpotifyConnected, type SpotifyTrack,
} from '../../lib/spotify';

export default function SpotifyMiniPlayer() {
  const [track,     setTrack]     = useState<SpotifyTrack | null>(null);
  const [loading,   setLoading]   = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll now-playing every 8s
  useEffect(() => {
    if (!isSpotifyConnected()) return;

    const poll = async () => {
      const t = await getNowPlaying().catch(() => null);
      setTrack(t);
    };

    poll();
    pollRef.current = setInterval(poll, 8_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  if (!isSpotifyConnected() || !track) return null;

  const progressPct = track.durationMs > 0
    ? Math.round((track.progressMs / track.durationMs) * 100)
    : 0;

  const handlePlayPause = async () => {
    setLoading(true);
    try {
      if (track.isPlaying) await pausePlayback();
      else await resumePlayback();
      setTrack(prev => prev ? { ...prev, isPlaying: !prev.isPlaying } : prev);
    } finally {
      setLoading(false);
    }
  };

  const handleNext = async () => {
    setLoading(true);
    try { await nextTrack(); setTimeout(() => getNowPlaying().then(t => setTrack(t)).catch(() => {}), 500); }
    finally { setLoading(false); }
  };

  const handlePrev = async () => {
    setLoading(true);
    try { await prevTrack(); setTimeout(() => getNowPlaying().then(t => setTrack(t)).catch(() => {}), 500); }
    finally { setLoading(false); }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 14px',
      background: 'rgba(30, 215, 96, 0.05)',
      border: '1px solid rgba(30, 215, 96, 0.18)',
      borderBottom: 'none',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Progress bar at top */}
      <div style={{
        position: 'absolute', top: 0, left: 0,
        height: 2,
        width: `${progressPct}%`,
        background: 'rgba(30, 215, 96, 0.7)',
        transition: 'width 1s linear',
      }} />

      {/* Album art */}
      {track.albumArt ? (
        <img
          src={track.albumArt}
          alt=""
          style={{ width: 32, height: 32, objectFit: 'cover', flexShrink: 0, border: '1px solid rgba(30,215,96,0.2)' }}
        />
      ) : (
        <div style={{
          width: 32, height: 32, flexShrink: 0,
          background: 'rgba(30,215,96,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Volume2 size={12} style={{ color: 'rgba(30,215,96,0.6)' }} />
        </div>
      )}

      {/* Track info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'monospace', fontSize: 11, fontWeight: 600,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {track.name}
        </div>
        <div style={{
          fontFamily: 'monospace', fontSize: 9,
          color: 'var(--text-muted)', letterSpacing: '0.05em',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {track.artist}
        </div>
      </div>

      {/* Spotify logo badge */}
      <span style={{
        fontFamily: 'monospace', fontSize: 8, color: 'rgba(30,215,96,0.5)',
        textTransform: 'uppercase', letterSpacing: '0.15em', flexShrink: 0,
      }}>SPT</span>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button
          onClick={handlePrev}
          disabled={loading}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'rgba(30,215,96,0.7)', display: 'flex' }}
        >
          <SkipBack size={13} />
        </button>

        <button
          onClick={handlePlayPause}
          disabled={loading}
          style={{
            background: 'rgba(30,215,96,0.12)', border: '1px solid rgba(30,215,96,0.3)',
            padding: '4px 6px', cursor: 'pointer', color: 'rgb(30,215,96)', display: 'flex',
          }}
        >
          {track.isPlaying
            ? <Pause size={11} />
            : <Play size={11} />
          }
        </button>

        <button
          onClick={handleNext}
          disabled={loading}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'rgba(30,215,96,0.7)', display: 'flex' }}
        >
          <SkipForward size={13} />
        </button>
      </div>
    </div>
  );
}
