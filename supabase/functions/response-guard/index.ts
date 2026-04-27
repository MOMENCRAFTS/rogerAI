// ─── Roger AI — Response Guard ────────────────────────────────────────────────
// Lightweight quality gate that validates Roger's AI response before TTS.
// Catches: hallucinated entities, tone drift, language mismatch, bad JSON.
//
// Deploy: supabase functions deploy response-guard --no-verify-jwt

import { trackUsage } from '../_shared/tokenTracker.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GUARD_PROMPT = `You are a quality assurance system for an AI assistant called Roger.
Your job: validate a response BEFORE it is spoken to the user.

CHECK THESE:
1. INTENT PLAUSIBILITY: Does the classified intent logically match what the user said?
2. ENTITY VALIDATION: Are all extracted entities actually present or inferable from the transcript?
3. LANGUAGE CONSISTENCY: If user spoke in Arabic/French/Spanish, is the response in the same language?
4. TONE: Response should be concise, military-aide style (not generic chatbot).
5. HALLUCINATION: Is Roger claiming facts or creating tasks the user didn't request?
6. JSON VALIDITY: Are required fields present (intent, confidence, outcome, roger_response)?

Respond in JSON:
{
  "valid": true/false,
  "issues": ["list of specific problems found"],
  "severity": "none" | "low" | "high",
  "corrected_response": null or "corrected roger_response text if high severity"
}

If valid, return { "valid": true, "issues": [], "severity": "none", "corrected_response": null }`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { transcript, response, detectedLanguage } = await req.json() as {
      transcript: string;
      response: {
        intent: string;
        confidence: number;
        outcome: string;
        roger_response: string;
        entities?: { text: string; type: string }[];
        proposed_tasks?: { text: string; priority: number }[];
      };
      detectedLanguage?: string;
    };

    if (!transcript || !response) {
      return new Response(JSON.stringify({ valid: true, issues: [], severity: 'none', corrected_response: null }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const start = Date.now();
    const userContent = `TRANSCRIPT: "${transcript}"
DETECTED LANGUAGE: ${detectedLanguage ?? 'en'}

ROGER'S RESPONSE:
- Intent: ${response.intent}
- Confidence: ${response.confidence}
- Outcome: ${response.outcome}
- Response text: "${response.roger_response}"
- Entities: ${JSON.stringify(response.entities ?? [])}
- Proposed tasks: ${JSON.stringify(response.proposed_tasks ?? [])}

Validate this response.`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: GUARD_PROMPT },
          { role: 'user', content: userContent },
        ],
      }),
    });

    const data = await res.json() as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    // Track token usage
    await trackUsage({
      functionName: 'response-guard',
      model: 'gpt-5.4-mini',
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
      latencyMs: Date.now() - start,
      success: true,
    });

    const raw = data.choices?.[0]?.message?.content ?? '{"valid":true,"issues":[],"severity":"none","corrected_response":null}';
    const result = JSON.parse(raw);

    return new Response(JSON.stringify(result), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // On any error, let the response through (fail-open)
    console.error('[response-guard] Error:', e);
    return new Response(JSON.stringify({ valid: true, issues: [], severity: 'none', corrected_response: null }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
