// supabase/functions/classify-priority/index.ts
// AI-driven classification of user response to a proactively surfaced item.
// Uses gpt-4o-mini for speed and cost.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const PRIORITY_PROMPT = `The user just responded to a proactively surfaced item from Roger AI.
Classify their response as one of these actions:
- forget: they want to permanently drop/delete this item
- defer: they want to push it back temporarily with no specific time
- lower: they consider it lower priority, resurface in ~7 days
- reschedule: they gave a specific future time or date
- urgent: they want it bumped to top priority immediately
- execute: they want it handled/done right now
- more_info: they want more context or details first

Return ONLY a JSON object: { "action": "execute", "reschedule_hint": null }
reschedule_hint should contain any time reference they mentioned (e.g. "tomorrow morning", "next Monday") or null.`;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { userResponse } = await req.json() as { userResponse: string };

    if (!userResponse) {
      return new Response(JSON.stringify({ action: 'defer', reschedule_hint: null }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.3,
        messages: [
          { role: 'system', content: PRIORITY_PROMPT },
          { role: 'user',   content: `User said: "${userResponse}"` },
        ],
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ action: 'defer', reschedule_hint: null }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json() as { choices: { message: { content: string } }[] };
    const raw  = data.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ action: 'defer', reschedule_hint: null, error: String(e) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
