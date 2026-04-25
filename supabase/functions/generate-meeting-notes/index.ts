// supabase/functions/generate-meeting-notes/index.ts
// Generates structured meeting notes from a full transcript.
// Extracts: executive summary, action items, decisions, participants.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const PROMPT = `You are a precision meeting notes generator. Extract structured intelligence from a raw meeting transcript.

Return ONLY valid JSON:
{
  "title": "Auto-generated meeting title (3-6 words)",
  "summary": "Executive summary in 2-3 sentences. Focus on outcomes, not process.",
  "action_items": [
    { "text": "Clear, actionable task", "owner": "Person responsible or null", "due_date": "Natural language date or null" }
  ],
  "decisions": [
    { "text": "A specific decision that was made and agreed upon" }
  ],
  "participants": [
    { "name": "Name mentioned", "role": "Their apparent role or context (e.g. 'finance lead', 'client')" }
  ],
  "key_topics": ["topic1", "topic2"],
  "spoken_summary": "A 2-3 sentence voice-friendly summary Roger can speak. Use second person: 'Your meeting covered...'"
}

Rules:
- Only include action_items where a clear commitment was made (avoid vague intentions)
- Only include decisions that are definitive (not just discussed)
- participants = people mentioned by name who seem present or relevant
- spoken_summary should be under 60 words and use natural spoken language
- If the transcript is too short or unclear, return honest minimal output`;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { transcript, title: providedTitle } = await req.json() as {
      transcript: string;
      title?: string;
    };

    if (!transcript?.trim() || transcript.length < 50) {
      return new Response(JSON.stringify({
        title: providedTitle ?? 'Untitled Meeting',
        summary: 'Meeting was too short to generate notes.',
        action_items: [], decisions: [], participants: [], key_topics: [],
        spoken_summary: 'Your meeting was too short for Roger to generate notes. Over.',
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const systemMsg = providedTitle
      ? `${PROMPT}\n\nMeeting title hint: "${providedTitle}"`
      : PROMPT;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',           // Full model — meeting notes are high-value
        response_format: { type: 'json_object' },
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: `Full meeting transcript:\n\n${transcript}` },
        ],
      }),
    });

    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const notes = JSON.parse(data.choices[0].message.content);

    // Ensure arrays always exist
    notes.action_items ??= [];
    notes.decisions    ??= [];
    notes.participants ??= [];
    notes.key_topics   ??= [];

    return new Response(JSON.stringify(notes), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({
      title: 'Meeting Notes',
      summary: 'Note generation failed.',
      action_items: [], decisions: [], participants: [], key_topics: [],
      spoken_summary: 'Roger could not generate meeting notes. The transcript may have been unclear. Over.',
      error: String(e),
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
