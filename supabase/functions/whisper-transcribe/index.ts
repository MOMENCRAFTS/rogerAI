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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API_KEY   = Deno.env.get('OPENAI_API_KEY') ?? '';
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
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

    // ── Parse form data (common crash point on Deno edge runtime) ────────────
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (parseErr) {
      console.error('[whisper-transcribe] FormData parse error:', parseErr);
      return new Response(JSON.stringify({ error: 'Failed to parse form data' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Ensure a file field is present
    const audioFile = formData.get('file');
    if (!audioFile || !(audioFile instanceof File)) {
      return new Response(JSON.stringify({ error: 'Missing "file" field in form data' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[whisper-transcribe] Audio: ${audioFile.name}, size: ${audioFile.size} bytes, type: ${audioFile.type}`);

    // Reject empty recordings (user tapped too quickly)
    if (audioFile.size < 100) {
      return new Response(JSON.stringify({ error: 'Recording too short', transcript: '' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Build a clean FormData for OpenAI (re-create to avoid Deno forwarding issues)
    const openaiForm = new FormData();
    openaiForm.append('file', audioFile, audioFile.name);
    openaiForm.append('model', (formData.get('model') as string) ?? 'whisper-1');
    if (formData.has('response_format')) {
      openaiForm.append('response_format', formData.get('response_format') as string);
    }
    // Prompt hint improves recognition of brand names and technical terms
    const promptHint = (formData.get('prompt') as string)
      ?? 'Roger AI, ChatGPT, Gemini, Notion, Slack, Trello, WhatsApp, PC, laptop, iPhone, Android, Dubai, Sharjah, Abu Dhabi, doctor, engineer, inventor, entrepreneur';
    openaiForm.append('prompt', promptHint);

    // Language lock: if the client sends a language code, force Whisper to use it
    // This prevents auto-detection from switching languages on accented speakers
    const langCode = formData.get('language') as string | null;
    if (langCode) {
      openaiForm.append('language', langCode);
      console.log(`[whisper-transcribe] Language forced: ${langCode}`);
    }

    // Forward to OpenAI Whisper with a 45s timeout
    const abortCtrl = new AbortController();
    const timeout = setTimeout(() => abortCtrl.abort(), 45_000);

    let whisperRes: Response;
    try {
      whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: openaiForm,
        signal: abortCtrl.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      console.error('[whisper-transcribe] Fetch to OpenAI failed:', fetchErr);
      return new Response(JSON.stringify({ error: 'Failed to reach Whisper API' }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    clearTimeout(timeout);

    if (!whisperRes.ok) {
      const errBody = await whisperRes.json().catch(() => ({}));
      console.error('[whisper-transcribe] OpenAI error:', whisperRes.status, errBody);
      return new Response(JSON.stringify({ error: 'Whisper API error', detail: errBody }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const data = await whisperRes.json() as { text: string };
    const durationMs = Date.now() - startMs;
    console.log(`[whisper-transcribe] OK: "${data.text?.substring(0, 50)}..." in ${durationMs}ms`);

    return new Response(JSON.stringify({ transcript: data.text ?? '', durationMs }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[whisper-transcribe] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error', detail: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
