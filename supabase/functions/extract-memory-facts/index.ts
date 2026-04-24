// supabase/functions/extract-memory-facts/index.ts
// Fire-and-forget implicit memory extraction from each PTT turn.
// Uses gpt-4o-mini for cost efficiency.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const MEMORY_EXTRACTOR_PROMPT = `Extract any new, durable facts about the user from this PTT conversation turn.
Only extract high-value facts that would still be relevant weeks from now.
Ignore transient details (weather, what they ate, current traffic).

Fact types: person | company | project | preference | relationship | goal | habit | location

Return ONLY valid JSON:
{
  "facts": [
    { "fact_type": "person", "subject": "Ahmad", "predicate": "is", "object": "my lawyer", "confidence": 85 }
  ],
  "insight": "One-sentence pattern observation (or null if nothing notable)",
  "entities": [
    { "text": "Ahmad", "type": "PERSON" }
  ]
}
Return facts: [] and insight: null if nothing new is learned.
Do NOT re-extract facts already obvious from the context.`;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { transcript, rogerResponse } = await req.json() as {
      transcript: string;
      rogerResponse: string;
    };

    if (!transcript) {
      return new Response(JSON.stringify({ facts: [], insight: null, entities: [] }), {
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
          { role: 'system', content: MEMORY_EXTRACTOR_PROMPT },
          { role: 'user', content: `User said: "${transcript}"\nRoger responded: "${rogerResponse}"` },
        ],
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ facts: [], insight: null, entities: [] }), {
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
    // Always return a safe fallback — never break PTT flow
    return new Response(JSON.stringify({ facts: [], insight: null, entities: [], error: String(e) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
