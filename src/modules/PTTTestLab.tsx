import { useState, useEffect, useRef, useCallback } from 'react';
import { insertTransmission, insertConversationTurn } from '../lib/api';
import { processTransmission, extractMemoryFacts } from '../lib/openai';
import { speakResponse, stopSpeaking } from '../lib/tts';
import type { RogerAIResponse, ConversationTurn } from '../lib/openai';
import {
  Mic, MicOff, Radio, CheckCircle2, XCircle,
  RotateCcw, Activity, Cpu, Database, Zap, ChevronRight,
  Volume2, Clock, Signal, FlaskConical, Send, Trash2, Sparkles,
  VolumeX, Bluetooth, Brain,
} from 'lucide-react';

// Admin test user ID — same as UserApp so memory is shared
const LAB_USER_ID = 'ADMIN-TEST';
import { attachPttHardware, isNative } from '../lib/pttHardware';

import { createAudioRecorder, MEDIA_RECORDER_SUPPORTED, type AudioRecorder } from '../lib/audioRecorder';
import { transcribeAudio } from '../lib/whisper';
import { enqueueRecording, getQueueCount, getPendingRecordings } from '../lib/offlineQueue';
import { startNetworkMonitor, type NetworkStatus, type ProcessedItem } from '../lib/networkMonitor';

// Voice support is now via MediaRecorder (replaces SpeechRecognition)
const VOICE_SUPPORTED = MEDIA_RECORDER_SUPPORTED;


// ─── Types ───────────────────────────────────────────────────────────────────

type PipelineStepStatus = 'idle' | 'running' | 'complete' | 'error' | 'skipped';
type TxOutcome = 'success' | 'clarification' | 'error' | null;
type PTTState = 'idle' | 'recording' | 'transcribing' | 'processing' | 'speaking' | 'responded' | 'awaiting_answer';

interface PipelineStep {
  id: string; label: string; sublabel: string; ms: number;
  status: PipelineStepStatus; detail?: string;
}

interface Message {
  id: string; role: 'user' | 'roger'; text: string;
  type?: 'transcription' | 'response' | 'clarification' | 'error';
  ts: number; txId?: string; intent?: string; confidence?: number;
  ambiguity?: number; outcome?: TxOutcome; reasoning?: string;
  entities?: { text: string; type: string; confidence: number }[];
  liveAI?: boolean; voiceInput?: boolean;
}

// ─── Scripted Scenarios ───────────────────────────────────────────────────────

interface Scenario {
  key: string; label: string; transcript: string;
  intent: string; confidence: number; ambiguity: number; outcome: TxOutcome;
  rogerResponse: string;
  entities: { text: string; type: string; confidence: number }[];
}

const SCENARIOS: Scenario[] = [
  { key: 'reminder_clear', label: 'Reminder — Clear',
    transcript: 'Remind me to call Ahmad tomorrow at 2pm',
    intent: 'CREATE_REMINDER', confidence: 97, ambiguity: 12, outcome: 'success',
    rogerResponse: 'Copy that. Reminder set — call Ahmad, tomorrow at 2pm. Over.',
    entities: [{ text: 'Ahmad', type: 'PERSON', confidence: 98 }, { text: 'tomorrow', type: 'TIME_REL', confidence: 95 }, { text: '2pm', type: 'TIME_ABS', confidence: 99 }] },
  { key: 'reminder_ambiguous', label: 'Reminder — Ambiguous',
    transcript: 'Remind me to follow up with him next week',
    intent: 'CREATE_REMINDER', confidence: 61, ambiguity: 78, outcome: 'clarification',
    rogerResponse: 'Need clarification — who would you like me to remind you to follow up with? Over.',
    entities: [{ text: 'him', type: 'PERSON', confidence: 34 }, { text: 'next week', type: 'TIME_REL', confidence: 89 }] },
  { key: 'briefing', label: 'Morning Briefing',
    transcript: 'Tell me my morning briefing',
    intent: 'BRIEFING_REQUEST', confidence: 98, ambiguity: 8, outcome: 'success',
    rogerResponse: 'Briefing ready. Markets up 0.4%. Three open reminders. Top priority: meeting with Sarah at 10am. Over.',
    entities: [] },
  { key: 'watchlist', label: 'Watchlist Query',
    transcript: "What's the price of gold right now",
    intent: 'WATCHLIST_QUERY', confidence: 99, ambiguity: 4, outcome: 'success',
    rogerResponse: 'Gold is currently trading at 3,318 dollars per ounce. Up 1.2% today. Over.',
    entities: [{ text: 'gold', type: 'ASSET', confidence: 99 }] },
  { key: 'memory', label: 'Memory Capture',
    transcript: 'Add this to my project notes — the client wants the prototype by Friday',
    intent: 'MEMORY_CAPTURE', confidence: 94, ambiguity: 18, outcome: 'success',
    rogerResponse: 'Logged. Memory saved to project notes — client prototype deadline, Friday. Over.',
    entities: [{ text: 'client', type: 'PERSON', confidence: 72 }, { text: 'prototype', type: 'TOPIC', confidence: 91 }, { text: 'Friday', type: 'TIME_ABS', confidence: 97 }] },
  { key: 'error', label: 'Unknown Command',
    transcript: 'Send error report to the server now',
    intent: 'UNKNOWN', confidence: 32, ambiguity: 91, outcome: 'error',
    rogerResponse: "Couldn't process that transmission. Intent unclear. Please retry. Over.",
    entities: [] },
];

function buildPipeline(intent?: string, confidence?: number, ambiguity?: number): PipelineStep[] {
  const conf  = confidence ?? 80;
  const ambig = ambiguity  ?? 20;
  return [
    { id: 'ptt',        label: 'PTT CAPTURE',      sublabel: 'Audio buffer acquired',         ms: 12, status: 'idle' },
    { id: 'transcribe', label: 'TRANSCRIPTION',     sublabel: 'Whisper STT engine',           ms: 89, status: 'idle' },
    { id: 'intent',     label: 'INTENT DETECTION',  sublabel: `→ ${intent ?? 'DETECTING'}`,  ms: 34, status: 'idle', detail: `${conf}% conf` },
    { id: 'entity',     label: 'ENTITY EXTRACTION', sublabel: 'NER pipeline',                  ms: 28, status: 'idle' },
    { id: 'context',    label: 'CONTEXT RETRIEVAL', sublabel: 'Memory graph query',            ms: 45, status: 'idle' },
    { id: 'ambiguity',  label: 'AMBIGUITY CHECK',   sublabel: `Score: ${ambig}%`,             ms: 18, status: 'idle', detail: ambig > 60 ? 'INTERCEPT' : 'PASS' },
    { id: 'router',     label: 'ACTION ROUTER',     sublabel: `→ ${intent ?? '?'}_NODE`,      ms: 8,  status: 'idle' },
    { id: 'execute',    label: 'NODE EXECUTION',    sublabel: 'Processing action',             ms: 67, status: 'idle' },
    { id: 'memory',     label: 'MEMORY UPDATE',     sublabel: 'Persisting to graph',           ms: 52, status: 'idle' },
    { id: 'feedback',   label: 'PTT FEEDBACK',      sublabel: 'Response synthesis',            ms: 31, status: 'idle' },
  ];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stepIcon(status: PipelineStepStatus) {
  if (status === 'complete') return <CheckCircle2 size={11} style={{ color: 'var(--green)', flexShrink: 0 }} />;
  if (status === 'error')    return <XCircle      size={11} style={{ color: 'var(--rust)',  flexShrink: 0 }} />;
  if (status === 'running')  return <Activity     size={11} style={{ color: 'var(--amber)', flexShrink: 0 }} className="led-pulse" />;
  return <ChevronRight size={11} style={{ color: 'var(--olive)', flexShrink: 0 }} />;
}
function conf2s(v: number)  { return v > 85 ? 'var(--green)' : v > 65 ? 'var(--amber)' : 'var(--rust)'; }
function ambig2s(v: number) { return v < 30 ? 'var(--green)' : v < 60 ? 'var(--amber)' : 'var(--rust)'; }
function outColor(o: TxOutcome) { return o === 'success' ? 'var(--green)' : o === 'clarification' ? 'var(--amber)' : 'var(--rust)'; }
function outLabel(o: TxOutcome) { return o === 'success' ? 'SUCCESS' : o === 'clarification' ? 'CLARIFICATION' : 'ERROR'; }

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PTTTestLab() {
  const [selectedScenario, setSelectedScenario] = useState<Scenario>(SCENARIOS[0]);
  const [liveAIMode, setLiveAIMode]             = useState(true);
  const [pttState, setPttState]                 = useState<PTTState>('idle');
  const [messages, setMessages]                 = useState<Message[]>([]);
  const [pipeline, setPipeline]                 = useState<PipelineStep[]>(buildPipeline());
  const [totalMs, setTotalMs]                   = useState<number | null>(null);
  const [holdMs, setHoldMs]                     = useState(0);
  const [waveAmps, setWaveAmps]                 = useState<number[]>(Array(30).fill(2));
  const [txCounter, setTxCounter]               = useState(1);
  const [manualInput, setManualInput]           = useState('');
  const [liveTranscript, setLiveTranscript]     = useState('');  // interim speech result
  const [aiError, setAiError]                   = useState<string | null>(null);
  const [lastAIResult, setLastAIResult]         = useState<RogerAIResponse | null>(null);
  const [isSpeaking, setIsSpeaking]             = useState(false);
  const [pendingCount, setPendingCount]           = useState(0);
  const [networkStatus, setNetworkStatus]         = useState<NetworkStatus>('online');
  const [whisperMs, setWhisperMs]                 = useState<number | null>(null);
  const [queueDrawerOpen, setQueueDrawerOpen]     = useState(false);
  const [queueItems, setQueueItems]               = useState<{ txId: string; ts: number; status: string }[]>([]);
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
  const [rogerMode, setRogerMode]                 = useState<'quiet' | 'active' | 'briefing'>('active');
  void setRogerMode; // exposed via Settings (future module). Silences TS unused warning.
  const awaitingAnswerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Session ID — persists per lab session for conversation grouping
  const sessionId = useRef(crypto.randomUUID());

  const holdRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepsRef    = useRef<ReturnType<typeof setTimeout>[]>([]);
  const recorderRef = useRef<AudioRecorder | null>(null);  // replaces srRef
  const scrollRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, liveTranscript]);

  // ── Waveform — driven by Web Audio amplitude when recording, random otherwise ──
  const startWave = () => {
    waveRef.current = setInterval(() => {
      const amp = recorderRef.current?.getAmplitude() ?? 0;
      // Mix real amplitude with some randomness for visual richness
      setWaveAmps(Array.from({ length: 30 }, () => {
        const base = amp * 32;
        return Math.max(2, base + (Math.random() - 0.5) * 12);
      }));
    }, 60);
  };
  const stopWave  = () => { if (waveRef.current) clearInterval(waveRef.current); setWaveAmps(Array(30).fill(2)); };

  // ── Animate pipeline ──
  const animatePipeline = useCallback((steps: PipelineStep[], outcome: TxOutcome, offset = 0): number => {
    let elapsed = 0;
    steps.forEach((step, idx) => {
      const startDelay = elapsed + idx * 20;
      const endDelay   = startDelay + step.ms + Math.random() * 30;
      elapsed = endDelay;
      const t1 = setTimeout(() => setPipeline(prev => prev.map((s, i) => i === (idx + offset) ? { ...s, status: 'running' } : s)), startDelay * 2);
      const t2 = setTimeout(() => {
        const fs: PipelineStepStatus =
          (outcome === 'error' && ['ambiguity','execute'].includes(step.id)) ? 'error'
          : (outcome === 'error' && ['entity','context','memory'].includes(step.id)) ? 'skipped'
          : 'complete';
        setPipeline(prev => prev.map((s, i) => i === (idx + offset) ? { ...s, status: fs } : s));
      }, endDelay * 2);
      stepsRef.current.push(t1, t2);
    });
    return elapsed * 2 + 200;
  }, []);

  // ── Clear ──
  const clearSession = useCallback(() => {
    stepsRef.current.forEach(clearTimeout); stepsRef.current = [];
    if (holdRef.current) clearInterval(holdRef.current);
    if (recorderRef.current) { recorderRef.current.dispose(); recorderRef.current = null; }
    stopWave(); stopSpeaking();
    setMessages([]); setPttState('idle'); setHoldMs(0);
    setTxCounter(1); setAiError(null); setLastAIResult(null);
    setLiveTranscript(''); setIsSpeaking(false); setWhisperMs(null);
    setPipeline(buildPipeline()); setTotalMs(null);
    setConversationHistory([]);
    if (awaitingAnswerRef.current) clearTimeout(awaitingAnswerRef.current);
  }, []);

  // ── Core: process + respond ──
  const processAndRespond = useCallback(async (transcript: string, txId: string, isVoice: boolean) => {
    if (!transcript.trim()) { setPttState('idle'); return; }

    setLiveTranscript('');
    setPttState('processing');

    // Add user TX message
    const userMsg: Message = {
      id: `u-${Date.now()}`, role: 'user', text: transcript,
      type: 'transcription', ts: Date.now(), txId,
      liveAI: liveAIMode, voiceInput: isVoice,
    };
    setMessages(prev => [...prev, userMsg]);

    if (liveAIMode) {
      // ── LIVE GPT-5.5 PATH ──
      setPipeline(buildPipeline());
      const startMs = Date.now();

      // animate step 0+1 immediately (PTT capture + transcription)
      [0, 1].forEach(idx => {
        const t1 = setTimeout(() => setPipeline(prev => prev.map((s, i) => i === idx ? { ...s, status: 'running' } : s)), idx * 280);
        const t2 = setTimeout(() => setPipeline(prev => prev.map((s, i) => i === idx ? { ...s, status: 'complete' } : s)), idx * 280 + 220);
        stepsRef.current.push(t1, t2);
      });

      try {
        const result = await processTransmission(transcript, conversationHistory, undefined, LAB_USER_ID);
        setLastAIResult(result);
        const elapsed = Date.now() - startMs;
        setTotalMs(elapsed);

        // Append to conversation history for multi-turn
        setConversationHistory(prev => [
          ...prev.slice(-10),
          { role: 'user' as const,      content: transcript },
          { role: 'assistant' as const, content: result.roger_response },
        ]);

        // Persist turns to DB (fire-and-forget — never blocks PTT flow)
        insertConversationTurn({ user_id: LAB_USER_ID, session_id: sessionId.current, role: 'user', content: transcript, intent: null, is_admin_test: true }).catch(() => {});
        insertConversationTurn({ user_id: LAB_USER_ID, session_id: sessionId.current, role: 'assistant', content: result.roger_response, intent: result.intent, is_admin_test: true }).catch(() => {});
        // Implicit memory extraction (fire-and-forget)
        extractMemoryFacts(transcript, result.roger_response, LAB_USER_ID).catch(() => {});

        // animate remaining steps with real values
        const updatedSteps = buildPipeline(result.intent, result.confidence, result.ambiguity);
        setPipeline(updatedSteps);
        animatePipeline(updatedSteps.slice(2), result.outcome, 2);

        const outcome: TxOutcome = result.outcome;
        const rogerMsg: Message = {
          id: `r-${Date.now()}`, role: 'roger', text: result.roger_response,
          type: outcome === 'clarification' ? 'clarification' : outcome === 'error' ? 'error' : 'response',
          ts: Date.now(), txId, intent: result.intent,
          confidence: result.confidence, ambiguity: result.ambiguity,
          outcome, liveAI: true, reasoning: result.reasoning, entities: result.entities,
        };
        setMessages(prev => [...prev, rogerMsg]);

        // Play TTS response
        setPttState('speaking');
        setIsSpeaking(true);
        try {
          await speakResponse(result.roger_response);
        } catch {
          // TTS fallback: browser SpeechSynthesis
          try {
            const utt = new SpeechSynthesisUtterance(result.roger_response);
            window.speechSynthesis.speak(utt);
            await new Promise<void>(res => { utt.onend = () => res(); });
          } catch { /* silent fallback */ }
        }
        setIsSpeaking(false);

        // After clarification: auto-listen (awaiting_answer state)
        if (result.outcome === 'clarification') {
          setPttState('awaiting_answer');
          awaitingAnswerRef.current = setTimeout(() => {
            // Auto-open mic after 800ms
            handlePTTDown();
          }, 800);
          // Hard timeout — give up after 8s total
          setTimeout(() => {
            if (awaitingAnswerRef.current) clearTimeout(awaitingAnswerRef.current);
            setPttState(s => (s === 'awaiting_answer' || s === 'recording') ? 'idle' : s);
          }, 8000);
        } else {
          setPttState('responded');
        }

        // Save to DB
        insertTransmission({
          id: txId, user_id: isVoice ? 'ADMIN-VOICE' : 'ADMIN-LIVE-AI',
          device_id: null, transcript, intent: result.intent as never,
          confidence: result.confidence, ambiguity: result.ambiguity,
          status: outcome === 'success' ? 'SUCCESS' : outcome === 'clarification' ? 'CLARIFICATION' : 'ERROR',
          latency_ms: elapsed, region: 'ADMIN-LAB', is_simulated: true,
        }).catch(() => {});

      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : 'AI error';
        setAiError(errMsg);
        setPipeline(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' } : s));
        // RECOVER — always speak an error message
        const recoverText = (e instanceof Error && e.message.includes('abort'))
          ? 'Signal timeout. Please retry. Over.'
          : 'AI core offline. Queued for retry. Over.';
        try { await speakResponse(recoverText); } catch {
          try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(recoverText)); } catch { /* silent */ }
        }
        setIsSpeaking(false);
        setPttState('responded');
      }

    } else {
      // ── SCRIPTED PATH ──
      const s = selectedScenario;
      setPipeline(buildPipeline(s.intent, s.confidence, s.ambiguity));
      const steps = buildPipeline(s.intent, s.confidence, s.ambiguity);
      const totalDelay = animatePipeline(steps, s.outcome);
      setTotalMs(Math.round(steps.reduce((acc, f) => acc + f.ms, 0)));

      const t = setTimeout(async () => {
        const rogerMsg: Message = {
          id: `r-${Date.now()}`, role: 'roger', text: s.rogerResponse,
          type: s.outcome === 'clarification' ? 'clarification' : s.outcome === 'error' ? 'error' : 'response',
          ts: Date.now(), txId, intent: s.intent,
          confidence: s.confidence, ambiguity: s.ambiguity, outcome: s.outcome,
        };
        setMessages(prev => [...prev, rogerMsg]);

        // Play TTS
        setPttState('speaking');
        setIsSpeaking(true);
        try { await speakResponse(s.rogerResponse); } catch {}
        setIsSpeaking(false);
        setPttState('responded');

        insertTransmission({
          id: txId, user_id: isVoice ? 'ADMIN-VOICE' : 'ADMIN-SIM', device_id: null,
          transcript, intent: s.intent as never, confidence: s.confidence, ambiguity: s.ambiguity,
          status: s.outcome === 'success' ? 'SUCCESS' : s.outcome === 'clarification' ? 'CLARIFICATION' : 'ERROR',
          latency_ms: steps.reduce((acc, f) => acc + f.ms, 0), region: 'ADMIN-LAB', is_simulated: true,
        }).catch(() => {});
      }, totalDelay + 100);
      stepsRef.current.push(t);
    }
  }, [liveAIMode, selectedScenario, animatePipeline]);

  // ── PTT Hold start ──
  const handlePTTDown = useCallback(() => {
    // Allow interrupt while Roger is speaking
    if (pttState === 'speaking') {
      stopSpeaking();
      setIsSpeaking(false);
      // fall through to start recording
    } else if (pttState !== 'idle' && pttState !== 'responded' && pttState !== 'awaiting_answer') {
      return;
    }
    if (awaitingAnswerRef.current) clearTimeout(awaitingAnswerRef.current);
    stopSpeaking(); setIsSpeaking(false);
    setPttState('recording');
    setHoldMs(0); setAiError(null); setLiveTranscript(''); setWhisperMs(null);
    startWave();
    holdRef.current = setInterval(() => setHoldMs(h => {
      // Auto-release at 60s
      if (h >= 59900) {
        setTimeout(() => handlePTTUp(), 0);
        speakResponse('Transmission too long. Auto-released. Over.').catch(() => {});
      }
      return h + 100;
    }), 100);

    // Start MediaRecorder if supported and in live AI mode
    if (liveAIMode && MEDIA_RECORDER_SUPPORTED) {
      createAudioRecorder().then(recorder => {
        recorderRef.current = recorder;
        recorder.start().then(granted => {
          if (!granted) {
            recorderRef.current = null;
            setAiError('Microphone permission denied');
          }
        });
      });
    }
  }, [pttState, liveAIMode]);


  // ── PTT Hold release ──
  const handlePTTUp = useCallback(() => {
    if (pttState !== 'recording') return;
    if (holdRef.current) clearInterval(holdRef.current);
    stopWave();

    // ── Hold too brief (< 300ms) ──
    if (holdMs < 300) {
      setPttState('idle');
      const msg = 'Too brief. Hold and speak clearly. Over.';
      speakResponse(msg).catch(() => window.speechSynthesis.speak(new SpeechSynthesisUtterance(msg)));
      return;
    }

    const txId = `TX-SIM-${String(txCounter).padStart(4, '0')}`;
    setTxCounter(c => c + 1);

    if (liveAIMode && MEDIA_RECORDER_SUPPORTED && recorderRef.current) {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      setPttState('transcribing');

      recorder.stop().then(async (blob) => {
        recorder.dispose();

        // ── OFFLINE PATH ──
        if (!navigator.onLine) {
          try {
            await enqueueRecording({ blob, txId, timestamp: Date.now(), manualText: manualInput.trim() || undefined });
            const count = await getQueueCount();
            setPendingCount(count);
            // Refresh queue drawer items
            getPendingRecordings().then(items => setQueueItems(items.map(r => ({ txId: r.txId, ts: r.timestamp, status: r.status }))));
          } catch {
            setAiError('Offline queue full — could not save transmission');
          }
          setPttState('idle');
          return;
        }

        // ── ONLINE PATH: Whisper → GPT-5.5 ──
        try {
          // Step 0+1 (PTT capture + transcribing) animate
          [0, 1].forEach(idx => {
            const t1 = setTimeout(() => setPipeline(prev => prev.map((s, i) => i === idx ? { ...s, status: 'running'   } : s)), idx * 200);
            const t2 = setTimeout(() => setPipeline(prev => prev.map((s, i) => i === idx ? { ...s, status: 'running'   } : s)), idx * 200 + 80);
            stepsRef.current.push(t1, t2);
          });

          // Whisper transcription
          const { transcript, durationMs } = await transcribeAudio(blob);
          setWhisperMs(durationMs);
          setLiveTranscript(transcript);

          // ── Silence / noise check ──
          const cleanText = transcript.replace(/[^a-zA-Z\u0600-\u06FF]/g, '');
          if (!cleanText || cleanText.length < 3) {
            const msg = 'Nothing received. Say your command. Over.';
            await speakResponse(msg).catch(() => window.speechSynthesis.speak(new SpeechSynthesisUtterance(msg)));
            setPttState('idle');
            return;
          }

          // Mark step 1 complete with real Whisper timing
          setPipeline(prev => prev.map((s, i) =>
            i === 0 ? { ...s, status: 'complete' } :
            i === 1 ? { ...s, status: 'complete', sublabel: `WHISPER-1 · ${durationMs}ms` } : s
          ));

          processAndRespond(transcript || manualInput.trim() || selectedScenario.transcript, txId, true);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Whisper transcription failed';
          setAiError(msg);
          setPttState('idle');
        }
      });
    } else {
      // No MediaRecorder / scripted mode → use manual input or scenario text
      const transcript = liveAIMode
        ? (manualInput.trim() || selectedScenario.transcript)
        : selectedScenario.transcript;
      processAndRespond(transcript, txId, false);
    }
  }, [pttState, txCounter, liveAIMode, manualInput, selectedScenario, processAndRespond]);

  // ── Manual send ──
  const handleManualSend = () => {
    if (!manualInput.trim() || pttState === 'recording' || pttState === 'processing' || pttState === 'speaking') return;
    const txId = `TX-TXT-${String(txCounter).padStart(4, '0')}`;
    setTxCounter(c => c + 1);
    processAndRespond(manualInput.trim(), txId, false);
    setManualInput('');
  };

  // ── Stop speaking ──
  const handleStopSpeaking = () => { stopSpeaking(); setIsSpeaking(false); setPttState('responded'); };

  // ── Network monitor + offline queue ──
  useEffect(() => {
    const stop = startNetworkMonitor({
      onStatusChange: (s) => setNetworkStatus(s),
      onQueueCountChange: (n) => setPendingCount(n),
      onItemProcessed: (item: ProcessedItem) => {
        // Add the queued item's result to the message list
        if (item.success) {
          const userMsg: Message = {
            id: `u-q-${item.txId}`, role: 'user', text: item.transcript,
            type: 'transcription', ts: Date.now(), txId: item.txId, liveAI: true, voiceInput: true,
          };
          const rogerMsg: Message = {
            id: `r-q-${item.txId}`, role: 'roger', text: item.rogerResponse,
            type: 'response', ts: Date.now(), txId: item.txId,
          };
          setMessages(prev => [...prev, userMsg, rogerMsg]);
        }
        // Refresh queue drawer
        getPendingRecordings().then(items => setQueueItems(items.map(r => ({ txId: r.txId, ts: r.timestamp, status: r.status }))));
      },
      onQueueDrained: () => {
        setPendingCount(0);
        setQueueItems([]);
      },
    });
    return stop;
  }, []);

  // ── Hardware PTT Button (FAS Bluetooth speaker) ──
  useEffect(() => {
    let cleanup: (() => void) | null = null;
    attachPttHardware(handlePTTDown, handlePTTUp).then(fn => { cleanup = fn; });
    return () => { cleanup?.(); };
  }, [handlePTTDown, handlePTTUp]);

  // ── Keyboard SPACE = PTT ──
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); handlePTTDown(); } };
    const onUp   = (e: KeyboardEvent) => { if (e.code === 'Space') handlePTTUp(); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, [handlePTTDown, handlePTTUp]);

  useEffect(() => () => {
    stepsRef.current.forEach(clearTimeout);
    if (holdRef.current) clearInterval(holdRef.current);
    if (waveRef.current) clearInterval(waveRef.current);
    if (recorderRef.current) { recorderRef.current.dispose(); recorderRef.current = null; }
    stopSpeaking();
  }, []);

  const canPTT = pttState === 'idle' || pttState === 'responded';
  const isRecording   = pttState === 'recording';
  const isTranscribing = pttState === 'transcribing';
  const isProcessing  = pttState === 'processing';
  const isSpeakingState = pttState === 'speaking';

  const pttBusy = !canPTT && !isRecording;

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Top Bar ── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b flex-wrap" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-recessed)' }}>
        <FlaskConical size={13} style={{ color: 'var(--amber)' }} />
        <span className="font-mono text-mini tracking-widest uppercase" style={{ color: 'var(--amber)' }}>PTT TEST LAB</span>
        <span className="font-mono text-nano" style={{ color: 'var(--text-muted)' }}>PATIENT EXPERIENCE SIMULATION</span>
        {/* Memory active badge */}
        {liveAIMode && (
          <span className="font-mono text-nano flex items-center gap-1 px-1.5 py-0.5 border" style={{ borderColor: 'rgba(139,92,246,0.35)', background: 'rgba(139,92,246,0.08)', color: '#a78bfa' }}>
            <Brain size={9} /> MEMORY ACTIVE · {LAB_USER_ID}
          </span>
        )}

        {/* Mode toggle */}
        <div className="flex items-center gap-1 ml-4">
          {['scripted', 'live'].map(mode => {
            const active = mode === 'live' ? liveAIMode : !liveAIMode;
            return (
              <button key={mode} onClick={() => { if (mode === 'live') { setLiveAIMode(true); } else { setLiveAIMode(false); } clearSession(); }}
                className="flex items-center gap-1.5 border px-2 py-1 font-mono text-nano uppercase tracking-wider"
                style={{ borderColor: active ? (mode === 'live' ? 'var(--green)' : 'var(--amber)') : 'var(--border-subtle)', background: active ? (mode === 'live' ? 'var(--green-dim)' : 'rgba(212,160,68,0.12)') : 'transparent', color: active ? (mode === 'live' ? 'var(--green)' : 'var(--amber)') : 'var(--text-muted)' }}
              >
                {mode === 'live' && <Sparkles size={9} />}
                {mode === 'live' ? 'LIVE AI · GPT-5.5' : 'SCRIPTED'}
              </button>
            );
          })}
        </div>

        {/* Scenario picker (scripted only) */}
        {!liveAIMode && (
          <select value={selectedScenario.key} onChange={e => { setSelectedScenario(SCENARIOS.find(s => s.key === e.target.value)!); clearSession(); }}
            className="border px-2 py-1 font-mono text-nano appearance-none ml-auto"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)', color: 'var(--text-primary)', minWidth: 140 }}>
            {SCENARIOS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        )}

        {liveAIMode && !VOICE_SUPPORTED && (
          <span className="font-mono text-nano ml-auto" style={{ color: 'var(--rust)' }}>⚠ Browser mic not supported — use text input</span>
        )}
        {liveAIMode && VOICE_SUPPORTED && (
          <span className="font-mono text-nano ml-auto flex items-center gap-1" style={{ color: 'var(--green)' }}>
            <Mic size={9} /> MIC READY
          </span>
        )}

        {/* Hardware button indicator */}
        {isNative && (
          <span className="font-mono text-nano flex items-center gap-1" style={{ color: 'var(--green)' }}>
            <Bluetooth size={9} />
            HW BTN
          </span>
        )}

        {/* Roger mode badge */}
        <span className="font-mono text-nano flex items-center gap-1 px-1.5 py-0.5 border" style={{
          borderColor: rogerMode === 'quiet' ? 'var(--border-subtle)' : rogerMode === 'briefing' ? 'rgba(96,165,250,0.3)' : 'var(--green-border)',
          background:  rogerMode === 'quiet' ? 'rgba(255,255,255,0.03)' : rogerMode === 'briefing' ? 'rgba(96,165,250,0.08)' : 'var(--green-dim)',
          color:       rogerMode === 'quiet' ? 'var(--text-muted)' : rogerMode === 'briefing' ? '#60a5fa' : 'var(--green)',
        }}>
          {rogerMode === 'quiet' ? '🔇 QUIET' : rogerMode === 'briefing' ? '🎙 BRIEFING' : '📡 ACTIVE'}
        </span>

        {/* Network status + queue badge */}
        {networkStatus === 'offline' ? (
          <span className="font-mono text-nano flex items-center gap-1 ml-auto" style={{ color: 'var(--amber)' }}>
            <Signal size={9} /> OFFLINE{pendingCount > 0 ? ` · ${pendingCount} QUEUED` : ''}
          </span>
        ) : pendingCount > 0 ? (
          <span className="font-mono text-nano flex items-center gap-1 ml-auto" style={{ color: 'var(--green)' }}>
            <Activity size={9} className="led-pulse" /> SYNCING {pendingCount} TX...
          </span>
        ) : null}

        <button onClick={clearSession} className="flex items-center gap-1.5 border px-2 py-1 font-mono text-nano uppercase tracking-wider" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
          <Trash2 size={10} /> CLEAR
        </button>
      </div>

      {/* Offline banner (full-width) */}
      {networkStatus === 'offline' && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 font-mono text-nano animate-pulse" style={{ background: 'rgba(212,160,68,0.12)', borderBottom: '1px solid var(--amber-border)', color: 'var(--amber)' }}>
          <Signal size={10} /> NO SIGNAL — TRANSMISSIONS WILL BE QUEUED AND SENT WHEN ONLINE
          {pendingCount > 0 && <span className="ml-auto">{pendingCount} TX PENDING</span>}
        </div>
      )}

      {/* ── 3-column layout ── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_280px] lg:grid-cols-[1fr_300px_250px]">

        {/* ══════ COL 1: Device Sim ══════ */}
        <div className="flex flex-col border-r min-h-0" style={{ borderColor: 'var(--border-subtle)' }}>

          {/* Chrome bar */}
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <Signal size={11} style={{ color: 'var(--green)' }} />
            <span className="font-mono text-nano" style={{ color: 'var(--text-secondary)' }}>ROGER DEVICE SIM</span>
            {liveAIMode && <span className="font-mono text-nano flex items-center gap-1" style={{ color: 'var(--green)' }}><Sparkles size={9} /> LIVE + VOICE</span>}
            <div className="ml-auto flex items-center gap-1.5 px-1.5 py-0.5 border" style={{
              borderColor: networkStatus === 'online' ? 'var(--green-border)' : 'var(--amber-border)',
              background:  networkStatus === 'online' ? 'var(--green-dim)' : 'rgba(212,160,68,0.1)',
            }}>
              <div className="w-1 h-1" style={{ background: networkStatus === 'online' ? 'var(--green)' : 'var(--amber)', borderRadius: '50%' }} />
              <span className="font-mono text-nano" style={{ color: networkStatus === 'online' ? 'var(--green)' : 'var(--amber)' }}>
                {networkStatus === 'online' ? 'CONNECTED' : 'OFFLINE'}
              </span>
            </div>
          </div>

          {/* Queue drawer */}
          {queueItems.length > 0 && (
            <div className="shrink-0 border-b" style={{ borderColor: 'var(--amber-border)', background: 'rgba(212,160,68,0.04)' }}>
              <button
                onClick={() => setQueueDrawerOpen(o => !o)}
                className="w-full flex items-center gap-2 px-4 py-2 font-mono text-nano"
                style={{ color: 'var(--amber)' }}
              >
                <Clock size={10} />
                OFFLINE QUEUE · {queueItems.length} PENDING
                <span className="ml-auto">{queueDrawerOpen ? '∧' : '∨'}</span>
              </button>
              {queueDrawerOpen && (
                <div className="px-4 pb-2 space-y-1">
                  {queueItems.map(item => (
                    <div key={item.txId} className="flex items-center gap-3 font-mono text-nano" style={{ color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--amber)' }}>{item.txId}</span>
                      <span>{new Date(item.ts).toLocaleTimeString()}</span>
                      <span className="ml-auto" style={{ color: item.status === 'failed' ? 'var(--rust)' : 'var(--amber)' }}>
                        {item.status === 'failed' ? '⚠ FAILED' : '⏳ PENDING'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Message scroll */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3" style={{ background: 'var(--bg-primary)' }}>
            {messages.length === 0 && !liveTranscript && (
              <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
                <Radio size={28} style={{ color: 'var(--amber)' }} />
                <p className="font-mono text-mini tracking-widest uppercase text-center" style={{ color: 'var(--text-muted)' }}>
                  {liveAIMode ? 'Hold PTT and speak\nRoger will listen and respond' : 'Hold PTT to transmit\nor press SPACEBAR'}
                </p>
              </div>
            )}

            {/* Error */}
            {aiError && (
              <div className="border px-3 py-2 font-mono text-nano" style={{ borderColor: 'var(--rust-border)', background: 'var(--rust-dim)', color: 'var(--rust)' }}>⚠ {aiError}</div>
            )}

            {/* Messages */}
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[85%] border p-3 space-y-1.5" style={{
                  borderColor: msg.role === 'user' ? 'var(--amber-border)' : msg.type === 'error' ? 'var(--rust-border)' : msg.type === 'clarification' ? 'var(--amber-border)' : 'var(--green-border)',
                  background:  msg.role === 'user' ? 'rgba(212,160,68,0.06)' : msg.type === 'error' ? 'var(--rust-dim)' : msg.type === 'clarification' ? 'var(--amber-warn-dim)' : 'var(--green-dim)',
                }}>
                  {/* Label row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {msg.role === 'user'
                      ? <MicOff size={9} style={{ color: 'var(--amber)' }} />
                      : <Volume2 size={9} style={{ color: msg.type === 'error' ? 'var(--rust)' : msg.type === 'clarification' ? 'var(--amber)' : 'var(--green)' }} />}
                    <span className="font-mono text-nano uppercase tracking-wider" style={{ color: msg.role === 'user' ? 'var(--amber)' : msg.type === 'error' ? 'var(--rust)' : msg.type === 'clarification' ? 'var(--amber)' : 'var(--green)' }}>
                      {msg.role === 'user' ? (msg.voiceInput ? '🎙 VOICE TX' : 'USER TX') : msg.type === 'clarification' ? 'ROGER — INTERCEPT' : msg.type === 'error' ? 'ROGER — FAIL' : 'ROGER AI'}
                    </span>
                    {msg.liveAI && <span className="font-mono text-micro border px-1" style={{ borderColor: 'var(--green-border)', color: 'var(--green)' }}>GPT-5.5</span>}
                    {msg.txId && <span className="font-mono text-micro ml-auto" style={{ color: 'var(--text-muted)' }}>{msg.txId}</span>}
                  </div>
                  {/* Text */}
                  <p className="text-sm" style={{ color: 'var(--text-primary)', fontStyle: msg.role === 'roger' ? 'italic' : 'normal' }}>{msg.text}</p>
                  {/* Entities */}
                  {msg.entities && msg.entities.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {msg.entities.map(e => <span key={e.text} className="font-mono text-micro border px-1" style={{ borderColor: 'var(--amber-border)', color: 'var(--amber)' }}>{e.text} · {e.type}</span>)}
                    </div>
                  )}
                  {/* Metrics */}
                  {msg.role === 'roger' && msg.confidence !== undefined && (
                    <div className="flex gap-3 pt-1 border-t" style={{ borderColor: 'rgba(74,82,64,0.2)' }}>
                      <span className="font-mono text-nano" style={{ color: 'var(--text-muted)' }}>CONF: <span style={{ color: conf2s(msg.confidence!) }}>{msg.confidence}%</span></span>
                      <span className="font-mono text-nano" style={{ color: 'var(--text-muted)' }}>AMBIG: <span style={{ color: ambig2s(msg.ambiguity!) }}>{msg.ambiguity}%</span></span>
                      {msg.outcome && <span className="font-mono text-nano ml-auto border px-1" style={{ borderColor: outColor(msg.outcome), color: outColor(msg.outcome) }}>{outLabel(msg.outcome)}</span>}
                    </div>
                  )}
                  {msg.reasoning && <p className="font-mono text-micro pt-1 border-t" style={{ borderColor: 'rgba(74,82,64,0.2)', color: 'var(--text-muted)' }}>{msg.reasoning}</p>}
                </div>
              </div>
            ))}

            {/* Live interim transcript / Whisper status */}
            {(isRecording || isTranscribing) && (
              <div className="flex justify-end">
                <div className="max-w-[85%] border px-3 py-2 font-mono text-nano italic" style={{ borderColor: 'var(--amber-border)', background: 'rgba(212,160,68,0.04)', color: 'var(--text-muted)' }}>
                  {isTranscribing && !liveTranscript
                    ? <span style={{ color: 'var(--amber)' }}>🎙 WHISPER PROCESSING{whisperMs != null ? ` · ${whisperMs}ms` : '...'}</span>
                    : <>🎙 &quot;{liveTranscript}&quot;</>
                  }
                </div>
              </div>
            )}

            {/* Status indicator */}
            {(isProcessing || isTranscribing || isSpeakingState) && (
              <div className="flex justify-start">
                <div className="border px-3 py-2 flex items-center gap-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                  <Activity size={11} className="led-pulse" style={{ color: isSpeakingState ? 'var(--green)' : 'var(--amber)' }} />
                  <span className="font-mono text-nano" style={{ color: isSpeakingState ? 'var(--green)' : 'var(--amber)' }}>
                    {isTranscribing ? 'TRANSCRIBING…' : isProcessing ? (liveAIMode ? 'ROGER AI THINKING (GPT-5.5)…' : 'ROGER PROCESSING…') : '🔊 ROGER SPEAKING…'}
                  </span>
                  {isSpeakingState && (
                    <button onClick={handleStopSpeaking} className="ml-2 border px-1.5 py-0.5 font-mono text-micro" style={{ borderColor: 'var(--rust-border)', color: 'var(--rust)' }}>
                      <VolumeX size={9} /> STOP
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── PTT Controls ── */}
          <div className="shrink-0 border-t p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            {/* Waveform */}
            <div className="flex items-end justify-center gap-[2px] h-8">
              {waveAmps.map((amp, i) => (
                <div key={i} style={{ width: 3, height: amp, background: isRecording ? 'var(--amber)' : isSpeakingState ? 'var(--green)' : 'var(--olive)', transition: isRecording || isSpeakingState ? 'height 80ms ease' : 'height 300ms ease', opacity: isRecording || isSpeakingState ? 1 : 0.3 }} />
              ))}
            </div>

            {/* PTT Button */}
            <button
              onMouseDown={handlePTTDown} onMouseUp={handlePTTUp}
              onTouchStart={e => { e.preventDefault(); handlePTTDown(); }}
              onTouchEnd={e => { e.preventDefault(); handlePTTUp(); }}
              disabled={pttBusy && !isSpeakingState}
              className="w-full flex flex-col items-center justify-center gap-1 py-3 border select-none"
              style={{
                borderColor: isRecording ? 'var(--amber)' : isSpeakingState ? 'var(--green)' : canPTT ? 'var(--border-active)' : 'var(--border-subtle)',
                background: isRecording ? 'rgba(212,160,68,0.2)' : isSpeakingState ? 'var(--green-dim)' : canPTT ? 'rgba(212,160,68,0.06)' : 'var(--bg-cell)',
                cursor: (canPTT || isRecording) ? 'pointer' : 'not-allowed',
                boxShadow: isRecording ? '0 0 20px rgba(212,160,68,0.25)' : isSpeakingState ? '0 0 20px rgba(90,156,105,0.2)' : 'none',
              }}
            >
              {isRecording ? <Mic size={20} className="led-pulse" style={{ color: 'var(--amber)' }} />
                : isTranscribing ? <RotateCcw size={20} className="animate-spin" style={{ color: 'var(--amber)' }} />
                : isProcessing ? <Activity size={20} className="led-pulse" style={{ color: 'var(--amber)' }} />
                : isSpeakingState ? <Volume2 size={20} className="led-pulse" style={{ color: 'var(--green)' }} />
                : <Mic size={20} style={{ color: canPTT ? 'var(--amber)' : 'var(--olive)' }} />}

              <span className="font-mono text-micro uppercase tracking-widest" style={{ color: isRecording ? 'var(--amber)' : isSpeakingState ? 'var(--green)' : 'var(--text-muted)' }}>
                {isRecording ? `🎙 LISTENING… ${(holdMs / 1000).toFixed(1)}s`
                  : isTranscribing ? 'TRANSCRIBING…'
                  : isProcessing ? (liveAIMode ? 'GPT-5.5 PROCESSING…' : 'PROCESSING…')
                  : isSpeakingState ? '🔊 ROGER SPEAKING'
                  : liveAIMode && VOICE_SUPPORTED ? 'HOLD TO SPEAK'
                  : 'HOLD TO TRANSMIT'}
              </span>
              {canPTT && <span className="font-mono text-micro" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>SPACEBAR</span>}
            </button>

            {/* Text input */}
            <div className="flex gap-2">
              <input
                type="text" value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleManualSend()}
                placeholder={liveAIMode && VOICE_SUPPORTED ? 'Or type instead of speaking…' : liveAIMode ? 'Type any command — GPT-5.5 will process it…' : 'Manual text input…'}
                disabled={isProcessing || isRecording || isTranscribing || isSpeakingState}
                className="flex-1 border px-3 py-1.5 font-mono text-nano"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)', color: 'var(--text-primary)' }}
              />
              <button onClick={handleManualSend}
                disabled={!manualInput.trim() || isProcessing || isRecording || isTranscribing || isSpeakingState}
                className="border px-2 py-1.5 flex items-center gap-1"
                style={{ borderColor: manualInput.trim() ? 'var(--amber-border)' : 'var(--border-subtle)', color: manualInput.trim() ? 'var(--amber)' : 'var(--text-muted)' }}>
                <Send size={11} />
              </button>
            </div>
          </div>
        </div>

        {/* ══════ COL 2: Pipeline Trace ══════ */}
        <div className="flex flex-col border-r min-h-0 overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <Cpu size={11} style={{ color: 'var(--amber)' }} />
            <span className="font-mono text-nano uppercase tracking-wider" style={{ color: 'var(--amber)' }}>AI PIPELINE TRACE</span>
            {totalMs !== null && (
              <span className="ml-auto font-mono text-nano border px-1.5 py-0.5" style={{ borderColor: 'var(--green-border)', color: 'var(--green)' }}>{totalMs}ms</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-1">
            {pipeline.map((step, idx) => (
              <div key={step.id} className="flex items-start gap-2 px-2 py-2 border" style={{
                borderColor: step.status === 'complete' ? 'var(--green-border)' : step.status === 'running' ? 'var(--amber-border)' : step.status === 'error' ? 'var(--rust-border)' : 'var(--border-dim)',
                background: step.status === 'complete' ? 'var(--green-dim)' : step.status === 'running' ? 'var(--amber-warn-dim)' : step.status === 'error' ? 'var(--rust-dim)' : 'transparent',
                transition: 'all 0.2s ease',
              }}>
                <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                  <span className="font-mono text-micro w-4 text-right" style={{ color: 'var(--text-muted)' }}>{String(idx + 1).padStart(2, '0')}</span>
                  {stepIcon(step.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-nano uppercase tracking-wider truncate" style={{ color: step.status === 'idle' ? 'var(--text-muted)' : 'var(--text-primary)' }}>{step.label}</span>
                    {step.status !== 'idle' && <span className="font-mono text-micro shrink-0" style={{ color: 'var(--text-muted)' }}>{step.ms}ms</span>}
                  </div>
                  <span className="font-mono text-micro block" style={{ color: 'var(--text-muted)' }}>{step.sublabel}</span>
                  {step.detail && step.status !== 'idle' && (
                    <span className="font-mono text-micro block mt-0.5 border-l pl-1.5" style={{ borderColor: step.status === 'error' ? 'var(--rust)' : 'var(--amber)', color: step.status === 'error' ? 'var(--rust)' : 'var(--amber)' }}>{step.detail}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="shrink-0 border-t p-3 grid grid-cols-3 gap-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            {[
              { icon: <CheckCircle2 size={10} />, label: 'DONE', color: 'var(--green)',  count: pipeline.filter(s => s.status === 'complete').length },
              { icon: <Activity      size={10} />, label: 'RUN',  color: 'var(--amber)', count: pipeline.filter(s => s.status === 'running').length },
              { icon: <XCircle       size={10} />, label: 'FAIL', color: 'var(--rust)',  count: pipeline.filter(s => s.status === 'error').length },
            ].map(stat => (
              <div key={stat.label} className="flex items-center gap-1.5">
                <span style={{ color: stat.color }}>{stat.icon}</span>
                <span className="font-mono text-micro" style={{ color: stat.color }}>{stat.count}</span>
                <span className="font-mono text-micro" style={{ color: 'var(--text-muted)' }}>{stat.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ══════ COL 3: Signal Intel ══════ */}
        <div className="hidden lg:flex flex-col min-h-0 overflow-hidden">
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <Database size={11} style={{ color: 'var(--amber)' }} />
            <span className="font-mono text-nano uppercase tracking-wider" style={{ color: 'var(--amber)' }}>SIGNAL INTEL</span>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-4">

            {/* Mode card */}
            <div className="border p-2 space-y-1" style={{ borderColor: liveAIMode ? 'var(--green-border)' : 'var(--border-subtle)', background: liveAIMode ? 'var(--green-dim)' : 'var(--bg-elevated)' }}>
              <div className="flex items-center gap-1.5">
                {liveAIMode ? <Sparkles size={10} style={{ color: 'var(--green)' }} /> : <FlaskConical size={10} style={{ color: 'var(--amber)' }} />}
                <span className="font-mono text-nano font-semibold" style={{ color: liveAIMode ? 'var(--green)' : 'var(--amber)' }}>
                  {liveAIMode ? 'LIVE AI — GPT-5.5' : 'SCRIPTED MODE'}
                </span>
              </div>
              <p className="font-mono text-micro" style={{ color: 'var(--text-muted)' }}>
                {liveAIMode
                  ? VOICE_SUPPORTED ? 'Hold PTT → speak naturally → GPT-5.5 processes → Roger responds with voice. Full PTT loop.'
                    : 'Type input → GPT-5.5 processes → Roger responds with voice.'
                  : 'Fixed scripted scenarios. Roger responds with voice via TTS.'}
              </p>
            </div>

            {/* TTS status */}
            {isSpeaking && (
              <div className="border p-2 flex items-center gap-2" style={{ borderColor: 'var(--green-border)', background: 'var(--green-dim)' }}>
                <Volume2 size={10} className="led-pulse" style={{ color: 'var(--green)' }} />
                <span className="font-mono text-nano" style={{ color: 'var(--green)' }}>ROGER SPEAKING</span>
                <button onClick={handleStopSpeaking} className="ml-auto font-mono text-micro border px-1" style={{ borderColor: 'var(--rust-border)', color: 'var(--rust)' }}>STOP</button>
              </div>
            )}

            {/* Last AI result */}
            {liveAIMode && lastAIResult && (
              <div className="space-y-2">
                <span className="font-mono text-micro uppercase tracking-widest block" style={{ color: 'var(--text-muted)' }}>LAST AI RESULT</span>
                {[
                  { label: 'INTENT',    value: lastAIResult.intent,              color: 'var(--text-primary)' },
                  { label: 'OUTCOME',   value: outLabel(lastAIResult.outcome),   color: outColor(lastAIResult.outcome) },
                  { label: 'CONF',      value: `${lastAIResult.confidence}%`,    color: conf2s(lastAIResult.confidence) },
                  { label: 'AMBIGUITY', value: `${lastAIResult.ambiguity}%`,     color: ambig2s(lastAIResult.ambiguity) },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="font-mono text-nano" style={{ color: 'var(--text-muted)' }}>{row.label}</span>
                    <span className="font-mono text-nano font-semibold" style={{ color: row.color }}>{row.value}</span>
                  </div>
                ))}
                {lastAIResult.entities.length > 0 && (
                  <>
                    <span className="font-mono text-micro uppercase tracking-widest block pt-1" style={{ color: 'var(--text-muted)' }}>ENTITIES</span>
                    {lastAIResult.entities.map(e => (
                      <div key={e.text} className="flex items-center gap-2 border px-2 py-1" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)' }}>
                        <span className="font-mono text-nano flex-1 font-semibold" style={{ color: 'var(--text-primary)' }}>"{e.text}"</span>
                        <span className="font-mono text-micro border px-1" style={{ borderColor: 'var(--amber-border)', color: 'var(--amber)' }}>{e.type}</span>
                        <span className="font-mono text-micro" style={{ color: conf2s(e.confidence) }}>{e.confidence}%</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* Scripted scenario info */}
            {!liveAIMode && (
              <div className="space-y-2">
                <span className="font-mono text-micro uppercase tracking-widest block" style={{ color: 'var(--text-muted)' }}>SCENARIO</span>
                <p className="font-mono text-nano font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedScenario.label}</p>
                <p className="font-mono text-micro italic" style={{ color: 'var(--text-secondary)' }}>"{selectedScenario.transcript}"</p>
                {[
                  { label: 'CONFIDENCE', value: `${selectedScenario.confidence}%`, color: conf2s(selectedScenario.confidence) },
                  { label: 'AMBIGUITY',  value: `${selectedScenario.ambiguity}%`,  color: ambig2s(selectedScenario.ambiguity) },
                  { label: 'OUTCOME',    value: outLabel(selectedScenario.outcome), color: outColor(selectedScenario.outcome) },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="font-mono text-nano" style={{ color: 'var(--text-muted)' }}>{row.label}</span>
                    <span className="font-mono text-nano font-semibold" style={{ color: row.color }}>{row.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Session stats */}
            <div className="space-y-1.5">
              <span className="font-mono text-micro uppercase tracking-widest block" style={{ color: 'var(--text-muted)' }}>SESSION</span>
              {[
                { icon: <Radio size={9} />, label: 'TX SENT',  value: String(txCounter - 1) },
                { icon: <Clock size={9} />, label: 'LATENCY',  value: totalMs ? `${totalMs}ms` : '—' },
                { icon: <Mic   size={9} />, label: 'VOICE',    value: liveAIMode && VOICE_SUPPORTED ? 'ACTIVE' : 'TEXT ONLY' },
                { icon: <Zap   size={9} />, label: 'TTS',      value: 'ONYX VOICE' },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <span style={{ color: 'var(--text-muted)' }}>{s.icon}</span>
                  <span className="font-mono text-nano flex-1" style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                  <span className="font-mono text-nano font-semibold" style={{ color: 'var(--text-primary)' }}>{s.value}</span>
                </div>
              ))}
            </div>

            {/* Hint */}
            <div className="border p-2" style={{ borderColor: 'var(--border-dim)', background: 'var(--bg-cell)' }}>
              <span className="font-mono text-micro" style={{ color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--amber)' }}>SPACEBAR</span> = PTT · All TX saved to DB
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
