// supabase/functions/analyse-ambient/index.ts
// Classifies a 30-second Whisper transcript chunk:
// speech (with language detection), music, ambient noise, or mixed.


const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const PROMPT = `You are an audio content classifier. A 30-second chunk of ambient audio was transcribed.
Classify it and return ONLY valid JSON:

{
  "content_type": "speech | music | ambient | mixed | unknown",
  "language": "ISO-639-1 code or null",
  "language_name": "English name of language or null",
  "transcript_clean": "cleaned, readable version of the transcript",
  "summary": "One sentence describing what is happening in the audio",
  "music_hint": "Any musical clues (genre, mood, instruments, artist guess) — null if no music",
  "is_music_dominant": true | false,
  "confidence": 0-100
}

Rules:
- If you detect a conversation, classify as "speech" and identify the language
- If music is audible (even in background), note it in music_hint
- If music is dominant (>50% of audio), set is_music_dominant: true and content_type: "music" or "mixed"
- If unclear/silence/noise only, classify as "ambient"
- transcript_clean should remove Whisper artifacts like [BLANK_AUDIO], (music), etc.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { transcript } = await req.json() as { transcript: string };

    if (!transcript?.trim()) {
      return new Response(
        JSON.stringify({
          content_type: 'ambient', language: null, language_name: null,
          transcript_clean: '', summary: 'No audio content detected.',
          music_hint: null, is_music_dominant: false, confidence: 0,
        }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: `Transcript: "${transcript}"` },
        ],
      }),
    });

    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const parsed = JSON.parse(data.choices[0].message.content);

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        content_type: 'unknown', language: null, language_name: null,
        transcript_clean: '', summary: 'Analysis failed.',
        music_hint: null, is_music_dominant: false, confidence: 0, error: String(e),
      }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
