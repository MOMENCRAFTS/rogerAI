// supabase/functions/tuya-control/index.ts
// Secure Tuya Cloud API proxy — HMAC-SHA256 signed requests.
// Secrets (APP_KEY, APP_SECRET) stay server-side in Supabase secrets.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const TUYA_APP_KEY    = Deno.env.get('TUYA_APP_KEY') ?? '';
const TUYA_APP_SECRET = Deno.env.get('TUYA_APP_SECRET') ?? '';
// Global / Central Europe data center — override via TUYA_API_ENDPOINT secret
const TUYA_BASE_URL   = Deno.env.get('TUYA_API_ENDPOINT') ?? 'https://openapi.tuyaus.com';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ── Token cache (in-memory, per-isolate) ──────────────────────────────────────
let cachedToken: { access_token: string; expires_at: number } | null = null;

// ── Crypto helpers ────────────────────────────────────────────────────────────
async function hmacSHA256(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(content));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Build Tuya signature ──────────────────────────────────────────────────────
async function buildHeaders(
  method: string, path: string, body: string = '', accessToken: string = ''
): Promise<Record<string, string>> {
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const contentHash = await sha256(body);
  const stringToSign = [method, contentHash, '', path].join('\n');
  const str = accessToken
    ? `${TUYA_APP_KEY}${accessToken}${t}${nonce}${stringToSign}`
    : `${TUYA_APP_KEY}${t}${nonce}${stringToSign}`;
  const sign = await hmacSHA256(str, TUYA_APP_SECRET);

  return {
    'client_id': TUYA_APP_KEY,
    'sign': sign,
    'sign_method': 'HMAC-SHA256',
    't': t,
    'nonce': nonce,
    ...(accessToken ? { 'access_token': accessToken } : {}),
    'Content-Type': 'application/json',
  };
}

// ── Get or refresh access token ───────────────────────────────────────────────
async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at) {
    return cachedToken.access_token;
  }

  const path = '/v1.0/token?grant_type=1';
  const headers = await buildHeaders('GET', path);
  const res = await fetch(`${TUYA_BASE_URL}${path}`, { method: 'GET', headers });
  const data = await res.json();

  if (!data.success) {
    throw new Error(`Tuya token error: ${data.msg ?? JSON.stringify(data)}`);
  }

  cachedToken = {
    access_token: data.result.access_token,
    expires_at: Date.now() + (data.result.expire_time * 1000) - 60000, // refresh 1 min early
  };
  return cachedToken.access_token;
}

// ── Tuya API caller ───────────────────────────────────────────────────────────
async function tuyaRequest(
  method: string, path: string, body?: Record<string, unknown>
): Promise<unknown> {
  const token = await getToken();
  const bodyStr = body ? JSON.stringify(body) : '';
  const headers = await buildHeaders(method, path, bodyStr, token);
  const res = await fetch(`${TUYA_BASE_URL}${path}`, {
    method,
    headers,
    ...(body ? { body: bodyStr } : {}),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(`Tuya API error [${path}]: ${data.msg ?? data.code ?? JSON.stringify(data)}`);
  }
  return data.result;
}

// ── List all devices for a user ───────────────────────────────────────────────
async function listDevices(tuyaUid: string): Promise<unknown[]> {
  // 1. Get user's homes
  const homes = await tuyaRequest('GET', `/v1.0/users/${tuyaUid}/homes`) as { home_id: number; name: string }[];
  if (!homes || homes.length === 0) return [];

  // 2. Get devices from each home
  const allDevices: unknown[] = [];
  for (const home of homes) {
    try {
      const devices = await tuyaRequest('GET', `/v1.0/homes/${home.home_id}/devices`) as unknown[];
      if (devices) {
        allDevices.push(...devices.map((d: unknown) => ({
          ...(d as Record<string, unknown>),
          home_name: home.name,
          home_id: home.home_id,
        })));
      }
    } catch { /* some homes may have no devices */ }
  }
  return allDevices;
}

// ── List scenes for a home ────────────────────────────────────────────────────
async function listScenes(homeId: string): Promise<unknown[]> {
  const scenes = await tuyaRequest('GET', `/v1.0/homes/${homeId}/scenes`) as unknown[];
  return scenes ?? [];
}

// ── Trigger a scene ───────────────────────────────────────────────────────────
async function triggerScene(homeId: string, sceneId: string): Promise<boolean> {
  await tuyaRequest('POST', `/v1.0/homes/${homeId}/scenes/${sceneId}/trigger`);
  return true;
}

// ── Send commands to a device ─────────────────────────────────────────────────
async function sendCommand(
  deviceId: string, commands: { code: string; value: unknown }[]
): Promise<boolean> {
  await tuyaRequest('POST', `/v1.0/devices/${deviceId}/commands`, { commands });
  return true;
}

// ── Get device status ─────────────────────────────────────────────────────────
async function getDeviceStatus(deviceId: string): Promise<unknown> {
  return await tuyaRequest('GET', `/v1.0/devices/${deviceId}/status`);
}

// ── Get device specifications (functions + status codes) ──────────────────────
async function getDeviceSpec(deviceId: string): Promise<unknown> {
  return await tuyaRequest('GET', `/v1.0/devices/${deviceId}/specifications`);
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    if (!TUYA_APP_KEY || !TUYA_APP_SECRET) {
      return new Response(
        JSON.stringify({ error: 'Tuya credentials not configured. Set TUYA_APP_KEY and TUYA_APP_SECRET in Supabase secrets.' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const { action, tuya_uid, device_id, commands, home_id, scene_id } = await req.json() as {
      action: string;
      tuya_uid?: string;
      device_id?: string;
      commands?: { code: string; value: unknown }[];
      home_id?: string;
      scene_id?: string;
    };

    let result: unknown;

    switch (action) {
      case 'list_devices': {
        if (!tuya_uid) throw new Error('tuya_uid required for list_devices');
        result = await listDevices(tuya_uid);
        break;
      }
      case 'device_status': {
        if (!device_id) throw new Error('device_id required for device_status');
        result = await getDeviceStatus(device_id);
        break;
      }
      case 'device_spec': {
        if (!device_id) throw new Error('device_id required for device_spec');
        result = await getDeviceSpec(device_id);
        break;
      }
      case 'send_command': {
        if (!device_id || !commands) throw new Error('device_id and commands required');
        result = await sendCommand(device_id, commands);
        break;
      }
      case 'list_scenes': {
        if (!home_id) throw new Error('home_id required for list_scenes');
        result = await listScenes(home_id);
        break;
      }
      case 'trigger_scene': {
        if (!home_id || !scene_id) throw new Error('home_id and scene_id required');
        result = await triggerScene(home_id, scene_id);
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: String(e) }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
