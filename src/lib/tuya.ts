// ── Tuya Smart Home client library ────────────────────────────────────────────
// Calls the `tuya-control` Supabase edge function to interact with Tuya Cloud.
// Credentials never touch the client — only the server-side function holds them.

import { supabase } from './supabase';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── Types ─────────────────────────────────────────────────────────────────────

export type TuyaDeviceStatus = { code: string; value: unknown };

export type TuyaDevice = {
  id: string;
  name: string;
  category: string;
  product_name: string;
  online: boolean;
  icon: string;
  home_name: string;
  home_id: number;
  status: TuyaDeviceStatus[];
};

export type TuyaScene = {
  scene_id: string;
  name: string;
  // background?: string;
};

// Category display mapping for common SmartLife device types
export const TUYA_CATEGORY_LABELS: Record<string, { label: string; emoji: string }> = {
  dj:  { label: 'Light',          emoji: '💡' },
  dd:  { label: 'Dimmer',         emoji: '🔆' },
  xdd: { label: 'Ceiling Light',  emoji: '💡' },
  fwd: { label: 'Downlight',      emoji: '💡' },
  dc:  { label: 'Light Strip',    emoji: '🌈' },
  cz:  { label: 'Plug',           emoji: '🔌' },
  pc:  { label: 'Power Strip',    emoji: '🔌' },
  kg:  { label: 'Switch',         emoji: '🔲' },
  tdq: { label: 'Breaker',        emoji: '⚡' },
  kt:  { label: 'Air Conditioner',emoji: '❄️' },
  wk:  { label: 'Thermostat',     emoji: '🌡️' },
  cl:  { label: 'Curtain',        emoji: '🪟' },
  ms:  { label: 'Lock',           emoji: '🔒' },
  ywbh:{ label: 'Smoke Detector', emoji: '🚨' },
  rqbh:{ label: 'Gas Detector',   emoji: '⚠️' },
  pir: { label: 'Motion Sensor',  emoji: '👁️' },
  mcs: { label: 'Door Sensor',    emoji: '🚪' },
  wsdcg:{ label: 'Temp/Humidity', emoji: '🌡️' },
  sp:  { label: 'Camera',         emoji: '📷' },
  ckmkzq: { label: 'Garage Door', emoji: '🏠' },
  bh:  { label: 'Heater',         emoji: '🔥' },
  fs:  { label: 'Fan',            emoji: '🌀' },
  jsq: { label: 'Humidifier',     emoji: '💨' },
  cs:  { label: 'Dehumidifier',   emoji: '💧' },
  sd:  { label: 'Robot Vacuum',   emoji: '🤖' },
  qn:  { label: 'Heater',         emoji: '🔥' },
  xxj: { label: 'Diffuser',       emoji: '🌸' },
  zndb:{ label: 'Smart Meter',    emoji: '📊' },
  dlq: { label: 'Circuit Breaker',emoji: '⚡' },
  jtmspro: { label: 'Gate Opener',emoji: '🚧' },
};

// ── Helper: call edge function ────────────────────────────────────────────────
async function callTuya(body: Record<string, unknown>): Promise<unknown> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON_KEY;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/tuya-control`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error ?? 'Tuya request failed');
  }
  return data.result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List all devices across the user's Tuya homes. */
export async function listTuyaDevices(tuyaUid: string): Promise<TuyaDevice[]> {
  const result = await callTuya({ action: 'list_devices', tuya_uid: tuyaUid });
  return (result as TuyaDevice[]) ?? [];
}

/** Get current status of a device. */
export async function getDeviceStatus(deviceId: string): Promise<TuyaDeviceStatus[]> {
  const result = await callTuya({ action: 'device_status', device_id: deviceId });
  return (result as TuyaDeviceStatus[]) ?? [];
}

/** Send commands to a device. */
export async function controlDevice(
  deviceId: string,
  commands: { code: string; value: unknown }[]
): Promise<boolean> {
  await callTuya({ action: 'send_command', device_id: deviceId, commands });
  return true;
}

/** List tap-to-run scenes for a home. */
export async function listTuyaScenes(homeId: string): Promise<TuyaScene[]> {
  const result = await callTuya({ action: 'list_scenes', home_id: homeId });
  return (result as TuyaScene[]) ?? [];
}

/** Trigger a tap-to-run scene. */
export async function triggerTuyaScene(homeId: string, sceneId: string): Promise<boolean> {
  await callTuya({ action: 'trigger_scene', home_id: homeId, scene_id: sceneId });
  return true;
}

// ── Voice intent helpers ──────────────────────────────────────────────────────

/** Fuzzy-match a spoken device name to a Tuya device from the device list. */
export function matchDevice(spoken: string, devices: TuyaDevice[]): TuyaDevice | null {
  const norm = spoken.toLowerCase().trim();
  // Exact name match
  const exact = devices.find(d => d.name.toLowerCase() === norm);
  if (exact) return exact;
  // Partial contains match
  const partial = devices.find(d =>
    d.name.toLowerCase().includes(norm) || norm.includes(d.name.toLowerCase())
  );
  if (partial) return partial;
  // Word overlap match (best effort)
  const words = norm.split(/\s+/);
  let best: TuyaDevice | null = null;
  let bestScore = 0;
  for (const d of devices) {
    const dWords = d.name.toLowerCase().split(/\s+/);
    const overlap = words.filter(w => dWords.some(dw => dw.includes(w) || w.includes(dw))).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = d;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Fuzzy-match a spoken scene name to a Tuya scene. */
export function matchScene(spoken: string, scenes: TuyaScene[]): TuyaScene | null {
  const norm = spoken.toLowerCase().trim();
  const exact = scenes.find(s => s.name.toLowerCase() === norm);
  if (exact) return exact;
  const partial = scenes.find(s =>
    s.name.toLowerCase().includes(norm) || norm.includes(s.name.toLowerCase())
  );
  return partial ?? null;
}

/**
 * Infer Tuya command code from a spoken intent.
 * Returns a standard Tuya command object.
 */
export function inferCommand(
  intent: string,
  deviceCategory: string,
  value?: unknown
): { code: string; value: unknown } | null {
  const cat = deviceCategory.toLowerCase();

  // Switch / plug / garage door — simple on/off
  if (['cz', 'pc', 'kg', 'tdq', 'ckmkzq', 'jtmspro'].includes(cat)) {
    if (intent.includes('ON') || intent.includes('OPEN')) {
      return { code: 'switch_1', value: true };
    }
    if (intent.includes('OFF') || intent.includes('CLOSE')) {
      return { code: 'switch_1', value: false };
    }
    // Toggle
    return { code: 'switch_1', value: value ?? true };
  }

  // Lights
  if (['dj', 'dd', 'xdd', 'fwd', 'dc'].includes(cat)) {
    if (intent.includes('ON'))  return { code: 'switch_led', value: true };
    if (intent.includes('OFF')) return { code: 'switch_led', value: false };
    if (intent.includes('DIM') || intent.includes('BRIGHTNESS')) {
      const brightness = typeof value === 'number' ? Math.round(value * 2.55) : 128;
      return { code: 'bright_value_v2', value: Math.max(10, Math.min(1000, brightness * 4)) };
    }
    return { code: 'switch_led', value: value ?? true };
  }

  // AC
  if (['kt', 'wk'].includes(cat)) {
    if (intent.includes('ON'))  return { code: 'switch', value: true };
    if (intent.includes('OFF')) return { code: 'switch', value: false };
    if (intent.includes('TEMP') || intent.includes('SET')) {
      return { code: 'temp_set', value: typeof value === 'number' ? value : 24 };
    }
    return { code: 'switch', value: value ?? true };
  }

  // Curtains
  if (cat === 'cl') {
    if (intent.includes('OPEN'))  return { code: 'control', value: 'open' };
    if (intent.includes('CLOSE')) return { code: 'control', value: 'close' };
    if (intent.includes('STOP'))  return { code: 'control', value: 'stop' };
    return { code: 'control', value: value ?? 'open' };
  }

  // Fan
  if (cat === 'fs') {
    if (intent.includes('ON'))  return { code: 'switch', value: true };
    if (intent.includes('OFF')) return { code: 'switch', value: false };
    return { code: 'switch', value: value ?? true };
  }

  // Default: try generic switch
  return { code: 'switch_1', value: value ?? true };
}
