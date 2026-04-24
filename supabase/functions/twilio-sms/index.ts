// ─── Roger AI — Twilio SMS Edge Function ────────────────────────────────────
// Sends an SMS message on behalf of a Roger user.
// Called by UserHome when SEND_SMS intent is detected.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_SID   = Deno.env.get('TWILIO_ACCOUNT_SID')!;
const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!;
const TWILIO_FROM  = Deno.env.get('TWILIO_FROM_NUMBER')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  }

  // Authenticate caller
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const body = await req.json() as { to: string; message: string };
  const { to, message } = body;

  if (!to || !message) {
    return new Response(JSON.stringify({ error: 'Missing to or message' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Sanitise phone number
  const phone = to.startsWith('+') ? to : `+${to.replace(/[^0-9]/g, '')}`;

  // Send via Twilio REST API
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const form = new URLSearchParams({ To: phone, From: TWILIO_FROM, Body: message });

  const twilioRes = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: form,
  });

  if (!twilioRes.ok) {
    const err = await twilioRes.json() as { message?: string };
    return new Response(JSON.stringify({ error: err.message ?? 'Twilio error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const result = await twilioRes.json() as { sid: string; status: string };
  return new Response(JSON.stringify({ ok: true, sid: result.sid, status: result.status }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
});
