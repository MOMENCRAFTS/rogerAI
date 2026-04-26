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
 * @param blob      - WebM/Opus audio blob from MediaRecorder
 * @param promptHint - Optional vocabulary hint for Whisper (contact names, brands, etc.)
 */
export async function transcribeAudio(blob: Blob, promptHint?: string): Promise<WhisperResult> {
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

  const res = await fetch(`${SUPABASE_URL}/functions/v1/whisper-transcribe`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body:    form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ??
      `whisper-transcribe error ${res.status}`
    );
  }

  const data = await res.json() as { transcript: string; durationMs: number };
  return {
    transcript: data.transcript.trim(),
    durationMs: Date.now() - t0,
  };
}
