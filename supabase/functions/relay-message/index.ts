import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RelayRequest {
  recipientHandle: string;   // display_name or contact handle ("Ahmad", "Mom")
  transcript:      string;
  priority?:       'normal' | 'urgent' | 'emergency';
  channelId?:      string;   // optional — use for group channels
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response('Unauthorized', { status: 401 });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Get sender from JWT
    const { data: { user }, error: authErr } = await createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    ).auth.getUser();

    if (authErr || !user) return new Response('Unauthorized', { status: 401 });
    const senderId = user.id;

    const body: RelayRequest = await req.json();
    const { recipientHandle, transcript, priority = 'normal', channelId } = body;

    if (!transcript?.trim()) {
      return new Response(JSON.stringify({ error: 'transcript required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 1. Detect priority from transcript keywords ───────────────────────────
    const finalPriority = detectPriority(transcript, priority);

    // ── 2. Resolve recipient by display_name in roger_contacts ────────────────
    let recipientId: string | null = null;
    let resolvedName = recipientHandle;

    if (!channelId && recipientHandle) {
      const { data: contacts } = await supabase
        .from('roger_contacts')
        .select('contact_id, display_name')
        .eq('user_id', senderId)
        .eq('status', 'active')
        .ilike('display_name', recipientHandle.trim());

      if (contacts && contacts.length > 0) {
        recipientId = contacts[0].contact_id;
        resolvedName = contacts[0].display_name;
      }
    }

    // ── 3. Optionally summarize long messages via GPT-4o-mini ────────────────
    let rogerSummary: string | null = null;
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (OPENAI_API_KEY && transcript.length > 120) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            temperature: 0.2,
            messages: [
              {
                role: 'system',
                content: `You are Roger AI relay. Summarize the following voice message in ≤20 words for the recipient.
Return JSON: { "summary": "...", "intent": "RELAY_ETA_UPDATE|RELAY_MEETING|RELAY_GENERAL|RELAY_EMERGENCY" }`,
              },
              { role: 'user', content: `Message from sender to ${resolvedName}: "${transcript}"` },
            ],
          }),
        });
        if (res.ok) {
          const data = await res.json() as { choices: { message: { content: string } }[] };
          const parsed = JSON.parse(data.choices[0]?.message?.content ?? '{}') as { summary?: string; intent?: string };
          rogerSummary = parsed.summary ?? null;
        }
      } catch { /* non-fatal */ }
    }

    // ── 4. Insert relay_message row ───────────────────────────────────────────
    const { data: message, error: insertErr } = await supabase
      .from('relay_messages')
      .insert({
        channel_id:    channelId ?? null,
        sender_id:     senderId,
        recipient_id:  recipientId,
        transcript,
        roger_summary: rogerSummary,
        priority:      finalPriority,
        status:        recipientId ? 'queued' : 'queued',
        intent:        'RELAY_SEND',
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // ── 5. Broadcast via Supabase Realtime ────────────────────────────────────
    // The recipient's app subscribes to relay_messages filtered by recipient_id.
    // Postgres changes will fire automatically via Realtime publication.
    // We also send a targeted broadcast for immediate delivery:
    if (recipientId) {
      await supabase.channel(`relay-${recipientId}`).send({
        type: 'broadcast',
        event: 'new_relay_message',
        payload: {
          messageId:    message.id,
          senderName:   resolvedName,
          transcript,
          summary:      rogerSummary ?? transcript.slice(0, 80),
          priority:     finalPriority,
          createdAt:    message.created_at,
        },
      });

      // ── 6. Web push notification (if registered) ─────────────────────────
      const { data: pushSubs } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', recipientId)
        .limit(3);

      const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
      const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY');

      if (pushSubs && pushSubs.length > 0 && VAPID_PRIVATE_KEY && VAPID_PUBLIC_KEY) {
        const pushPayload = JSON.stringify({
          title: `📡 Roger · Message from ${resolvedName}`,
          body:  rogerSummary ?? transcript.slice(0, 100),
          icon:  '/pwa-192x192.png',
          tag:   `relay-${message.id}`,
          data:  { messageId: message.id, priority: finalPriority },
        });

        for (const sub of pushSubs) {
          try {
            await fetch(sub.endpoint, {
              method: 'POST',
              headers: {
                'Content-Type':  'application/json',
                'Authorization': `vapid t=placeholder,k=${VAPID_PUBLIC_KEY}`, // simplified
              },
              body: pushPayload,
            });
          } catch { /* per-subscription failures are non-fatal */ }
        }
      }

      // Mark as delivered
      await supabase.from('relay_messages')
        .update({ status: 'delivered', delivered_at: new Date().toISOString() })
        .eq('id', message.id);
    }

    return new Response(JSON.stringify({
      ok:            true,
      messageId:     message.id,
      recipientId,
      resolvedName,
      priority:      finalPriority,
      summary:       rogerSummary,
      status:        recipientId ? 'delivered' : 'queued',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function detectPriority(
  transcript: string,
  base: 'normal' | 'urgent' | 'emergency'
): 'normal' | 'urgent' | 'emergency' {
  const lower = transcript.toLowerCase();
  if (/\b(emergency|help|accident|crash|urgent|now|asap|immediately)\b/.test(lower)) {
    return lower.includes('emergency') || lower.includes('accident') || lower.includes('crash')
      ? 'emergency'
      : 'urgent';
  }
  return base;
}
