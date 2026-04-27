// supabase/functions/smartthings-control/index.ts
// Secure Samsung SmartThings API proxy.
// The user's PAT is passed from the client. No server-side secrets needed
// beyond what's already in user_preferences.

const SMARTTHINGS_BASE = 'https://api.smartthings.com/v1';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ── SmartThings API caller ────────────────────────────────────────────────────
async function stRequest(
  method: string,
  path: string,
  pat: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${SMARTTHINGS_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`SmartThings API error [${res.status}] ${path}: ${errBody}`);
  }

  // Some endpoints return 200 with empty body (e.g., scene execute)
  const text = await res.text();
  return text ? JSON.parse(text) : { ok: true };
}

// ── List all devices ──────────────────────────────────────────────────────────
async function listDevices(pat: string): Promise<unknown[]> {
  const data = await stRequest('GET', '/devices', pat) as { items?: unknown[] };
  return data.items ?? [];
}

// ── Get device status ─────────────────────────────────────────────────────────
async function getDeviceStatus(pat: string, deviceId: string): Promise<unknown> {
  return await stRequest('GET', `/devices/${deviceId}/status`, pat);
}

// ── Send command to device ────────────────────────────────────────────────────
async function sendCommand(
  pat: string,
  deviceId: string,
  commands: { component?: string; capability: string; command: string; arguments?: unknown[] }[],
): Promise<unknown> {
  return await stRequest('POST', `/devices/${deviceId}/commands`, pat, {
    commands: commands.map(c => ({
      component: c.component ?? 'main',
      capability: c.capability,
      command: c.command,
      arguments: c.arguments ?? [],
    })),
  });
}

// ── List scenes ───────────────────────────────────────────────────────────────
async function listScenes(pat: string): Promise<unknown[]> {
  const data = await stRequest('GET', '/scenes', pat) as { items?: unknown[] };
  return data.items ?? [];
}

// ── Execute a scene ───────────────────────────────────────────────────────────
async function executeScene(pat: string, sceneId: string): Promise<unknown> {
  return await stRequest('POST', `/scenes/${sceneId}/execute`, pat);
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json() as Record<string, unknown>;
    const { action, pat, device_id, commands, scene_id } = body as {
      action: string;
      pat?: string;
      device_id?: string;
      commands?: { component?: string; capability: string; command: string; arguments?: unknown[] }[];
      scene_id?: string;
    };

    if (!pat) {
      return new Response(
        JSON.stringify({ error: 'SmartThings PAT not provided. Set up in Settings.' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    let result: unknown;

    switch (action) {
      case 'list_devices':
        result = await listDevices(pat as string);
        break;

      case 'device_status':
        if (!device_id) throw new Error('device_id required');
        result = await getDeviceStatus(pat as string, device_id as string);
        break;

      case 'send_command':
        if (!device_id || !commands) throw new Error('device_id and commands required');
        result = await sendCommand(pat as string, device_id as string, commands);
        break;

      case 'list_scenes':
        result = await listScenes(pat as string);
        break;

      case 'execute_scene':
        if (!scene_id) throw new Error('scene_id required');
        result = await executeScene(pat as string, scene_id as string);
        break;

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
