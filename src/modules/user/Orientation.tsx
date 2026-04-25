/**
 * Orientation.tsx
 *
 * Interactive 10-chapter Roger orientation. Roger speaks each chapter
 * via TTS, then waits for the user to say "understood" (via PTT) or
 * tap the CONTINUE button before advancing to the next chapter.
 *
 * Slot: renders after Onboarding, before the main app.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, Volume2, VolumeX, Mic, MicOff } from 'lucide-react';
import { ORIENTATION_CHAPTERS, ORIENTATION_VERSION, ISLAMIC_CHAPTER } from '../../lib/orientationScript';
import { speakResponse, stopSpeaking } from '../../lib/tts';
import { createAudioRecorder } from '../../lib/audioRecorder';
import { transcribeAudio } from '../../lib/whisper';

// Keywords that mean "I understand, move on"
const CONFIRM_KEYWORDS = [
  'understood', 'got it', 'continue', 'roger', 'okay', 'ok',
  'next', 'proceed', 'ready', 'yes', 'affirmative', 'copy',
  "i'm ready", 'engage', 'let\'s go',
];

interface Props {
  displayName?: string;
  islamicMode?: boolean;
  onComplete: () => void;
}

export default function Orientation({ displayName, islamicMode, onComplete }: Props) {
  const [chapter, setChapter]         = useState(0);
  const [direction, setDirection]     = useState(1);
  const [speaking, setSpeaking]       = useState(false);
  const [muted, setMuted]             = useState(false);
  const [exiting, setExiting]         = useState(false);
  const [pttHeld, setPttHeld]         = useState(false);
  const [pttTranscribing, setPttTranscribing] = useState(false);
  const [flashMsg, setFlashMsg]       = useState<string | null>(null);
  const [showConfirmZone, setShowConfirmZone] = useState(false);

  // Build chapter list: add Islamic chapter at the end if user opted in
  const CHAPTERS = islamicMode
    ? [...ORIENTATION_CHAPTERS, ISLAMIC_CHAPTER]
    : ORIENTATION_CHAPTERS;

  const spokenRef  = useRef<Set<number>>(new Set());
  const recorderRef = useRef<ReturnType<typeof createAudioRecorder> | null>(null);
  // openaiKey is read from env inside whisper.ts — no need to pass it here

  const total   = CHAPTERS.length;
  const current = CHAPTERS[chapter];
  const isLast  = chapter === total - 1;
  const Icon    = current.icon;

  // ── Speak chapter on entry ────────────────────────────────────────────────
  const speakChapter = useCallback((idx: number) => {
    if (muted || spokenRef.current.has(idx)) {
      setShowConfirmZone(true);
      return;
    }
    spokenRef.current.add(idx);
    setSpeaking(true);
    setShowConfirmZone(false);
    const text = CHAPTERS[idx].rogerSpeech(displayName);
    speakResponse(text)
      .catch(() => {
        try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* silent */ }
      })
      .finally(() => {
        setSpeaking(false);
        setShowConfirmZone(true); // show confirm zone after speech finishes
      });
  }, [muted, displayName]);

  useEffect(() => {
    speakChapter(chapter);
  }, [chapter, speakChapter]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const goNext = useCallback(() => {
    stopSpeaking();
    if (isLast) { handleComplete(); return; }
    setDirection(1);
    setChapter(c => c + 1);
    setShowConfirmZone(false);
  }, [isLast]); // eslint-disable-line react-hooks/exhaustive-deps

  const goPrev = useCallback(() => {
    if (chapter === 0) return;
    stopSpeaking();
    setDirection(-1);
    setChapter(c => c - 1);
    setShowConfirmZone(false);
    // Allow re-speaking if going back
    spokenRef.current.delete(chapter - 1);
  }, [chapter]);

  const handleSkip = () => {
    stopSpeaking();
    handleComplete();
  };

  const handleComplete = () => {
    setExiting(true);
    setTimeout(() => onComplete(), 500);
  };

  // ── Mute toggle ────────────────────────────────────────────────────────────
  const toggleMute = () => {
    if (!muted) stopSpeaking();
    setMuted(m => !m);
    if (muted) setShowConfirmZone(true); // reveal confirm zone immediately when muting
  };

  // ── Flash helper ──────────────────────────────────────────────────────────
  const flash = (msg: string) => {
    setFlashMsg(msg);
    setTimeout(() => setFlashMsg(null), 1800);
  };

  // ── PTT confirm via voice ─────────────────────────────────────────────────
  const handlePttDown = async () => {
    if (pttHeld || pttTranscribing) return;
    stopSpeaking();
    setPttHeld(true);
    try {
      const rec = createAudioRecorder();
      recorderRef.current = rec;
      await rec.start();
    } catch {
      setPttHeld(false);
    }
  };

  const handlePttUp = async () => {
    if (!pttHeld || !recorderRef.current) return;
    setPttHeld(false);
    setPttTranscribing(true);
    try {
      const blob = await recorderRef.current.stop();
      recorderRef.current = null;
      if (blob.size < 500) { setPttTranscribing(false); return; }

      const { transcript } = await transcribeAudio(blob, 'en');
      const lower = transcript.toLowerCase().trim();
      const confirmed = CONFIRM_KEYWORDS.some(kw => lower.includes(kw));

      if (confirmed) {
        flash('✓ Understood');
        setTimeout(() => goNext(), 600);
      } else {
        flash(`"${transcript.slice(0, 40)}" — say "understood" to continue`);
      }
    } catch {
      flash('Could not hear you. Try again or tap Continue.');
    } finally {
      setPttTranscribing(false);
    }
  };

  // ── Keyboard support (Prev only — advancement is PTT voice only) ──────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'Escape') handleSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goPrev]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: exiting ? 0 : 1 }}
      transition={{ duration: 0.4 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(8,10,9,0.97)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', overflowY: 'auto',
        padding: '80px 20px 40px',
      }}
    >
      {/* ── Ambient glow ── */}
      <div
        key={`glow-${chapter}`}
        style={{
          position: 'fixed', top: '38%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 500, height: 500, borderRadius: '50%',
          background: `radial-gradient(circle, ${current.iconColor}0c 0%, transparent 70%)`,
          pointerEvents: 'none', transition: 'background 600ms ease',
        }}
      />

      {/* ── Top bar ── */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 20px', zIndex: 2,
        background: 'rgba(8,10,9,0.85)', backdropFilter: 'blur(8px)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(212,160,68,0.5)', textTransform: 'uppercase', letterSpacing: '0.25em', flex: 1 }}>
          Roger AI · Orientation
        </span>
        <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(212,160,68,0.4)', letterSpacing: '0.1em' }}>
          {chapter + 1} / {total}
        </span>
        <button onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, color: muted ? 'rgba(212,160,68,0.3)' : 'rgba(212,160,68,0.65)', display: 'flex' }}>
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <button onClick={handleSkip} title="Skip orientation"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 10px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(107,106,94,0.5)' }}>
          Skip →
        </button>
      </div>

      {/* ── Chapter card ── */}
      <div style={{ width: '100%', maxWidth: 420, position: 'relative', zIndex: 1 }}>
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={chapter}
            custom={direction}
            initial={{ opacity: 0, x: direction * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -40 }}
            transition={{ duration: 0.28, ease: 'easeInOut' }}
          >
            {/* ── Hero icon ── */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
              <div style={{ position: 'relative' }}>
                <div style={{
                  width: 76, height: 76,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: '50%',
                  background: `${current.iconColor}10`,
                  border: `1px solid ${current.iconColor}30`,
                  boxShadow: speaking
                    ? `0 0 32px ${current.iconColor}45, 0 0 10px ${current.iconColor}20`
                    : `0 0 14px ${current.iconColor}18`,
                  transition: 'box-shadow 300ms ease',
                }}>
                  <Icon size={34} color={current.iconColor} />
                </div>
                {speaking && (
                  <motion.div
                    initial={{ opacity: 0.6, scale: 1 }}
                    animate={{ opacity: 0, scale: 1.6 }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
                    style={{
                      position: 'absolute', inset: -10, borderRadius: '50%',
                      border: `2px solid ${current.iconColor}50`, pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
            </div>

            {/* ── Card body ── */}
            <div style={{
              background: 'rgba(18,20,16,0.94)',
              border: `1px solid ${current.iconColor}1e`,
              padding: '22px 20px',
              marginBottom: 16,
            }}>
              {/* Chapter label */}
              <p style={{ fontFamily: 'monospace', fontSize: 9, margin: '0 0 5px', color: current.iconColor, textTransform: 'uppercase', letterSpacing: '0.25em', opacity: 0.7 }}>
                {current.chapterLabel}
              </p>
              {/* Headline */}
              <h2 style={{ fontFamily: 'monospace', fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 12px', letterSpacing: '0.05em', textTransform: 'uppercase', lineHeight: 1.3 }}>
                {current.headline}
              </h2>
              {/* Body text */}
              <p style={{ fontFamily: 'monospace', fontSize: 11.5, color: 'var(--text-secondary)', margin: '0 0 18px', lineHeight: 1.75 }}>
                {current.body}
              </p>

              {/* ── Example chips ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.18em', margin: '0 0 4px' }}>
                  Voice Examples
                </p>
                {current.keyExamples.map((ex, i) => (
                  <div key={i} style={{
                    padding: '7px 12px',
                    background: `${current.iconColor}08`,
                    border: `1px solid ${current.iconColor}22`,
                    fontFamily: 'monospace', fontSize: 11,
                    color: current.iconColor, fontStyle: 'italic',
                  }}>
                    {ex}
                  </div>
                ))}
              </div>

              {/* ── Pro tip ── */}
              {current.tip && (
                <div style={{ padding: '8px 12px', background: 'rgba(212,160,68,0.05)', border: '1px solid rgba(212,160,68,0.15)' }}>
                  <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(212,160,68,0.7)', margin: 0, lineHeight: 1.5 }}>
                    💡 {current.tip}
                  </p>
                </div>
              )}
            </div>

            {/* ── Confirm zone ── */}
            <AnimatePresence>
              {showConfirmZone && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.3 }}
                  style={{ marginBottom: 14 }}
                >
                  {/* PTT confirm button */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <button
                      onPointerDown={handlePttDown}
                      onPointerUp={handlePttUp}
                      style={{
                        flex: 1,
                        padding: '14px',
                        fontFamily: 'monospace', fontSize: 10,
                        textTransform: 'uppercase', letterSpacing: '0.15em',
                        cursor: 'pointer',
                        background: pttHeld
                          ? `${current.iconColor}20`
                          : pttTranscribing
                          ? 'rgba(212,160,68,0.08)'
                          : `${current.iconColor}08`,
                        border: `1px solid ${pttHeld ? current.iconColor : current.iconColor + '35'}`,
                        color: pttHeld ? current.iconColor : 'var(--text-muted)',
                        transition: 'all 150ms',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      }}
                    >
                      {pttTranscribing
                        ? <><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--amber)', animation: 'pulse 0.8s infinite' }} /> Listening...</>
                        : pttHeld
                        ? <><MicOff size={13} /> Release when done</>
                        : <><Mic size={13} /> Hold to say "understood"</>
                      }
                    </button>
                  </div>

                  {/* Flash message */}
                  <AnimatePresence>
                    {flashMsg && (
                      <motion.p
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--amber)', textAlign: 'center', margin: '0 0 8px', letterSpacing: '0.1em' }}
                      >
                        {flashMsg}
                      </motion.p>
                    )}
                  </AnimatePresence>

                  {/* Confirm prompt text */}
                  <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', margin: '0 0 10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    {current.confirmPrompt}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Nav row — Prev + progress dots only; Continue removed (PTT voice only) ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={goPrev}
                disabled={chapter === 0}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '11px 14px', fontFamily: 'monospace', fontSize: 10,
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  color: chapter === 0 ? 'rgba(107,106,94,0.2)' : 'var(--text-muted)',
                  cursor: chapter === 0 ? 'default' : 'pointer',
                  flexShrink: 0,
                }}
              >
                <ChevronLeft size={12} /> Prev
              </button>

              {/* Progress dots */}
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 5, flexWrap: 'wrap' }}>
                {CHAPTERS.map((ch, i) => (
                  <div
                    key={i}
                    style={{
                      width: i === chapter ? 18 : 5,
                      height: 5, borderRadius: 3,
                      background: i < chapter
                        ? 'rgba(74,222,128,0.5)'
                        : i === chapter
                        ? current.iconColor
                        : 'rgba(107,106,94,0.3)',
                      transition: 'all 300ms ease',
                      boxShadow: i === chapter ? `0 0 6px ${current.iconColor}50` : 'none',
                    }}
                  />
                ))}
              </div>

              {/* PTT voice hint badge */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '8px 12px',
                border: `1px solid ${current.iconColor}30`,
                background: `${current.iconColor}08`,
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 9, color: `${current.iconColor}90`, fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {isLast ? '● Engage via PTT' : '● PTT to advance'}
                </span>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Version watermark ── */}
      <div style={{
        position: 'fixed', bottom: 14, left: 0, right: 0, textAlign: 'center',
        fontFamily: 'monospace', fontSize: 8, color: 'rgba(107,106,94,0.22)',
        letterSpacing: '0.2em', textTransform: 'uppercase', pointerEvents: 'none',
      }}>
        Orientation v{ORIENTATION_VERSION} · Roger AI
      </div>
    </motion.div>
  );
}
