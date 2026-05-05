// supabase/functions/spawn-ai-persona/index.ts
// Admin-only — generates a living AI user persona using GPT-5.5 then seeds all DB tables.
// Three-phase: action="preview" (GPT only, no DB) → action="commit" (DB writes).
// Deploy: supabase functions deploy spawn-ai-persona --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { trackUsage } from '../_shared/tokenTracker.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!;
const OPENAI_API_KEY    = Deno.env.get('OPENAI_API_KEY')!;
const ADMIN_EMAILS      = (Deno.env.get('ADMIN_EMAILS') ?? '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

// ── NATO callsign pool ─────────────────────────────────────────────────────────
const NATO = ['ALPHA','BRAVO','CHARLIE','DELTA','ECHO','FOXTROT','GOLF','HOTEL',
  'INDIA','JULIET','KILO','LIMA','MIKE','NOVEMBER','OSCAR','PAPA',
  'QUEBEC','ROMEO','SIERRA','TANGO','UNIFORM','VICTOR','WHISKEY','XRAY','YANKEE','ZULU'];

function randomCallsign() {
  const word = NATO[Math.floor(Math.random() * NATO.length)];
  const num  = String(Math.floor(Math.random() * 90) + 10);
  return `${word}-${num}`;
}

// ── Archetypes: 15 Gulf + 10 global ─────────────────────────────────────────
const ARCHETYPES = [
  // ── Gulf — Saudi Arabia ────────────────────────────────────────────────────
  'Saudi Aramco Engineer',
  'Saudi Vision 2030 Startup Founder',
  'Saudi Government Official',
  'Saudi Working Mother',
  'Saudi University Student',

  // ── Gulf — UAE ─────────────────────────────────────────────────────────────
  'Emirati Smart City Planner',
  'Emirati Government Officer',
  'Dubai Expat Professional',
  'Abu Dhabi Investment Director',

  // ── Gulf — Qatar ───────────────────────────────────────────────────────────
  'Qatari Real Estate Developer',
  'Qatar Airways Crew Member',

  // ── Gulf — Kuwait / Bahrain / Oman ─────────────────────────────────────────
  'Kuwaiti Investment Banker',
  'Bahraini Fintech Founder',
  'Omani Tourism Executive',
  'GCC Family Patriarch',

  // ── Global ─────────────────────────────────────────────────────────────────
  'Gulf Executive',
  'Muslim Professional',
  'Working Parent',
  'Language Learner',
  'Tech Entrepreneur',
  'Smart Home User',
  'Field Researcher',
  'Daily Commuter',
  'Finance Trader',
  'Social Connector',
];

// ── Gulf nationality mapping (archetype → expected nationality / city) ────────
const GULF_CONTEXT: Record<string, { nationality: string; city: string; timezone: string; language: string; islamic_mode: boolean }> = {
  'Saudi Aramco Engineer':           { nationality: 'Saudi Arabian', city: 'Dhahran, Saudi Arabia',     timezone: 'Asia/Riyadh',  language: 'ar', islamic_mode: true },
  'Saudi Vision 2030 Startup Founder':{ nationality: 'Saudi Arabian', city: 'Riyadh, Saudi Arabia',     timezone: 'Asia/Riyadh',  language: 'ar', islamic_mode: true },
  'Saudi Government Official':        { nationality: 'Saudi Arabian', city: 'Riyadh, Saudi Arabia',     timezone: 'Asia/Riyadh',  language: 'ar', islamic_mode: true },
  'Saudi Working Mother':             { nationality: 'Saudi Arabian', city: 'Jeddah, Saudi Arabia',     timezone: 'Asia/Riyadh',  language: 'ar', islamic_mode: true },
  'Saudi University Student':         { nationality: 'Saudi Arabian', city: 'Riyadh, Saudi Arabia',     timezone: 'Asia/Riyadh',  language: 'ar', islamic_mode: true },
  'Emirati Smart City Planner':       { nationality: 'Emirati',       city: 'Abu Dhabi, UAE',           timezone: 'Asia/Dubai',   language: 'ar', islamic_mode: true },
  'Emirati Government Officer':       { nationality: 'Emirati',       city: 'Dubai, UAE',               timezone: 'Asia/Dubai',   language: 'ar', islamic_mode: true },
  'Dubai Expat Professional':         { nationality: 'Mixed (Indian/British/American/Lebanese)', city: 'Dubai, UAE', timezone: 'Asia/Dubai', language: 'en', islamic_mode: false },
  'Abu Dhabi Investment Director':    { nationality: 'Emirati',       city: 'Abu Dhabi, UAE',           timezone: 'Asia/Dubai',   language: 'en', islamic_mode: true },
  'Qatari Real Estate Developer':     { nationality: 'Qatari',        city: 'Doha, Qatar',              timezone: 'Asia/Qatar',   language: 'ar', islamic_mode: true },
  'Qatar Airways Crew Member':        { nationality: 'Mixed (Filipina/Indian/French/Jordanian)', city: 'Doha, Qatar', timezone: 'Asia/Qatar', language: 'en', islamic_mode: false },
  'Kuwaiti Investment Banker':        { nationality: 'Kuwaiti',       city: 'Kuwait City, Kuwait',      timezone: 'Asia/Kuwait',  language: 'ar', islamic_mode: true },
  'Bahraini Fintech Founder':         { nationality: 'Bahraini',      city: 'Manama, Bahrain',          timezone: 'Asia/Bahrain', language: 'en', islamic_mode: true },
  'Omani Tourism Executive':          { nationality: 'Omani',         city: 'Muscat, Oman',             timezone: 'Asia/Muscat',  language: 'ar', islamic_mode: true },
  'GCC Family Patriarch':             { nationality: 'Saudi Arabian', city: 'Riyadh, Saudi Arabia',     timezone: 'Asia/Riyadh',  language: 'ar', islamic_mode: true },
  'Gulf Executive':                   { nationality: 'Saudi Arabian', city: 'Riyadh, Saudi Arabia',     timezone: 'Asia/Riyadh',  language: 'en', islamic_mode: true },
};

// ── GPT-5.5 call ──────────────────────────────────────────────────────────────
async function gpt(system: string, user: string, userId?: string): Promise<{ text: string; tokens: number; cost: number; latency: number }> {
  const start = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      max_tokens: 3000,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
    }),
  });
  const data = await res.json() as { choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
  const text = data.choices?.[0]?.message?.content ?? '{}';
  const pt   = data.usage?.prompt_tokens ?? 0;
  const ct   = data.usage?.completion_tokens ?? 0;
  const cost = (pt / 1000) * 0.005 + (ct / 1000) * 0.015;
  const latency = Date.now() - start;
  await trackUsage({ functionName: 'spawn-ai-persona', model: 'gpt-4o', userId: userId ?? null,
    promptTokens: pt, completionTokens: ct, totalTokens: pt + ct, latencyMs: latency, success: true });
  return { text, tokens: pt + ct, cost, latency };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Auth guard
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const anonClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !user?.email) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (ADMIN_EMAILS.length > 0 && !ADMIN_EMAILS.includes(user.email.toLowerCase()))
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json() as { action: 'preview' | 'commit'; archetype?: string; previewData?: Record<string, unknown> };

    // ── PHASE 1: Preview (GPT only, no DB writes) ─────────────────────────────
    if (body.action === 'preview') {
      const archetype = body.archetype ?? ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
      const gulfCtx = GULF_CONTEXT[archetype];

      const system = `You are a user persona generator for RogerAI — an AI Chief of Staff system.
Generate a deeply realistic human persona for the archetype provided.
Respond ONLY with valid JSON matching the schema exactly.`;

      const userPrompt = `Generate a complete AI user persona for archetype: "${archetype}".

The persona must feel like a real person who genuinely benefits from using Roger AI daily.
Roger AI is a voice-first PTT (walkie-talkie-style) AI assistant. The user speaks to Roger
to set reminders, capture memories, manage tasks, get briefings, control smart home, track commute, etc.

Return this exact JSON schema:
{
  "archetype": "${archetype}",
  "name": "Full Name",
  "age": 28,
  "nationality": "e.g. Saudi Arabian",
  "city": "e.g. Riyadh, Saudi Arabia",
  "timezone": "e.g. Asia/Riyadh",
  "language": "en|ar|fr|es|de|ja|zh",
  "profession": "e.g. VP of Operations at Saudi Aramco",
  "family_context": "e.g. Married, 3 kids, aging parent lives with them",
  "personality_traits": ["organized", "tech-savvy", "ambitious"],
  "why_roger": "One sentence: why this person relies on Roger AI daily",
  "roger_mode": "active|quiet|briefing",
  "islamic_mode": true,
  "talkative_enabled": true,
  "talkative_frequency": "thoughtful|active_talk|always_on",
  "briefing_interests": ["gold_price", "weather", "news"],
  "daily_rhythm": {
    "morning": "Checks briefing at 6am, drops kids at school",
    "commute": "30min drive to office, uses Roger for task queue",
    "work": "Meetings, memory captures, relay messages to team",
    "evening": "Family time, smart home control, reminders for tomorrow"
  },
  "memory_facts": [
    { "fact_type": "company", "subject": "Name", "predicate": "works at", "object": "Company Name", "confidence": 95 },
    { "fact_type": "person", "subject": "Name", "predicate": "has child", "object": "child name, age", "confidence": 90 }
  ],
  "memories": [
    { "type": "note", "text": "A note this person captured", "tags": ["work"] }
  ],
  "reminders": [
    { "text": "Reminder text", "due_offset_hours": 24, "recurrence_rule": null }
  ],
  "tasks": [
    { "text": "Task text", "priority": 7 }
  ],
  "conversation_seeds": [
    { "role": "user", "content": "Roger, ...", "intent": "CREATE_REMINDER" },
    { "role": "assistant", "content": "Done. Over." }
  ],
  "entity_mentions": [
    { "entity_text": "Person or place name", "entity_type": "PERSON|LOCATION|ORG|PROJECT", "mention_count": 3 }
  ]
}

Rules:
- memory_facts: 12-15 entries covering life facts (company, family, projects, habits, goals)
- memories: 5-8 entries (realistic captures this person would make)
- reminders: 3-5 entries (realistic upcoming events)  
- tasks: 3-5 entries (real actionable items in their life)
- conversation_seeds: 8-12 turns (4-6 realistic back-and-forth exchanges with Roger)
- entity_mentions: 5-8 entries (people/places/orgs they frequently mention to Roger)
- Make the data deeply consistent with the archetype and daily_rhythm
- If it is a Gulf/GCC archetype, the persona MUST be from the correct country and city:
  ${gulfCtx ? `nationality="${gulfCtx.nationality}", city="${gulfCtx.city}", timezone="${gulfCtx.timezone}"` : 'Use a realistic nationality matching the archetype'}
- islamic_mode should be true for all GCC nationals and Muslim professionals
  ${gulfCtx ? `islamic_mode=${gulfCtx.islamic_mode}` : ''}
- Gulf personas must include prayer-aware scheduling in daily_rhythm (Fajr, Dhuhr, Asr, Maghrib, Isha)
- Gulf Arabic speakers use "language": "ar"; bilingual Gulf personas with English work use "language": "en"
- conversation_seeds for Gulf/Arabic personas MUST be in Arabic script naturally, as this person speaks to Roger
- Gulf personas should reference real places: KAEC, NEOM, Diriyah Gate, King Salman Park, Dubai Frame,
  Al Maryah Island, Lusail City, The Pearl Qatar, Avenues Mall, Muscat Hills, etc.
- GCC memory_facts must include diwaniya/family gathering habits, wasta networks, Vision 2030 projects,
  or relevant national mega-projects (e.g. NEOM, Qiddiya, Diriyah, Expo City Dubai, FIFA 2034)
- Include culturally accurate entities: شركة أرامكو, الديوانية, الرياض, الكويت, etc. in entity_mentions
  for Arabic-speaking Gulf personas
- Working hours for Gulf personas: Sun–Thu 8am–5pm (not Mon–Fri)
- commute notes should reference specific Gulf roads: King Fahd Road, Sheikh Zayed Road, Al Khaleej Road
- For Dubai expats: include visa/DIFC/free zone context and multinational office culture
- For Qatar personas: include World Cup legacy infrastructure, QNB, QatarEnergy references
- For Kuwait personas: include National Bank of Kuwait, KIPCO, family business culture
- For Bahrain personas: include Bahrain Financial Harbour, FinTech Bay, Tamkeen context
- For Oman personas: include Muscat Hills, Oman Vision 2040, diversification from oil
`;

      const { text, tokens, cost, latency } = await gpt(system, userPrompt);
      let persona: Record<string, unknown>;
      try { persona = JSON.parse(text); } catch { return new Response(JSON.stringify({ error: 'GPT returned invalid JSON' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

      return new Response(JSON.stringify({ persona, tokens, cost, latency }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── PHASE 3: Commit (DB writes using approved previewData) ────────────────
    if (body.action === 'commit' && body.previewData) {
      const p = body.previewData as Record<string, unknown>;
      const facts     = (p.memory_facts as Record<string, unknown>[])      ?? [];
      const mems      = (p.memories as Record<string, unknown>[])          ?? [];
      const rems      = (p.reminders as Record<string, unknown>[])         ?? [];
      const tsks      = (p.tasks as Record<string, unknown>[])             ?? [];
      const convSeeds = (p.conversation_seeds as Record<string, unknown>[]) ?? [];
      const entities  = (p.entity_mentions as Record<string, unknown>[])   ?? [];

      // 1. Create Supabase Auth user
      const email = `ai-${crypto.randomUUID().slice(0, 8)}@rogerai.sim`;
      const { data: authData, error: authError } = await db.auth.admin.createUser({
        email,
        password: crypto.randomUUID(), // Random — AI personas never log in
        email_confirm: true,
      });
      if (authError || !authData.user) throw new Error(`Auth user creation failed: ${authError?.message}`);
      const userId = authData.user.id;

      // 2. Generate a unique callsign
      let callsign = randomCallsign();
      for (let i = 0; i < 10; i++) {
        const { data: existing } = await db.from('user_callsigns').select('id').eq('callsign', callsign).maybeSingle();
        if (!existing) break;
        callsign = randomCallsign();
      }

      // 3. Seed all tables in parallel
      const now       = new Date();
      const sessionId = `sim-${crypto.randomUUID().slice(0, 8)}`;

      await Promise.all([
        // user_preferences
        db.from('user_preferences').upsert({
          user_id:              userId,
          display_name:         String(p.name ?? 'Unknown'),
          roger_mode:           String(p.roger_mode ?? 'active'),
          language:             String(p.language ?? 'en'),
          timezone:             String(p.timezone ?? 'UTC'),
          onboarding_complete:  true,
          onboarding_step:      5,
          tour_seen:            true,
          tour_version:         1,
          orientation_seen:     true,
          orientation_version:  1,
          islamic_mode:         !!(p.islamic_mode),
          talkative_enabled:    !!(p.talkative_enabled),
          talkative_frequency:  String(p.talkative_frequency ?? 'thoughtful'),
          briefing_interests:   p.briefing_interests ?? [],
          haptic_enabled:       true,
          sfx_enabled:          true,
          is_ai_persona:        true,
          ai_persona_identity:  p,
          last_advanced_at:     now.toISOString(),
          updated_at:           now.toISOString(),
        }, { onConflict: 'user_id' }),

        // user_callsigns
        db.from('user_callsigns').insert({ user_id: userId, callsign }),

        // memory_graph
        facts.length > 0 && db.from('memory_graph').insert(
          facts.map(f => ({
            user_id:    userId,
            fact_type:  String(f.fact_type ?? 'person'),
            subject:    String(f.subject ?? ''),
            predicate:  String(f.predicate ?? ''),
            object:     String(f.object ?? ''),
            confidence: Number(f.confidence ?? 80),
            is_draft:   false,
            is_confirmed: true,
            source_tx:  'ai_persona_spawn',
          }))
        ),

        // memories
        mems.length > 0 && db.from('memories').insert(
          mems.map(m => ({
            user_id:      userId,
            type:         String(m.type ?? 'note'),
            text:         String(m.text ?? ''),
            tags:         Array.isArray(m.tags) ? m.tags : [],
            is_admin_test: true,
          }))
        ),

        // reminders
        rems.length > 0 && db.from('reminders').insert(
          rems.map(r => {
            const dueAt = new Date(now.getTime() + Number(r.due_offset_hours ?? 24) * 3600000);
            return {
              user_id:        userId,
              text:           String(r.text ?? ''),
              due_at:         dueAt.toISOString(),
              status:         'pending',
              is_admin_test:  true,
            };
          })
        ),

        // tasks
        tsks.length > 0 && db.from('tasks').insert(
          tsks.map(t => ({
            user_id:      userId,
            text:         String(t.text ?? ''),
            priority:     Number(t.priority ?? 5),
            status:       'open',
            is_admin_test: true,
          }))
        ),

        // conversation_history (pair up turns)
        convSeeds.length > 0 && db.from('conversation_history').insert(
          convSeeds.map((c, i) => ({
            user_id:      userId,
            session_id:   sessionId,
            role:         String(c.role ?? 'user'),
            content:      String(c.content ?? ''),
            intent:       c.role === 'user' ? String((c as Record<string, unknown>).intent ?? '') : null,
            is_admin_test: true,
            created_at:   new Date(now.getTime() - (convSeeds.length - i) * 60000).toISOString(),
          }))
        ),

        // entity_mentions
        entities.length > 0 && db.from('entity_mentions').insert(
          entities.map(e => ({
            user_id:            userId,
            entity_text:        String(e.entity_text ?? ''),
            entity_type:        String(e.entity_type ?? 'PERSON'),
            mention_count:      Number(e.mention_count ?? 1),
            last_mentioned_at:  now.toISOString(),
            first_mentioned_at: new Date(now.getTime() - 7 * 86400000).toISOString(),
          }))
        ),
      ]);

      // 4. Log spawn event
      await db.from('ai_persona_events').insert({
        user_id:    userId,
        event_type: 'spawn',
        summary:    `Persona spawned: ${p.name} (${p.archetype}) — ${facts.length} facts, ${mems.length} memories, ${tsks.length} tasks, ${rems.length} reminders, ${convSeeds.length} conv turns`,
        detail: {
          archetype:    p.archetype,
          name:         p.name,
          nationality:  p.nationality,
          profession:   p.profession,
          callsign,
          email,
          memory_facts_count:  facts.length,
          memories_count:      mems.length,
          tasks_count:         tsks.length,
          reminders_count:     rems.length,
          conv_turns_count:    convSeeds.length,
        },
        model_used:  'gpt-4o',
      });

      return new Response(JSON.stringify({
        userId,
        email,
        callsign,
        persona: { name: p.name, archetype: p.archetype, nationality: p.nationality, profession: p.profession, why_roger: p.why_roger },
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Invalid action. Use "preview" or "commit".' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
