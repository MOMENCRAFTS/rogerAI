/**
 * whisper-transcribe — Server-side Whisper STT proxy
 *
 * Accepts: multipart/form-data with:
 *   - "file"  : audio blob (webm/ogg/mp4/etc.)
 *   - "model" : (optional) defaults to "whisper-1"
 *
 * Returns: { transcript: string, durationMs: number }
 *
 * Deploy: supabase functions deploy whisper-transcribe --no-verify-jwt
 *
 * Auth: caller must supply a valid Supabase user JWT in the Authorization header.
 * The function verifies the token to confirm the user is authenticated before
 * forwarding to OpenAI — the OpenAI key never leaves the server.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API_KEY   = Deno.env.get('OPENAI_API_KEY') ?? '';
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Auth check ────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing authorization token' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // ── Validate content type ─────────────────────────────────────────────────
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return new Response(JSON.stringify({ error: 'Expected multipart/form-data' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const startMs = Date.now();

    // ── Forward the multipart body directly to OpenAI Whisper ────────────────
    // We pipe the raw formdata through unchanged — no re-encoding needed.
    const formData = await req.formData();

    // Ensure a file field is present
    const audioFile = formData.get('file');
    if (!audioFile || !(audioFile instanceof File)) {
      return new Response(JSON.stringify({ error: 'Missing "file" field in form data' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Default to whisper-1 if not specified
    if (!formData.has('model')) {
      formData.append('model', 'whisper-1');
    }

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      const errBody = await whisperRes.json().catch(() => ({}));
      console.error('[whisper-transcribe] OpenAI error:', errBody);
      return new Response(JSON.stringify({ error: 'Whisper API error', detail: errBody }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const data = await whisperRes.json() as { text: string };
    const durationMs = Date.now() - startMs;

    return new Response(JSON.stringify({ transcript: data.text ?? '', durationMs }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[whisper-transcribe] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
