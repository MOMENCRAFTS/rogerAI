// ── SmartThings client library ─────────────────────────────────────────────────
// Calls the `smartthings-control` Supabase edge function to interact with
// Samsung SmartThings API. The user's PAT is passed through to the edge function.

import { supabase } from './supabase';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── Types ─────────────────────────────────────────────────────────────────────

export type SmartThingsDevice = {
  deviceId: string;
  name: string;
  label: string;
  roomId?: string;
  locationId?: string;
  components: {
    id: string;
    capabilities: { id: string; version: number }[];
  }[];
  // Derived from status query
  switchState?: 'on' | 'off';
  level?: number;
  lockState?: 'locked' | 'unlocked';
  doorState?: 'open' | 'closed';
  temperature?: number;
};

export type SmartThingsScene = {
  sceneId: string;
  sceneName: string;
  sceneIcon?: string;
  sceneColor?: string;
};

// Capability → friendly label mapping for UI
export const ST_CAPABILITY_LABELS: Record<string, { label: string; emoji: string }> = {
  switch:                       { label: 'Switch',       emoji: '🔲' },
  switchLevel:                  { label: 'Dimmer',       emoji: '🔆' },
  colorControl:                 { label: 'Color Light',  emoji: '🌈' },
  lock:                         { label: 'Lock',         emoji: '🔒' },
  doorControl:                  { label: 'Garage Door',  emoji: '🏠' },
  thermostat:                   { label: 'Thermostat',   emoji: '🌡️' },
  thermostatCoolingSetpoint:    { label: 'AC Setpoint',  emoji: '❄️' },
  thermostatHeatingSetpoint:    { label: 'Heater',       emoji: '🔥' },
  motionSensor:                 { label: 'Motion',       emoji: '👁️' },
  contactSensor:                { label: 'Door Sensor',  emoji: '🚪' },
  temperatureMeasurement:       { label: 'Temp Sensor',  emoji: '🌡️' },
  airConditionerMode:           { label: 'AC Mode',      emoji: '❄️' },
};

// ── Helper: call edge function ────────────────────────────────────────────────
async function callSmartThings(body: Record<string, unknown>): Promise<unknown> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON_KEY;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/smartthings-control`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error ?? 'SmartThings request failed');
  }
  return data.result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List all SmartThings devices. */
export async function listSmartThingsDevices(pat: string): Promise<SmartThingsDevice[]> {
  const result = await callSmartThings({ action: 'list_devices', pat });
  return (result as SmartThingsDevice[]) ?? [];
}

/** Get status of a specific device. */
export async function getSmartThingsDeviceStatus(pat: string, deviceId: string): Promise<unknown> {
  return await callSmartThings({ action: 'device_status', pat, device_id: deviceId });
}

/** Send a command to a SmartThings device. */
export async function controlSmartThingsDevice(
  pat: string,
  deviceId: string,
  commands: { capability: string; command: string; arguments?: unknown[] }[],
): Promise<boolean> {
  await callSmartThings({ action: 'send_command', pat, device_id: deviceId, commands });
  return true;
}

/** List all SmartThings scenes. */
export async function listSmartThingsScenes(pat: string): Promise<SmartThingsScene[]> {
  const result = await callSmartThings({ action: 'list_scenes', pat });
  return (result as SmartThingsScene[]) ?? [];
}

/** Execute a SmartThings scene. */
export async function executeSmartThingsScene(pat: string, sceneId: string): Promise<boolean> {
  await callSmartThings({ action: 'execute_scene', pat, scene_id: sceneId });
  return true;
}

// ── Voice intent helpers ──────────────────────────────────────────────────────

/** Fuzzy-match a spoken device name to a SmartThings device. */
export function matchSmartThingsDevice(spoken: string, devices: SmartThingsDevice[]): SmartThingsDevice | null {
  const norm = spoken.toLowerCase().trim();

  // Exact label match
  const exact = devices.find(d => (d.label ?? d.name).toLowerCase() === norm);
  if (exact) return exact;

  // Partial contains
  const partial = devices.find(d => {
    const label = (d.label ?? d.name).toLowerCase();
    return label.includes(norm) || norm.includes(label);
  });
  if (partial) return partial;

  // Word overlap
  const words = norm.split(/\s+/);
  let best: SmartThingsDevice | null = null;
  let bestScore = 0;
  for (const d of devices) {
    const dWords = (d.label ?? d.name).toLowerCase().split(/\s+/);
    const overlap = words.filter(w => dWords.some(dw => dw.includes(w) || w.includes(dw))).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = d;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Fuzzy-match a spoken scene name. */
export function matchSmartThingsScene(spoken: string, scenes: SmartThingsScene[]): SmartThingsScene | null {
  const norm = spoken.toLowerCase().trim();
  const exact = scenes.find(s => s.sceneName.toLowerCase() === norm);
  if (exact) return exact;
  const partial = scenes.find(s =>
    s.sceneName.toLowerCase().includes(norm) || norm.includes(s.sceneName.toLowerCase())
  );
  return partial ?? null;
}

/** Check if a device has a specific capability. */
export function hasCapability(device: SmartThingsDevice, capability: string): boolean {
  return device.components?.some(c =>
    c.capabilities?.some(cap => cap.id === capability)
  ) ?? false;
}

/**
 * Infer SmartThings command from a spoken intent.
 * Returns a SmartThings capability command object.
 */
export function inferSmartThingsCommand(
  intent: string,
  device: SmartThingsDevice,
  value?: unknown,
  aiAction?: string | null,
): { capability: string; command: string; arguments?: unknown[] } | null {
  const action = aiAction?.toLowerCase() ??
    (intent.includes('ON') || intent.includes('OPEN') ? 'on' :
     intent.includes('OFF') || intent.includes('CLOSE') ? 'off' :
     intent.includes('LOCK') ? 'lock' :
     intent.includes('UNLOCK') ? 'unlock' :
     intent.includes('DIM') || intent.includes('BRIGHTNESS') ? 'set' :
     intent.includes('TEMP') || intent.includes('SET') ? 'set' :
     'on');

  // Lock
  if (hasCapability(device, 'lock')) {
    if (action === 'lock')   return { capability: 'lock', command: 'lock' };
    if (action === 'unlock') return { capability: 'lock', command: 'unlock' };
    // Default for locks
    return { capability: 'lock', command: action === 'off' ? 'unlock' : 'lock' };
  }

  // Garage door / door control
  if (hasCapability(device, 'doorControl')) {
    if (action === 'on' || action === 'open')  return { capability: 'doorControl', command: 'open' };
    if (action === 'off' || action === 'close') return { capability: 'doorControl', command: 'close' };
    return { capability: 'doorControl', command: value ? 'open' : 'close' };
  }

  // Thermostat
  if (hasCapability(device, 'thermostatCoolingSetpoint') && action === 'set' && typeof value === 'number') {
    return { capability: 'thermostatCoolingSetpoint', command: 'setCoolingSetpoint', arguments: [value] };
  }
  if (hasCapability(device, 'thermostatHeatingSetpoint') && action === 'set' && typeof value === 'number') {
    return { capability: 'thermostatHeatingSetpoint', command: 'setHeatingSetpoint', arguments: [value] };
  }

  // Dimmer
  if (hasCapability(device, 'switchLevel') && action === 'set') {
    const level = typeof value === 'number' ? value : 50;
    return { capability: 'switchLevel', command: 'setLevel', arguments: [level] };
  }

  // Switch (fallback for most devices)
  if (hasCapability(device, 'switch')) {
    if (action === 'on' || action === 'open')  return { capability: 'switch', command: 'on' };
    if (action === 'off' || action === 'close') return { capability: 'switch', command: 'off' };
    return { capability: 'switch', command: value ? 'on' : 'off' };
  }

  return null;
}
