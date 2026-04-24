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

    const { requestId } = await req.json() as { requestId: string };

    // Fetch request
    const { data: request, error: rErr } = await supabase
      .from('tune_in_requests')
      .select('*')
      .eq('id', requestId)
      .single();
    if (rErr || !request) throw new Error('Request not found');

    // Validate
    if (request.target_user_id !== user.id) return new Response('Forbidden', { status: 403 });
    if (request.status !== 'pending') {
      return new Response(JSON.stringify({
        ok: false, rogerResponse: 'Request is no longer pending. Over.',
      }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    if (new Date(request.expires_at) < new Date()) {
      await supabase.from('tune_in_requests').update({ status: 'expired' }).eq('id', requestId);
      return new Response(JSON.stringify({
        ok: false, rogerResponse: 'Request expired. Over.',
      }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // Create session
    const { data: session, error: sErr } = await supabase
      .from('tune_in_sessions')
      .insert({
        request_id:    requestId,
        participant_a: request.requester_id,
        participant_b: user.id,
      })
      .select()
      .single();
    if (sErr) throw sErr;

    // Update request
    await supabase.from('tune_in_requests')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('id', requestId);

    // Resolve display names
    const { data: aContact } = await supabase.from('roger_contacts')
      .select('display_name').eq('user_id', user.id).eq('contact_id', request.requester_id).maybeSingle();
    const requesterName = aContact?.display_name ?? `Callsign ${request.requester_callsign}`;

    const { data: bContact } = await supabase.from('roger_contacts')
      .select('display_name').eq('user_id', request.requester_id).eq('contact_id', user.id).maybeSingle();
    const targetName = bContact?.display_name ?? `Callsign ${request.target_callsign}`;

    // Notify both
    await supabase.channel(`tunein-${request.requester_id}`).send({
      type: 'broadcast', event: 'tune_in_accepted',
      payload: {
        sessionId:   session.id,
        withName:    targetName,
        rogerSpeak:  `${targetName} accepted. Channel open. You are live. Over.`,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      sessionId: session.id,
      withName:  requesterName,
      rogerResponse: `Channel open with ${requesterName}. Roger is listening. Over.`,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
