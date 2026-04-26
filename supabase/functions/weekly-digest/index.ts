// supabase/functions/weekly-digest/index.ts
// Edge Function: Secure GPT-5.5 weekly digest generation
// Replaces client-side OpenAI call in UserAnalytics.tsx

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { stats } = await req.json() as {
      stats: {
        totalTransmissions: number;
        totalFacts: number;
        topPeople: string;
        tasksCreated: number;
        tasksDone: number;
        tasksOpen: number;
        remindersSet: number;
      };
    };

    const prompt = `You are Roger AI delivering a weekly digest briefing.
Summarise this week in 120–160 words. Be warm, analytical, and specific.

This week stats:
- Tasks created: ${stats.tasksCreated} (${stats.tasksDone} done, ${stats.tasksOpen} still open)
- Reminders set: ${stats.remindersSet}
- Total voice transmissions: ${stats.totalTransmissions}
- People most mentioned: ${stats.topPeople || 'none tracked yet'}
- Memory facts total: ${stats.totalFacts}

Close with one forward-looking suggestion and "Standing by. Over."
Return plain text only.`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-5.5', temperature: 0.5, messages: [{ role: 'user', content: prompt }] }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: err }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const data = await res.json() as { choices: { message: { content: string } }[] };
    const text = data.choices[0]?.message?.content ?? 'Weekly digest unavailable. Over.';

    return new Response(JSON.stringify({ text }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
