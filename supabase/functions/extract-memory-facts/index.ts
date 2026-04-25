// supabase/functions/extract-memory-facts/index.ts
// Fire-and-forget implicit memory extraction from each PTT turn.
// Uses gpt-4o-mini for cost efficiency.
//
// v2 — two-pass noise filter:
//   - confidence >= 75  → confirmed candidate (is_draft: false)
//   - confidence 50–74  → draft / borderline (is_draft: true, needs second signal)
//   - confidence < 50   → discarded with filter_reason logged
//   - transient details → discarded with filter_reason logged

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const MEMORY_EXTRACTOR_PROMPT = `Extract any new, durable facts about the user from this PTT conversation turn.

DURABILITY RULE — only extract facts that would still be relevant weeks from now.
TRANSIENT = skip entirely (weather, current traffic, what they just ate, one-off locations).
DURABLE = store (who someone is, relationships, preferences, ongoing projects, habits, goals).

Fact types: person | company | project | preference | relationship | goal | habit | location

For each fact, assign a confidence score AND a draft flag:
- confidence 75–100, is_draft: false  → strong, durable, high-signal fact
- confidence 50–74,  is_draft: true   → borderline — needs a second mention to confirm
- confidence < 50                      → DO NOT include in facts array

For facts you are skipping entirely (transient or too low confidence), include them in
"discarded" array with a brief filter_reason so the system can log why.

Return ONLY valid JSON:
{
  "facts": [
    {
      "fact_type": "person",
      "subject": "Ahmad",
      "predicate": "is",
      "object": "my lawyer",
      "confidence": 85,
      "is_draft": false
    }
  ],
  "discarded": [
    {
      "text": "it's raining outside",
      "filter_reason": "transient — current weather condition"
    }
  ],
  "insight": "One-sentence pattern observation (or null if nothing notable)",
  "entities": [
    { "text": "Ahmad", "type": "PERSON" }
  ]
}
Return facts: [], discarded: [], insight: null if nothing in this turn is worth storing.
Do NOT re-extract facts already obvious from the context.`;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { transcript, rogerResponse } = await req.json() as {
      transcript: string;
      rogerResponse: string;
    };

    if (!transcript) {
      return new Response(
        JSON.stringify({ facts: [], discarded: [], insight: null, entities: [] }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.2, // tighter for classification tasks
        messages: [
          { role: 'system', content: MEMORY_EXTRACTOR_PROMPT },
          { role: 'user', content: `User said: "${transcript}"\nRoger responded: "${rogerResponse}"` },
        ],
      }),
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ facts: [], discarded: [], insight: null, entities: [] }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const data = await res.json() as { choices: { message: { content: string } }[] };
    const raw  = data.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);

    // Ensure discarded array always exists
    if (!Array.isArray(parsed.discarded)) parsed.discarded = [];

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // Always return a safe fallback — never break PTT flow
    return new Response(
      JSON.stringify({ facts: [], discarded: [], insight: null, entities: [], error: String(e) }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
