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

    const { data: request } = await supabase
      .from('tune_in_requests').select('*').eq('id', requestId).single();
    if (!request || request.target_user_id !== user.id)
      return new Response('Forbidden', { status: 403 });

    await supabase.from('tune_in_requests')
      .update({ status: 'declined', responded_at: new Date().toISOString() })
      .eq('id', requestId);

    // Notify requester
    await supabase.channel(`tunein-${request.requester_id}`).send({
      type: 'broadcast', event: 'tune_in_declined',
      payload: {
        callsign:   request.target_callsign,
        rogerSpeak: `${request.target_callsign} is not available right now. Over.`,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      rogerResponse: 'Decline sent. Over.',
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
