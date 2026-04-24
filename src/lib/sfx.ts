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
    if (!ctx) ctx = new AudioContext();
    return ctx;
  } catch { return null; }
}

/** Ensure the AudioContext is running. Must be awaited before playback. */
async function ensureRunning(): Promise<AudioContext | null> {
  const c = getCtx();
  if (!c) return null;
  // Android WebView suspends AudioContext until a user gesture resumes it.
  // We must properly await resume() — fire-and-forget causes silent playback.
  if (c.state === 'suspended') {
    try { await c.resume(); } catch { return null; }
  }
  return c.state === 'running' ? c : null;
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
