// supabase/functions/generate-curriculum/index.ts
// Generates a structured learning curriculum for any topic using GPT-4o + web search.
// Called when user says "Roger, teach me about [topic]".

import { trackUsage } from '../_shared/tokenTracker.ts';

const OPENAI_API_KEY      = Deno.env.get('OPENAI_API_KEY') ?? '';
const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CURRICULUM_PROMPT = `You are an expert curriculum designer. Given a topic, create a structured learning pathway.

RULES:
1. Auto-size: simple topics = 3-4 modules, complex topics = 6-8 modules. Max 8.
2. Each module builds on the previous one (progressive difficulty).
3. Each module's lesson_content should be 250-350 words — written as a SPOKEN SCRIPT that a voice assistant would read aloud.
4. Write lesson_content in a conversational, engaging tone. Use analogies. No markdown formatting (it's spoken via TTS).
5. key_concepts = the 3-5 core ideas the student should understand after this module.
6. summary = 1-2 sentence overview of the module.
7. The first module should always be foundational — assume zero prior knowledge.
8. The last module should synthesize everything and look at practical application.

OUTPUT FORMAT (strict JSON):
{
  "title": "Investing Fundamentals",
  "description": "A structured pathway to understand personal investing, from basic concepts to portfolio strategy.",
  "modules": [
    {
      "module_number": 1,
      "title": "What is Investing?",
      "summary": "The basics of putting money to work and why it matters.",
      "key_concepts": ["compound interest", "risk vs reward", "inflation"],
      "lesson_content": "Alright, let's start with the foundation. Investing is simply..."
    }
  ]
}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const { topic, userId } = await req.json() as { topic: string; userId: string };

    if (!topic || !userId) {
      return new Response(JSON.stringify({ error: 'topic and userId required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();

    // Use Responses API with web_search to get current knowledge
    const aiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        tools: [{ type: 'web_search_preview' }],
        text: { format: { type: 'json_object' } },
        input: [
          { role: 'system', content: CURRICULUM_PROMPT },
          { role: 'user', content: `Create a learning pathway for: "${topic}"` },
        ],
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      await trackUsage({ functionName: 'generate-curriculum', model: 'gpt-4o', success: false, errorMessage: err, latencyMs: Date.now() - startTime });
      return new Response(JSON.stringify({ error: err }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const aiData = await aiRes.json() as {
      output_text?: string;
      output?: { type?: string; content?: { type?: string; text?: string }[] }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    // Extract text from Responses API
    let rawText = aiData.output_text ?? '';
    if (!rawText && Array.isArray(aiData.output)) {
      for (const item of aiData.output) {
        if (item.type === 'message' && Array.isArray(item.content)) {
          for (const block of item.content) {
            if (block.type === 'output_text' && block.text) {
              rawText = block.text;
              break;
            }
          }
        }
        if (rawText) break;
      }
    }

    // Track usage
    await trackUsage({
      functionName: 'generate-curriculum',
      model: 'gpt-4o',
      success: true,
      latencyMs: Date.now() - startTime,
      promptTokens: aiData.usage?.input_tokens ?? 0,
      completionTokens: aiData.usage?.output_tokens ?? 0,
    });

    // Parse curriculum JSON
    let curriculum: {
      title: string;
      description: string;
      modules: {
        module_number: number;
        title: string;
        summary: string;
        key_concepts: string[];
        lesson_content: string;
      }[];
    };

    try {
      // Strip markdown code fences if present
      const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      curriculum = JSON.parse(cleaned);
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to parse curriculum', raw: rawText }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── Store in DB ────────────────────────────────────────────────────────
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY,
    };

    // 1. Create pathway
    const pathwayRes = await fetch(`${SUPABASE_URL}/rest/v1/learning_pathways`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        user_id: userId,
        topic: topic.toLowerCase(),
        title: curriculum.title,
        description: curriculum.description,
        total_modules: curriculum.modules.length,
      }),
    });

    if (!pathwayRes.ok) {
      const err = await pathwayRes.text();
      return new Response(JSON.stringify({ error: 'DB insert failed', detail: err }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const [pathway] = await pathwayRes.json() as { id: string }[];

    // 2. Create modules (first one is 'available', rest are 'locked')
    const moduleRows = curriculum.modules.map((m, i) => ({
      pathway_id: pathway.id,
      module_number: m.module_number,
      title: m.title,
      summary: m.summary,
      key_concepts: m.key_concepts,
      lesson_content: m.lesson_content,
      status: i === 0 ? 'available' : 'locked',
      unlocked_at: i === 0 ? new Date().toISOString() : null,
    }));

    const modulesRes = await fetch(`${SUPABASE_URL}/rest/v1/pathway_modules`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'return=representation' },
      body: JSON.stringify(moduleRows),
    });

    if (!modulesRes.ok) {
      const err = await modulesRes.text();
      return new Response(JSON.stringify({ error: 'Module insert failed', detail: err }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const modules = await modulesRes.json() as { id: string; module_number: number; title: string }[];

    return new Response(JSON.stringify({
      pathway_id: pathway.id,
      title: curriculum.title,
      description: curriculum.description,
      total_modules: curriculum.modules.length,
      first_module: {
        id: modules[0]?.id,
        title: modules[0]?.title,
        lesson_preview: curriculum.modules[0]?.lesson_content?.slice(0, 200) + '...',
      },
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
