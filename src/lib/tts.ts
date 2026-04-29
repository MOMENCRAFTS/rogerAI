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

// ─── Text chunker ─────────────────────────────────────────────────────────────
// OpenAI TTS rejects input > 4096 chars. Long Roger responses (briefings, deep
// dives) regularly exceed this. We split on sentence boundaries so each chunk
// is under the limit, then play them sequentially without any gap.
const TTS_CHUNK_LIMIT = 4000; // leave headroom below the 4096 hard cap

function chunkText(text: string): string[] {
  if (text.length <= TTS_CHUNK_LIMIT) return [text];

  // Split on sentence-ending punctuation followed by whitespace
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    // Single sentence is itself too long — hard-split at word boundary
    if (sentence.length > TTS_CHUNK_LIMIT) {
      if (current) { chunks.push(current.trim()); current = ''; }
      const words = sentence.split(' ');
      let wordChunk = '';
      for (const word of words) {
        if ((wordChunk + ' ' + word).trim().length > TTS_CHUNK_LIMIT) {
          chunks.push(wordChunk.trim());
          wordChunk = word;
        } else {
          wordChunk = (wordChunk + ' ' + word).trim();
        }
      }
      if (wordChunk) current = wordChunk;
      continue;
    }

    const candidate = current ? current + ' ' + sentence : sentence;
    if (candidate.length > TTS_CHUNK_LIMIT) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * Speak text using OpenAI TTS.
 * Automatically chunks text > 4000 chars into sentence-boundary segments and
 * plays them sequentially — so long briefings / deep-dive responses are always
 * heard in full rather than silently failing at the 4096-char proxy limit.
 * Includes built-in retry: if AudioContext fails on first attempt, resets and retries once.
 * AbortErrors are NOT retried — they mean stopSpeaking() was called intentionally.
 */
export async function speakResponse(text: string): Promise<void> {
  const chunks = chunkText(text);
  console.log(`[TTS] ${chunks.length} chunk(s) for ${text.length} chars`);

  for (const chunk of chunks) {
    // If stopSpeaking() was called mid-sequence, bail out immediately
    if (_abortController?.signal.aborted) return;

    try {
      await _speakResponseInner(chunk);
    } catch (firstErr) {
      // AbortError = intentional cancellation → stop the whole sequence
      if (firstErr instanceof DOMException && firstErr.name === 'AbortError') {
        console.log('[TTS] Aborted (intentional), stopping sequence');
        return;
      }
      // Genuine failure → retry once with fresh AudioContext
      console.warn('[TTS] Chunk failed, retrying with fresh AudioContext:', firstErr);
      resetAudioContext();
      try {
        await _speakResponseInner(chunk);
      } catch (retryErr) {
        if (retryErr instanceof DOMException && (retryErr as DOMException).name === 'AbortError') return;
        // Both OpenAI TTS attempts failed for this chunk — Web Speech fallback
        console.warn('[TTS] OpenAI TTS retry failed, using Web Speech fallback:', retryErr);
        await _webSpeechFallback(chunk);
      }
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
