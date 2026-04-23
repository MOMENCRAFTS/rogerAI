// ─── Roger AI — Text-to-Speech ──────────────────────────────────────────────
// Uses OpenAI TTS (tts-1 model, onyx voice) to speak Roger's responses.
// Onyx = deep, clear, authoritative — perfect for radio/PTT aesthetic.

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string;

let currentAudio: HTMLAudioElement | null = null;
let currentAudioCtx: AudioContext | null = null;

export function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (currentAudioCtx) {
    currentAudioCtx.close().catch(() => {});
    currentAudioCtx = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

export async function speakResponse(text: string): Promise<void> {
  if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

  stopSpeaking();

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

  const blob  = await res.blob();
  const url   = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;

  // Explicitly max out volume — mobile browsers default to ~0.5 on some devices
  audio.volume = 1.0;

  return new Promise((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      resolve();
    };
    audio.onerror = (e) => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      reject(e);
    };

    audio.play()
      .then(() => {
        try {
          // Route through Web Audio API → forces speaker channel (not earpiece/call)
          // on iOS Safari & Android Chrome, and allows gain boosting.
          const ctx = new AudioContext();
          currentAudioCtx = ctx;
          const source = ctx.createMediaElementSource(audio);
          const gain   = ctx.createGain();
          gain.gain.value = 1.5; // 1.5× boost — crisp loudness, no clipping
          source.connect(gain);
          gain.connect(ctx.destination);
          if (ctx.state === 'suspended') ctx.resume();
        } catch {
          // Web Audio unavailable — plain play() already started, fine
        }
      })
      .catch(reject);
  });
}
