/**
 * audioRecorder.ts — MediaRecorder-based audio capture for PTT.
 *
 * Captures microphone audio while the PTT button is held, returns a
 * WebM/Opus blob on release. Also provides real-time amplitude data
 * for the waveform visualizer via Web Audio API AnalyserNode.
 */

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function getSupportedMimeType(): string {
  for (const type of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return ''; // let the browser decide
}

export interface AudioRecorder {
  /** Start recording. Returns false if mic permission denied. */
  start(): Promise<boolean>;
  /** Stop recording. Returns the captured audio blob. */
  stop(): Promise<Blob>;
  /** Current amplitude 0–1, sampled live. Use for waveform bars. */
  getAmplitude(): number;
  /** Release mic stream (call when done with the recorder instance). */
  dispose(): void;
}

/**
 * Create a new AudioRecorder instance.
 * Must call start() before stop().
 */
export async function createAudioRecorder(): Promise<AudioRecorder> {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let amplitudeData: any = new Uint8Array(0);
  let mimeType = '';

  function getAmplitude(): number {
    if (!analyser || amplitudeData.length === 0) return 0;
    analyser.getByteTimeDomainData(amplitudeData);
    // RMS amplitude normalised to 0–1
    let sum = 0;
    for (const v of amplitudeData) {
      const norm = (v - 128) / 128;
      sum += norm * norm;
    }
    return Math.sqrt(sum / amplitudeData.length);
  }

  async function start(): Promise<boolean> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      return false; // permission denied or no mic
    }

    // Web Audio Analyser for waveform
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    amplitudeData = new Uint8Array(analyser.frequencyBinCount);
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    // MediaRecorder for capture
    mimeType = getSupportedMimeType();
    chunks = [];
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start(100); // collect chunks every 100ms
    return true;
  }

  function stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }));
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
        resolve(blob);
      };
      recorder.stop();
      // Stop all mic tracks so the recording indicator clears on device
      stream?.getTracks().forEach(t => t.stop());
    });
  }

  function dispose() {
    try { recorder?.stop(); } catch {}
    stream?.getTracks().forEach(t => t.stop());
    audioCtx?.close();
    stream = null;
    recorder = null;
    audioCtx = null;
    analyser = null;
  }

  return { start, stop, getAmplitude, dispose };
}

/** True if this browser/device supports MediaRecorder at all. */
export const MEDIA_RECORDER_SUPPORTED =
  typeof MediaRecorder !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function';
