// ── EZVIZ Security Camera client library ──────────────────────────────────────
// Calls the `ezviz-control` Supabase edge function to interact with EZVIZ Cloud.
// Credentials never touch the client — only the server-side function holds them.

import { supabase } from './supabase';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── Types ─────────────────────────────────────────────────────────────────────

export type EzvizDevice = {
  deviceSerial: string;
  deviceName: string;
  deviceType: string;
  status: number;        // 1 = online, 2 = offline
  defence: number;       // 0 = disarmed, 1 = armed
  isEncrypt: number;     // 0 = unencrypted, 1 = encrypted
  deviceCover?: string;  // thumbnail URL
  category?: string;     // e.g. 'IPC' (camera), 'DVR', etc.
};

export type EzvizAlarm = {
  alarmId: string;
  alarmName: string;
  alarmType: number;
  alarmTime: number;     // epoch ms
  deviceSerial: string;
  channelNo: number;
  alarmPicUrl?: string;
  isRead: number;        // 0 = unread, 1 = read
};

export type EzvizSnapshot = {
  picUrl: string;
};

// PTZ direction constants
export const PTZ_DIRECTION = {
  UP:        '0',
  DOWN:      '1',
  LEFT:      '2',
  RIGHT:     '3',
  UP_LEFT:   '4',
  DOWN_LEFT: '5',
  UP_RIGHT:  '6',
  DOWN_RIGHT:'7',
  ZOOM_IN:   '8',
  ZOOM_OUT:  '9',
} as const;

// ── Helper: call edge function ────────────────────────────────────────────────
async function callEzviz(body: Record<string, unknown>): Promise<unknown> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON_KEY;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ezviz-control`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error ?? 'EZVIZ request failed');
  }
  return data.result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List all EZVIZ devices (cameras, doorbells, locks). */
export async function listEzvizDevices(): Promise<EzvizDevice[]> {
  const result = await callEzviz({ action: 'list_devices' });
  return (result as EzvizDevice[]) ?? [];
}

/** Get info for a specific device. */
export async function getEzvizDeviceInfo(deviceSerial: string): Promise<EzvizDevice> {
  const result = await callEzviz({ action: 'device_info', device_serial: deviceSerial });
  return result as EzvizDevice;
}

/** Capture a snapshot from a camera. Returns the image URL. */
export async function captureSnapshot(deviceSerial: string): Promise<string | null> {
  try {
    const result = await callEzviz({ action: 'capture_image', device_serial: deviceSerial });
    return (result as EzvizSnapshot)?.picUrl ?? null;
  } catch {
    return null;
  }
}

/** Arm a camera (enable motion detection / defence mode). */
export async function armDevice(deviceSerial: string): Promise<boolean> {
  await callEzviz({ action: 'set_defence', device_serial: deviceSerial, is_defence: '1' });
  return true;
}

/** Disarm a camera (disable motion detection / defence mode). */
export async function disarmDevice(deviceSerial: string): Promise<boolean> {
  await callEzviz({ action: 'set_defence', device_serial: deviceSerial, is_defence: '0' });
  return true;
}

/** Arm all cameras. Returns count of armed devices. */
export async function armAll(): Promise<number> {
  const devices = await listEzvizDevices();
  const online = devices.filter(d => d.status === 1);
  let count = 0;
  for (const d of online) {
    try {
      await armDevice(d.deviceSerial);
      count++;
    } catch { /* skip failed devices */ }
  }
  return count;
}

/** Disarm all cameras. Returns count of disarmed devices. */
export async function disarmAll(): Promise<number> {
  const devices = await listEzvizDevices();
  const online = devices.filter(d => d.status === 1);
  let count = 0;
  for (const d of online) {
    try {
      await disarmDevice(d.deviceSerial);
      count++;
    } catch { /* skip failed devices */ }
  }
  return count;
}

/** Start PTZ movement. */
export async function ptzStart(
  deviceSerial: string,
  direction: string,
  speed = '1',
): Promise<boolean> {
  await callEzviz({
    action: 'ptz_start',
    device_serial: deviceSerial,
    direction,
    speed,
  });
  return true;
}

/** Stop PTZ movement. */
export async function ptzStop(deviceSerial: string): Promise<boolean> {
  await callEzviz({ action: 'ptz_stop', device_serial: deviceSerial });
  return true;
}

/** Get alarm/event list for a device (default: last 24 hours). */
export async function getAlarms(
  deviceSerial: string,
  hoursBack = 24,
): Promise<EzvizAlarm[]> {
  const now = Date.now();
  const start = now - hoursBack * 60 * 60 * 1000;
  const result = await callEzviz({
    action: 'alarm_list',
    device_serial: deviceSerial,
    start_time: String(start),
    end_time: String(now),
  });
  return (result as EzvizAlarm[]) ?? [];
}

// ── Voice intent helpers ──────────────────────────────────────────────────────

/** Fuzzy-match a spoken camera name to an EZVIZ device. */
export function matchCamera(spoken: string, devices: EzvizDevice[]): EzvizDevice | null {
  const norm = spoken.toLowerCase().trim();

  // Exact name match
  const exact = devices.find(d => d.deviceName.toLowerCase() === norm);
  if (exact) return exact;

  // Partial contains
  const partial = devices.find(d =>
    d.deviceName.toLowerCase().includes(norm) || norm.includes(d.deviceName.toLowerCase())
  );
  if (partial) return partial;

  // Word overlap
  const words = norm.split(/\s+/);
  let best: EzvizDevice | null = null;
  let bestScore = 0;
  for (const d of devices) {
    const dWords = d.deviceName.toLowerCase().split(/\s+/);
    const overlap = words.filter(w => dWords.some(dw => dw.includes(w) || w.includes(dw))).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = d;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Parse a spoken PTZ direction to EZVIZ direction code. */
export function parsePtzDirection(spoken: string): string | null {
  const norm = spoken.toLowerCase().trim();
  if (norm.includes('up') && norm.includes('left'))    return PTZ_DIRECTION.UP_LEFT;
  if (norm.includes('up') && norm.includes('right'))   return PTZ_DIRECTION.UP_RIGHT;
  if (norm.includes('down') && norm.includes('left'))  return PTZ_DIRECTION.DOWN_LEFT;
  if (norm.includes('down') && norm.includes('right')) return PTZ_DIRECTION.DOWN_RIGHT;
  if (norm.includes('up'))        return PTZ_DIRECTION.UP;
  if (norm.includes('down'))      return PTZ_DIRECTION.DOWN;
  if (norm.includes('left'))      return PTZ_DIRECTION.LEFT;
  if (norm.includes('right'))     return PTZ_DIRECTION.RIGHT;
  if (norm.includes('zoom in'))   return PTZ_DIRECTION.ZOOM_IN;
  if (norm.includes('zoom out'))  return PTZ_DIRECTION.ZOOM_OUT;
  return null;
}
