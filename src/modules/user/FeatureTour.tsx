import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Volume2, VolumeX, X } from 'lucide-react';
import { TOUR_SLIDES, TOUR_VERSION } from '../../lib/featureTour';
import { speakResponse, stopSpeaking } from '../../lib/tts';

interface Props {
  displayName?: string;
  onComplete: () => void;
}

export default function FeatureTour({ displayName, onComplete }: Props) {
  const [slide, setSlide]     = useState(0);
  const [muted, setMuted]     = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [direction, setDirection] = useState(1); // 1=forward, -1=back
  const [exiting, setExiting]   = useState(false);
  const spokenRef = useRef<Set<number>>(new Set());

  const total = TOUR_SLIDES.length;
  const current = TOUR_SLIDES[slide];
  const isLast = slide === total - 1;

  // ── Speak the current slide on entry ──────────────────────────────────────
  const speakSlide = useCallback((idx: number) => {
    if (muted || spokenRef.current.has(idx)) return;
    spokenRef.current.add(idx);
    const text = TOUR_SLIDES[idx].rogerSpeech(displayName);
    setSpeaking(true);
    speakResponse(text)
      .catch(() => {
        try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* silent */ }
      })
      .finally(() => setSpeaking(false));
  }, [muted, displayName]);

  useEffect(() => {
    speakSlide(slide);
  }, [slide, speakSlide]);

  // ── Mute toggle — also stop active speech ────────────────────────────────
  const toggleMute = () => {
    if (!muted) stopSpeaking();
    setMuted(m => !m);
  };

  // ── Navigation ────────────────────────────────────────────────────────────
  const goNext = useCallback(() => {
    stopSpeaking();
    if (isLast) { handleComplete(); return; }
    setDirection(1);
    setSlide(s => s + 1);
  }, [isLast]); // eslint-disable-line react-hooks/exhaustive-deps

  const goPrev = useCallback(() => {
    if (slide === 0) return;
    stopSpeaking();
    setDirection(-1);
    setSlide(s => s - 1);
  }, [slide]);

  const handleSkip = () => {
    stopSpeaking();
    handleComplete();
  };

  const handleComplete = () => {
    setExiting(true);
    setTimeout(() => onComplete(), 500);
  };

  // ── Keyboard support ──────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') goNext();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'Escape') handleSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev]); // eslint-disable-line react-hooks/exhaustive-deps

  const Icon = current.icon;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: exiting ? 0 : 1 }}
      transition={{ duration: 0.4 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'rgba(8,10,9,0.97)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '24px 20px',
      }}
    >
      {/* CRT scanlines pass through from global body::after */}

      {/* Ambient radial glow behind slide — color-matched to slide icon */}
      <div
        key={`glow-${slide}`}
        style={{
          position: 'absolute', top: '38%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 420, height: 420, borderRadius: '50%',
          background: `radial-gradient(circle, ${current.iconColor}0d 0%, transparent 70%)`,
          pointerEvents: 'none',
          transition: 'background 600ms ease',
        }}
      />

      {/* ── Top bar: step counter + mute + skip ── */}
      <div style={{
        position: 'absolute', top: 18, left: 20, right: 20,
        display: 'flex', alignItems: 'center', gap: 10, zIndex: 2,
      }}>
        {/* Mission brief label */}
        <span style={{
          fontFamily: 'monospace', fontSize: 9, color: 'rgba(212,160,68,0.5)',
          textTransform: 'uppercase', letterSpacing: '0.25em', flex: 1,
        }}>
          Roger AI · Mission Brief
        </span>

        {/* Step counter */}
        <span style={{
          fontFamily: 'monospace', fontSize: 9,
          color: 'rgba(212,160,68,0.4)', letterSpacing: '0.1em',
        }}>
          {slide + 1} / {total}
        </span>

        {/* Mute */}
        <button
          onClick={toggleMute}
          title={muted ? 'Unmute Roger' : 'Mute Roger'}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 6, color: muted ? 'rgba(212,160,68,0.35)' : 'rgba(212,160,68,0.65)',
            display: 'flex', transition: 'color 150ms',
          }}
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>

        {/* Skip */}
        <button
          onClick={handleSkip}
          title="Skip tour"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 6, color: 'rgba(107,106,94,0.6)',
            display: 'flex', transition: 'color 150ms',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgba(107,106,94,1)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(107,106,94,0.6)')}
        >
          <X size={15} />
        </button>
      </div>

      {/* ── Slide card ── */}
      <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={slide}
            custom={direction}
            initial={{ opacity: 0, x: direction * 36 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -36 }}
            transition={{ duration: 0.28, ease: 'easeInOut' }}
          >
            {/* Hero icon zone */}
            <div style={{
              display: 'flex', justifyContent: 'center', marginBottom: 28,
            }}>
              <div style={{ position: 'relative' }}>
                <div style={{
                  width: 80, height: 80,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: '50%',
                  background: `${current.iconColor}12`,
                  border: `1px solid ${current.iconColor}30`,
                  boxShadow: speaking
                    ? `0 0 28px ${current.iconColor}40, 0 0 8px ${current.iconColor}20`
                    : `0 0 12px ${current.iconColor}18`,
                  transition: 'box-shadow 300ms ease',
                }}>
                  <Icon size={36} color={current.iconColor} />
                </div>

                {/* Speaking pulse ring */}
                {speaking && (
                  <motion.div
                    initial={{ opacity: 0.7, scale: 1 }}
                    animate={{ opacity: 0, scale: 1.55 }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
                    style={{
                      position: 'absolute', inset: -8,
                      borderRadius: '50%',
                      border: `2px solid ${current.iconColor}55`,
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
            </div>

            {/* Card body */}
            <div style={{
              background: 'rgba(20,22,18,0.92)',
              border: `1px solid ${current.iconColor}22`,
              padding: '24px 22px',
              marginBottom: 20,
            }}>
              {/* Slide tag */}
              <p style={{
                fontFamily: 'monospace', fontSize: 9, margin: '0 0 6px',
                color: current.iconColor,
                textTransform: 'uppercase', letterSpacing: '0.25em',
                opacity: 0.75,
              }}>
                {String(slide + 1).padStart(2, '0')} · Capability
              </p>

              {/* Headline */}
              <h2 style={{
                fontFamily: 'monospace', fontSize: 18, fontWeight: 700,
                color: 'var(--text-primary)', margin: '0 0 12px',
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>
                {current.headline}
              </h2>

              {/* Body */}
              <p style={{
                fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)',
                margin: '0 0 20px', lineHeight: 1.7,
              }}>
                {current.body}
              </p>

              {/* Example command chip */}
              <div style={{
                background: `${current.iconColor}09`,
                border: `1px solid ${current.iconColor}25`,
                padding: '10px 14px',
              }}>
                <p style={{
                  fontFamily: 'monospace', fontSize: 9, margin: '0 0 5px',
                  color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em',
                }}>
                  {current.exampleLabel}
                </p>
                <p style={{
                  fontFamily: 'monospace', fontSize: 12,
                  color: current.iconColor,
                  margin: 0, lineHeight: 1.5, fontStyle: 'italic',
                }}>
                  {current.exampleCommand}
                </p>
              </div>
            </div>

            {/* ── Nav row ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Prev */}
              <button
                onClick={goPrev}
                disabled={slide === 0}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '10px 14px', fontFamily: 'monospace', fontSize: 10,
                  textTransform: 'uppercase', letterSpacing: '0.12em',
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  color: slide === 0 ? 'rgba(107,106,94,0.25)' : 'var(--text-muted)',
                  cursor: slide === 0 ? 'default' : 'pointer',
                  transition: 'all 150ms', flexShrink: 0,
                }}
              >
                <ChevronLeft size={12} /> Prev
              </button>

              {/* Progress dots */}
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 6 }}>
                {TOUR_SLIDES.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => { stopSpeaking(); setDirection(i > slide ? 1 : -1); setSlide(i); }}
                    style={{
                      width: i === slide ? 20 : 6,
                      height: 6, borderRadius: 3,
                      background: i === slide ? current.iconColor : 'rgba(107,106,94,0.35)',
                      border: 'none', padding: 0, cursor: 'pointer',
                      transition: 'all 300ms ease',
                      boxShadow: i === slide ? `0 0 6px ${current.iconColor}50` : 'none',
                    }}
                    aria-label={`Go to slide ${i + 1}`}
                  />
                ))}
              </div>

              {/* Next / Enter */}
              <button
                onClick={goNext}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '10px 16px', fontFamily: 'monospace', fontSize: 10,
                  textTransform: 'uppercase', letterSpacing: '0.12em',
                  background: isLast ? `${current.iconColor}18` : 'rgba(212,160,68,0.1)',
                  border: `1px solid ${isLast ? current.iconColor : 'rgba(212,160,68,0.4)'}`,
                  color: isLast ? current.iconColor : 'var(--amber)',
                  cursor: 'pointer',
                  transition: 'all 150ms', flexShrink: 0,
                  fontWeight: isLast ? 700 : 400,
                  boxShadow: isLast ? `0 0 14px ${current.iconColor}25` : 'none',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = isLast ? `${current.iconColor}28` : 'rgba(212,160,68,0.18)')}
                onMouseLeave={e => (e.currentTarget.style.background = isLast ? `${current.iconColor}18` : 'rgba(212,160,68,0.1)')}
              >
                {isLast ? 'Engage' : 'Next'} <ChevronRight size={12} />
              </button>
            </div>

            {/* Skip text — shown only on first 3 slides */}
            {slide < 3 && (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button
                  onClick={handleSkip}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontFamily: 'monospace', fontSize: 9, color: 'rgba(107,106,94,0.5)',
                    textTransform: 'uppercase', letterSpacing: '0.15em',
                    transition: 'color 150ms',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'rgba(107,106,94,0.9)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'rgba(107,106,94,0.5)')}
                >
                  Skip brief →
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Version watermark ── */}
      <div style={{
        position: 'absolute', bottom: 14, left: 0, right: 0, textAlign: 'center',
        fontFamily: 'monospace', fontSize: 8, color: 'rgba(107,106,94,0.25)',
        letterSpacing: '0.2em', textTransform: 'uppercase', pointerEvents: 'none',
      }}>
        Mission Brief v{TOUR_VERSION} · Roger AI
      </div>
    </motion.div>
  );
}
