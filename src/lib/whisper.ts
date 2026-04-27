/**
 * whisper.ts — Speech-to-Text via server-side Edge Function.
 *
 * SECURITY: The OpenAI key is held server-side in the `whisper-transcribe`
 * Edge Function. The client posts the audio blob with the user's Supabase JWT.
 * No OpenAI key is bundled into the app.
 *
 * Used by UserHome PTT pipeline after the user releases the PTT button.
 */

import { getAuthToken } from './getAuthToken';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export interface WhisperResult {
  transcript: string;
  durationMs: number;
}

/**
 * Transcribe an audio blob via the whisper-transcribe Edge Function.
 * @param blob       - WebM/Opus audio blob from MediaRecorder
 * @param promptHint - Optional vocabulary hint for Whisper (contact names, brands, etc.)
 * @param language   - Optional ISO language code to force Whisper's transcription language
 */
export async function transcribeAudio(blob: Blob, promptHint?: string, language?: string): Promise<WhisperResult> {
  const t0 = Date.now();

  const token = await getAuthToken();

  // Whisper requires a file extension for format detection
  const ext  = blob.type.includes('ogg') ? 'ogg' : 'webm';
  const file = new File([blob], `recording.${ext}`, { type: blob.type });

  const form = new FormData();
  form.append('file',            file);
  form.append('model',           'whisper-1');
  form.append('response_format', 'json');
  if (promptHint) form.append('prompt', promptHint);
  // Force Whisper to transcribe in the user's chosen language
  // This is the hard lock: Whisper won't auto-detect/switch languages
  if (language) form.append('language', language);

  // Retry once on transient server errors (502/503) — these happen when
  // OpenAI is slow or the Deno edge runtime times out temporarily.
  const MAX_ATTEMPTS = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      // Backoff: 1.5s before retry to let the server recover
      await new Promise(r => setTimeout(r, 1500));
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/whisper-transcribe`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body:    form,
    });

    if (res.ok) {
      const data = await res.json() as { transcript: string; durationMs: number };
      return {
        transcript: data.transcript.trim(),
        durationMs: Date.now() - t0,
      };
    }

    // Transient server error → retry
    if ((res.status === 502 || res.status === 503) && attempt < MAX_ATTEMPTS - 1) {
      console.warn(`[whisper] ${res.status} on attempt ${attempt + 1}, retrying...`);
      lastError = new Error(`whisper-transcribe error ${res.status}`);
      continue;
    }

    // Permanent error → throw immediately
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ??
      `whisper-transcribe error ${res.status}`
    );
  }

  throw lastError ?? new Error('whisper-transcribe failed');
}
