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
export const TUYA_CATEGORY_LABELS: Record<string, { label: string; emoji: string; iconName: string }> = {
  dj:  { label: 'Light',          emoji: '💡', iconName: 'device-light' },
  dd:  { label: 'Dimmer',         emoji: '🔆', iconName: 'device-dimmer' },
  xdd: { label: 'Ceiling Light',  emoji: '💡', iconName: 'device-light' },
  fwd: { label: 'Downlight',      emoji: '💡', iconName: 'device-light' },
  dc:  { label: 'Light Strip',    emoji: '🌈', iconName: 'device-strip' },
  cz:  { label: 'Plug',           emoji: '🔌', iconName: 'device-plug' },
  pc:  { label: 'Power Strip',    emoji: '🔌', iconName: 'device-plug' },
  kg:  { label: 'Switch',         emoji: '🔲', iconName: 'device-switch' },
  tdq: { label: 'Breaker',        emoji: '⚡', iconName: 'device-breaker' },
  kt:  { label: 'Air Conditioner',emoji: '❄️', iconName: 'device-ac' },
  wk:  { label: 'Thermostat',     emoji: '🌡️', iconName: 'device-thermostat' },
  cl:  { label: 'Curtain',        emoji: '🪟', iconName: 'device-curtain' },
  ms:  { label: 'Lock',           emoji: '🔒', iconName: 'device-lock' },
  ywbh:{ label: 'Smoke Detector', emoji: '🚨', iconName: 'device-smoke' },
  rqbh:{ label: 'Gas Detector',   emoji: '⚠️', iconName: 'device-gas' },
  pir: { label: 'Motion Sensor',  emoji: '👁️', iconName: 'device-motion' },
  mcs: { label: 'Door Sensor',    emoji: '🚪', iconName: 'device-door' },
  wsdcg:{ label: 'Temp/Humidity', emoji: '🌡️', iconName: 'device-thermostat' },
  sp:  { label: 'Camera',         emoji: '📷', iconName: 'device-camera' },
  ckmkzq: { label: 'Garage Door', emoji: '🏠', iconName: 'device-garage' },
  bh:  { label: 'Heater',         emoji: '🔥', iconName: 'device-heater' },
  fs:  { label: 'Fan',            emoji: '🌀', iconName: 'device-fan' },
  jsq: { label: 'Humidifier',     emoji: '💨', iconName: 'device-humidifier' },
  cs:  { label: 'Dehumidifier',   emoji: '💧', iconName: 'device-dehumidifier' },
  sd:  { label: 'Robot Vacuum',   emoji: '🤖', iconName: 'device-vacuum' },
  qn:  { label: 'Heater',         emoji: '🔥', iconName: 'device-heater' },
  xxj: { label: 'Diffuser',       emoji: '🌸', iconName: 'device-diffuser' },
  zndb:{ label: 'Smart Meter',    emoji: '📊', iconName: 'device-meter' },
  dlq: { label: 'Circuit Breaker',emoji: '⚡', iconName: 'device-breaker' },
  jtmspro: { label: 'Gate Opener',emoji: '🚧', iconName: 'device-gate' },
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
 * @param aiAction - AI-extracted normalized action: 'on' | 'off' | 'set' | 'open' | 'close' | 'stop'
 */
export function inferCommand(
  intent: string,
  deviceCategory: string,
  value?: unknown,
  /** AI-extracted normalized device action (takes priority over intent string parsing) */
  aiAction?: string | null,
): { code: string; value: unknown } | null {
  const cat = deviceCategory.toLowerCase();

  // Normalize the action: AI-extracted action takes priority, then parse from intent string
  const action = aiAction?.toLowerCase() ??
    (intent.includes('ON') || intent.includes('OPEN') ? 'on' :
     intent.includes('OFF') || intent.includes('CLOSE') ? 'off' :
     intent.includes('DIM') || intent.includes('BRIGHTNESS') ? 'set' :
     intent.includes('TEMP') || intent.includes('SET') ? 'set' :
     intent.includes('STOP') ? 'stop' :
     'on'); // default

  // Switch / plug / garage door — simple on/off
  if (['cz', 'pc', 'kg', 'tdq', 'ckmkzq', 'jtmspro'].includes(cat)) {
    if (action === 'on' || action === 'open')  return { code: 'switch_1', value: true };
    if (action === 'off' || action === 'close') return { code: 'switch_1', value: false };
    return { code: 'switch_1', value: value ?? true };
  }

  // Lights
  if (['dj', 'dd', 'xdd', 'fwd', 'dc'].includes(cat)) {
    if (action === 'on')  return { code: 'switch_led', value: true };
    if (action === 'off') return { code: 'switch_led', value: false };
    if (action === 'set') {
      const brightness = typeof value === 'number' ? Math.round(value * 2.55) : 128;
      return { code: 'bright_value_v2', value: Math.max(10, Math.min(1000, brightness * 4)) };
    }
    return { code: 'switch_led', value: value ?? true };
  }

  // AC
  if (['kt', 'wk'].includes(cat)) {
    if (action === 'on')  return { code: 'switch', value: true };
    if (action === 'off') return { code: 'switch', value: false };
    if (action === 'set') {
      return { code: 'temp_set', value: typeof value === 'number' ? value : 24 };
    }
    return { code: 'switch', value: value ?? true };
  }

  // Curtains
  if (cat === 'cl') {
    if (action === 'on' || action === 'open')   return { code: 'control', value: 'open' };
    if (action === 'off' || action === 'close')  return { code: 'control', value: 'close' };
    if (action === 'stop')                        return { code: 'control', value: 'stop' };
    return { code: 'control', value: value ?? 'open' };
  }

  // Fan
  if (cat === 'fs') {
    if (action === 'on')  return { code: 'switch', value: true };
    if (action === 'off') return { code: 'switch', value: false };
    return { code: 'switch', value: value ?? true };
  }

  // Default: try generic switch
  return { code: 'switch_1', value: value ?? true };
}
