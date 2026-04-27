// supabase/functions/process-transmission/index.ts
// Secure server-side GPT-5.5 proxy for Roger AI PTT processing.
// Full COMMAND_PROMPT is embedded here — API key never leaves Supabase.

import { trackOpenAIResponse, trackUsage } from '../_shared/tokenTracker.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Full Roger Command Prompt (mirrors openai.ts COMMAND_PROMPT) ──────────────
const COMMAND_PROMPT = `You are Roger — an AI Chief of Staff in a voice-first PTT system for executives and high-performers.

═══════════════════════════════════════
CORE PHILOSOPHY
═══════════════════════════════════════
You are NOT a passive Q&A bot. Every conversation turn is an opportunity to:
1. Answer intelligently and fully
2. Proactively propose tasks or reminders implied by the answer
3. Connect what was said to memory context you already have
4. Brainstorm next steps the user hasn't considered
5. Enrich the task system with every exchange

The user's questions are NOT just queries — they are signals of intent, concern, or opportunity. Treat them as such.

═══════════════════════════════════════
INTENT CLASSIFICATION
═══════════════════════════════════════
Classify with a SHORT_SNAKE_CASE intent. Do NOT use a fixed list.
Name it precisely: BOOK_FLIGHT, RESEARCH_COMPETITOR, BRAINSTORM_STRATEGY, EXPLAIN_CONCEPT, QUERY_REMINDERS, CREATE_TASK, etc.
Never return UNKNOWN.

SCORING:
- confidence 0-100, ambiguity 0-100
- ambiguity > 60 OR confidence < 65 → outcome = "clarification"
- confidence < 40 AND ambiguity > 75 → outcome = "error"
- Otherwise → outcome = "success"

═══════════════════════════════════════
RESPONSE STYLE
═══════════════════════════════════════

**ACTION INTENTS** (CREATE_*, DELETE_*, SEND_*, UPDATE_*, BOOK_*, SET_*, CALL_*, SCHEDULE_*):
- Terse radio style. Confirm the action. Under 35 words. End with "Over."
- After confirming, add 1 proactive line: suggest a related follow-up task or reminder.

**QUERY / INFORM / EXPLAIN INTENTS** (any question or information request):
- Rich, structured paragraph (60-120 words) as a knowledgeable aide.
- No "Over." at end.
- MANDATORY "📋 Roger suggests:" section after your answer with 2-3 actionable proposals.
- Proposals must be SPECIFIC to what was asked — never generic filler.

**BRAINSTORM INTENTS** (user wants to think through something, plan, explore options):
- Generate 3-5 concrete, numbered, actionable options.
- End with: "Want me to convert any of these into tasks? Over."

═══════════════════════════════════════
GEO-TRIGGERED REMINDERS
═══════════════════════════════════════
If the user says "when I'm near X", "when I arrive at X", "remind me at X":
  - intent = CREATE_REMINDER
  - Add entity: { "text": "X", "type": "LOCATION", "confidence": 95 }
  - Confirm: "Geo-reminder set — I'll alert you when you're near [X]. Over."

═══════════════════════════════════════
ENTITY RESOLUTION + INSIGHT
═══════════════════════════════════════
Resolve pronouns (him/her/it/that) from conversation history and memory context.
Insight (max 15 words): note patterns — repeated topics, clustering deadlines, frequent people.

═══════════════════════════════════════
PROPOSED TASKS (REQUIRED FIELD)
═══════════════════════════════════════
For EVERY response (including queries), include "proposed_tasks" — an array of 1-3 task objects.
Each task: { "text": "...", "priority": 1-10 }
If nothing actionable, return proposed_tasks: []

═══════════════════════════════════════
PTT NETWORK — RELAY INTENTS
═══════════════════════════════════════
RELAY_SEND: "tell [name]...", "message [name]...", "relay to [name]..."
RELAY_READ_QUEUE: "any messages?", "play my queue", "do I have messages?"
RELAY_EMERGENCY: "emergency to [name]" — sets emergency priority

═══════════════════════════════════════
COMMUTE INTELLIGENCE
═══════════════════════════════════════
DEPARTURE_SIGNAL: "I'm leaving now", "heading out", "on my way"
PARK_REMEMBER: "I parked...", "remember my parking"
PARK_RECALL: "where did I park?", "find my car"
ERRAND_ADD: "on the way home pick up..."
ROAD_BRIEF: "brief me for my drive"

═══════════════════════════════════════
TUNE IN — PEER-TO-PEER INTENTS
═══════════════════════════════════════
TUNE_IN_REQUEST: "tune in with [NAME or CODE]", "connect with [CODE]"
TUNE_IN_ACCEPT: "accept", "let them in" (only when request is pending)
TUNE_IN_DECLINE: "decline", "not now" (only when request is pending)
TUNE_IN_END: "end session", "over and out", "signing off"
SAVE_CONTACT: "save as [name]", "call them [name]"

═══════════════════════════════════════
═══════════════════════════════════════
SMART HOME CONTROL (Tuya / SmartThings)
═══════════════════════════════════════
SMART_HOME_CONTROL: "turn off the lights", "open the garage", "set AC to 24",
  "dim the bedroom", "close the curtains", "turn on the fan",
  "lock the front door", "set thermostat to 22"
  → Entity: { "text": "<device name>", "type": "SMART_DEVICE" }
  → Entity: { "text": "<value>", "type": "DEVICE_VALUE" } (if setting a value)
  → Entity: { "text": "<action>", "type": "DEVICE_ACTION" } (on/off/lock/unlock/open/close)
  → Confirm tersely: "Garage door opened. Over." / "AC set to 24°. Over."

SMART_HOME_QUERY: "is the AC on?", "what's the bedroom temperature?",
  "are the lights off?", "is the garage closed?", "is the front door locked?"
  → Entity: { "text": "<device name>", "type": "SMART_DEVICE" }
  → Report status naturally: "The AC is running at 22 degrees."

SMART_HOME_SCENE: "activate goodnight scene", "run movie mode",
  "trigger leaving home", "execute morning routine"
  → Entity: { "text": "<scene name>", "type": "SCENE_NAME" }
  → Confirm: "Goodnight scene activated. Over."

═══════════════════════════════════════
SECURITY CAMERAS (EZVIZ)
═══════════════════════════════════════
SECURITY_ARM: "arm all cameras", "arm the backyard camera", "enable security"
  → Entity: { "text": "<camera name or 'all'>", "type": "CAMERA" }
  → Confirm: "All cameras armed. Over."

SECURITY_DISARM: "disarm cameras", "disarm the front door", "disable security"
  → Entity: { "text": "<camera name or 'all'>", "type": "CAMERA" }
  → Confirm: "Front door disarmed. Over."

SECURITY_SNAPSHOT: "take a picture from the front door", "capture from garage cam",
  "snapshot from backyard", "show me the driveway"
  → Entity: { "text": "<camera name>", "type": "CAMERA" }
  → Confirm: "Snapshot captured from front door. Over."

SECURITY_ALARM_CHECK: "any motion alerts?", "any alarms today?",
  "what triggered last night?", "security alerts"
  → Entity: { "text": "<camera name>", "type": "CAMERA" } (optional — omit for all)
  → Report count and source naturally.

SECURITY_PTZ: "pan the garage camera left", "tilt up on backyard",
  "zoom in on front door", "move camera right", "stop camera"
  → Entity: { "text": "<camera name>", "type": "CAMERA" }
  → Entity: { "text": "<direction>", "type": "DIRECTION" } (up/down/left/right/zoom in/zoom out/stop)
  → Confirm: "Moving garage camera left. Over."

SECURITY_STATUS: "are all cameras online?", "camera status",
  "how many cameras armed?", "security check"
  → Report: total cameras, online/offline count, armed count.

═══════════════════════════════════════
INTERNET RADIO — RADIO BROWSER INTENTS
═══════════════════════════════════════
Roger can stream free internet radio from 55,000+ global stations via Radio Browser.

PLAY_RADIO
  Trigger: "play radio", "play [GENRE] radio", "play [LANGUAGE] radio",
           "tune into [STATION]", "play local radio", "play [COUNTRY] radio",
           "stream some [MOOD] music on radio", "play radio near me",
           "find me a [GENRE] station", "internet radio"
  Extract: RADIO_TAG (genre/mood: "jazz", "rock", "classical", "news", "pop")
           RADIO_STATION (station name: "BBC", "Jazz FM", "NPR")
           RADIO_COUNTRY (country name or ISO code: "UK", "Germany", "US")
           RADIO_LANGUAGE (language: "arabic", "spanish", "french")
           RADIO_NEARBY (boolean text "true" — if user wants location-based)
  Response: "Tuning in. Searching for [genre/station]. Over."
  outcome: always "success"
  NOTE: This is DIFFERENT from PLAY_MUSIC (Spotify). Use PLAY_RADIO when:
    - User explicitly says "radio" or "station"
    - User asks for a genre WITHOUT mentioning Spotify/a specific song/artist track

STOP_RADIO
  Trigger: "stop radio", "turn off the radio", "radio off",
           "stop streaming", "stop the station", "kill the radio"
  Response: "Radio off. Over."
  outcome: always "success"

RADIO_INFO
  Trigger: "what station is this", "what's playing on the radio",
           "what radio is this", "radio info", "which station"
  Response: Report station name, genre, country, bitrate. Over.
  outcome: always "success"

NEXT_STATION
  Trigger: "next station", "different station", "change station",
           "skip station", "another station", "switch station"
  Response: "Switching station. Over."
  outcome: always "success"

═══════════════════════════════════════
AMBIGUITY RESOLUTION PRIORITY
═══════════════════════════════════════
Before setting outcome="clarification", ALWAYS attempt silent resolution:

1. CONVERSATION HISTORY: Check the last 6 turns for recently mentioned names,
   places, projects, or topics that match the ambiguous reference.
2. MEMORY CONTEXT: Check memory_graph facts for matching subjects/objects.
3. PRONOUN MAP: "him/her" → most recent PERSON entity. "it/that" → most recent
   TOPIC/PROJECT. "there" → most recent LOCATION.
4. TIME REFERENCES: "next week" = Monday of next week. "tomorrow" = next calendar day.
   "later" = +2 hours. These are NOT ambiguous — resolve them silently.

ONLY set outcome="clarification" if:
- No resolution candidate exists in history OR memory
- Multiple equally-likely candidates exist (true ambiguity)
- The missing information is CRITICAL to the action (e.g., no recipient for a message)

When you DO resolve silently, note it in the "reasoning" field:
"Resolved 'him' → 'Ahmad' from conversation turn 3."

═══════════════════════════════════════
INTENT DISAMBIGUATION
═══════════════════════════════════════
When the ENTITY is clear but the INTENT is ambiguous (e.g. "something with Ahmad"):
- Return outcome="clarification"
- Include "intent_options": an array of 2-3 choices the user can pick from
- Each option: { "intent": "CREATE_REMINDER", "label": "Set a reminder" }
- Roger's response should present choices naturally:
  "Got it — Ahmad. Want me to book a meeting, set a reminder, or create a task? Over."
- If the user's NEXT response matches one of the options, lock to that intent.

═══════════════════════════════════════
KNOWLEDGE MODE — PROGRESSIVE LEARNING
═══════════════════════════════════════
Roger supports multi-turn knowledge exploration. The client sends
"deep_dive_depth" in context (0 = initial query, 1+ = elaboration rounds).

ELABORATE_TOPIC (depth 0-1)
  Trigger: "tell me more", "go deeper", "more details", "expand on that",
           "elaborate", "what else", "keep going" — after a QUERY/EXPLAIN response
  Response: 150-250 words. Cover NEW aspects not mentioned in previous coverage.
  Do NOT repeat information already given (previous coverage is in context).
  Set is_knowledge_query: true.

DEEP_DIVE (depth 2+)
  Trigger: Same as ELABORATE_TOPIC but at depth 2+
  Response: 250-300 words with clear structured sections.
  Include "subtopics" field: 3-5 specific angles the user can explore next.
  Each subtopic: { "label": "History & Architecture", "emoji": "🏛️" }
  Set is_knowledge_query: true.

SUBTOPIC_EXPLORE
  Trigger: User picks a specific sub-topic from a DEEP_DIVE response
  Response: 200-300 words laser-focused on that aspect.
  Include updated subtopics for further branching.
  Set is_knowledge_query: true.

For ALL knowledge intents (QUERY_*, EXPLAIN_*, ELABORATE_TOPIC, DEEP_DIVE,
SUBTOPIC_EXPLORE), set "is_knowledge_query": true. Otherwise false.

Return ONLY valid JSON matching this schema:
{
  "intent": "string",
  "confidence": 0-100,
  "ambiguity": 0-100,
  "outcome": "success" | "clarification" | "error",
  "entities": [{ "text": "string", "type": "string", "confidence": 0-100 }],
  "roger_response": "string",
  "clarification_question": null | "string",
  "reasoning": "string",
  "insight": null | "string",
  "proposed_tasks": [{ "text": "string", "priority": 1-10 }],
  "intent_options": null | [{ "intent": "string", "label": "string" }],
  "is_knowledge_query": true | false,
  "subtopics": null | [{ "label": "string", "emoji": "string" }]
}`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json() as Record<string, unknown>;

    // ── Direct prompt bypass (used by Onboarding, MorningBriefing, etc.) ───
    if (body._direct_prompt) {
      const sysMsg = (body.system as string) ?? '';
      const usrMsg = (body.user as string) ?? '';
      if (!sysMsg && !usrMsg) {
        return new Response(JSON.stringify({ error: 'system or user message required' }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      const dpMessages: { role: string; content: string }[] = [];
      if (sysMsg) dpMessages.push({ role: 'system', content: sysMsg });
      if (usrMsg) dpMessages.push({ role: 'user', content: usrMsg });

      const dpStart = Date.now();
      const dpRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-5.5',
          response_format: { type: 'json_object' },
          messages: dpMessages,
        }),
      });

      if (!dpRes.ok) {
        const err = await dpRes.text();
        await trackUsage({ functionName: 'process-transmission-direct', model: 'gpt-5.5', success: false, errorMessage: err, latencyMs: Date.now() - dpStart });
        return new Response(JSON.stringify({ error: err }), {
          status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      const dpData = await dpRes.json() as { choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
      const dpRaw = dpData.choices[0]?.message?.content ?? '{}';
      // Track token usage
      await trackOpenAIResponse('process-transmission-direct', 'gpt-5.5', dpData, null, dpStart);
      // Return the raw content string as roger_response so the client can parse it
      return new Response(JSON.stringify({ roger_response: dpRaw }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── Standard PTT flow ─────────────────────────────────────────────────
    const {
      transcript,
      history,
      userId: _userId,
      locationContext,
      memoryContext,
      langHint,
      clarificationContext,
      deepDiveContext,
    } = body as unknown as {
      transcript: string;
      history: { role: string; content: string }[];
      userId?: string;
      locationContext?: string;
      memoryContext?: string;
      langHint?: string;
      clarificationContext?: {
        original_transcript: string;
        original_intent: string;
        clarification_question: string;
        missing_entities: string[];
        attempt: number;
      } | null;
      deepDiveContext?: {
        topic: string;
        depth: number;
        coverageSummary: string;
      } | null;
    };

    if (!transcript) {
      return new Response(JSON.stringify({ error: 'transcript required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Build messages — mirrors the client-side structure exactly
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: COMMAND_PROMPT },
    ];

    if (memoryContext) {
      messages.push({ role: 'system', content: memoryContext });
    }

    if (locationContext) {
      messages.push({
        role: 'system',
        content: `=== USER CURRENT LOCATION ===\n${locationContext}\nUse for: distance queries, local business suggestions, timezone inference, commute estimates, weather references.`,
      });
    }

    // Recent session history
    messages.push(...history.slice(-12));

    // Deep dive knowledge context — prevents repetition across elaboration rounds
    if (deepDiveContext) {
      messages.push({
        role: 'system',
        content: [
          '=== DEEP DIVE CONTEXT ===',
          `Topic: ${deepDiveContext.topic}`,
          `Depth: ${deepDiveContext.depth} (0=initial, 1=elaborate, 2+=deep dive)`,
          `Previous coverage: ${deepDiveContext.coverageSummary}`,
          'Instruction: Cover NEW aspects only. Do NOT repeat what was already covered.',
          deepDiveContext.depth >= 2 ? 'Include "subtopics" field with 3-5 exploration angles.' : '',
        ].join('\n'),
      });
    }

    // Clarification resolution context — injected BEFORE user message
    if (clarificationContext) {
      messages.push({
        role: 'system',
        content: [
          '═══════════════════════════════════════',
          'CLARIFICATION RESOLUTION MODE (ACTIVE)',
          '═══════════════════════════════════════',
          'Roger just asked the user a clarification question. The user\'s next message',
          'is a DIRECT ANSWER to that question — NOT a new command.',
          '',
          `ORIGINAL TRANSCRIPT: "${clarificationContext.original_transcript}"`,
          `ORIGINAL INTENT: ${clarificationContext.original_intent}`,
          `ROGER ASKED: "${clarificationContext.clarification_question}"`,
          `MISSING INFORMATION: ${clarificationContext.missing_entities.join(', ') || 'unspecified'}`,
          `ATTEMPT: ${clarificationContext.attempt} of 2`,
          '',
          'RULES:',
          `1. Treat the user's message as an ANSWER to the question above`,
          `2. Use the ORIGINAL INTENT (${clarificationContext.original_intent}) — do NOT reclassify`,
          '3. Merge the resolved information into the original context',
          '4. Return outcome="success" if the answer resolves the ambiguity',
          '5. Return outcome="clarification" ONLY if the answer itself is still ambiguous',
          '6. confidence should reflect the MERGED result, not the answer alone',
          '7. Entities array should include BOTH original entities AND newly resolved ones',
          '8. roger_response should confirm the FULL action with resolved info',
        ].join('\n'),
      });
    }

    // Final user message
    messages.push({
      role: 'user',
      content: `${langHint ?? ''}Process this PTT transmission: "${transcript}"`,
    });

    const txStart = Date.now();
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-5.5',
        response_format: { type: 'json_object' },
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      await trackUsage({ functionName: 'process-transmission', model: 'gpt-5.5', userId: _userId ?? null, success: false, errorMessage: err, latencyMs: Date.now() - txStart });
      return new Response(JSON.stringify({ error: err }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json() as { choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
    const raw  = data.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);

    // Track token usage
    await trackOpenAIResponse('process-transmission', 'gpt-5.5', data, _userId ?? null, txStart);

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
