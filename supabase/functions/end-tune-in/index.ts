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

    const { sessionId } = await req.json() as { sessionId: string };

    // Validate + end session
    const { data: session } = await supabase
      .from('tune_in_sessions').select('*').eq('id', sessionId).single();
    if (!session) throw new Error('Session not found');
    if (session.participant_a !== user.id && session.participant_b !== user.id)
      return new Response('Forbidden', { status: 403 });

    const endedAt = new Date().toISOString();
    await supabase.from('tune_in_sessions')
      .update({ status: 'ended', session_end: endedAt })
      .eq('id', sessionId);

    // Fetch all turns
    const { data: turns } = await supabase
      .from('tune_in_turns')
      .select('speaker_id, transcript, is_flagged, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    const durationMs = new Date(endedAt).getTime() - new Date(session.session_start).getTime();
    const durationMin = Math.round(durationMs / 60000);

    // GPT-5.5 post-session analysis
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    let rogerNotes = 'Session transcript unavailable for analysis.';
    let proposedTasks: { text: string; priority: number }[] = [];

    if (OPENAI_API_KEY && turns && turns.length > 0) {
      const transcript = turns.map(t =>
        `[${t.speaker_id === session.participant_a ? 'A' : 'B'}]${t.is_flagged ? ' ⭐FLAGGED' : ''}: ${t.transcript}`
      ).join('\n');

      const flagged = turns.filter(t => t.is_flagged).map(t => t.transcript);

      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: 'gpt-5.5',
            response_format: { type: 'json_object' },
            temperature: 0.2,
            messages: [
              {
                role: 'system',
                content: `You are Roger AI — an intelligent dispatch operator analyzing a completed voice session between two users.
Produce a structured debrief.

Return JSON:
{
  "summary": "2-3 sentence plain-language summary of what was discussed",
  "topics": ["list", "of", "main", "topics"],
  "decisions": ["any decisions made"],
  "flagged_notes": ["any turns explicitly flagged for attention"],
  "proposed_tasks": [
    { "text": "specific actionable task", "priority": 7 }
  ]
}

proposed_tasks must be SPECIFIC to this conversation. Max 5 tasks.
If nothing actionable was discussed, return proposed_tasks: [].`,
              },
              {
                role: 'user',
                content: `Session duration: ${durationMin} minutes. ${turns.length} turns.\n\nTranscript:\n${transcript}\n\n${flagged.length > 0 ? `Explicitly flagged by users:\n${flagged.join('\n')}` : ''}`,
              },
            ],
          }),
        });

        if (res.ok) {
          const data = await res.json() as { choices: { message: { content: string } }[] };
          const parsed = JSON.parse(data.choices[0]?.message?.content ?? '{}') as {
            summary?: string;
            topics?: string[];
            decisions?: string[];
            flagged_notes?: string[];
            proposed_tasks?: { text: string; priority: number }[];
          };
          rogerNotes = [
            parsed.summary ?? '',
            parsed.topics?.length ? `Topics: ${parsed.topics.join(', ')}.` : '',
            parsed.decisions?.length ? `Decisions: ${parsed.decisions.join('; ')}.` : '',
            parsed.flagged_notes?.length ? `Flagged: ${parsed.flagged_notes.join('; ')}.` : '',
          ].filter(Boolean).join('\n');
          proposedTasks = parsed.proposed_tasks ?? [];
        }
      } catch { /* non-fatal */ }
    }

    // Save notes to session
    await supabase.from('tune_in_sessions')
      .update({ roger_notes: rogerNotes })
      .eq('id', sessionId);

    // Surface notes + tasks to both participants
    const otherUserId = session.participant_a === user.id ? session.participant_b : session.participant_a;

    for (const uid of [user.id, otherUserId]) {
      await supabase.from('surface_items').insert({
        user_id:    uid,
        type:       'TUNE_IN_NOTES',
        content:    `Session ended (${durationMin} min, ${turns?.length ?? 0} turns).\n\n${rogerNotes}`,
        priority:   8,
        dismissed:  false,
        snooze_count: 0,
        surface_at: new Date().toISOString(),
        context:    JSON.stringify({ sessionId, proposedTasks }),
        source_tx_id: sessionId,
      }).catch(() => {});
    }

    // Notify other participant the session ended
    await supabase.channel(`tunein-session-${sessionId}`).send({
      type: 'broadcast', event: 'session_ended',
      payload: { sessionId, durationMin, turnCount: turns?.length ?? 0, rogerSpeak: 'Session ended. Roger is preparing your debrief. Over.' },
    });

    return new Response(JSON.stringify({
      ok: true, durationMin, turnCount: turns?.length ?? 0,
      rogerNotes, proposedTasks,
      rogerResponse: `Channel closed. Session lasted ${durationMin} minute${durationMin !== 1 ? 's' : ''}. Roger will brief you shortly. Over.`,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
