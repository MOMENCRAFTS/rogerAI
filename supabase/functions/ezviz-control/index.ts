// supabase/functions/ezviz-control/index.ts
// Secure EZVIZ Cloud API proxy for camera control.
// Secrets (EZVIZ_APP_KEY, EZVIZ_APP_SECRET) stay server-side in Supabase secrets.

const EZVIZ_APP_KEY    = Deno.env.get('EZVIZ_APP_KEY') ?? '';
const EZVIZ_APP_SECRET = Deno.env.get('EZVIZ_APP_SECRET') ?? '';
// Middle East / International endpoint
const EZVIZ_BASE_URL   = Deno.env.get('EZVIZ_API_ENDPOINT') ?? 'https://open.ezvizlife.com';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ── Token cache (in-memory, per-isolate) ──────────────────────────────────────
let cachedToken: { access_token: string; expires_at: number } | null = null;

// ── Get or refresh access token ───────────────────────────────────────────────
async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at) {
    return cachedToken.access_token;
  }

  const form = new URLSearchParams();
  form.append('appKey', EZVIZ_APP_KEY);
  form.append('appSecret', EZVIZ_APP_SECRET);

  const res = await fetch(`${EZVIZ_BASE_URL}/api/lapp/token/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  const data = await res.json();
  if (data.code !== '200' && data.code !== 200) {
    throw new Error(`EZVIZ token error: ${data.msg ?? JSON.stringify(data)}`);
  }

  const result = data.data;
  cachedToken = {
    access_token: result.accessToken,
    // EZVIZ tokens typically last 7 days; refresh 1 hour early
    expires_at: Date.now() + (result.expireTime ?? 604800) * 1000 - 3600000,
  };
  return cachedToken.access_token;
}

// ── EZVIZ API caller ──────────────────────────────────────────────────────────
async function ezvizRequest(
  path: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  const token = await getToken();

  const form = new URLSearchParams();
  form.append('accessToken', token);
  for (const [k, v] of Object.entries(params)) {
    form.append(k, v);
  }

  const res = await fetch(`${EZVIZ_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  const data = await res.json();
  if (data.code !== '200' && data.code !== 200) {
    throw new Error(`EZVIZ API error [${path}]: ${data.msg ?? data.code ?? JSON.stringify(data)}`);
  }
  return data.data ?? data;
}

// ── List all devices ──────────────────────────────────────────────────────────
async function listDevices(): Promise<unknown[]> {
  const result = await ezvizRequest('/api/lapp/device/list');
  return (result as unknown[]) ?? [];
}

// ── Capture a snapshot from a camera ──────────────────────────────────────────
async function captureImage(deviceSerial: string, channelNo = '1'): Promise<unknown> {
  return await ezvizRequest('/api/lapp/device/capture', {
    deviceSerial,
    channelNo,
  });
}

// ── PTZ control (pan/tilt/zoom) ───────────────────────────────────────────────
// direction: 0=up, 1=down, 2=left, 3=right, 4=upleft, 5=downleft, 6=upright, 7=downright
//            8=zoomin, 9=zoomout, 10=focusnear, 11=focusfar
async function ptzStart(
  deviceSerial: string,
  direction: string,
  speed = '1',
): Promise<unknown> {
  return await ezvizRequest('/api/lapp/device/ptz/start', {
    deviceSerial,
    channelNo: '1',
    direction,
    speed,
  });
}

async function ptzStop(deviceSerial: string): Promise<unknown> {
  return await ezvizRequest('/api/lapp/device/ptz/stop', {
    deviceSerial,
    channelNo: '1',
  });
}

// ── Arm / disarm (defence mode) ───────────────────────────────────────────────
// isDefence: 1 = arm, 0 = disarm
async function setDefence(
  deviceSerial: string,
  isDefence: string,
): Promise<unknown> {
  return await ezvizRequest('/api/lapp/device/defence/set', {
    deviceSerial,
    channelNo: '1',
    isDefence,
  });
}

// ── Get alarm/event list ──────────────────────────────────────────────────────
async function getAlarms(
  deviceSerial: string,
  startTime: string,
  endTime: string,
  pageStart = '0',
  pageSize = '10',
): Promise<unknown> {
  return await ezvizRequest('/api/lapp/alarm/device/list', {
    deviceSerial,
    startTime,
    endTime,
    pageStart,
    pageSize,
    status: '2', // 0=unread, 2=all
  });
}

// ── Get device info ───────────────────────────────────────────────────────────
async function getDeviceInfo(deviceSerial: string): Promise<unknown> {
  return await ezvizRequest('/api/lapp/device/info', { deviceSerial });
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    if (!EZVIZ_APP_KEY || !EZVIZ_APP_SECRET) {
      return new Response(
        JSON.stringify({ error: 'EZVIZ credentials not configured. Set EZVIZ_APP_KEY and EZVIZ_APP_SECRET in Supabase secrets.' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json() as Record<string, string>;
    const { action, device_serial, direction, speed, start_time, end_time, is_defence, channel_no } = body;

    let result: unknown;

    switch (action) {
      case 'list_devices':
        result = await listDevices();
        break;

      case 'device_info':
        if (!device_serial) throw new Error('device_serial required');
        result = await getDeviceInfo(device_serial);
        break;

      case 'capture_image':
        if (!device_serial) throw new Error('device_serial required');
        result = await captureImage(device_serial, channel_no ?? '1');
        break;

      case 'ptz_start':
        if (!device_serial || !direction) throw new Error('device_serial and direction required');
        result = await ptzStart(device_serial, direction, speed ?? '1');
        break;

      case 'ptz_stop':
        if (!device_serial) throw new Error('device_serial required');
        result = await ptzStop(device_serial);
        break;

      case 'set_defence':
        if (!device_serial || !is_defence) throw new Error('device_serial and is_defence required');
        result = await setDefence(device_serial, is_defence);
        break;

      case 'alarm_list': {
        if (!device_serial) throw new Error('device_serial required');
        const now = Date.now();
        const defaultStart = String(now - 24 * 60 * 60 * 1000); // 24h ago
        result = await getAlarms(
          device_serial,
          start_time ?? defaultStart,
          end_time ?? String(now),
        );
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
