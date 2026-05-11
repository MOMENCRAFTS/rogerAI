import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, PATCH, OPTIONS',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// ── Generate a secure device token ────────────────────────────────────
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Extract and verify the user JWT ───────────────────────────────────
async function verifyUser(req: Request): Promise<{ userId: string } | null> {
  const authHeader = req.headers.get('authorization') ?? '';
  const jwt = authHeader.replace('Bearer ', '');
  if (!jwt) return null;

  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) return null;
  return { userId: user.id };
}

// ── POST /pair-device — App sends pairing code + device_id ────────────
async function handlePair(req: Request): Promise<Response> {
  // 1. Verify the user's JWT
  const auth = await verifyUser(req);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json();
  const { device_id, pairing_code, device_name } = body;

  if (!device_id || !pairing_code) {
    return new Response(JSON.stringify({ error: 'Missing device_id or pairing_code' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[pair-device] User ${auth.userId} pairing device ${device_id} with code ${pairing_code}`);

  // 2. Check if device is already paired (and not revoked)
  const { data: existing } = await supabase
    .from('device_tokens')
    .select('id, user_id, revoked')
    .eq('device_id', device_id)
    .eq('revoked', false)
    .maybeSingle();

  if (existing) {
    // Device already paired — if same user, return existing token
    if (existing.user_id === auth.userId) {
      const { data: tokenRow } = await supabase
        .from('device_tokens')
        .select('token')
        .eq('id', existing.id)
        .single();

      return new Response(JSON.stringify({
        success: true,
        device_token: tokenRow?.token,
        message: 'Device already paired to your account',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Different user — revoke old pairing
    await supabase
      .from('device_tokens')
      .update({ revoked: true })
      .eq('id', existing.id);

    console.log(`[pair-device] Revoked previous pairing for device ${device_id}`);
  }

  // 3. Generate secure device token
  const token = generateToken();

  // 4. Insert pairing record
  const { error: insertErr } = await supabase.from('device_tokens').insert({
    device_id,
    user_id: auth.userId,
    token,
    pairing_code,
    device_name: device_name || 'Roger Device',
    paired_at: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
  });

  if (insertErr) {
    console.error('[pair-device] Insert error:', insertErr);
    return new Response(JSON.stringify({ error: 'Failed to create pairing' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 5. Also update device_registry for admin panel visibility
  await supabase.from('device_registry').upsert({
    device_id,
    user_id: auth.userId,
    status: 'online',
    last_seen: new Date().toISOString(),
  }, { onConflict: 'device_id' });

  console.log(`[pair-device] Successfully paired device ${device_id} → user ${auth.userId}`);

  return new Response(JSON.stringify({
    success: true,
    device_token: token,
    user_id: auth.userId,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ── GET /pair-device — List user's paired devices ─────────────────────
async function handleListDevices(req: Request): Promise<Response> {
  const auth = await verifyUser(req);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data, error } = await supabase
    .from('device_tokens')
    .select('id, device_id, device_name, firmware_ver, paired_at, last_used_at')
    .eq('user_id', auth.userId)
    .eq('revoked', false)
    .order('paired_at', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch devices' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ devices: data ?? [] }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── DELETE /pair-device — Unpair (revoke) a device ────────────────────
async function handleUnpair(req: Request): Promise<Response> {
  const auth = await verifyUser(req);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json();
  const { device_id } = body;

  if (!device_id) {
    return new Response(JSON.stringify({ error: 'Missing device_id' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { error } = await supabase
    .from('device_tokens')
    .update({ revoked: true })
    .eq('device_id', device_id)
    .eq('user_id', auth.userId);

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to unpair' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Update device_registry status
  await supabase
    .from('device_registry')
    .update({ status: 'offline' })
    .eq('device_id', device_id);

  console.log(`[pair-device] Unpaired device ${device_id} for user ${auth.userId}`);

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── PATCH /pair-device — Rename a device ──────────────────────────────
async function handleRename(req: Request): Promise<Response> {
  const auth = await verifyUser(req);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json();
  const { device_id, device_name } = body;

  if (!device_id || !device_name) {
    return new Response(JSON.stringify({ error: 'Missing device_id or device_name' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { error } = await supabase
    .from('device_tokens')
    .update({ device_name })
    .eq('device_id', device_id)
    .eq('user_id', auth.userId)
    .eq('revoked', false);

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to rename device' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[pair-device] Renamed device ${device_id} → "${device_name}"`);

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── GET /pair-device?device_id=X&pairing_code=Y — ESP32 polls for token ──
// No JWT required — the device authenticates via its unique device_id + code
async function handleDevicePoll(url: URL): Promise<Response> {
  const deviceId    = url.searchParams.get('device_id');
  const pairingCode = url.searchParams.get('pairing_code');

  if (!deviceId || !pairingCode) {
    return new Response(JSON.stringify({ error: 'Missing device_id or pairing_code' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Look up a token that matches this device + code
  const { data, error } = await supabase
    .from('device_tokens')
    .select('token, user_id')
    .eq('device_id', deviceId)
    .eq('pairing_code', pairingCode)
    .eq('revoked', false)
    .maybeSingle();

  if (error) {
    return new Response(JSON.stringify({ error: 'DB error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!data) {
    // Not yet paired — device should keep polling
    return new Response(JSON.stringify({ paired: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[pair-device] Device ${deviceId} poll → paired! Returning token.`);

  return new Response(JSON.stringify({
    paired: true,
    device_token: data.token,
    user_id: data.user_id,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ── Router ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    if (req.method === 'POST')   return await handlePair(req);
    if (req.method === 'DELETE') return await handleUnpair(req);
    if (req.method === 'PATCH')  return await handleRename(req);

    if (req.method === 'GET') {
      // Device poll: has query params, no JWT
      if (url.searchParams.has('device_id') && url.searchParams.has('pairing_code')) {
        return await handleDevicePoll(url);
      }
      // App: list paired devices (requires JWT)
      return await handleListDevices(req);
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  } catch (err) {
    console.error('[pair-device] Unhandled error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
