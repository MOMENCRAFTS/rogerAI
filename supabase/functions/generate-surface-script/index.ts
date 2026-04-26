// supabase/functions/generate-surface-script/index.ts
// Generates Roger's spoken line for proactively surfacing a memory item.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SURFACE_PROMPT = `You are Roger AI surfacing a memory item proactively to the user.
Speak as a trusted aide who has been paying careful attention.
Reference the time elapsed, context, and urgency naturally.
Ask exactly ONE actionable question at the end.
Keep the response under 35 words total. Always end with "Over."
Do not read the item verbatim — summarize it naturally.
Return plain text only (no JSON).`;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { type, content, timeRef, context } = await req.json() as {
      type: string;
      content: string;
      timeRef: string;
      context?: string;
    };

    const userContent = `Item type: ${type}\nContent: "${content}"\nAdded: ${timeRef}\n${context ? `Context: ${context}` : ''}\nGenerate Roger's proactive spoken line.`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-5.5',
        temperature: 0.3,
        messages: [
          { role: 'system', content: SURFACE_PROMPT },
          { role: 'user',   content: userContent },
        ],
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ text: 'Heads up — something needs your attention. Over.' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json() as { choices: { message: { content: string } }[] };
    const text = data.choices[0]?.message?.content ?? 'Heads up — something needs your attention. Over.';

    return new Response(JSON.stringify({ text }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ text: 'Heads up — something needs your attention. Over.', error: String(e) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
