/**
 * whisper.ts — OpenAI Whisper STT API client.
 *
 * Sends a recorded audio blob to Whisper and returns the transcript.
 * Used by PTT Test Lab after the user releases the PTT button.
 */

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string;

export interface WhisperResult {
  transcript: string;
  durationMs: number; // how long the Whisper call took
}

/**
 * Transcribe an audio blob via OpenAI Whisper-1.
 * @param blob - WebM/Opus audio blob from MediaRecorder
 * @param language - BCP-47 language code hint (default 'en')
 */
export async function transcribeAudio(
  blob: Blob,
  language = 'en'
): Promise<WhisperResult> {
  if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

  const t0 = Date.now();

  // Whisper requires a file extension in the filename for format detection
  const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
  const file = new File([blob], `recording.${ext}`, { type: blob.type });

  const form = new FormData();
  form.append('file', file);
  form.append('model', 'whisper-1');
  form.append('language', language);
  form.append('response_format', 'json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: { message?: string } }).error?.message ??
      `Whisper error ${res.status}`
    );
  }

  const data = await res.json() as { text: string };
  return {
    transcript: data.text.trim(),
    durationMs: Date.now() - t0,
  };
}
