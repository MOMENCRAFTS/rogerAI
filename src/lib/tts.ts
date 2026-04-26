// ─── Roger AI — Text-to-Speech ──────────────────────────────────────────────
// Uses OpenAI TTS (tts-1 model, onyx voice) via the server-side tts-proxy
// Edge Function. The OpenAI key is held server-side — never in the bundle.
//
// ANDROID / CAPACITOR NOTE:
//   CapacitorHttp (DISABLED in capacitor.config.ts) patches fetch and XHR.
//   With it disabled, the WebView uses its native networking stack.
//   Binary responses arrive as real ArrayBuffers — decodeAudioData works.
//
//   Pipeline: fetch tts-proxy → arrayBuffer() → decodeAudioData → speaker

import { getAuthToken } from './getAuthToken';
import { getCurrentLocale } from './i18n';
import { DIALECT_CONFIG } from './translations/dialects';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

// Shared AudioContext — lazy-created, recreated if it enters a closed state.
let _ctx: AudioContext | null = null;

// Currently playing source — allows stopSpeaking() to interrupt mid-sentence.
let _currentSource: AudioBufferSourceNode | null = null;
let _stopCallback: (() => void) | null = null;

// AbortController — cancels in-flight TTS fetch so stale audio never plays.
let _abortController: AbortController | null = null;

// ─── AudioContext lifecycle ────────────────────────────────────────────────────

async function getAudioContext(): Promise<AudioContext> {
  if (_ctx && _ctx.state === 'closed') _ctx = null;
  if (!_ctx) _ctx = new AudioContext();
  if (_ctx.state === 'suspended') {
    try { await _ctx.resume(); } catch { /* best effort */ }
    // PC browsers may still be suspended — force with a second attempt
    if (_ctx.state === 'suspended') {
      await new Promise(r => setTimeout(r, 50));
      try { await _ctx.resume(); } catch { /* best effort */ }
    }
  }
  return _ctx;
}

function resetAudioContext(): void {
  if (_ctx) { try { _ctx.close(); } catch { /* ignore */ } }
  _ctx = null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Prime the AudioContext on the very first user gesture (PermissionGate tap).
 * Must be called from a synchronous event handler (touchstart / pointerdown).
 * Also safe to call on every PTT down to keep the context alive on PC browsers.
 */
export async function unlockAudio(): Promise<void> {
  try {
    const ctx = await getAudioContext();
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    console.log('[TTS] AudioContext unlocked, state:', ctx.state);
  } catch (e) {
    console.warn('[TTS] unlockAudio failed:', e);
  }
}

export function stopSpeaking(): void {
  // Abort any in-flight TTS fetch first — prevents stale audio from arriving later
  if (_abortController) {
    try { _abortController.abort(); } catch { /* ignore */ }
    _abortController = null;
  }
  if (_currentSource) {
    try { _currentSource.stop(); } catch { /* already stopped */ }
    _currentSource = null;
  }
  if (_stopCallback) {
    _stopCallback();
    _stopCallback = null;
  }
  // Guard: speechSynthesis may be undefined on Android WebView
  try {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  } catch { /* ignore */ }
}

/**
 * Speak text using OpenAI TTS.
 * Now uses native fetch (CapacitorHttp disabled) so binary audio arrives intact.
 * Includes built-in retry: if AudioContext fails on first attempt, resets and retries once.
 * AbortErrors are NOT retried — they mean stopSpeaking() was called intentionally.
 */
export async function speakResponse(text: string): Promise<void> {
  try {
    return await _speakResponseInner(text);
  } catch (firstErr) {
    // AbortError = intentional cancellation (stopSpeaking called) → don't retry
    if (firstErr instanceof DOMException && firstErr.name === 'AbortError') {
      console.log('[TTS] Aborted (intentional), not retrying');
      return;
    }
    // Genuine failure (stale AudioContext, decode error) → retry once
    console.warn('[TTS] First attempt failed, retrying with fresh AudioContext:', firstErr);
    resetAudioContext();
    try {
      return await _speakResponseInner(text);
    } catch (retryErr) {
      // AbortError on retry — bail silently
      if (retryErr instanceof DOMException && (retryErr as DOMException).name === 'AbortError') return;
      // ── Web Speech API fallback ──────────────────────────────────────
      // Both OpenAI TTS attempts failed — fall back to browser-native speech.
      // This eliminates the need for 70+ identical .catch() blocks in callers.
      console.warn('[TTS] OpenAI TTS retry failed, using Web Speech fallback:', retryErr);
      return _webSpeechFallback(text);
    }
  }
}

/**
 * Browser-native Web Speech API fallback.
 * Lower quality than OpenAI TTS, but guaranteed to work on all modern browsers.
 * Resolves when speech finishes or immediately if speechSynthesis is unavailable.
 */
function _webSpeechFallback(text: string): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        console.warn('[TTS] Web Speech API not available — silent failure');
        resolve();
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => resolve();
      utterance.onerror = () => {
        console.warn('[TTS] Web Speech fallback also failed — truly silent');
        resolve();
      };
      window.speechSynthesis.speak(utterance);
      console.log('[TTS] Web Speech fallback started');
    } catch {
      resolve(); // absolute last resort — never throw from TTS
    }
  });
}

async function _speakResponseInner(text: string): Promise<void> {
  stopSpeaking();

  // Create a fresh AbortController for this request
  const controller = new AbortController();
  _abortController = controller;

  let ctx: AudioContext;
  try {
    ctx = await getAudioContext();
  } catch (e) {
    resetAudioContext();
    throw new Error(`AudioContext init failed: ${(e as Error).message}`);
  }
  console.log('[TTS] ctx state:', ctx.state);

  // Check if aborted during AudioContext init (another speakResponse call came in)
  if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

  // Fetch TTS audio via server-side proxy (OpenAI key stays server-side)
  const token = await getAuthToken();

  // Select TTS voice based on user's dialect
  const locale = getCurrentLocale();
  const dialectVoice = DIALECT_CONFIG[locale]?.ttsVoice ?? 'onyx';

  const res = await fetch(`${SUPABASE_URL}/functions/v1/tts-proxy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ text, voice: dialectVoice, speed: 1.0, model: 'tts-1' }),
    signal: controller.signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `TTS error ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  console.log('[TTS] audio bytes received:', arrayBuffer.byteLength);

  if (ctx.state === 'closed') {
    resetAudioContext();
    ctx = await getAudioContext();
  }

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    console.log('[TTS] decoded duration:', audioBuffer.duration.toFixed(2), 's');
  } catch (decodeErr) {
    console.warn('[TTS] decodeAudioData failed, resetting ctx:', decodeErr);
    resetAudioContext();
    ctx = await getAudioContext();
    audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  }

  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch { /* best effort */ }
  }

  // If aborted during fetch/decode, bail out silently
  if (controller.signal.aborted) return;

  return new Promise((resolve, reject) => {
    if (ctx.state === 'closed') {
      reject(new Error('AudioContext closed before playback'));
      return;
    }

    // Double-check: abort may have fired between decode and playback
    if (controller.signal.aborted) { resolve(); return; }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    _currentSource = source;
    _stopCallback  = resolve;

    source.onended = () => {
      _currentSource = null;
      _stopCallback  = null;
      console.log('[TTS] playback ended');
      resolve();
    };

    try {
      source.start(0);
      console.log('[TTS] playback started');
    } catch (e) {
      _currentSource = null;
      _stopCallback  = null;
      resetAudioContext();
      reject(e);
    }
  });
}
