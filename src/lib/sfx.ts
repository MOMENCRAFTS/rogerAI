/**
 * sfx.ts — Subtle PTT radio sound effects for Roger AI
 * Uses Web Audio API; lazy-inits AudioContext on first interaction.
 * Falls back silently on web/desktop or if files are missing.
 *
 * ANDROID FIX: AudioContext is always "suspended" on Android WebView until a real
 * user gesture resumes it. The previous code called ctx.resume() fire-and-forget,
 * which meant play() ran on a suspended context and produced silence. Fixed by
 * awaiting resume() inside an async play() before scheduling the buffer source.
 */

let ctx: AudioContext | null = null;
let masterGain               = 0.35;
let sfxEnabled               = true;
let loading: Promise<void>  | null = null;

// Cooldown gate — avoids hammering ctx.resume() when the device
// keeps suspending the context (common on Android WebView).
let _lastResumeFail = 0;
const RESUME_COOLDOWN_MS = 2000;

const buffers = new Map<string, AudioBuffer>();

const SFX: Record<string, string> = {
  'ptt-down':  '/sfx/ptt-down.wav',
  'ptt-up':    '/sfx/ptt-up.wav',
  'roger-in':  '/sfx/roger-in.wav',
  'roger-out': '/sfx/roger-out.wav',
  'error':     '/sfx/error.wav',
};

function getCtx(): AudioContext | null {
  try {
    // If the AudioContext has been closed (e.g. system reclaimed it),
    // discard and create a fresh one.
    if (ctx && ctx.state === 'closed') {
      ctx = null;
    }
    if (!ctx) {
      ctx = new AudioContext();
      // Auto-recover from system suspensions (screen off → on, app resume)
      ctx.onstatechange = () => {
        if (ctx?.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
      };
    }
    return ctx;
  } catch { return null; }
}

/** Ensure the AudioContext is running. Must be awaited before playback. */
async function ensureRunning(): Promise<AudioContext | null> {
  const c = getCtx();
  if (!c) return null;
  if (c.state === 'running') return c;
  // Android WebView suspends AudioContext until a user gesture resumes it.
  // We must properly await resume() — fire-and-forget causes silent playback.
  // Cooldown prevents spamming resume() when the device keeps killing it.
  if (c.state === 'suspended') {
    const now = Date.now();
    if (now - _lastResumeFail < RESUME_COOLDOWN_MS) return null;
    try {
      await c.resume();
    } catch {
      _lastResumeFail = now;
      return null;
    }
    if ((c.state as string) !== 'running') {
      _lastResumeFail = now;
      return null;
    }
  }
  return (c.state as string) === 'running' ? c : null;
}

async function loadBuf(name: string, url: string): Promise<void> {
  const c = getCtx();
  if (!c) return;
  try {
    const res = await fetch(url);
    const ab  = await res.arrayBuffer();
    buffers.set(name, await c.decodeAudioData(ab));
  } catch { /* silent — missing file or decode error */ }
}

/** Call once on component mount to pre-decode all buffers (zero-latency playback). */
export function preloadAll(): void {
  if (loading) return;
  loading = Promise.all(Object.entries(SFX).map(([k, v]) => loadBuf(k, v))).then(() => {});
}

/**
 * Prime the AudioContext on the first user gesture (PTT touch / permission grant).
 * Call this from any touch handler to guarantee context is running before the
 * first sound needs to play. Safe to call multiple times.
 */
export async function unlockSfxContext(): Promise<void> {
  await ensureRunning();
}

async function play(name: string): Promise<void> {
  if (!sfxEnabled) return;
  const c   = await ensureRunning();
  const buf = buffers.get(name);
  if (!c || !buf) return;
  try {
    const gain = c.createGain();
    gain.gain.value = masterGain;
    gain.connect(c.destination);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.start();
  } catch { /* silent */ }
}

/** Adjust SFX volume globally (0–1). Persists until next call. */
export function setSfxVolume(v: number): void { masterGain = Math.max(0, Math.min(1, v)); }

/** Enable or disable all SFX at runtime (called from RogerSettings). */
export function setSfxEnabled(v: boolean): void { sfxEnabled = v; }

export function sfxPTTDown():  void { play('ptt-down').catch(() => {}); }
export function sfxPTTUp():    void { play('ptt-up').catch(() => {}); }
export function sfxRogerIn():  void { play('roger-in').catch(() => {}); }
export function sfxRogerOut(): void { play('roger-out').catch(() => {}); }
export function sfxError():    void { play('error').catch(() => {}); }

/**
 * sfxRogerPing — synthesized short radio-static attention ping.
 * No audio file required. Uses Web Audio noise + bandpass + envelope.
 * driveMode = true → louder burst for in-car.
 */
export async function sfxRogerPing(driveMode = false): Promise<void> {
  if (!sfxEnabled) return;
  const c = await ensureRunning();
  if (!c) return;
  try {
    const dur    = 0.45;
    const volume = driveMode ? Math.min(1, masterGain * 2.5) : masterGain * 0.9;

    // White noise buffer (0.5s)
    const frames = Math.ceil(c.sampleRate * dur);
    const buf    = c.createBuffer(1, frames, c.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    // Bandpass → gives "radio" character
    const bp        = c.createBiquadFilter();
    bp.type         = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value      = 0.8;

    // Gain envelope: fast attack, fast decay
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(volume, c.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);

    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(bp);
    bp.connect(gain);
    gain.connect(c.destination);
    src.start();
    src.stop(c.currentTime + dur);
  } catch { /* silent */ }
}

