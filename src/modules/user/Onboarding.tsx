import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Radio } from 'lucide-react';
import { useI18n } from '../../context/I18nContext';
import {
  generateNameConfirm, generateAddInfoTurn,
  generateIslamicTurn, buildReviewScript, parseReviewIntentAI,
  mergeExtractedFields, silentExtractFields,
  getWelcomeScript, PHASE_LABELS, MAX_TOTAL_TURNS,
  type OnboardingPhase, type OnboardingAnswers,
} from '../../lib/onboarding';
import { speakResponse, stopSpeaking, unlockAudio } from '../../lib/tts';
import { transcribeAudio } from '../../lib/whisper';
import { createAudioRecorder } from '../../lib/audioRecorder';
import {
  upsertUserPreferences, upsertMemoryFact, upsertEntityMention,
} from '../../lib/api';
import { hapticPTTDown, hapticPTTUp, hapticTick, hapticSuccess, hapticError } from '../../lib/haptics';
import { preloadAll, sfxPTTDown, sfxPTTUp, sfxRogerIn, sfxRogerOut, sfxError } from '../../lib/sfx';

// ── Shared pill styles for the review card ────────────────────────────────────
const chipStyle: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 9,
  padding: '3px 8px', borderRadius: 2,
  border: '1px solid rgba(212,160,68,0.25)',
  color: 'rgba(212,160,68,0.8)',
  background: 'rgba(212,160,68,0.05)',
  whiteSpace: 'nowrap',
  letterSpacing: '0.04em',
};
const tagStyle: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 9,
  padding: '2px 7px', borderRadius: 2,
  border: '1px solid rgba(167,139,250,0.25)',
  color: '#c4b5fd',
  background: 'rgba(167,139,250,0.05)',
  letterSpacing: '0.04em',
};

interface Props {
  userId: string;
  onComplete: (answers: OnboardingAnswers) => void;
}

type PttPhase = 'speaking' | 'waiting' | 'recording' | 'processing' | 'done';

export default function Onboarding({ userId, onComplete }: Props) {
  const { t } = useI18n();
  const [flowPhase, setFlowPhase] = useState<OnboardingPhase>('welcome');
  const [totalTurns, setTotalTurns] = useState(1);
  const [answers, setAnswers]     = useState<OnboardingAnswers>({});
  const [script, setScript]       = useState('');
  const [phase, setPhase]         = useState<PttPhase>('speaking');
  const [holdMs, setHoldMs]       = useState(0);
  const [typeText, setTypeText]   = useState('');
  const [addingInfo, setAddingInfo] = useState(false);

  const recorderRef  = useRef<Awaited<ReturnType<typeof createAudioRecorder>> | null>(null);
  const holdRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const typeRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const pttStartRef  = useRef<number>(0);

  // ── Typewriter ────────────────────────────────────────────────────────────
  const typewrite = useCallback((text: string) => {
    setTypeText('');
    let i = 0;
    if (typeRef.current) clearInterval(typeRef.current);
    typeRef.current = setInterval(() => {
      setTypeText(text.slice(0, i + 1));
      i++;
      if (i >= text.length && typeRef.current) clearInterval(typeRef.current);
    }, 28);
  }, []);

  // ── Speak ─────────────────────────────────────────────────────────────────
  const speakNode = useCallback(async (text: string) => {
    setPhase('speaking');
    setScript(text);
    typewrite(text);
    sfxRogerIn();
    try { await speakResponse(text); } catch (e) { console.warn('[Onboarding TTS]', e); }
    sfxRogerOut();
    setPhase('waiting');
  }, [typewrite]);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    speakNode(getWelcomeScript());
    preloadAll();
    return () => { stopSpeaking(); if (typeRef.current) clearInterval(typeRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Complete onboarding ───────────────────────────────────────────────────
  const finishOnboarding = useCallback(async (finalAnswers: OnboardingAnswers) => {
    hapticSuccess();
    await persistOnboardingMemory(userId, finalAnswers);
    setFlowPhase('complete');
    const doneScript = `Profile locked, ${finalAnswers.name ?? 'Commander'}. Roger standing by. Over.`;
    await speakNode(doneScript);
    setPhase('done');
    await upsertUserPreferences(userId, {
      onboarding_complete: true,
      onboarding_step: MAX_TOTAL_TURNS,
      response_style: finalAnswers.comm_style ?? 'balanced',
      display_name: finalAnswers.name,
      ...(finalAnswers.islamic_mode !== undefined && { islamic_mode: finalAnswers.islamic_mode }),
    } as Parameters<typeof upsertUserPreferences>[1]).catch(() => {});
    setTimeout(() => onComplete(finalAnswers), 1800);
  }, [userId, speakNode, onComplete]);

  // ── Advance turn (phase-aware router) ─────────────────────────────────────
  const advanceTurn = useCallback(async (transcript: string, currentAnswers: OnboardingAnswers) => {
    const t = totalTurns + 1;
    setTotalTurns(t);
    hapticTick();

    // ── WELCOME → extract name + fields, then move to name_confirm or islamic
    if (flowPhase === 'welcome') {
      const extracted = await silentExtractFields(transcript, currentAnswers);
      const merged = mergeExtractedFields(currentAnswers, extracted);
      setAnswers(merged);
      console.log('[Onboarding] Welcome response extracted:', JSON.stringify(extracted));

      // Name found → confirm spelling
      if (merged.name) {
        setFlowPhase('name_confirm');
        const nc = await generateNameConfirm(merged.name);
        await speakNode(nc.script);
        return;
      }

      // Name NOT found → ask directly
      const nameScript = 'Copy. Before we go further — what should I call you?';
      await speakNode(nameScript);
      return;
    }

    // ── NAME CONFIRM → then straight to islamic ──────────────────────────
    if (flowPhase === 'name_confirm') {
      const nc = await generateNameConfirm(currentAnswers.name ?? '', transcript);
      const merged = { ...currentAnswers };
      if (nc.extracted_value && nc.extracted_value.toLowerCase() !== 'yes') {
        merged.name = nc.extracted_value;
      }
      setAnswers(merged);
      // Move directly to Islamic mode
      setFlowPhase('islamic');
      const it = await generateIslamicTurn();
      await speakNode(it.script);
      return;
    }

    // ── ISLAMIC MODE ─────────────────────────────────────────────────────
    if (flowPhase === 'islamic') {
      const it = await generateIslamicTurn(transcript);
      const isYes = it.extracted_value?.toLowerCase() === 'yes';
      const merged = { ...currentAnswers, islamic_mode: isYes };
      setAnswers(merged);
      // Move to review
      setFlowPhase('review');
      const reviewScript = await buildReviewScript(merged);
      await speakNode(reviewScript);
      return;
    }

    // ── REVIEW (with “add key info” support) ─────────────────────────────────
    if (flowPhase === 'review') {
      if (addingInfo) {
        const result = await generateAddInfoTurn(currentAnswers, transcript);
        const merged = mergeExtractedFields(currentAnswers, result.extracted_fields);
        setAnswers(merged);
        setAddingInfo(false);
        const reviewScript = await buildReviewScript(merged);
        await speakNode(reviewScript);
        return;
      }
      const intent = await parseReviewIntentAI(transcript, userId);
      if (intent === 'confirm') {
        await finishOnboarding(currentAnswers);
        return;
      }
      // User said something that’s not confirm — treat as additional info
      const result = await generateAddInfoTurn(currentAnswers, transcript);
      const merged = mergeExtractedFields(currentAnswers, result.extracted_fields);
      setAnswers(merged);
      const reviewScript = await buildReviewScript(merged);
      await speakNode(reviewScript);
      return;
    }
  }, [flowPhase, totalTurns, userId, addingInfo, speakNode, finishOnboarding]);

  // ── PTT Down ──────────────────────────────────────────────────────────────
  const handleDown = useCallback(async (e: React.PointerEvent) => {
    if (phase !== 'waiting') return;

    // Capture the pointer so pointerleave doesn't fire while holding on desktop
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }

    stopSpeaking();

    // Keep AudioContext alive on PC browsers
    unlockAudio().catch(() => {});

    hapticPTTDown();
    sfxPTTDown();
    setPhase('recording');
    pttStartRef.current = Date.now();
    setHoldMs(0);
    holdRef.current = setInterval(() => setHoldMs(h => h + 100), 100);
    const recorder = await createAudioRecorder();
    recorderRef.current = recorder;
    await recorder.start();
  }, [phase]);

  // ── PTT Up ────────────────────────────────────────────────────────────────
  const handleUp = useCallback(async () => {
    if (phase !== 'recording') return;
    if (holdRef.current) clearInterval(holdRef.current);
    hapticPTTUp();
    sfxPTTUp();

    // Use timestamp ref for hold duration — immune to React stale-closure issues
    const elapsed = Date.now() - pttStartRef.current;
    console.log('[Onboarding PTT] Hold duration:', elapsed, 'ms');

    // Minimum hold time — too-brief presses don't capture usable audio
    if (elapsed < 400) {
      console.warn('[Onboarding PTT] Too brief:', elapsed, 'ms');
      hapticError(); sfxError();
      recorderRef.current?.dispose();
      recorderRef.current = null;
      setPhase('waiting');
      return;
    }

    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) { setPhase('waiting'); return; }
    setPhase('processing');
    try {
      const blob = await recorder.stop();
      recorder.dispose();
      console.log('[Onboarding PTT] Blob size:', blob.size, 'type:', blob.type);
      if (blob.size < 100) {
        console.warn('[Onboarding PTT] Blob too small, skipping transcription');
        hapticError(); sfxError(); setPhase('waiting'); return;
      }
      const { transcript } = await transcribeAudio(blob);
      console.log('[Onboarding PTT] Transcript:', transcript);
      if (!transcript || transcript.replace(/[^a-zA-Z\u0600-\u06FF]/g, '').length < 2) {
        hapticError(); sfxError(); setPhase('waiting'); return;
      }
      await advanceTurn(transcript, answers);
    } catch (err) {
      console.error('[Onboarding PTT] Error:', err);
      hapticError(); sfxError(); setPhase('waiting');
    }
  }, [phase, answers, advanceTurn]);

  // ── Skip ──────────────────────────────────────────────────────────────────
  const handleSkip = useCallback(async () => {
    if (phase !== 'waiting' && phase !== 'speaking') return;
    stopSpeaking();
    await advanceTurn('', answers);
  }, [phase, answers, advanceTurn]);

  // ── UI helpers ────────────────────────────────────────────────────────────
  const isAnswerable = flowPhase !== 'welcome' && flowPhase !== 'complete';
  const isReview     = flowPhase === 'review';
  const progressPct  = flowPhase === 'complete' ? 100
    : flowPhase === 'review' ? 100
    : flowPhase === 'islamic' ? 75
    : flowPhase === 'name_confirm' ? 50
    : 25;

  const btnColor = phase === 'recording'  ? '#d4a044'
    : phase === 'processing' ? '#a78bfa'
    : phase === 'speaking'   ? 'rgba(212,160,68,0.3)'
    : 'var(--amber)';

  const stateLabel = phase === 'recording'  ? `● REC ${(holdMs / 1000).toFixed(1)}s`
    : phase === 'processing' ? 'Understanding...'
    : phase === 'speaking'   ? 'Roger speaking...'
    : phase === 'done'       ? 'Initializing...'
    : isReview               ? (addingInfo ? 'Hold to add info about yourself' : 'Say "confirm" or tap Add Key Info')
    : 'Hold to speak';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#0d0d0a', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '24px',
      overflowY: 'auto',
    }}>

      {/* Ambient glow */}
      <div style={{
        position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 300, height: 300, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(212,160,68,0.08) 0%, transparent 70%)',
        animation: 'pulse 3s ease-in-out infinite', pointerEvents: 'none',
      }} />

      {/* Mascot + title */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24, gap: 10, zIndex: 1 }}>
        <div style={{ position: 'relative' }}>
          <img src="/mascot.png" alt="Roger AI" style={{ width: 64, height: 64, objectFit: 'contain', mixBlendMode: 'screen', filter: 'drop-shadow(0 0 16px rgba(212,160,68,0.4))' }} />
          {phase === 'speaking' && (
            <div style={{ position: 'absolute', inset: -8, borderRadius: '50%', border: '2px solid rgba(212,160,68,0.4)', animation: 'ping 1.5s ease-in-out infinite' }} />
          )}
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.25em', margin: 0 }}>
            {t('app.name')}
          </p>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', margin: '2px 0 0' }}>
            {PHASE_LABELS[flowPhase] ?? 'Initializing your profile'}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {isAnswerable && !isReview && (
        <div style={{ width: '100%', maxWidth: 360, marginBottom: 20, zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {PHASE_LABELS[flowPhase] ?? 'Profile setup'}
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)' }}>
              {totalTurns}/{MAX_TOTAL_TURNS}
            </span>
          </div>
          <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1 }}>
            <div style={{ height: '100%', width: `${progressPct}%`, background: 'var(--amber)', borderRadius: 1, transition: 'width 600ms ease' }} />
          </div>
        </div>
      )}

      {/* ── Review card — premium persona layout ── */}
      {isReview && (
        <div style={{
          width: '100%', maxWidth: 360, marginBottom: 16, zIndex: 1,
          border: '1px solid rgba(212,160,68,0.25)',
          background: 'rgba(10,10,8,0.9)',
          overflow: 'hidden',
        }}>
          {/* Header strip */}
          <div style={{
            padding: '10px 16px',
            background: 'rgba(212,160,68,0.06)',
            borderBottom: '1px solid rgba(212,160,68,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
              ◈ Roger's Read — Confirm Profile
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'rgba(212,160,68,0.4)', letterSpacing: '0.1em' }}>
              REVIEW
            </span>
          </div>

          {/* Identity block */}
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Avatar circle */}
              <div style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                background: 'rgba(212,160,68,0.1)',
                border: '1px solid rgba(212,160,68,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'monospace', fontSize: 14, color: 'var(--amber)', fontWeight: 700,
              }}>
                {(answers.name ?? '?')[0].toUpperCase()}
              </div>
              <div>
                <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.05em' }}>
                  {answers.name ?? '—'}
                </p>
                {answers.role && (
                  <p style={{ margin: '2px 0 0', fontFamily: 'monospace', fontSize: 10, color: 'rgba(212,160,68,0.7)', textTransform: 'capitalize' }}>
                    {answers.role}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Context chips row */}
          <div style={{ padding: '10px 16px', display: 'flex', flexWrap: 'wrap', gap: 6, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            {answers.location_base && (
              <span style={chipStyle}>📍 {answers.location_base}</span>
            )}
            {answers.work_schedule && (
              <span style={chipStyle}>🕘 {answers.work_schedule}</span>
            )}
            {answers.comm_style && (
              <span style={chipStyle}>💬 {answers.comm_style}</span>
            )}
            {answers.tools_used?.map(t => (
              <span key={t} style={chipStyle}>⚙️ {t}</span>
            ))}
            {answers.key_priorities?.map(p => (
              <span key={p} style={{ ...chipStyle, borderColor: 'rgba(96,165,250,0.3)', color: '#93c5fd' }}>▸ {p}</span>
            ))}
            {answers.islamic_mode && (
              <span style={{ ...chipStyle, borderColor: 'rgba(16,185,129,0.4)', color: '#34d399', background: 'rgba(16,185,129,0.06)' }}>☽ Islamic Mode</span>
            )}
          </div>

          {/* Interests + features */}
          {(answers.interests?.length || answers.feature_prefs?.length) && (
            <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              {answers.interests?.length ? (
                <div style={{ marginBottom: answers.feature_prefs?.length ? 8 : 0 }}>
                  <p style={{ margin: '0 0 5px', fontFamily: 'monospace', fontSize: 8, color: 'rgba(107,106,94,0.7)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                    Interests
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {answers.interests.map(i => (
                      <span key={i} style={{ ...tagStyle, borderColor: 'rgba(167,139,250,0.3)', color: '#c4b5fd' }}>{i}</span>
                    ))}
                  </div>
                </div>
              ) : null}
              {answers.feature_prefs?.length ? (
                <div>
                  <p style={{ margin: '0 0 5px', fontFamily: 'monospace', fontSize: 8, color: 'rgba(107,106,94,0.7)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                    Active Modules
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {answers.feature_prefs.map(f => (
                      <span key={f} style={{ ...tagStyle, borderColor: 'rgba(52,211,153,0.3)', color: '#6ee7b7' }}>{f}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Add key info button */}
          <div style={{ padding: '8px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => { setAddingInfo(true); setPhase('waiting'); stopSpeaking(); }}
              disabled={phase === 'processing' || addingInfo}
              style={{
                flex: 1, padding: '8px 12px',
                background: addingInfo ? 'rgba(212,160,68,0.1)' : 'transparent',
                border: '1px solid rgba(212,160,68,0.25)',
                cursor: 'pointer', fontFamily: 'monospace', fontSize: 10,
                color: addingInfo ? 'var(--amber)' : 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.1em',
                transition: 'all 200ms',
              }}
            >
              {addingInfo ? '▸ SPEAK NOW — ADD KEY INFO' : '＋ ADD KEY INFO'}
            </button>
            <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 8, color: 'rgba(107,106,94,0.5)', letterSpacing: '0.1em' }}>
              OR SAY "CONFIRM"
            </p>
          </div>
        </div>
      )}

      {/* Script card */}
      <div style={{
        width: '100%', maxWidth: 360, marginBottom: 28, zIndex: 1,
        padding: '16px 20px', border: '1px solid rgba(212,160,68,0.18)',
        background: 'rgba(212,160,68,0.03)', minHeight: 72,
        display: 'flex', alignItems: 'center',
      }}>
        <p style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)', margin: 0, lineHeight: 1.65 }}>
          {typeText || script}
          {phase === 'speaking' && <span style={{ animation: 'blink 1s infinite', color: 'var(--amber)' }}>▌</span>}
        </p>
      </div>

      {/* PTT */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, zIndex: 1 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: btnColor, textTransform: 'uppercase', letterSpacing: '0.25em', transition: 'color 200ms', textAlign: 'center', minHeight: 14 }}>
          {stateLabel}
        </span>

        {/* Sonar rings + button */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 165, height: 165 }}>
          {/* Sonar rings during recording */}
          {phase === 'recording' && (
            <>
              <div style={{ position: 'absolute', width: 165, height: 165, borderRadius: '50%', border: `1.5px solid ${btnColor}`, opacity: 0, animation: 'sonar 1.6s ease-out infinite' }} />
              <div style={{ position: 'absolute', width: 165, height: 165, borderRadius: '50%', border: `1.5px solid ${btnColor}`, opacity: 0, animation: 'sonar 1.6s ease-out 0.5s infinite' }} />
              <div style={{ position: 'absolute', width: 165, height: 165, borderRadius: '50%', border: `1.5px solid ${btnColor}`, opacity: 0, animation: 'sonar 1.6s ease-out 1.0s infinite' }} />
            </>
          )}
          {/* Speaking pulse */}
          {phase === 'speaking' && (
            <div style={{ position: 'absolute', width: 148, height: 148, borderRadius: '50%', background: `${btnColor}18`, animation: 'pulse 1.2s ease-in-out infinite' }} />
          )}
          <button
            onPointerDown={handleDown}
            onPointerUp={handleUp}
            onPointerLeave={handleUp}
            onPointerCancel={handleUp}
            onContextMenu={e => e.preventDefault()}
            disabled={phase === 'speaking' || phase === 'processing' || phase === 'done'}
            aria-label="Hold to answer"
            style={{
              width: 120, height: 120, borderRadius: '50%',
              border: `2.5px solid ${btnColor}`,
              background: phase === 'recording'
                ? `radial-gradient(circle, ${btnColor}30 0%, ${btnColor}10 100%)`
                : phase === 'speaking' ? `${btnColor}14`
                : 'rgba(255,255,255,0.04)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: phase === 'waiting' ? 'pointer' : 'default',
              transition: 'border-color 250ms, background 250ms',
              boxShadow: phase === 'recording'
                ? `0 0 48px ${btnColor}66, 0 0 16px ${btnColor}33, inset 0 0 20px ${btnColor}1a`
                : phase === 'speaking' ? `0 0 28px ${btnColor}44`
                : `0 0 20px ${btnColor}18`,
              opacity: (phase === 'speaking' || phase === 'processing' || phase === 'done') ? 0.35 : 1,
              userSelect: 'none',
              WebkitUserSelect: 'none',
              touchAction: 'none',
            }}
          >
            <Radio size={38} style={{ color: btnColor, transition: 'color 250ms' }} />
          </button>
        </div>

        {/* Skip */}
        {(phase === 'waiting' || phase === 'speaking') && flowPhase !== 'complete' && flowPhase !== 'welcome' && !isReview && (
          <button onClick={handleSkip} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.1em', padding: '4px 12px',
          }}>
            Skip this question →
          </button>
        )}
      </div>

      <style>{`
        @keyframes ping { 0%,100% { transform:scale(1); opacity:.4; } 50% { transform:scale(1.2); opacity:.8; } }
        @keyframes pulse { 0%,100% { opacity:.5; } 50% { opacity:1; } }
        @keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0; } }
        @keyframes sonar { 0% { transform:scale(0.7); opacity:0.8; } 100% { transform:scale(1.6); opacity:0; } }
      `}</style>
    </div>
  );
}

// ─── Persist to memory_graph ───────────────────────────────────────────────────
async function persistOnboardingMemory(userId: string, answers: OnboardingAnswers) {
  const writes: Promise<unknown>[] = [];

  if (answers.name) writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'person', subject: 'user', predicate: 'name is', object: answers.name, confidence: 100, is_confirmed: true, is_draft: false, source_tx: 'onboarding' }));
  if (answers.role) writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'preference', subject: 'user', predicate: 'role is', object: answers.role, confidence: 95, is_confirmed: true, is_draft: false, source_tx: 'onboarding' }));
  if (answers.current_focus) writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'goal', subject: 'user', predicate: 'current focus is', object: answers.current_focus, confidence: 95, is_confirmed: true, is_draft: false, source_tx: 'onboarding' }));
  if (answers.location_base) writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'preference', subject: 'user', predicate: 'location is', object: answers.location_base, confidence: 95, is_confirmed: true, is_draft: false, source_tx: 'onboarding' }));
  if (answers.comm_style) writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'preference', subject: 'user', predicate: 'comm style is', object: answers.comm_style, confidence: 95, is_confirmed: true, is_draft: false, source_tx: 'onboarding' }));

  if (answers.key_priorities?.length) {
    for (const p of answers.key_priorities) {
      writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'goal', subject: 'user', predicate: 'priority is', object: p, confidence: 90, is_confirmed: true, is_draft: false, source_tx: 'onboarding' }));
    }
  }

  if (answers.tools_used?.length) {
    for (const t of answers.tools_used) {
      writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'preference', subject: 'user', predicate: 'uses tool', object: t, confidence: 90, is_confirmed: true, is_draft: false, source_tx: 'onboarding' }));
      writes.push(upsertEntityMention(userId, t, 'TOOL'));
    }
  }

  if (answers.interests?.length) {
    for (const i of answers.interests) {
      writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'preference', subject: 'user', predicate: 'interested in', object: i, confidence: 90, is_confirmed: true, is_draft: false, source_tx: 'onboarding' }));
    }
  }

  if (answers.feature_prefs?.length) {
    for (const f of answers.feature_prefs) {
      writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'preference', subject: 'user', predicate: 'wants feature', object: f, confidence: 95, is_confirmed: true, is_draft: false, source_tx: 'onboarding' }));
    }
  }

  await Promise.allSettled(writes);
}
