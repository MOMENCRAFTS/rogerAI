// ─── Roger AI — Conversational Onboarding Flow ──────────────────────────────
import { getAuthToken } from './getAuthToken';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

// ── Phases ──────────────────────────────────────────────────────────────────
export type OnboardingPhase =
  | 'welcome'        // Roger introduces himself, asks name + open question
  | 'name_confirm'   // spelling check with phonetic variants
  | 'islamic'        // must-ask: Islamic mode
  | 'review'         // AI-generated profile summary
  | 'complete';

export interface OnboardingAnswers {
  name?: string;
  role?: string;
  key_priorities?: string[];
  current_focus?: string;
  work_schedule?: string;
  location_base?: string;
  comm_style?: 'brief' | 'balanced' | 'detailed';
  tools_used?: string[];
  interests?: string[];
  feature_prefs?: string[];
  islamic_mode?: boolean;
}

// Fields the AI interview can extract from conversation (reference only)
// const INTERVIEW_FIELDS = [
//   'name', 'role', 'key_priorities', 'current_focus',
//   'work_schedule', 'location_base', 'comm_style', 'tools_used', 'interests',
// ] as const;

// Minimum / maximum elastic interview turns
export const MIN_INTERVIEW_TURNS = 1;
export const MAX_INTERVIEW_TURNS = 2;
export const MAX_TOTAL_TURNS = 6;

// Features list shown during the dedicated features turn
export const ROGER_FEATURES = [
  'Calendar management',
  'Task & reminder tracking',
  'Morning briefings',
  'Road hazard & radar alerts',
  'Weather updates',
  'News digest',
  'Finance & stock updates',
  'Commute assistance',
  'Memory vault',
];

// Phase labels for progress UI
export const PHASE_LABELS: Record<OnboardingPhase, string> = {
  welcome:      'WELCOME',
  name_confirm: 'NAME CHECK',
  islamic:      'PREFERENCES',
  review:       'REVIEW',
  complete:     'COMPLETE',
};

// ── For backward compat with Onboarding.tsx imports ─────────────────────────
// These are kept so the existing code doesn't break during migration
export type OnboardingNode = OnboardingPhase;
export const TOTAL_NODES = MAX_TOTAL_TURNS;
export const NODE_INDEX = (_phase: OnboardingPhase) => 0;
export const NODE_LABELS: Partial<Record<OnboardingPhase, string>> = PHASE_LABELS;
export const NEXT_NODE: Record<string, string> = {};

// ── Utility: which fields are still missing? ────────────────────────────────
export function getMissingFields(answers: OnboardingAnswers): string[] {
  const missing: string[] = [];
  if (!answers.name) missing.push('name');
  if (!answers.role) missing.push('role');
  if (!answers.key_priorities?.length) missing.push('key_priorities');
  if (!answers.current_focus) missing.push('current_focus');
  if (!answers.work_schedule) missing.push('work_schedule');
  if (!answers.location_base) missing.push('location_base');
  if (!answers.comm_style) missing.push('comm_style');
  if (!answers.tools_used?.length) missing.push('tools_used');
  if (!answers.interests?.length) missing.push('interests');
  return missing;
}

// ── Welcome script ──────────────────────────────────────────────────────────
export const WELCOME_SCRIPT =
  "Roger AI online. I'm your AI chief of staff — here to manage your day, your tasks, and your intel. Let's get acquainted. What's your name, and what do you do?";

// ── Interview prompt ────────────────────────────────────────────────────────
const INTERVIEW_PROMPT = (
  turnNumber: number,
  answers: OnboardingAnswers,
  missing: string[],
  previousQuestions: string[],
) => `You are Roger AI — a voice-first AI chief of staff — conducting an onboarding interview.

═══ STEP 1: SILENT AUDIT (do this internally, do NOT output it) ═══
Before generating your question, silently evaluate:
1. What fields are ALREADY collected? → ${JSON.stringify(answers)}
2. What fields are STILL MISSING? → ${missing.length > 0 ? missing.join(', ') : 'NONE — all fields collected'}
3. What questions have ALREADY been asked? → ${previousQuestions.length > 0 ? previousQuestions.map((q, i) => `Turn ${i + 1}: "${q}"`).join(' | ') : 'None yet'}
4. Turn budget: ${turnNumber} of ${MAX_INTERVIEW_TURNS} max. Minimum remaining: ${Math.max(0, MIN_INTERVIEW_TURNS - turnNumber)}

═══ STEP 2: EXTRACT FIELDS FROM USER'S RESPONSE ═══
Extract ALL possible fields from what the user just said:
- "My name is Momen" → name: "Momen"
- "I'm a doctor in Dubai" → role: "Doctor", location_base: "Dubai"
- "I focus on clinic growth and patient retention" → current_focus: "Clinic growth", key_priorities: ["Clinic growth", "Patient retention"]
- "I start at 8 and finish around 5" → work_schedule: "8 AM – 5 PM"
- "I use Notion and Slack" → tools_used: ["Notion", "Slack"]
- "I love football and reading" → interests: ["Football", "Reading"]
- For comm_style: INFER from verbosity. Terse → "brief". Verbose → "detailed". Normal → "balanced".
- Title-case names and proper nouns.

═══ STEP 3: DECIDE NEXT QUESTION (critical rules) ═══

ABSOLUTE RULES — VIOLATION IS FAILURE:
1. NEVER ask about a field that is ALREADY in the collected data. If name is collected, DO NOT ask "what's your name".
2. NEVER repeat a question from a previous turn. Check the "already asked" list above.
3. NEVER ask about features or Islamic mode — those have dedicated turns later.
4. Each question MUST target ONLY missing fields.
5. DO NOT ask generic questions like "anything else?" or "is there more?" — instead, ask about a SPECIFIC missing field.

QUESTION STYLE:
- Under 30 words. Warm but direct. Military-aide tone.
- Start by acknowledging what you just learned: "Copy that, Momen. Doctor in Dubai, focused on growth."
- Then ask about 1-2 SPECIFIC missing fields: "What time does your day usually start? And what tools do you rely on?"
- Never say "certainly", "absolutely", "great", "perfect".

COMPLETION LOGIC:
${turnNumber >= MIN_INTERVIEW_TURNS ? `- You have met the minimum turn requirement.
- If 5+ fields are collected (especially name + role), set all_covered: true.
- If only 1-2 fields are missing and they're optional, set all_covered: true.
- DO NOT drag the interview with vague catch-all questions.` : `- Minimum turns NOT met. Set all_covered: false. Ask about specific missing fields.`}

Return ONLY valid JSON:
{
  "script": "your specific question targeting missing fields",
  "extracted_fields": {
    "name": "string or null",
    "role": "string or null",
    "key_priorities": ["array"] or null,
    "current_focus": "string or null",
    "work_schedule": "string or null",
    "location_base": "string or null",
    "comm_style": "brief|balanced|detailed or null",
    "tools_used": ["array"] or null,
    "interests": ["array"] or null
  },
  "all_covered": false
}`;

// ── Name confirm prompt ─────────────────────────────────────────────────────
const NAME_CONFIRM_PROMPT = (name: string) =>
  `You are Roger AI confirming a user's name spelling during onboarding.
The name extracted is: "${name}"
Generate a short confirmation question (under 20 words). E.g. "Got it, ${name} — is that spelled correctly? Say yes or spell it for me."
Also process the user's response if provided.

extracted_value rules:
- If user says yes/correct/right → extracted_value: "yes"
- If user spells a correction → extracted_value: the corrected name (title-cased)

Return ONLY valid JSON:
{"script": "...", "extracted_value": "yes or corrected name"}`;

// ── Features prompt ─────────────────────────────────────────────────────────
const FEATURES_PROMPT = (name: string) =>
  `You are Roger AI presenting available features during onboarding.
User name: ${name || 'Commander'}

Tell them what Roger can help with: ${ROGER_FEATURES.join(', ')}.
Ask which features matter most to them. Under 35 words. Warm, direct tone.

When processing their response, match spoken preferences to these exact labels:
${ROGER_FEATURES.map(f => `"${f}"`).join(', ')}

Return ONLY valid JSON:
{"script": "...", "extracted_value": "comma-separated matched feature labels, or null"}`;

// ── Islamic mode prompt ─────────────────────────────────────────────────────
const ISLAMIC_PROMPT =
  `You are Roger AI asking about Islamic Mode during onboarding.
Say EXACTLY: "One more thing. Are you Muslim? If so, I can activate Islamic Mode — prayer times, Qibla direction, and salah reminders. Say yes to enable, or skip."
Do NOT deviate from this phrasing.

When processing their response:
- "yes"/"sure"/"I am"/"enable" → extracted_value: "yes"
- "no"/"skip"/"not for me" → extracted_value: "no"

Return ONLY valid JSON:
{"script": "...", "extracted_value": "yes or no or null"}`;

// ── Result types ────────────────────────────────────────────────────────────
export interface InterviewTurnResult {
  script: string;
  extracted_fields: Partial<OnboardingAnswers>;
  all_covered: boolean;
}

export interface SimpleNodeResult {
  script: string;
  extracted_value: string | null;
}

// ── Backward compat type ────────────────────────────────────────────────────
export interface NodeScriptResult {
  script: string;
  extracted_value: string | null;
  needs_clarification: boolean;
  clarification_prompt: string | null;
}

async function callLLM(system: string, user: string): Promise<string> {
  const token = await getAuthToken().catch(() => null);
  if (!token) throw new Error('No auth token');

  console.log('[callLLM] Sending _direct_prompt request...');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/process-transmission`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ _direct_prompt: true, system, user }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[callLLM] HTTP', res.status, errText);
    throw new Error(`LLM HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json() as Record<string, unknown>;
  console.log('[callLLM] Response keys:', Object.keys(data));

  // Edge function returns { roger_response: "raw LLM JSON string" }
  const content = typeof data.roger_response === 'string' ? data.roger_response : '';

  if (!content) {
    console.error('[callLLM] Empty roger_response. Full data:', JSON.stringify(data).substring(0, 500));
    throw new Error('LLM returned empty content');
  }

  console.log('[callLLM] Got response, length:', content.length);
  return content;
}

// ── Silent field extraction (no question generation) ────────────────────────
const EXTRACTION_PROMPT = `You are a data extraction engine. Extract structured fields from the user's speech.

RULES:
- Extract ONLY what the user explicitly stated. Do not infer or assume.
- Title-case names and proper nouns.
- For comm_style: infer from verbosity. Terse → "brief". Verbose → "detailed". Normal → "balanced".
- Return ONLY valid JSON. No explanation, no commentary.

Return format:
{
  "name": "string or null",
  "role": "string or null",
  "key_priorities": ["array"] or null,
  "current_focus": "string or null",
  "work_schedule": "string or null",
  "location_base": "string or null",
  "comm_style": "brief|balanced|detailed or null",
  "tools_used": ["array"] or null,
  "interests": ["array"] or null
}`;

export async function silentExtractFields(
  transcript: string,
  existing: OnboardingAnswers,
): Promise<Partial<OnboardingAnswers>> {
  console.log('[Onboarding] Silent extract START — transcript:', transcript);
  console.log('[Onboarding] Silent extract — existing answers:', JSON.stringify(existing));
  try {
    const raw = await callLLM(EXTRACTION_PROMPT, `User said: "${transcript}"`);
    console.log('[Onboarding] Silent extract — raw LLM response:', raw);
    const ef = JSON.parse(raw) as Record<string, unknown>;

    const extracted: Partial<OnboardingAnswers> = {};
    if (ef.name && typeof ef.name === 'string' && !existing.name) extracted.name = extractName(ef.name as string);
    if (ef.role && typeof ef.role === 'string' && !existing.role) extracted.role = ef.role as string;
    if (ef.current_focus && typeof ef.current_focus === 'string' && !existing.current_focus) extracted.current_focus = ef.current_focus as string;
    if (ef.work_schedule && typeof ef.work_schedule === 'string' && !existing.work_schedule) extracted.work_schedule = ef.work_schedule as string;
    if (ef.location_base && typeof ef.location_base === 'string' && !existing.location_base) extracted.location_base = ef.location_base as string;
    if (ef.comm_style && typeof ef.comm_style === 'string' && !existing.comm_style) {
      const cs = (ef.comm_style as string).toLowerCase();
      extracted.comm_style = cs === 'brief' ? 'brief' : cs === 'detailed' ? 'detailed' : 'balanced';
    }
    if (Array.isArray(ef.key_priorities) && !existing.key_priorities?.length) extracted.key_priorities = (ef.key_priorities as string[]).filter(Boolean);
    if (Array.isArray(ef.tools_used) && !existing.tools_used?.length) extracted.tools_used = (ef.tools_used as string[]).filter(Boolean);
    if (Array.isArray(ef.interests) && !existing.interests?.length) extracted.interests = (ef.interests as string[]).filter(Boolean);

    console.log('[Onboarding] Silent extract — extracted fields:', JSON.stringify(extracted));
    return extracted;
  } catch (err) {
    console.error('[Onboarding] Silent extract FAILED:', err);
    return extractFieldsRegex(transcript, existing);
  }
}

// ── Generate interview turn ─────────────────────────────────────────────────
export async function generateInterviewTurn(
  turnNumber: number,
  answers: OnboardingAnswers,
  transcript?: string,
  previousQuestions: string[] = [],
): Promise<InterviewTurnResult> {
  const missing = getMissingFields(answers);

  // Fallback questions — context-aware (skip fields already collected)
  const FALLBACKS: string[] = [];
  if (!answers.name || !answers.role) {
    FALLBACKS.push(`What's your name, and what do you do?`);
  }
  if (!answers.location_base || !answers.current_focus) {
    FALLBACKS.push(`${answers.name ? answers.name + ', where' : 'Where'} are you based, and what's your main focus right now?`);
  }
  if (!answers.work_schedule) {
    FALLBACKS.push(`What does a typical day look like? When do you start and wrap up?`);
  }
  if (!answers.tools_used?.length || !answers.interests?.length) {
    FALLBACKS.push(`What tools or apps do you rely on most? And what are your interests outside work?`);
  }
  FALLBACKS.push(`${answers.name ? answers.name + ', anything' : 'Anything'} else I should know about you?`);

  try {
    const prompt = INTERVIEW_PROMPT(turnNumber, answers, missing, previousQuestions);
    // Build context message — always include collected fields so LLM sees the full picture
    const collectedSummary = Object.entries(answers)
      .filter(([, v]) => v && (typeof v !== 'object' || (Array.isArray(v) && v.length > 0)))
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(', ');
    const content = transcript
      ? `User said: "${transcript}"\nAlready collected: {${collectedSummary}}\nGenerate follow-up about MISSING fields only.`
      : `Already collected: {${collectedSummary}}\nMissing fields: ${missing.join(', ')}\nGenerate a question about the missing fields. Do NOT ask about already-collected fields.`;
    const raw = await callLLM(prompt, content);
    const parsed = JSON.parse(raw) as {
      script: string;
      extracted_fields: Record<string, unknown>;
      all_covered: boolean;
    };

    // Map extracted fields to OnboardingAnswers
    const ef = parsed.extracted_fields ?? {};
    const extracted: Partial<OnboardingAnswers> = {};
    if (ef.name && typeof ef.name === 'string') extracted.name = extractName(ef.name as string);
    if (ef.role && typeof ef.role === 'string') extracted.role = ef.role as string;
    if (ef.current_focus && typeof ef.current_focus === 'string') extracted.current_focus = ef.current_focus as string;
    if (ef.work_schedule && typeof ef.work_schedule === 'string') extracted.work_schedule = ef.work_schedule as string;
    if (ef.location_base && typeof ef.location_base === 'string') extracted.location_base = ef.location_base as string;
    if (ef.comm_style && typeof ef.comm_style === 'string') {
      const cs = (ef.comm_style as string).toLowerCase();
      extracted.comm_style = cs === 'brief' ? 'brief' : cs === 'detailed' ? 'detailed' : 'balanced';
    }
    if (Array.isArray(ef.key_priorities)) extracted.key_priorities = (ef.key_priorities as string[]).filter(Boolean);
    if (Array.isArray(ef.tools_used)) extracted.tools_used = (ef.tools_used as string[]).filter(Boolean);
    if (Array.isArray(ef.interests)) extracted.interests = (ef.interests as string[]).filter(Boolean);

    return {
      script: parsed.script ?? FALLBACKS[Math.min(turnNumber - 1, FALLBACKS.length - 1)],
      extracted_fields: extracted,
      all_covered: turnNumber >= MIN_INTERVIEW_TURNS ? (parsed.all_covered ?? false) : false,
    };
  } catch {
    return {
      script: FALLBACKS[Math.min(turnNumber - 1, FALLBACKS.length - 1)],
      extracted_fields: transcript ? extractFieldsRegex(transcript, answers) : {},
      all_covered: false,
    };
  }
}

// ── Generate name confirmation ──────────────────────────────────────────────
export async function generateNameConfirm(
  name: string,
  transcript?: string,
): Promise<SimpleNodeResult> {
  const fallbackScript = `Got it, ${name}. Is that spelled correctly? Say yes or spell it for me.`;
  try {
    const content = transcript
      ? `User said: "${transcript}"`
      : `Generate spelling confirmation for name: ${name}`;
    const raw = await callLLM(NAME_CONFIRM_PROMPT(name), content);
    const parsed = JSON.parse(raw) as SimpleNodeResult;
    return { script: parsed.script ?? fallbackScript, extracted_value: parsed.extracted_value ?? null };
  } catch {
    return { script: fallbackScript, extracted_value: null };
  }
}

// ── Generate features turn ──────────────────────────────────────────────────
export async function generateFeaturesTurn(
  name: string,
  transcript?: string,
): Promise<SimpleNodeResult> {
  const fallbackScript = `${name || 'Commander'}, Roger can help with: calendar, tasks, briefings, hazard alerts, weather, news, finance, commute, and memory vault. Which matter most to you?`;
  try {
    const content = transcript
      ? `User said: "${transcript}"`
      : `Generate features presentation.`;
    const raw = await callLLM(FEATURES_PROMPT(name), content);
    const parsed = JSON.parse(raw) as SimpleNodeResult;
    return { script: parsed.script ?? fallbackScript, extracted_value: parsed.extracted_value ?? null };
  } catch {
    return { script: fallbackScript, extracted_value: null };
  }
}

// ── Generate Islamic mode turn ──────────────────────────────────────────────
export async function generateIslamicTurn(
  transcript?: string,
): Promise<SimpleNodeResult> {
  const fallbackScript = 'One more thing. Are you Muslim? If so, I can activate Islamic Mode — prayer times, Qibla direction, and salah reminders. Say yes to enable, or skip.';
  try {
    const content = transcript
      ? `User said: "${transcript}"`
      : `Generate Islamic Mode question.`;
    const raw = await callLLM(ISLAMIC_PROMPT, content);
    const parsed = JSON.parse(raw) as SimpleNodeResult;
    return { script: parsed.script ?? fallbackScript, extracted_value: parsed.extracted_value ?? null };
  } catch {
    return { script: fallbackScript, extracted_value: null };
  }
}

// ── Build review script ─────────────────────────────────────────────────────
export function buildReviewScriptFallback(answers: OnboardingAnswers): string {
  const name = answers.name ?? 'you';
  const role = answers.role ? `, a ${answers.role},` : '';
  const loc  = answers.location_base ? ` based in ${answers.location_base}` : '';
  const focus = answers.current_focus ? ` Currently focused on ${answers.current_focus}.` : '';
  const sched = answers.work_schedule ? ` Operating from ${answers.work_schedule}.` : '';
  const tools = answers.tools_used?.length ? ` Relies on ${answers.tools_used.join(', ')}.` : '';
  const interests = answers.interests?.length ? ` Passionate about ${answers.interests.join(', ')}.` : '';
  const features = answers.feature_prefs?.length
    ? ` Roger will be activated for: ${answers.feature_prefs.join(', ')}.`
    : '';
  return `Roger understands that ${name}${role}${loc} is setting up Command.${focus}${sched}${tools}${interests}${features} Say confirm to lock this in, or name the field to change.`;
}

export async function buildReviewScript(answers: OnboardingAnswers): Promise<string> {
  const summary = [
    answers.name        && `Name: ${answers.name}`,
    answers.role        && `Role: ${answers.role}`,
    answers.location_base && `Location: ${answers.location_base}`,
    answers.work_schedule && `Schedule: ${answers.work_schedule}`,
    answers.current_focus && `Focus: ${answers.current_focus}`,
    answers.key_priorities?.length && `Priorities: ${answers.key_priorities.join(', ')}`,
    answers.comm_style  && `Style: ${answers.comm_style}`,
    answers.tools_used?.length && `Tools: ${answers.tools_used.join(', ')}`,
    answers.interests?.length && `Interests: ${answers.interests.join(', ')}`,
    answers.feature_prefs?.length && `Features: ${answers.feature_prefs.join(', ')}`,
    answers.islamic_mode !== undefined && `Islamic Mode: ${answers.islamic_mode ? 'Enabled' : 'Disabled'}`,
  ].filter(Boolean).join('\n');

  try {
    const system = `You are Roger AI. Given a user profile, write a SHORT 2-3 sentence 3rd-person narrative.
Rules:
- Speak AS Roger confirming what he learned (e.g. "Roger reads you as...")
- 3rd person, concise, intelligent, not robotic
- Reference name, profession, location, passions naturally
- Under 60 words
- End with: "Say confirm to lock this in, or name the field to change."
- No emojis. Military-aide tone.`;
    const raw = await callLLM(system, summary);
    const parsed = JSON.parse(raw) as { roger_response?: string; script?: string };
    return (parsed.script ?? parsed.roger_response ?? raw) || buildReviewScriptFallback(answers);
  } catch {
    return buildReviewScriptFallback(answers);
  }
}

// ── Name extraction (regex fallback) ────────────────────────────────────────
function extractName(raw: string): string {
  let name = raw.trim()
    .replace(/[.!?,]+$/, '')
    .replace(/^(hey[,.]?\s*|hi[,.]?\s*|hello[,.]?\s*)?/i, '')
    .replace(/^(my name is|the name is|the name'?s|i'?m called|they call me|people call me|you can call me|call me|i am|i'?m|it'?s|this is|name'?s)\s+/i, '')
    .trim();
  if (!name) name = raw.trim();
  name = name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return name;
}

// ── Regex fallback field extraction ─────────────────────────────────────────
function extractFieldsRegex(transcript: string, existing: OnboardingAnswers): Partial<OnboardingAnswers> {
  const result: Partial<OnboardingAnswers> = {};
  const t = transcript.trim();
  if (!existing.name) {
    const nameMatch = t.match(/(?:my name is|i'm|i am|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    if (nameMatch) result.name = extractName(nameMatch[1]);
  }
  return result;
}

// ── Merge extracted fields into answers ─────────────────────────────────────
export function mergeExtractedFields(
  answers: OnboardingAnswers,
  extracted: Partial<OnboardingAnswers>,
): OnboardingAnswers {
  const merged = { ...answers };
  if (extracted.name) merged.name = extracted.name;
  if (extracted.role) merged.role = extracted.role;
  if (extracted.current_focus) merged.current_focus = extracted.current_focus;
  if (extracted.work_schedule) merged.work_schedule = extracted.work_schedule;
  if (extracted.location_base) merged.location_base = extracted.location_base;
  if (extracted.comm_style) merged.comm_style = extracted.comm_style;
  if (extracted.key_priorities?.length) merged.key_priorities = extracted.key_priorities;
  if (extracted.tools_used?.length) merged.tools_used = extracted.tools_used;
  if (extracted.interests?.length) merged.interests = extracted.interests;
  if (extracted.feature_prefs?.length) merged.feature_prefs = extracted.feature_prefs;
  if (extracted.islamic_mode !== undefined) merged.islamic_mode = extracted.islamic_mode;
  return merged;
}

// ── Apply feature prefs from transcript ─────────────────────────────────────
export function applyFeaturePrefs(value: string): string[] {
  const lv = value.toLowerCase();
  const matched: string[] = [];
  const map: [RegExp, string][] = [
    [/calendar/, 'Calendar management'],
    [/task|remind/, 'Task & reminder tracking'],
    [/brief|morning/, 'Morning briefings'],
    [/hazard|radar|speed|trap/, 'Road hazard & radar alerts'],
    [/weather/, 'Weather updates'],
    [/news|digest/, 'News digest'],
    [/financ|stock|market/, 'Finance & stock updates'],
    [/commut|traffic|drive|navigation/, 'Commute assistance'],
    [/memory|vault|rememb/, 'Memory vault'],
  ];
  for (const [re, label] of map) {
    if (re.test(lv)) matched.push(label);
  }
  // Also try exact comma-separated labels from AI
  if (matched.length === 0) {
    const parts = value.split(',').map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      const found = ROGER_FEATURES.find(f => f.toLowerCase() === p.toLowerCase());
      if (found) matched.push(found);
    }
  }
  return matched.length > 0 ? matched : [value];
}

// ── Parse review intent (AI + regex fallback) ───────────────────────────────
export function parseReviewIntent(transcript: string): string {
  const lv = transcript.toLowerCase();
  if (/\b(confirm|yes|correct|good|lock|done|proceed|that'?s (right|it|good))\b/.test(lv)) return 'confirm';
  if (/\bname\b/.test(lv)) return 'name';
  if (/\brole\b|\bjob\b|\btitle\b/.test(lv)) return 'role';
  if (/\bpriorit/.test(lv)) return 'priorities';
  if (/\bfocus\b|\bchallenge\b/.test(lv)) return 'focus';
  if (/\bschedul\b|\btime\b|\bhours\b/.test(lv)) return 'schedule';
  if (/\bcity\b|\blocation\b|\bbased\b/.test(lv)) return 'location';
  if (/\bstyle\b|\bbrief\b|\bdetail\b/.test(lv)) return 'style';
  if (/\btool\b|\bapp\b/.test(lv)) return 'tools';
  if (/\binterest\b|\bpassion\b|\bhobb/.test(lv)) return 'interests';
  if (/\bfeature\b|\bhelp\b|\bmodule\b/.test(lv)) return 'features';
  if (/\bislam\b|\bmuslim\b|\bsalah\b|\bprayer\b/.test(lv)) return 'islamic';
  return 'confirm';
}

export async function parseReviewIntentAI(
  transcript: string,
  userId: string,
): Promise<string> {
  void userId; // Used for context in future
  try {
    const FIELDS = ['name','role','priorities','focus','schedule','location','style','tools','interests','features','islamic'];
    const system = `The user is reviewing their onboarding profile. They want to edit a field or confirm.
Fields: ${FIELDS.join(', ')}.
User said: "${transcript}"
Return JSON: {"action":"confirm"|"edit","field":"<field_name or null>"}`;
    const raw = await callLLM(system, `User said: "${transcript}"`);
    const parsed = JSON.parse(raw) as { action: string; field?: string };
    if (parsed.action === 'confirm') return 'confirm';
    if (parsed.field && FIELDS.includes(parsed.field)) return parsed.field;
  } catch { /* fall through */ }
  return parseReviewIntent(transcript);
}

// ── Backward compat exports ─────────────────────────────────────────────────
// These are kept so existing code doesn't break during migration
export function generateNodeScript(
  _node: OnboardingPhase,
  answers: OnboardingAnswers,
  previousTranscript?: string,
): Promise<NodeScriptResult> {
  // Redirect to the new interview system
  return generateInterviewTurn(1, answers, previousTranscript).then(r => ({
    script: r.script,
    extracted_value: r.extracted_fields.name ?? null,
    needs_clarification: false,
    clarification_prompt: null,
  }));
}

export function applyOnboardingAnswer(
  _node: string,
  value: string,
  answers: OnboardingAnswers,
  aiValue?: string | null,
): OnboardingAnswers {
  const v = (aiValue ?? value).trim();
  if (!v) return answers;
  // Simple pass-through for backward compat
  return { ...answers };
}

export function updateOnboardingStep(
  _userId: string,
  _step: number,
  _name?: string,
): Promise<void> {
  return Promise.resolve();
}
