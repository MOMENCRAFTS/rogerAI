import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response('Unauthorized', { status: 401 });

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) return new Response('Unauthorized', { status: 401 });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { sessionId, transcript, isFlagged } = await req.json() as {
      sessionId: string; transcript: string; isFlagged?: boolean;
    };

    // Validate session
    const { data: session } = await supabase
      .from('tune_in_sessions').select('*').eq('id', sessionId).single();
    if (!session) throw new Error('Session not found');
    if (session.status !== 'active') throw new Error('Session not active');
    if (session.participant_a !== user.id && session.participant_b !== user.id)
      return new Response('Forbidden', { status: 403 });

    // Insert turn
    const { data: turn, error: tErr } = await supabase
      .from('tune_in_turns')
      .insert({ session_id: sessionId, speaker_id: user.id, transcript, is_flagged: isFlagged ?? false })
      .select().single();
    if (tErr) throw tErr;

    // Increment turn count
    await supabase.from('tune_in_sessions')
      .update({ turn_count: session.turn_count + 1 })
      .eq('id', sessionId);

    // Resolve speaker display name for recipient
    const recipientId = session.participant_a === user.id ? session.participant_b : session.participant_a;
    const { data: nameRow } = await supabase.from('roger_contacts')
      .select('display_name').eq('user_id', recipientId).eq('contact_id', user.id).maybeSingle();
    const speakerName = nameRow?.display_name ?? 'Them';

    const spokenLine = `From ${speakerName}: ${transcript}`;

    // Broadcast to the other participant
    await supabase.channel(`tunein-session-${sessionId}`).send({
      type: 'broadcast', event: 'session_turn',
      payload: { turnId: turn.id, speakerId: user.id, speakerName, transcript, isFlagged, spokenLine },
    });

    return new Response(JSON.stringify({ ok: true, turnId: turn.id, spokenLine }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
