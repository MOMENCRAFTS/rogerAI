/**
 * ambientListener.ts — "Roger, listen to this" continuous background recording engine.
 *
 * Architecture:
 *  - MediaRecorder runs continuously in 30-second rolling chunks
 *  - Each chunk → Whisper transcription → analyse-ambient edge fn (GPT-5.4-mini)
 *  - If music is dominant → audio chunk forwarded to identify-music edge fn (ACRCloud)
 *  - Emits events via callbacks throughout the session lifecycle
 *
 * Usage:
 *   const session = await createAmbientSession({ onChunk, onMusicDetected, onError });
 *   await session.start();
 *   // ... 
 *   const result = await session.stop(); // → AmbientSessionResult
 */

const CHUNK_INTERVAL_MS = 30_000; // 30-second rolling chunks

const SUPABASE_URL      = (typeof import.meta !== 'undefined')
  ? (import.meta as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL ?? ''
  : '';
const SUPABASE_ANON_KEY = (typeof import.meta !== 'undefined')
  ? (import.meta as { env?: Record<string, string> }).env?.VITE_SUPABASE_ANON_KEY ?? ''
  : '';

import { getAuthToken } from './getAuthToken';

export interface AmbientChunkResult {
  chunkIndex:    number;
  timestamp:     number;
  contentType:   'speech' | 'music' | 'ambient' | 'mixed' | 'unknown';
  language:      string | null;
  languageName:  string | null;
  transcriptClean: string;
  summary:       string;
  musicHint:     string | null;
  isMusicDominant: boolean;
  confidence:    number;
  musicIdentified?: { title: string; artist: string; album: string | null; genre: string | null };
}

export interface AmbientSessionResult {
  sessionId:    string;
  contentType:  string;
  language:     string | null;
  languageName: string | null;
  transcript:   string;
  summary:      string;
  musicTitle:   string | null;
  musicArtist:  string | null;
  musicAlbum:   string | null;
  chunks:       AmbientChunkResult[];
  durationS:    number;
}

export interface AmbientSessionOptions {
  onChunk?:          (chunk: AmbientChunkResult) => void;
  onMusicDetected?:  (info: { title: string; artist: string; album: string | null }) => void;
  onError?:          (err: string) => void;
  onTranscriptUpdate?: (fullTranscript: string) => void;
}

export interface AmbientSession {
  start(): Promise<boolean>;     // returns false if mic denied
  stop(): Promise<AmbientSessionResult>;
  isActive(): boolean;
}

const PREFERRED_MIME = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg'];
function getMime() { return PREFERRED_MIME.find(m => MediaRecorder.isTypeSupported(m)) ?? ''; }

/** Blob → base64 string */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]); // strip data:...;base64,
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Send blob to whisper-transcribe Edge Function and return transcript */
async function transcribeBlob(blob: Blob): Promise<string> {
  try {
    const token = await getAuthToken();
    const form  = new FormData();
    form.append('file',  blob, 'chunk.webm');
    form.append('model', 'whisper-1');
    // No language hint — let Whisper auto-detect
    const res = await fetch(`${SUPABASE_URL}/functions/v1/whisper-transcribe`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body:    form,
    });
    if (!res.ok) return '';
    const data = await res.json() as { transcript: string };
    return data.transcript ?? '';
  } catch {
    return '';
  }
}

/** Forward to analyse-ambient edge fn */
async function analyseChunk(transcript: string): Promise<Omit<AmbientChunkResult, 'chunkIndex' | 'timestamp' | 'musicIdentified'>> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/analyse-ambient`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ transcript }),
  });
  if (!res.ok) return {
    contentType: 'unknown', language: null, languageName: null,
    transcriptClean: transcript, summary: 'Analysis unavailable.',
    musicHint: null, isMusicDominant: false, confidence: 0,
  };
  const d = await res.json() as {
    content_type: string; language: string | null; language_name: string | null;
    transcript_clean: string; summary: string; music_hint: string | null;
    is_music_dominant: boolean; confidence: number;
  };
  return {
    contentType:     d.content_type as AmbientChunkResult['contentType'],
    language:        d.language,
    languageName:    d.language_name,
    transcriptClean: d.transcript_clean ?? transcript,
    summary:         d.summary,
    musicHint:       d.music_hint,
    isMusicDominant: d.is_music_dominant ?? false,
    confidence:      d.confidence ?? 0,
  };
}

/** Forward to identify-music edge fn (ACRCloud) */
async function identifyMusic(blob: Blob, mime: string): Promise<AmbientChunkResult['musicIdentified'] | undefined> {
  try {
    const audioBase64 = await blobToBase64(blob);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/identify-music`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ audioBase64, mimeType: mime }),
    });
    if (!res.ok) return undefined;
    const d = await res.json() as { identified: boolean; title?: string; artist?: string; album?: string | null; genre?: string | null };
    if (!d.identified) return undefined;
    return { title: d.title!, artist: d.artist!, album: d.album ?? null, genre: d.genre ?? null };
  } catch {
    return undefined;
  }
}

/** Determine dominant content type across all chunks */
function dominantType(chunks: AmbientChunkResult[]): string {
  if (!chunks.length) return 'unknown';
  const counts: Record<string, number> = {};
  for (const c of chunks) counts[c.contentType] = (counts[c.contentType] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export function createAmbientSession(
  opts: AmbientSessionOptions,
): AmbientSession {
  let stream:   MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let active = false;
  let chunkIndex = 0;
  let startedAt = 0;
  const chunks: AmbientChunkResult[] = [];
  const transcriptParts: string[] = [];
  let chunkTimer: ReturnType<typeof setInterval> | null = null;
  let currentChunkBlobs: Blob[] = [];
  const mime = getMime();

  /** Flush current blob accumulation → process → emit */
  async function flushChunk() {
    if (!currentChunkBlobs.length) return;
    const blob = new Blob(currentChunkBlobs, { type: mime || 'audio/webm' });
    currentChunkBlobs = [];
    const idx = chunkIndex++;
    const ts = Date.now();

    try {
      const transcript = await transcribeBlob(blob);
      if (!transcript.trim()) return; // silence chunk — skip

      const analysis = await analyseChunk(transcript);
      const chunk: AmbientChunkResult = { chunkIndex: idx, timestamp: ts, ...analysis };

      // If music dominant → run ACRCloud fingerprint (best effort)
      if (analysis.isMusicDominant) {
        const musicId = await identifyMusic(blob, mime);
        if (musicId) {
          chunk.musicIdentified = musicId;
          opts.onMusicDetected?.({ title: musicId.title, artist: musicId.artist, album: musicId.album });
        }
      }

      chunks.push(chunk);
      transcriptParts.push(analysis.transcriptClean || transcript);
      opts.onChunk?.(chunk);
      opts.onTranscriptUpdate?.(transcriptParts.join(' '));
    } catch (e) {
      opts.onError?.(`Chunk ${idx} failed: ${String(e)}`);
    }
  }

  async function start(): Promise<boolean> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      return false;
    }

    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) currentChunkBlobs.push(e.data); };
    recorder.start(500); // collect every 500ms
    active = true;
    startedAt = Date.now();

    // Flush every 30s
    chunkTimer = setInterval(() => { flushChunk().catch(() => {}); }, CHUNK_INTERVAL_MS);

    return true;
  }

  async function stop(): Promise<AmbientSessionResult> {
    active = false;
    if (chunkTimer) clearInterval(chunkTimer);

    // Stop recorder, collect final blob
    await new Promise<void>((resolve) => {
      if (!recorder || recorder.state === 'inactive') { resolve(); return; }
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    stream?.getTracks().forEach(t => t.stop());

    // Process final chunk
    await flushChunk();

    const durationS = Math.round((Date.now() - startedAt) / 1000);
    const fullTranscript = transcriptParts.join(' ');

    // Find any music identified
    const musicChunk = chunks.find(c => c.musicIdentified);

    // Majority language
    const langCounts: Record<string, { name: string | null; count: number }> = {};
    for (const c of chunks) {
      if (c.language) {
        if (!langCounts[c.language]) langCounts[c.language] = { name: c.languageName, count: 0 };
        langCounts[c.language].count++;
      }
    }
    const topLang = Object.entries(langCounts).sort((a, b) => b[1].count - a[1].count)[0];

    return {
      sessionId:    crypto.randomUUID(),
      contentType:  dominantType(chunks),
      language:     topLang?.[0] ?? null,
      languageName: topLang?.[1].name ?? null,
      transcript:   fullTranscript,
      summary:      chunks.map(c => c.summary).filter(Boolean).join(' '),
      musicTitle:   musicChunk?.musicIdentified?.title ?? null,
      musicArtist:  musicChunk?.musicIdentified?.artist ?? null,
      musicAlbum:   musicChunk?.musicIdentified?.album ?? null,
      chunks,
      durationS,
    };
  }

  return { start, stop, isActive: () => active };
}
