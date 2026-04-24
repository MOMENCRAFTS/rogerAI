import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
function generateCallsign() { const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; return Array.from({ length: 7 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
function toNato(callsign) { const map = { A:'Alpha',B:'Bravo',C:'Charlie',D:'Delta',E:'Echo',F:'Foxtrot',G:'Golf',H:'Hotel',J:'Juliet',K:'Kilo',M:'Mike',N:'November',P:'Papa',Q:'Quebec',R:'Romeo',S:'Sierra',T:'Tango',U:'Uniform',V:'Victor',W:'Whiskey',X:'X-ray',Y:'Yankee',Z:'Zulu','2':'Two','3':'Three','4':'Four','5':'Five','6':'Six','7':'Seven','8':'Eight','9':'Nine' }; return callsign.split('').map(c => map[c] ?? c).join(' · '); }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response('Unauthorized', { status: 401 });
    const anonClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) return new Response('Unauthorized', { status: 401 });
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const body = await req.json();
    const code = body.targetCallsign?.trim().toUpperCase();
    if (!code) return new Response(JSON.stringify({ error: 'targetCallsign required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    let { data: myRow } = await supabase.from('user_callsigns').select('callsign').eq('user_id', user.id).maybeSingle();
    if (!myRow) { let newCode = generateCallsign(); for (let i = 0; i < 5; i++) { const { data: c } = await supabase.from('user_callsigns').select('callsign').eq('callsign', newCode).maybeSingle(); if (!c) break; newCode = generateCallsign(); } const { data: created } = await supabase.from('user_callsigns').insert({ user_id: user.id, callsign: newCode }).select().single(); myRow = created; }
    const myCallsign = myRow?.callsign ?? '???????';
    if (code === myCallsign) return new Response(JSON.stringify({ ok: false, rogerResponse: "That's your own callsign. Over." }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    const { data: targetRow } = await supabase.from('user_callsigns').select('user_id').eq('callsign', code).maybeSingle();
    if (!targetRow) return new Response(JSON.stringify({ ok: false, rogerResponse: 'Callsign ' + code + ' not found. Over.' }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    const targetUserId = targetRow.user_id;
    const { data: targetPrefs } = await supabase.from('user_preferences').select('ghost_mode_until').eq('user_id', targetUserId).maybeSingle();
    if (targetPrefs?.ghost_mode_until && new Date(targetPrefs.ghost_mode_until) > new Date()) return new Response(JSON.stringify({ ok: false, rogerResponse: code + ' is unavailable. Over.' }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    const { data: activeSession } = await supabase.from('tune_in_sessions').select('id').or('participant_a.eq.' + targetUserId + ',participant_b.eq.' + targetUserId).eq('status', 'active').maybeSingle();
    if (activeSession) return new Response(JSON.stringify({ ok: false, rogerResponse: code + ' is in another session. Over.' }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    const { data: contactEntry } = await supabase.from('roger_contacts').select('display_name').eq('user_id', targetUserId).eq('contact_id', user.id).maybeSingle();
    const displayedAs = contactEntry?.display_name ?? ('Callsign ' + myCallsign);
    const { data: request, error: reqErr } = await supabase.from('tune_in_requests').insert({ requester_id: user.id, requester_callsign: myCallsign, target_callsign: code, target_user_id: targetUserId, reason: body.reason ?? null }).select().single();
    if (reqErr) throw reqErr;
    await supabase.channel('tunein-' + targetUserId).send({ type: 'broadcast', event: 'tune_in_request', payload: { requestId: request.id, from: displayedAs, callsign: myCallsign, reason: body.reason ?? null, expiresAt: request.expires_at, rogerSpeak: 'Incoming tune-in request from ' + displayedAs + '. Say accept or decline. Over.' } });
    return new Response(JSON.stringify({ ok: true, requestId: request.id, myCallsign, rogerResponse: 'Requesting tune-in with ' + code + ' — ' + toNato(code) + '. Standing by. Over.' }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (err) { return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }); }
});
