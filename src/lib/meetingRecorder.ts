/**
 * meetingRecorder.ts — "Roger, record meeting" structured session engine.
 *
 * Architecture:
 *  - MediaRecorder runs continuously in 60-second rolling chunks
 *  - Each chunk → Whisper transcription (1 retry on failure)
 *  - After each successful chunk: checkpoint-upsert transcript to DB (crash-safe)
 *  - Accumulates full rolling transcript in memory
 *  - On stop() → generate-meeting-notes edge fn (GPT-5.5) → structured notes
 *  - Updates the existing in_progress row to done (no duplicate inserts)
 *  - Feeds key participants into memory_graph
 *
 * Usage:
 *   const recorder = createMeetingRecorder(userId, { onChunk, onComplete, onError });
 *   await recorder.start('Q2 Budget Review');
 *   // ...
 *   const notes = await recorder.stop();
 */

const CHUNK_INTERVAL_MS   = 60_000; // 60-second rolling chunks
const WHISPER_RETRY_DELAY = 2_000;  // ms before retrying a failed chunk

const SUPABASE_URL = (typeof import.meta !== 'undefined')
  ? (import.meta as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL ?? ''
  : '';

import { getAuthToken } from './getAuthToken';

export interface MeetingActionItem { text: string; owner: string | null; due_date: string | null }
export interface MeetingDecision   { text: string }
export interface MeetingParticipant { name: string; role: string }

export interface MeetingNotes {
  title:        string;
  summary:      string;
  action_items: MeetingActionItem[];
  decisions:    MeetingDecision[];
  participants: MeetingParticipant[];
  key_topics:   string[];
  spoken_summary: string;
}

export interface MeetingChunk {
  index:      number;
  startedAt:  number;
  transcript: string;
  wordCount:  number;
}

export interface MeetingResult {
  dbId:       string | null;    // UUID from meeting_recordings table
  title:      string;
  notes:      MeetingNotes;
  transcript: string;
  chunks:     MeetingChunk[];
  durationS:  number;
}

export interface MeetingRecorderOptions {
  onChunkTranscribed?: (chunk: MeetingChunk) => void;
  onComplete?:         (result: MeetingResult) => void;
  onError?:            (err: string) => void;
  onProgress?:         (elapsedS: number, wordCount: number) => void;
}

export interface MeetingRecorder {
  start(title?: string): Promise<boolean>;
  stop(): Promise<MeetingResult>;
  getTranscriptSoFar(): string;
  getElapsedSeconds(): number;
  isActive(): boolean;
}

const PREFERRED_MIME = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg'];
function getMime() { return PREFERRED_MIME.find(m => MediaRecorder.isTypeSupported(m)) ?? ''; }

async function transcribeBlob(blob: Blob, attempt = 1): Promise<string> {
  try {
    const token = await getAuthToken();
    const form  = new FormData();
    form.append('file',  blob, 'chunk.webm');
    form.append('model', 'whisper-1');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/whisper-transcribe`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body:    form,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { transcript: string };
    return data.transcript ?? '';
  } catch (err) {
    if (attempt < 2) {
      // One retry after a short delay
      await new Promise(r => setTimeout(r, WHISPER_RETRY_DELAY));
      return transcribeBlob(blob, 2);
    }
    console.warn('[MeetingRecorder] Whisper failed after retry:', err);
    return '';
  }
}

async function generateNotes(transcript: string, title?: string): Promise<MeetingNotes> {
  // ✅ Use user JWT — not the anon key — so the edge fn can verify the caller
  const token = await getAuthToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-meeting-notes`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body:    JSON.stringify({ transcript, title }),
  });
  if (!res.ok) throw new Error(`generate-meeting-notes ${res.status}`);
  return res.json() as Promise<MeetingNotes>;
}

/** Upsert the in_progress checkpoint row after each chunk — crash-safe recovery. */
async function checkpointToDB(sessionId: string, userId: string, title: string, transcript: string, chunkCount: number): Promise<void> {
  try {
    const { supabase } = await import('./supabase');
    await supabase.from('meeting_recordings').upsert({
      id:          sessionId,
      user_id:     userId,
      title,
      transcript,
      chunk_count: chunkCount,
      status:      'in_progress',
    }, { onConflict: 'id' });
  } catch { /* silent — checkpoint is best-effort */ }
}

/** Finalise the session row: write notes and mark as done. */
async function finaliseToDB(sessionId: string, userId: string, result: MeetingResult): Promise<void> {
  try {
    const { supabase } = await import('./supabase');
    await supabase.from('meeting_recordings').upsert({
      id:          sessionId,
      user_id:     userId,
      title:       result.title,
      transcript:  result.transcript,
      summary:     result.notes.summary,
      action_items: result.notes.action_items,
      decisions:   result.notes.decisions,
      participants: result.notes.participants,
      chunk_count: result.chunks.length,
      duration_s:  result.durationS,
      ended_at:    new Date().toISOString(),
      status:      'done',
    }, { onConflict: 'id' });
  } catch { /* silent */ }
}

async function feedParticipantsToMemory(userId: string, participants: MeetingParticipant[], title: string) {
  try {
    const { upsertMemoryFact } = await import('./api');
    await Promise.allSettled(
      participants.map(p =>
        upsertMemoryFact({
          user_id:      userId,
          fact_type:    'person',
          subject:      p.name,
          predicate:    'attended',
          object:       `meeting: ${title}`,
          confidence:   70,
          source_tx:    `meeting:${title}`,
          is_confirmed: false,
          is_draft:     true, // single meeting mention → draft
        })
      )
    );
  } catch { /* silent */ }
}

export function createMeetingRecorder(
  userId: string,
  opts: MeetingRecorderOptions,
): MeetingRecorder {
  let stream:   MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let active = false;
  let title = 'Meeting';
  // Stable session UUID created at start() — used for checkpoint upserts
  let sessionId = crypto.randomUUID();
  let chunkIndex = 0;
  let startedAt = 0;
  let totalWords = 0;
  const chunks: MeetingChunk[] = [];
  const transcriptParts: string[] = [];
  let chunkTimer:  ReturnType<typeof setInterval> | null = null;
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let currentBlobs: Blob[] = [];
  const mime = getMime();

  async function flushChunk() {
    if (!currentBlobs.length) return;
    const blob = new Blob(currentBlobs, { type: mime || 'audio/webm' });
    currentBlobs = [];
    const idx = chunkIndex++;
    const chunkStart = Date.now();

    try {
      // transcribeBlob includes 1 automatic retry on failure
      const transcript = await transcribeBlob(blob);
      if (!transcript.trim()) return;

      const words = transcript.trim().split(/\s+/).length;
      totalWords += words;
      transcriptParts.push(transcript);

      const chunk: MeetingChunk = { index: idx, startedAt: chunkStart, transcript, wordCount: words };
      chunks.push(chunk);
      opts.onChunkTranscribed?.(chunk);

      // ✅ Checkpoint: persist rolling transcript to DB so a crash loses at most 1 chunk
      checkpointToDB(sessionId, userId, title, transcriptParts.join('\n\n'), chunks.length).catch(() => {});
    } catch (e) {
      opts.onError?.(`Chunk ${idx} transcription failed: ${String(e)}`);
    }
  }

  async function start(meetingTitle?: string): Promise<boolean> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      return false;
    }

    title     = meetingTitle ?? 'Meeting';
    sessionId = crypto.randomUUID(); // fresh UUID per session
    recorder  = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) currentBlobs.push(e.data); };
    recorder.start(500);
    active    = true;
    startedAt = Date.now();

    // ✅ Create the in_progress row immediately so crash recovery knows a session started
    checkpointToDB(sessionId, userId, title, '', 0).catch(() => {});

    chunkTimer = setInterval(() => { flushChunk().catch(() => {}); }, CHUNK_INTERVAL_MS);
    progressTimer = setInterval(() => {
      opts.onProgress?.(Math.floor((Date.now() - startedAt) / 1000), totalWords);
    }, 5_000);

    return true;
  }

  async function stop(): Promise<MeetingResult> {
    active = false;
    if (chunkTimer)    clearInterval(chunkTimer);
    if (progressTimer) clearInterval(progressTimer);

    // Stop recorder gracefully
    await new Promise<void>((resolve) => {
      if (!recorder || recorder.state === 'inactive') { resolve(); return; }
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    stream?.getTracks().forEach(t => t.stop());

    // Process final chunk
    await flushChunk();

    const durationS = Math.round((Date.now() - startedAt) / 1000);
    const fullTranscript = transcriptParts.join('\n\n');

    // Generate notes via edge fn (GPT-5.5)
    let notes: MeetingNotes;
    try {
      notes = await generateNotes(fullTranscript, title);
    } catch {
      notes = {
        title, summary: 'Note generation failed.',
        action_items: [], decisions: [], participants: [],
        key_topics: [], spoken_summary: 'Roger could not generate notes. Over.',
      };
    }

    const result: MeetingResult = {
      dbId: sessionId, title: notes.title || title,
      notes, transcript: fullTranscript, chunks, durationS,
    };

    // ✅ Finalise the existing row (upsert to done) + feed memory (fire-and-forget)
    finaliseToDB(sessionId, userId, result).catch(() => {});
    feedParticipantsToMemory(userId, notes.participants, notes.title || title).catch(() => {});

    opts.onComplete?.(result);
    return result;
  }

  return {
    start,
    stop,
    getTranscriptSoFar: () => transcriptParts.join('\n\n'),
    getElapsedSeconds:  () => active ? Math.round((Date.now() - startedAt) / 1000) : 0,
    isActive: () => active,
  };
}
