import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import OpenAI from 'https://esm.sh/openai@4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! });

// ── Device registration endpoint ──────────────────────────────────────
async function handleRegister(body: { device_id: string; user_id: string; firmware_version?: string }) {
  const { device_id, user_id, firmware_version } = body;

  await supabase.from('device_registry').upsert({
    device_id,
    user_id,
    firmware_version: firmware_version ?? '1.0.0',
    last_seen: new Date().toISOString(),
    status: 'online',
  }, { onConflict: 'device_id' });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── Main PTT relay endpoint ───────────────────────────────────────────
async function handlePTT(req: Request) {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return new Response(JSON.stringify({ error: 'Expected multipart/form-data' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const form = await req.formData();
  const deviceId = form.get('device_id') as string;
  const userId   = form.get('user_id')   as string;
  const audioFile = form.get('audio')    as File;

  if (!deviceId || !userId || !audioFile) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[device-relay] Device: ${deviceId} | User: ${userId} | Audio: ${audioFile.size} bytes`);

  // ── Update device heartbeat ───────────────────────────────────────
  supabase.from('device_registry').upsert({
    device_id: deviceId,
    user_id:   userId,
    last_seen: new Date().toISOString(),
    status:    'online',
  }, { onConflict: 'device_id' });

  // ── Step 1: Whisper STT ───────────────────────────────────────────
  const audioBlob = new File([await audioFile.arrayBuffer()], 'ptt.wav', { type: 'audio/wav' });

  let transcript = '';
  try {
    const sttResp = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file:  audioBlob,
      language: 'en',
    });
    transcript = sttResp.text.trim();
    console.log(`[device-relay] Transcript: "${transcript}"`);
  } catch (e) {
    console.error('[device-relay] Whisper error:', e);
    return new Response(JSON.stringify({ error: 'STT failed', detail: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!transcript || transcript.length < 3) {
    return new Response(JSON.stringify({
      transcript: '',
      roger_response: 'Nothing received. Over.',
      tts_url: '',
      intent: 'EMPTY',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // ── Step 2: Fetch user context (memory + history) ─────────────────
  const [{ data: historyRows }, { data: factsRows }] = await Promise.all([
    supabase.from('conversation_history')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('memory_graph')
      .select('fact_type, subject, predicate, object, is_confirmed')
      .eq('user_id', userId)
      .order('confidence', { ascending: false }),
  ]);

  const factsSummary = (factsRows ?? [])
    .map(f => `${f.subject} ${f.predicate} ${f.object}${f.is_confirmed ? ' ✓' : ''}`)
    .join('; ');

  const historyMessages = (historyRows ?? [])
    .reverse()
    .map(h => ({ role: h.role as 'user' | 'assistant', content: h.content }));

  const memoryContext = `=== USER MEMORY ===\nKey facts: ${factsSummary || 'None yet.'}\n`;

  // ── Step 3: GPT-4o processing ─────────────────────────────────────
  const SYSTEM_PROMPT = `You are Roger, an AI Chief of Staff. The user speaks to you via a physical PTT radio device.
Respond in radio style. For action intents (CREATE_*, SET_*, UPDATE_*): ≤35 words, end "Over."
For query intents: 60-120 words, end with an offer. Always return valid JSON.
Response format: {"intent":"SHORT_SNAKE_CASE","roger_response":"...","confidence":85,"ambiguity":10,"entities":[],"insight":""}`;

  let aiResult: { intent: string; roger_response: string; confidence: number; ambiguity: number; entities: { text: string; type: string }[]; insight: string } = {
    intent: 'UNKNOWN', roger_response: 'Unable to process. Over.',
    confidence: 0, ambiguity: 100, entities: [], insight: '',
  };

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + '\n\n' + memoryContext },
        ...historyMessages.slice(-10),
        { role: 'user', content: transcript },
      ],
    });
    aiResult = JSON.parse(completion.choices[0].message.content ?? '{}');
  } catch (e) {
    console.error('[device-relay] GPT-4o error:', e);
  }

  const rogerResponse = aiResult.roger_response || 'Unable to process. Over.';
  console.log(`[device-relay] Intent: ${aiResult.intent} | Response: "${rogerResponse}"`);

  // ── Step 4: TTS generation ────────────────────────────────────────
  let ttsUrl = '';
  try {
    const ttsResp = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'onyx',
      input: rogerResponse,
      response_format: 'mp3',
    });
    // Store in Supabase Storage so ESP32 can download
    const audioBytes = new Uint8Array(await ttsResp.arrayBuffer());
    const fileName   = `tts/${userId}/${Date.now()}.mp3`;

    const { data: upload } = await supabase.storage
      .from('roger-audio')
      .upload(fileName, audioBytes, { contentType: 'audio/mpeg', upsert: true });

    if (upload) {
      const { data: urlData } = supabase.storage
        .from('roger-audio')
        .getPublicUrl(fileName);
      ttsUrl = urlData?.publicUrl ?? '';
    }
  } catch (e) {
    console.error('[device-relay] TTS error:', e);
  }

  // ── Step 5: Write to DB ───────────────────────────────────────────
  const sessionId = `device_${deviceId}_${new Date().toDateString().replace(/ /g, '_')}`;

  await Promise.allSettled([
    supabase.from('conversation_history').insert({
      user_id: userId, session_id: sessionId,
      role: 'user', content: transcript,
      intent: aiResult.intent, is_admin_test: false,
    }),
    supabase.from('conversation_history').insert({
      user_id: userId, session_id: sessionId,
      role: 'assistant', content: rogerResponse,
      intent: aiResult.intent, is_admin_test: false,
    }),
    // Handle action intents
    ...(aiResult.intent === 'CREATE_REMINDER' ? [
      supabase.from('reminders').insert({ user_id: userId, text: transcript, entities: aiResult.entities }),
    ] : []),
    ...(aiResult.intent === 'CREATE_TASK' ? [
      supabase.from('tasks').insert({ user_id: userId, text: transcript, priority: 5, status: 'open' }),
    ] : []),
    // Auto-register intent
    supabase.from('intent_registry').upsert({
      name: aiResult.intent, status: 'active', execution_tier: 'soft',
      ambient_mode: false, use_count: 1,
    }, { onConflict: 'name', ignoreDuplicates: false }),
  ]);

  // ── Step 6: Return response to ESP32 ─────────────────────────────
  return new Response(JSON.stringify({
    transcript,
    roger_response: rogerResponse,
    tts_url:        ttsUrl,
    intent:         aiResult.intent,
    entities:       aiResult.entities,
    insight:        aiResult.insight,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ── Router ────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);

  try {
    if (url.pathname.endsWith('/register') && req.method === 'POST') {
      const body = await req.json();
      return await handleRegister(body);
    }
    if (req.method === 'POST') {
      return await handlePTT(req);
    }
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  } catch (err) {
    console.error('[device-relay] Unhandled error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
