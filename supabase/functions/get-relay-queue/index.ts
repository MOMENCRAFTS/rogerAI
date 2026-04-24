import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response('Unauthorized', { status: 401 });

    // Verify user from JWT
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

    // ── Fetch queued messages for this user ───────────────────────────────────
    const { data: messages, error: fetchErr } = await supabase
      .from('relay_messages')
      .select(`
        id, sender_id, transcript, roger_summary,
        priority, status, intent, created_at,
        roger_contacts!relay_messages_sender_id_fkey (display_name)
      `)
      .eq('recipient_id', user.id)
      .in('status', ['queued', 'delivered'])
      .order('priority', { ascending: false })   // emergency first
      .order('created_at', { ascending: true })  // oldest first within same priority
      .limit(20);

    if (fetchErr) throw fetchErr;

    // ── Enrich with sender display name from roger_contacts ───────────────────
    // (contacts are stored from the sender's perspective, so look up their contact entry)
    const senderIds = [...new Set((messages ?? []).map(m => m.sender_id))];
    const senderNames: Record<string, string> = {};

    if (senderIds.length > 0) {
      // Try to find a contact entry where contact_id = sender and user_id = recipient
      const { data: contactRows } = await supabase
        .from('roger_contacts')
        .select('contact_id, display_name')
        .eq('user_id', user.id)
        .in('contact_id', senderIds);

      (contactRows ?? []).forEach(c => {
        senderNames[c.contact_id] = c.display_name;
      });
    }

    const enriched = (messages ?? []).map(m => ({
      id:           m.id,
      senderId:     m.sender_id,
      senderName:   senderNames[m.sender_id] ?? 'Unknown',
      transcript:   m.transcript,
      summary:      m.roger_summary ?? m.transcript.slice(0, 100),
      priority:     m.priority,
      status:       m.status,
      intent:       m.intent,
      createdAt:    m.created_at,
      // Pre-build Roger's spoken delivery line
      spokenLine:   buildSpokenLine(
        senderNames[m.sender_id] ?? 'someone',
        m.roger_summary ?? m.transcript,
        m.priority,
        m.created_at
      ),
    }));

    // ── Mark all returned messages as 'read' ──────────────────────────────────
    if (enriched.length > 0) {
      const ids = enriched.map(m => m.id);
      await supabase
        .from('relay_messages')
        .update({ status: 'read', read_at: new Date().toISOString() })
        .in('id', ids);
    }

    return new Response(JSON.stringify({
      ok:       true,
      count:    enriched.length,
      messages: enriched,
      // Roger's queue announcement (speak this first if count > 0)
      announcement: enriched.length === 0
        ? null
        : enriched.length === 1
          ? `You have one message from ${enriched[0].senderName}. Standing by. Over.`
          : `You have ${enriched.length} messages waiting. Playing now. Over.`,
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

function buildSpokenLine(
  senderName: string,
  content: string,
  priority: string,
  createdAt: string
): string {
  const diff    = Date.now() - new Date(createdAt).getTime();
  const mins    = Math.floor(diff / 60000);
  const timeRef = mins < 1  ? 'just now'
    : mins < 60 ? `${mins} minute${mins === 1 ? '' : 's'} ago`
    : `${Math.floor(mins / 60)} hour${Math.floor(mins / 60) === 1 ? '' : 's'} ago`;

  const prefix = priority === 'emergency' ? '⚠ EMERGENCY from'
    : priority === 'urgent'   ? 'Urgent from'
    : 'Message from';

  return `${prefix} ${senderName}, ${timeRef}: ${content}. Over.`;
}
