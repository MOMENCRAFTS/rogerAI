/**
 * tts-proxy — Server-side OpenAI TTS proxy
 *
 * Accepts: POST JSON { text: string, voice?: string, speed?: number }
 * Returns: audio/mpeg binary (buffered — compatible with Web Audio decodeAudioData)
 *
 * Deploy: supabase functions deploy tts-proxy --no-verify-jwt
 *
 * Auth: caller must supply a valid Supabase user JWT in the Authorization header.
 * The OpenAI key lives only in Supabase secrets — never exposed to the client.
 *
 * Design note: We buffer the full OpenAI response before returning it.
 * This keeps the client-side pipeline identical to before:
 *   fetch → arrayBuffer() → decodeAudioData → BufferSource → speaker
 * Streaming would reduce latency but requires a more complex client-side reader.
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

interface TTSRequest {
  text:   string;
  voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  speed?: number;
  model?: string;
}

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

  // ── Parse request body ────────────────────────────────────────────────────
  let body: TTSRequest;
  try {
    body = await req.json() as TTSRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { text, voice = 'onyx', speed = 1.0, model = 'tts-1' } = body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'Missing or empty "text" field' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Enforce a reasonable input length limit (OpenAI allows up to 4096 chars)
  if (text.length > 4096) {
    return new Response(JSON.stringify({ error: 'Text exceeds 4096 character limit' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    // ── Forward to OpenAI TTS ───────────────────────────────────────────────
    const openaiRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${OPENAI_API_KEY}`,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({ model, input: text, voice, speed }),
    });

    if (!openaiRes.ok) {
      const errBody = await openaiRes.json().catch(() => ({}));
      console.error('[tts-proxy] OpenAI error:', errBody);
      return new Response(JSON.stringify({ error: 'TTS API error', detail: errBody }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── Buffer and return the audio binary ───────────────────────────────────
    const audioBuffer = await openaiRes.arrayBuffer();
    console.log(`[tts-proxy] user=${user.id} bytes=${audioBuffer.byteLength} voice=${voice}`);

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type':   'audio/mpeg',
        'Content-Length': String(audioBuffer.byteLength),
        'Cache-Control':  'no-store',
      },
    });

  } catch (err) {
    console.error('[tts-proxy] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
