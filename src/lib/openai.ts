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
  intent: string;
  confidence: number;
  ambiguity: number;
  outcome: 'success' | 'clarification' | 'error';
  entities: { text: string; type: string; confidence: number }[];
  roger_response: string;
  clarification_question?: string | null;
  reasoning: string;
  insight?: string | null;
  proposed_tasks?: { text: string; priority: number }[]; // NEW — auto-generated task proposals
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
- MANDATORY "📋 Roger suggests:" section after your answer with 2-3 actionable proposals:
  • A specific task directly derived from the information
  • A reminder if there's a time or deadline element
  • A brainstorm thread or research to pursue next
  Example: "📋 Roger suggests: (1) Task — draft summary of this for the team. (2) Reminder — revisit in 30 days. (3) Research — compare with competitor approach."
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
PROPOSED TASKS (NEW FIELD)
═══════════════════════════════════════
For EVERY response (including queries), include "proposed_tasks" — an array of 1-3 task objects
that should be auto-created or offered to the user based on this conversation turn.
Each task: { "text": "...", "priority": 1-10 }
If nothing actionable, return proposed_tasks: []

Return ONLY valid JSON:
{
  "intent": "EXPLAIN_CONCEPT",
  "confidence": 91,
  "ambiguity": 8,
  "outcome": "success",
  "entities": [
    { "text": "inflation", "type": "TOPIC", "confidence": 96 }
  ],
  "roger_response": "Inflation is the rate at which general price levels rise, eroding purchasing power. Central banks target ~2% annually. High inflation often follows loose monetary policy or supply shocks — it affects savings, debt, and asset values differently.\n\n📋 Roger suggests: (1) Task — review your portfolio's inflation exposure this week. (2) Reminder — check CPI data on next release date. (3) Research — which of your current holdings benefit from inflation?",
  "clarification_question": null,
  "insight": "Second economics query today — consider a morning markets briefing.",
  "reasoning": "User asked explanatory question about inflation. Gave educational answer with 3 actionable proposals.",
  "proposed_tasks": [
    { "text": "Review portfolio inflation exposure", "priority": 6 },
    { "text": "Check CPI data on next release", "priority": 5 }
  ]
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
