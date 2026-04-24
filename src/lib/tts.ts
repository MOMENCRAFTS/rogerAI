// ─── Roger AI — Text-to-Speech ──────────────────────────────────────────────
// Uses OpenAI TTS (tts-1 model, onyx voice) to speak Roger's responses.
// Onyx = deep, clear, authoritative — perfect for radio/PTT aesthetic.
//
// ANDROID NOTE: Do NOT use Web Audio API (createMediaElementSource) here.
// Connecting an HTMLAudioElement to an AudioContext detaches it from the
// speaker pipeline in Android WebView, causing complete silence.
// setMediaPlaybackRequiresUserGesture(false) in MainActivity handles autoplay.

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string;

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
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

  // Max volume — direct on the element, no Web Audio API routing
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
    audio.play().catch(reject);
  });
}
