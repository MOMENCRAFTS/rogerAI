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

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

// Shared AudioContext — lazy-created, recreated if it enters a closed state.
let _ctx: AudioContext | null = null;

// Currently playing source — allows stopSpeaking() to interrupt mid-sentence.
let _currentSource: AudioBufferSourceNode | null = null;
let _stopCallback: (() => void) | null = null;

// ─── AudioContext lifecycle ────────────────────────────────────────────────────

async function getAudioContext(): Promise<AudioContext> {
  if (_ctx && _ctx.state === 'closed') _ctx = null;
  if (!_ctx) _ctx = new AudioContext();
  if (_ctx.state === 'suspended') {
    try { await _ctx.resume(); } catch { /* best effort */ }
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
 */
export async function speakResponse(text: string): Promise<void> {
  stopSpeaking();

  let ctx: AudioContext;
  try {
    ctx = await getAudioContext();
  } catch (e) {
    resetAudioContext();
    throw new Error(`AudioContext init failed: ${(e as Error).message}`);
  }
  console.log('[TTS] ctx state:', ctx.state);

  // Fetch TTS audio via server-side proxy (OpenAI key stays server-side)
  const token = await getAuthToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/tts-proxy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ text, voice: 'onyx', speed: 1.0, model: 'tts-1' }),
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

  return new Promise((resolve, reject) => {
    if (ctx.state === 'closed') {
      reject(new Error('AudioContext closed before playback'));
      return;
    }

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
