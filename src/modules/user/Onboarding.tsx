import { useState, useRef, useEffect, useCallback } from 'react';
import { Radio } from 'lucide-react';
import {
  generateNodeScript, applyOnboardingAnswer, parseReviewIntent,
  buildReviewScript, NEXT_NODE, TOTAL_NODES, NODE_INDEX, NODE_LABELS,
  type OnboardingNode, type OnboardingAnswers,
} from '../../lib/onboarding';
import { speakResponse, stopSpeaking } from '../../lib/tts';
import { transcribeAudio } from '../../lib/whisper';
import { createAudioRecorder } from '../../lib/audioRecorder';
import {
  upsertUserPreferences, upsertMemoryFact, upsertEntityMention,
  updateOnboardingStep,
} from '../../lib/api';
import { hapticPTTDown, hapticPTTUp, hapticTick, hapticSuccess, hapticError } from '../../lib/haptics';
import { preloadAll, sfxPTTDown, sfxPTTUp, sfxRogerIn, sfxRogerOut, sfxError } from '../../lib/sfx';

interface Props {
  userId: string;
  onComplete: (answers: OnboardingAnswers) => void;
}

type Phase = 'speaking' | 'waiting' | 'recording' | 'processing' | 'done';

export default function Onboarding({ userId, onComplete }: Props) {
  const [node, setNode]           = useState<OnboardingNode>('welcome');
  const [answers, setAnswers]     = useState<OnboardingAnswers>({});
  const [script, setScript]       = useState('');
  const [phase, setPhase]         = useState<Phase>('speaking');
  const [holdMs, setHoldMs]       = useState(0);
  const [typeText, setTypeText]   = useState('');
  const [returnToReview, setReturnToReview] = useState(false);

  const recorderRef = useRef<Awaited<ReturnType<typeof createAudioRecorder>> | null>(null);
  const holdRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const typeRef     = useRef<ReturnType<typeof setInterval> | null>(null);

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
    try {
      await speakResponse(text);
    } catch {
      try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* silent */ }
    }
    sfxRogerOut();
    setPhase('waiting');
  }, [typewrite]);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    generateNodeScript('welcome', {}).then(({ script: s }) => speakNode(s));
    preloadAll();
    return () => {
      stopSpeaking();
      if (typeRef.current) clearInterval(typeRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Advance node ──────────────────────────────────────────────────────────
  const advanceNode = useCallback(async (
    currentNode: OnboardingNode,
    transcript: string,
    currentAnswers: OnboardingAnswers,
    isReturningToReview: boolean
  ) => {
    // ── Special: review_confirm ───────────────────────────────────────────
    if (currentNode === 'review_confirm') {
      const intent = parseReviewIntent(transcript);
      if (intent !== 'confirm') {
        // Re-edit a specific field — go back to that node
        setReturnToReview(true);
        setNode(intent);
        const { script: s } = await generateNodeScript(intent, currentAnswers);
        await speakNode(s);
        return;
      }
      // Confirmed → complete
      hapticSuccess();
      await persistOnboardingMemory(userId, currentAnswers);
      const { script: cs } = await generateNodeScript('complete', currentAnswers);
      setNode('complete');
      await speakNode(cs);
      setPhase('done');
      await upsertUserPreferences(userId, {
        onboarding_complete: true,
        onboarding_step: TOTAL_NODES,
        response_style: currentAnswers.comm_style ?? 'balanced',
        display_name: currentAnswers.name,
      } as Parameters<typeof upsertUserPreferences>[1]).catch(() => {});
      setTimeout(() => onComplete(currentAnswers), 1800);
      return;
    }

    // ── Apply answer ──────────────────────────────────────────────────────
    const updatedAnswers = applyOnboardingAnswer(currentNode, transcript, currentAnswers);
    setAnswers(updatedAnswers);

    // After re-editing a field, go back to review
    const next: OnboardingNode = isReturningToReview ? 'review_confirm' : NEXT_NODE[currentNode];
    if (isReturningToReview) setReturnToReview(false);

    updateOnboardingStep(userId, NODE_INDEX(next), updatedAnswers.name).catch(() => {});

    hapticTick();
    setNode(next);
    const { script: nextScript } = await generateNodeScript(next, updatedAnswers, transcript);
    await speakNode(nextScript);
  }, [userId, speakNode, onComplete]);

  // ── PTT Down ──────────────────────────────────────────────────────────────
  const handleDown = useCallback(async () => {
    if (phase !== 'waiting') return;
    stopSpeaking();
    hapticPTTDown();
    sfxPTTDown();
    setPhase('recording');
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
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) { setPhase('waiting'); return; }
    setPhase('processing');
    try {
      const blob = await recorder.stop();
      recorder.dispose();
      const { transcript } = await transcribeAudio(blob);
      if (!transcript || transcript.replace(/[^a-zA-Z\u0600-\u06FF]/g, '').length < 2) {
        hapticError(); sfxError(); setPhase('waiting'); return;
      }
      await advanceNode(node, transcript, answers, returnToReview);
    } catch {
      hapticError(); sfxError(); setPhase('waiting');
    }
  }, [phase, node, answers, returnToReview, advanceNode]);

  // ── Skip ──────────────────────────────────────────────────────────────────
  const handleSkip = useCallback(async () => {
    if (phase !== 'waiting' && phase !== 'speaking') return;
    stopSpeaking();
    await advanceNode(node, '', answers, returnToReview);
  }, [phase, node, answers, returnToReview, advanceNode]);

  // ── UI helpers ────────────────────────────────────────────────────────────
  const isAnswerable = node !== 'welcome' && node !== 'complete';
  const isReview     = node === 'review_confirm';
  const currentStep  = Math.max(0, NODE_INDEX(node) - 1);
  const progressPct  = node === 'complete' ? 100 : isReview ? 100 : Math.max(5, (currentStep / TOTAL_NODES) * 100);

  const btnColor = phase === 'recording'  ? '#d4a044'
    : phase === 'processing' ? '#a78bfa'
    : phase === 'speaking'   ? 'rgba(212,160,68,0.3)'
    : 'var(--amber)';

  const stateLabel = phase === 'recording'  ? `● REC ${(holdMs / 1000).toFixed(1)}s`
    : phase === 'processing' ? 'Understanding...'
    : phase === 'speaking'   ? 'Roger speaking...'
    : phase === 'done'       ? 'Initializing...'
    : isReview               ? 'Say "confirm" or "change my [field]"'
    : 'Hold to answer';

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
            ROGER AI
          </p>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', margin: '2px 0 0' }}>
            {returnToReview ? `Editing ${NODE_LABELS[node] ?? node}` : 'Initializing your profile'}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {isAnswerable && !isReview && (
        <div style={{ width: '100%', maxWidth: 360, marginBottom: 20, zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {NODE_LABELS[node] ?? 'Profile setup'}
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)' }}>
              {currentStep}/{TOTAL_NODES}
            </span>
          </div>
          <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1 }}>
            <div style={{ height: '100%', width: `${progressPct}%`, background: 'var(--amber)', borderRadius: 1, transition: 'width 600ms ease' }} />
          </div>
        </div>
      )}

      {/* Review summary card */}
      {isReview && (
        <div style={{
          width: '100%', maxWidth: 360, marginBottom: 20, zIndex: 1,
          border: '1px solid rgba(212,160,68,0.3)', background: 'rgba(212,160,68,0.04)',
          padding: '14px 18px',
        }}>
          <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.2em', margin: '0 0 10px' }}>
            ◈ Profile Summary — Review
          </p>
          {[
            { label: 'NAME',       value: answers.name },
            { label: 'ROLE',       value: answers.role },
            { label: 'PRIORITIES', value: answers.key_priorities?.join(', ') },
            { label: 'FOCUS',      value: answers.current_focus },
            { label: 'SCHEDULE',   value: answers.work_schedule },
            { label: 'LOCATION',   value: answers.location_base },
            { label: 'STYLE',      value: answers.comm_style },
            { label: 'TOOLS',      value: answers.tools_used?.join(', ') },
            { label: 'INTERESTS',  value: answers.interests?.join(', ') },
            { label: 'FEATURES',   value: answers.feature_prefs?.join(', ') },
          ].filter(r => r.value).map(row => (
            <div key={row.label} style={{ display: 'flex', gap: 10, marginBottom: 5, alignItems: 'flex-start' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.12em', minWidth: 72, opacity: 0.6, paddingTop: 1 }}>
                {row.label}
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                {row.value}
              </span>
            </div>
          ))}
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
        <span style={{ fontFamily: 'monospace', fontSize: 9, color: btnColor, textTransform: 'uppercase', letterSpacing: '0.2em', transition: 'color 200ms', textAlign: 'center' }}>
          {stateLabel}
        </span>
        <button
          onPointerDown={handleDown}
          onPointerUp={handleUp}
          onPointerLeave={handleUp}
          disabled={phase === 'speaking' || phase === 'processing' || phase === 'done'}
          aria-label="Hold to answer"
          style={{
            width: 96, height: 96, borderRadius: '50%',
            border: `3px solid ${btnColor}`,
            background: phase === 'recording' ? 'rgba(212,160,68,0.12)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: phase === 'waiting' ? 'pointer' : 'default',
            transition: 'all 200ms',
            boxShadow: phase === 'recording' ? '0 0 32px rgba(212,160,68,0.3)' : 'none',
            opacity: (phase === 'speaking' || phase === 'processing' || phase === 'done') ? 0.35 : 1,
          }}
        >
          <Radio size={34} style={{ color: btnColor, transition: 'color 200ms' }} />
        </button>

        {/* Skip */}
        {(phase === 'waiting' || phase === 'speaking') && node !== 'complete' && node !== 'welcome' && !isReview && (
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
      `}</style>
    </div>
  );
}

// ─── Persist to memory_graph ───────────────────────────────────────────────────
async function persistOnboardingMemory(userId: string, answers: OnboardingAnswers) {
  const writes: Promise<unknown>[] = [];

  if (answers.name) writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'person', subject: 'user', predicate: 'name is', object: answers.name, confidence: 100, is_confirmed: true, source_tx: 'onboarding' }));
  if (answers.role) writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'preference', subject: 'user', predicate: 'role is', object: answers.role, confidence: 95, is_confirmed: true, source_tx: 'onboarding' }));
  if (answers.current_focus) writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'goal', subject: 'user', predicate: 'current focus is', object: answers.current_focus, confidence: 95, is_confirmed: true, source_tx: 'onboarding' }));
  if (answers.location_base) writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'preference', subject: 'user', predicate: 'location is', object: answers.location_base, confidence: 95, is_confirmed: true, source_tx: 'onboarding' }));
  if (answers.comm_style) writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'preference', subject: 'user', predicate: 'comm style is', object: answers.comm_style, confidence: 95, is_confirmed: true, source_tx: 'onboarding' }));

  if (answers.key_priorities?.length) {
    for (const p of answers.key_priorities) {
      writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'goal', subject: 'user', predicate: 'priority is', object: p, confidence: 90, is_confirmed: true, source_tx: 'onboarding' }));
    }
  }

  if (answers.tools_used?.length) {
    for (const t of answers.tools_used) {
      writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'preference', subject: 'user', predicate: 'uses tool', object: t, confidence: 90, is_confirmed: true, source_tx: 'onboarding' }));
      writes.push(upsertEntityMention(userId, t, 'TOOL'));
    }
  }

  if (answers.interests?.length) {
    for (const i of answers.interests) {
      writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'preference', subject: 'user', predicate: 'interested in', object: i, confidence: 90, is_confirmed: true, source_tx: 'onboarding' }));
    }
  }

  if (answers.feature_prefs?.length) {
    for (const f of answers.feature_prefs) {
      writes.push(upsertMemoryFact({ user_id: userId, fact_type: 'preference', subject: 'user', predicate: 'wants feature', object: f, confidence: 95, is_confirmed: true, source_tx: 'onboarding' }));
    }
  }

  await Promise.allSettled(writes);
}
