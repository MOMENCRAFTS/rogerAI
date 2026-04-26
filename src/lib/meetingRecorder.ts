/**
 * meetingRecorder.ts — "Roger, record meeting" structured session engine.
 *
 * Architecture:
 *  - MediaRecorder runs continuously in 60-second rolling chunks
 *  - Each chunk → Whisper transcription (language auto-detected)
 *  - Accumulates full rolling transcript in memory
 *  - On stop() → generate-meeting-notes edge fn (GPT-5.5) → structured notes
 *  - Saves to meeting_recordings table + feeds key participants into memory_graph
 *
 * Usage:
 *   const recorder = createMeetingRecorder({ onChunk, onComplete, onError });
 *   const sessionId = await recorder.start('Q2 Budget Review');
 *   // ...
 *   const notes = await recorder.stop();
 */

const CHUNK_INTERVAL_MS = 60_000; // 60-second rolling chunks

const SUPABASE_URL      = (typeof import.meta !== 'undefined')
  ? (import.meta as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL ?? ''
  : '';
const SUPABASE_ANON_KEY = (typeof import.meta !== 'undefined')
  ? (import.meta as { env?: Record<string, string> }).env?.VITE_SUPABASE_ANON_KEY ?? ''
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

async function transcribeBlob(blob: Blob): Promise<string> {
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
    if (!res.ok) return '';
    const data = await res.json() as { transcript: string };
    return data.transcript ?? '';
  } catch {
    return '';
  }
}

async function generateNotes(transcript: string, title?: string): Promise<MeetingNotes> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-meeting-notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ transcript, title }),
  });
  if (!res.ok) throw new Error(`Edge fn ${res.status}`);
  return res.json() as Promise<MeetingNotes>;
}

async function saveToDB(userId: string, result: MeetingResult): Promise<string | null> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.from('meeting_recordings').insert({
      user_id:      userId,
      title:        result.title,
      transcript:   result.transcript,
      summary:      result.notes.summary,
      action_items: result.notes.action_items,
      decisions:    result.notes.decisions,
      participants: result.notes.participants,
      chunk_count:  result.chunks.length,
      duration_s:   result.durationS,
      ended_at:     new Date().toISOString(),
      status:       'done',
    }).select('id').single();
    if (error) return null;
    return data?.id ?? null;
  } catch {
    return null;
  }
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
      const transcript = await transcribeBlob(blob);
      if (!transcript.trim()) return;

      const words = transcript.trim().split(/\s+/).length;
      totalWords += words;
      transcriptParts.push(transcript);

      const chunk: MeetingChunk = { index: idx, startedAt: chunkStart, transcript, wordCount: words };
      chunks.push(chunk);
      opts.onChunkTranscribed?.(chunk);
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

    title = meetingTitle ?? 'Meeting';
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) currentBlobs.push(e.data); };
    recorder.start(500);
    active = true;
    startedAt = Date.now();

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
      dbId: null, title: notes.title || title,
      notes, transcript: fullTranscript, chunks, durationS,
    };

    // Save to DB + feed memory (fire-and-forget)
    saveToDB(userId, result).then(id => { result.dbId = id; }).catch(() => {});
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
