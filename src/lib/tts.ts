// ─── Roger AI — Text-to-Speech ──────────────────────────────────────────────
// Uses OpenAI TTS (tts-1 model, onyx voice) to speak Roger's responses.
//
// ANDROID / CAPACITOR NOTE:
//   Capacitor's CapacitorHttp plugin patches window.fetch() and intercepts
//   ALL outgoing requests — including binary audio downloads. The patched
//   fetch() cannot correctly deliver binary MP3 data as ArrayBuffer, causing
//   decodeAudioData() to receive corrupt data and throw an AudioContext error.
//
//   FIX: We use XMLHttpRequest with responseType='arraybuffer' for the TTS
//   download. XHR is NOT intercepted by CapacitorHttp, so we get raw binary.
//
//   Pipeline: XHR (raw binary) → ArrayBuffer → decodeAudioData → BufferSource
//   This is the same pipeline that sfx.ts uses for PTT beeps — works on device.

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string;

// Shared AudioContext — lazy-created, recreated if it enters a closed/error state.
let _ctx: AudioContext | null = null;

// Currently playing source — allows stopSpeaking() to interrupt mid-sentence.
let _currentSource: AudioBufferSourceNode | null = null;
let _stopCallback: (() => void) | null = null;

// ─── AudioContext lifecycle ────────────────────────────────────────────────────

async function getAudioContext(): Promise<AudioContext> {
  if (_ctx && _ctx.state === 'closed') {
    _ctx = null; // recreate if closed
  }
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

// ─── XHR binary download (bypasses Capacitor HTTP interceptor) ───────────────

function fetchAudioBuffer(text: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://api.openai.com/v1/audio/speech', true);
    xhr.responseType = 'arraybuffer'; // CRITICAL: raw binary, not intercepted
    xhr.setRequestHeader('Authorization', `Bearer ${OPENAI_API_KEY}`);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as ArrayBuffer);
      } else {
        // Try to extract an error message from the response
        try {
          const errText = new TextDecoder().decode(xhr.response as ArrayBuffer);
          const errJson = JSON.parse(errText) as { error?: { message?: string } };
          reject(new Error(errJson.error?.message ?? `TTS HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`TTS HTTP ${xhr.status}`));
        }
      }
    };

    xhr.onerror   = () => reject(new Error('TTS network error (XHR)'));
    xhr.ontimeout = () => reject(new Error('TTS timeout'));
    xhr.timeout   = 30_000; // 30 s max

    xhr.send(JSON.stringify({
      model: 'tts-1',
      input: text,
      voice: 'onyx',
      speed: 1.0,
      response_format: 'mp3',
    }));
  });
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
 * Speak text using OpenAI TTS via XHR (bypasses Capacitor HTTP interceptor)
 * and play through AudioContext BufferSource pipeline.
 */
export async function speakResponse(text: string): Promise<void> {
  if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

  stopSpeaking();

  // 1. Ensure AudioContext is alive and running
  let ctx: AudioContext;
  try {
    ctx = await getAudioContext();
  } catch (e) {
    resetAudioContext();
    throw new Error(`AudioContext init failed: ${(e as Error).message}`);
  }
  console.log('[TTS] ctx state before fetch:', ctx.state);

  // 2. Download audio via XHR (not fetch — Capacitor patches fetch for binary)
  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await fetchAudioBuffer(text);
    console.log('[TTS] XHR audio bytes received:', arrayBuffer.byteLength);
  } catch (e) {
    throw new Error(`TTS fetch failed: ${(e as Error).message}`);
  }

  // 3. Recreate context if it closed during the download
  if (ctx.state === 'closed') {
    resetAudioContext();
    ctx = await getAudioContext();
  }

  // 4. Decode the MP3 into a Web Audio buffer
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    console.log('[TTS] decoded audio duration:', audioBuffer.duration.toFixed(2), 's');
  } catch (decodeErr) {
    console.warn('[TTS] decodeAudioData failed, resetting context and retrying:', decodeErr);
    resetAudioContext();
    ctx = await getAudioContext();
    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch (retryErr) {
      throw new Error(`TTS decode failed: ${(retryErr as Error).message}`);
    }
  }

  // 5. Resume context if suspended after decode
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch { /* best effort */ }
  }

  // 6. Play
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
