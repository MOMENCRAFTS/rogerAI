// ─── Roger AI — OpenAI Integration ──────────────────────────────────────────
// Calls GPT-4o to process a PTT transcript and return structured AI output.
// Now supports: open-ended intents, conversation history, AI-driven priority
// classification, response guarantee, and language detection.

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface RogerAIResponse {
  intent: string;           // Open-ended — GPT-4o names it freely (e.g. BOOK_FLIGHT)
  confidence: number;       // 0–100
  ambiguity: number;        // 0–100
  outcome: 'success' | 'clarification' | 'error';
  entities: { text: string; type: string; confidence: number }[];
  roger_response: string;   // Action intents: ≤35 words terse. Query intents: 60–120 words rich paragraph + follow-up offer.
  clarification_question?: string | null;
  reasoning: string;
  insight?: string | null;  // Optional 1-sentence pattern observation for CONVERSE type
}

export type PriorityAction =
  | 'forget'      // drop permanently
  | 'defer'       // push back 2 hours
  | 'lower'       // lower priority, resurface in 7 days
  | 'reschedule'  // specific time given
  | 'urgent'      // bump to priority 10
  | 'execute'     // handle/do the item
  | 'more_info';  // user wants more context

// ─── System Prompts ──────────────────────────────────────────────────────────

// Prompt A — Command Processor
const COMMAND_PROMPT = `You are the AI core of "Roger AI" — a voice-first PTT (push-to-talk) assistant for executives and high-performers.

INTENT CLASSIFICATION:
Classify every command with a SHORT_SNAKE_CASE intent name that precisely describes what the user wants.
Do NOT use a fixed list — name the intent accurately for what was said (e.g. BOOK_FLIGHT, SEND_EMAIL, IDENTIFY_MUSIC, QUERY_REMINDERS, DELETE_TASK, STATUS_CHECK, EXPLAIN_TOPIC, MARKET_QUERY).
Never return UNKNOWN. Always name the closest intent even if unusual.

SCORING:
- confidence: how certain you are about the intent (0–100)
- ambiguity: how unclear or incomplete the input is (0–100)
- If ambiguity > 60 OR confidence < 65: outcome = "clarification"
- If confidence < 40 AND ambiguity > 75: outcome = "error"
- Otherwise: outcome = "success"

GEO-TRIGGERED REMINDERS:
If the user says "when I'm near X", "when I arrive at X", "when I get to X", "remind me at X", or any location-conditional phrase:
  - intent = CREATE_REMINDER
  - Add entity: { "text": "X", "type": "LOCATION", "confidence": 95 }
  - roger_response confirms: "Geo-reminder set — I'll alert you when you're near [X]. Over."
  - Do NOT classify X as a TIME entity.

ENTITY RESOLUTION:
If the user says "him", "her", "it", "that", or "same" — resolve from conversation history.

RESPONSE STYLE — TWO MODES:

**ACTION INTENTS** (CREATE_*, DELETE_*, SEND_*, UPDATE_*, BOOK_*, SET_*):
- Terse military radio style. Confirm the action. Under 35 words. End with "Over." or "Roger that."
- Never elaborate unless asked.

**QUERY / INFORM INTENTS** (QUERY_*, STATUS_*, EXPLAIN_*, *_QUERY, BRIEFING_*, MARKET_*, RESEARCH_*, WATCHLIST_*, anything that is a question or information request):
- Give a RICH, well-structured paragraph response (60–120 words).
- Speak as a knowledgeable trusted aide, not a terse radio operator.
- No "Over." at the end of query responses.
- ALWAYS end with a natural follow-up offer on its own line. Use one of these forms:
  • "Want me to go deeper on any aspect of this?"
  • "Should I create a task or reminder from this?"
  • "Want more detail on [specific entity from your answer]?"
  • "Would you like me to track this or add it to your briefing?"
- The follow-up must feel natural, not robotic.

INSIGHT (optional):
If you notice the user has mentioned the same person/topic multiple times, add it as "insight" (max 12 words).
Examples: "Third Ahmad reminder this month." / "Eight open tasks now."

Return ONLY valid JSON:
{
  "intent": "CREATE_REMINDER",
  "confidence": 97,
  "ambiguity": 12,
  "outcome": "success",
  "entities": [
    { "text": "Ahmad", "type": "PERSON", "confidence": 98 },
    { "text": "tomorrow", "type": "TIME_REL", "confidence": 95 },
    { "text": "2pm", "type": "TIME_ABS", "confidence": 99 }
  ],
  "roger_response": "Copy that. Reminder set — call Ahmad, tomorrow at 2pm. Over.",
  "clarification_question": null,
  "insight": "Third Ahmad reminder this month.",
  "reasoning": "Clear reminder intent with specific person and time."
}`;

// Prompt B — Proactive Surface Script
const SURFACE_PROMPT = `You are Roger AI surfacing a memory item proactively to the user.
Speak as a trusted aide who has been paying careful attention.
Reference the time elapsed, context, and urgency naturally.
Ask exactly ONE actionable question at the end.
Keep the response under 35 words total. Always end with "Over."
Do not read the item verbatim — summarize it naturally.
Return plain text only (no JSON).`;

// Prompt C — Priority Classifier (AI-driven, no keywords)
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

// ─── API Helper ───────────────────────────────────────────────────────────────

async function callGPT<T>(
  systemPrompt: string,
  userContent: string,
  model: 'gpt-4o' | 'gpt-4o-mini' = 'gpt-4o',
  jsonMode = true,
  timeoutMs = 10000
): Promise<T> {
  if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userContent },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: { message?: string } }).error?.message ?? `OpenAI error ${res.status}`);
    }

    const data = await res.json() as { choices: { message: { content: string } }[] };
    const raw = data.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty response from OpenAI');

    return jsonMode ? JSON.parse(raw) as T : raw as unknown as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build user memory context string from DB.
 * Fetches conversation history + memory graph facts in parallel.
 * Returns a formatted context block for GPT-4o injection.
 */
async function buildUserContext(userId: string): Promise<string> {
  try {
    const { fetchConversationHistory, fetchMemoryGraph } = await import('./api');
    const [history, facts] = await Promise.all([
      fetchConversationHistory(userId, 20).catch(() => []),
      fetchMemoryGraph(userId).catch(() => []),
    ]);

    const lines: string[] = ['=== USER MEMORY CONTEXT ==='];

    if (facts.length > 0) {
      lines.push('\nKey facts about this user:');
      facts.slice(0, 12).forEach(f => {
        const confirmed = f.is_confirmed ? ' ✓' : '';
        lines.push(`  • ${f.subject} ${f.predicate} ${f.object}${confirmed}`);
      });
    }

    if (history.length > 0) {
      lines.push('\nRecent conversation history (oldest to newest):');
      history.slice(-12).forEach(t => {
        const label = t.role === 'user' ? 'User' : 'Roger';
        lines.push(`  [${label}]: ${t.content}`);
      });
    }

    lines.push('\nUse this context to: resolve pronouns, avoid asking things already known, personalize responses, and connect related topics.');
    return lines.join('\n');
  } catch {
    return ''; // graceful degradation — continue without context
  }
}

/**
 * Process a PTT voice transmission.
 * Injects persistent DB memory context (conversation_history + memory_graph) into GPT-4o.
 * Falls back gracefully if DB is unavailable.
 */
export async function processTransmission(
  transcript: string,
  history: ConversationTurn[] = [],
  detectedLanguage?: string,
  userId?: string,
  locationContext?: string   // e.g. "Riyadh, Saudi Arabia (24.6877, 46.7219)"
): Promise<RogerAIResponse> {
  const langHint = detectedLanguage && detectedLanguage !== 'en'
    ? `Language detected: ${detectedLanguage}. `
    : '';

  // Build session turns (in-memory history)
  const sessionMessages = history.slice(-6).map(t => ({
    role: t.role as 'user' | 'assistant',
    content: t.content,
  }));

  // Fetch persistent DB context if userId provided
  const memoryContext = userId ? await buildUserContext(userId) : '';

  if (!OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  // Build the messages array
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: COMMAND_PROMPT },
  ];

  // Inject memory context as a second system message (if available)
  if (memoryContext) {
    messages.push({ role: 'system', content: memoryContext });
  }

  // Inject live location as a GUARANTEED dedicated system block
  // Not buried in memory facts — always present when GPS is active
  if (locationContext) {
    messages.push({
      role: 'system',
      content: `=== USER CURRENT LOCATION ===\n${locationContext}\nUse for: distance queries, local business suggestions, timezone inference, commute estimates, weather references.`,
    });
  }

  // Inject session history turns
  messages.push(...sessionMessages);

  // Final user message
  messages.push({
    role: 'user',
    content: `${langHint}Process this PTT transmission: "${transcript}"`,
  });

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: 0.3,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: { message?: string } }).error?.message ?? `OpenAI error ${res.status}`);
    }

    const data = await res.json() as { choices: { message: { content: string } }[] };
    const raw = data.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty response from OpenAI');

    const result = JSON.parse(raw) as RogerAIResponse;

    // Auto-register any newly discovered intent into the registry (fire-and-forget)
    import('./api').then(({ upsertIntent }) => {
      upsertIntent(result.intent, {
        use_count: 1,
        last_used_at: new Date().toISOString(),
      }).catch(() => {});
    }).catch(() => {});

    return result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate Roger's proactive voice script for surfacing a memory item.
 * Returns plain text ready for TTS — not JSON.
 */
export async function generateSurfaceScript(item: {
  type: string;
  content: string;
  createdAt: Date;
  context?: string;
}): Promise<string> {
  const daysSince = Math.floor((Date.now() - item.createdAt.getTime()) / 86400000);
  const timeRef = daysSince === 0 ? 'earlier today'
    : daysSince === 1 ? 'yesterday'
    : `${daysSince} days ago`;

  const userContent = `Item type: ${item.type}
Content: "${item.content}"
Added: ${timeRef}
${item.context ? `Context: ${item.context}` : ''}
Generate Roger's proactive spoken line.`;

  return callGPT<string>(SURFACE_PROMPT, userContent, 'gpt-4o', false, 6000);
}

/**
 * Classify how the user responded to a proactively surfaced item.
 * AI-driven — no keyword matching. User can say anything natural.
 */
export async function classifyPriorityAction(userResponse: string): Promise<{
  action: PriorityAction;
  reschedule_hint: string | null;
}> {
  return callGPT<{ action: PriorityAction; reschedule_hint: string | null }>(
    PRIORITY_PROMPT,
    `User said: "${userResponse}"`,
    'gpt-4o-mini',
    true,
    4000
  );
}

// ─── Implicit Memory Extraction ───────────────────────────────────────────────

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

/**
 * Fire-and-forget implicit memory extraction after every PTT turn.
 * Uses GPT-4o-mini for low cost. Writes to memory_graph + memory_insights.
 */
export async function extractMemoryFacts(
  transcript: string,
  rogerResponse: string,
  userId: string
): Promise<void> {
  try {
    const result = await callGPT<{
      facts: { fact_type: string; subject: string; predicate: string; object: string; confidence: number }[];
      insight: string | null;
      entities: { text: string; type: string }[];
    }>(
      MEMORY_EXTRACTOR_PROMPT,
      `User said: "${transcript}"\nRoger responded: "${rogerResponse}"`,
      'gpt-4o-mini',
      true,
      6000
    );

    const { upsertMemoryFact, insertMemoryInsight } = await import('./api');

    // Write new facts to memory_graph
    if (result.facts?.length) {
      await Promise.allSettled(
        result.facts.map(f =>
          upsertMemoryFact({
            user_id: userId,
            fact_type: f.fact_type as never,
            subject: f.subject,
            predicate: f.predicate,
            object: f.object,
            confidence: f.confidence ?? 75,
            source_tx: transcript.slice(0, 80),
            is_confirmed: false,
          })
        )
      );
    }

    // Write insight to memory_insights
    if (result.insight) {
      await insertMemoryInsight({
        user_id: userId,
        insight: result.insight,
        source_turn: transcript.slice(0, 120),
      }).catch(() => {});
    }
  } catch {
    // Silent — never interrupt PTT flow
  }
}
