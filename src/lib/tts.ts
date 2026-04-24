// ─── Roger AI — Text-to-Speech ──────────────────────────────────────────────
// Uses OpenAI TTS (tts-1 model, onyx voice) to speak Roger's responses.
// Onyx = deep, clear, authoritative — perfect for radio/PTT aesthetic.
//
// ANDROID: HTMLAudioElement + blob URL is unreliable in Capacitor WebView —
// it plays fine on desktop but stays silent on Android regardless of flags.
// SFX (sfx.ts) uses AudioContext.decodeAudioData() + BufferSource and WORKS.
// So TTS now uses the same AudioContext pipeline.
//
// WARNING: Do NOT use createMediaElementSource() to connect an HTMLAudioElement
// to AudioContext — that detaches it from the speaker on Android WebView.
// This implementation uses raw ArrayBuffer → decodeAudioData → BufferSource,
// which is a completely separate (and working) path.

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string;

// Shared AudioContext for TTS playback — persisted across calls so it stays
// resumed. Lazy-created on first speakResponse() call.
let _ctx: AudioContext | null = null;

// Currently playing source — allows stopSpeaking() to cut it off mid-playback.
let _currentSource: AudioBufferSourceNode | null = null;
let _stopCallback: (() => void) | null = null;

/** Get (or create) the shared AudioContext, ensuring it is running. */
async function getAudioContext(): Promise<AudioContext> {
  if (!_ctx) _ctx = new AudioContext();
  if (_ctx.state === 'suspended') {
    await _ctx.resume();
  }
  return _ctx;
}

/**
 * Prime the AudioContext on the very first user gesture (PermissionGate tap).
 * Must be called from a synchronous event handler (touchstart / pointerdown).
 * Safe to call multiple times.
 */
export async function unlockAudio(): Promise<void> {
  try {
    const ctx = await getAudioContext();
    // Play a 1-frame silent buffer to formally unlock the audio pipeline.
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* best effort */ }
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
  // Also cancel any browser speechSynthesis fallback
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Fetch audio from OpenAI TTS and play it through AudioContext.
 *
 * Uses ArrayBuffer → decodeAudioData → BufferSource instead of
 * HTMLAudioElement + blob URL. This is the same pipeline that sfx.ts
 * uses for PTT beeps — confirmed working on Android WebView.
 */
export async function speakResponse(text: string): Promise<void> {
  if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

  stopSpeaking();

  // Ensure AudioContext is running before we start the async fetch.
  // This is important: if the context suspended between unlock and now, resume it.
  const ctx = await getAudioContext();

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice: 'onyx',
      speed: 1.0,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `TTS error ${res.status}`);
  }

  // Get raw binary — arrayBuffer() is safer than blob() through Capacitor HTTP bridge
  const arrayBuffer = await res.arrayBuffer();

  // Decode the MP3 audio into a Web Audio buffer
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  // Re-check context state after the async decode (could have been interrupted)
  if (ctx.state === 'suspended') await ctx.resume();

  return new Promise((resolve, reject) => {
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    // Connect directly to speakers — no intermediate gain node needed for TTS
    source.connect(ctx.destination);

    _currentSource = source;

    source.onended = () => {
      _currentSource = null;
      _stopCallback = null;
      resolve();
    };

    // Store a cancel callback so stopSpeaking() can resolve cleanly
    _stopCallback = resolve;

    try {
      source.start(0);
    } catch (e) {
      _currentSource = null;
      _stopCallback = null;
      reject(e);
    }
  });
}
