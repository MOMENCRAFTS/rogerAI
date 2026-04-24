import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // Count today's transmissions
    const { data: txRows, error: txErr } = await supabase
      .from('transmissions')
      .select('status, confidence, latency_ms', { count: 'exact' })
      .gte('created_at', `${today}T00:00:00Z`);

    if (txErr) throw txErr;

    const txToday   = txRows?.length ?? 0;
    const successes = txRows?.filter(t => t.status === 'SUCCESS').length ?? 0;
    const clarifs   = txRows?.filter(t => t.status === 'CLARIFICATION').length ?? 0;
    const avgLat    = txToday > 0
      ? Math.round((txRows ?? []).reduce((s, t) => s + (t.latency_ms ?? 0), 0) / txToday)
      : 0;
    const successRate   = txToday > 0 ? Math.round((successes / txToday) * 1000) / 10 : 100;
    const clarifRate    = txToday > 0 ? Math.round((clarifs  / txToday) * 1000) / 10 : 0;

    // Active users — distinct user_ids in last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: userRows } = await supabase
      .from('transmissions')
      .select('user_id')
      .gte('created_at', thirtyDaysAgo);
    const activeUsers = new Set((userRows ?? []).map(r => r.user_id)).size;

    // Connected devices — online count
    const { count: connectedDevices } = await supabase
      .from('devices')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'online');

    // Upsert today's stat row
    const { error: upsertErr } = await supabase
      .from('platform_stats')
      .upsert({
        stat_date:          today,
        active_users:       activeUsers || 1,
        connected_devices:  connectedDevices ?? 0,
        tx_today:           txToday,
        success_rate:       successRate,
        clarification_rate: clarifRate,
        avg_latency_ms:     avgLat,
      }, { onConflict: 'stat_date' });

    if (upsertErr) throw upsertErr;

    return new Response(JSON.stringify({
      ok: true,
      stat_date: today,
      tx_today: txToday,
      active_users: activeUsers,
      success_rate: successRate,
      clarification_rate: clarifRate,
      avg_latency_ms: avgLat,
      connected_devices: connectedDevices ?? 0,
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
