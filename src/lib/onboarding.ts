// ─── Roger AI — Conversational Onboarding Flow ──────────────────────────────
import { getAuthToken } from './getAuthToken';
import { getLockedBaseLanguage, getLockedLocale } from './i18n';
import { DIALECT_CONFIG } from './translations/dialects';

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

// Minimum / maximum elastic interview turns (kept for backward compat)
export const MIN_INTERVIEW_TURNS = 1;
export const MAX_INTERVIEW_TURNS = 2;
export const MAX_TOTAL_TURNS = 6;

// Features list (kept for backward compat — no longer shown during onboarding)
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
/**
 * buildLanguageDirective() — HARDCODED locale enforcement directive.
 * Reads getLockedBaseLanguage() — the user's confirmed selection from
 * localStorage — NOT navigator.language (which reflects OS, not user choice).
 *
 * This directive is structurally prepended to EVERY LLM system prompt so
 * that language compliance is a code-level guarantee, not a prompt hint.
 */
function buildLanguageDirective(): string {
  const base = getLockedBaseLanguage();
  if (base === 'ar') return 'Respond ONLY in Arabic (فصحى). All output MUST be in Arabic script. Never use Latin characters for Arabic words.';
  if (base === 'fr') return 'Respond ONLY in French. All output MUST be in French.';
  if (base === 'es') return 'Respond ONLY in Spanish. All output MUST be in Spanish.';
  return 'Respond ONLY in English.';
}

/**
 * buildDialectContext() — Full dialect personality block injected into LLM calls.
 * Reads getLockedLocale() for the full dialect (e.g. ar-gulf vs ar-egypt).
 * Prepended structurally to callLLM() system prompts.
 */
function buildDialectContext(): string {
  const locale = getLockedLocale();
  if (!locale) return buildLanguageDirective(); // fallback: at least enforce base language
  const dc = DIALECT_CONFIG[locale as keyof typeof DIALECT_CONFIG];
  if (!dc) return buildLanguageDirective();
  const base = getLockedBaseLanguage();
  const langName = base === 'ar' ? 'Arabic' : base === 'fr' ? 'French' : base === 'es' ? 'Spanish' : 'English';
  return [
    `=== DIALECT PERSONALITY ===`,
    `User locale: ${locale} | Base language: ${base}`,
    dc.aiPersonality,
    `CRITICAL: The user selected ${langName}. ALL responses MUST be in ${langName}.`,
    base === 'ar' ? 'Write in Arabic script only. Do NOT transliterate.' : '',
    base !== 'ar' ? `Respond ONLY in ${langName}. Never switch languages unless asked to translate.` : '',
  ].filter(Boolean).join('\n');
}

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

// ── Hardcoded welcome scripts per locale ─────────────────────────────────────
// These are never LLM-generated — the first words Roger speaks are hardcoded
// to guarantee they come out in the correct language regardless of any API
// latency or LLM behaviour. Keyed by base language.
const WELCOME_SCRIPTS: Record<string, string> = {
  ar: 'روجر AI جاهز. أنا رئيس أركانك الرقمي — أدير يومك، مهامك، ومعلوماتك. عرّفني عن نفسك — اسمك، شغلك، وين مقرّك، وأي شي تبي أعرفه عنك. تفضّل.',
  fr: "Roger AI en ligne. Je suis votre chef de cabinet IA. Parlez-moi de vous — votre nom, ce que vous faites, où vous êtes basé, tout ce que je devrais savoir. À vous.",
  es: "Roger AI en línea. Soy tu jefe de gabinete IA. Cuéntame sobre ti — tu nombre, a qué te dedicas, dónde estás, lo que quieras que sepa. Adelante.",
  en: "Roger AI online. I'm your AI chief of staff — here to manage your day, your tasks, and your intel. Tell me about yourself — your name, what you do, where you're based, anything you want me to know. Over.",
};

export const WELCOME_SCRIPT = WELCOME_SCRIPTS.en;

export function getWelcomeScript(): string {
  const base = getLockedBaseLanguage();
  return WELCOME_SCRIPTS[base] ?? WELCOME_SCRIPTS.en;
}

// ── Name confirm prompt (with phonetic variants) ────────────────────────────
const NAME_CONFIRM_PROMPT = (name: string) =>
  `You are Roger AI confirming a user's name spelling during onboarding.
${buildLanguageDirective()}
The name extracted is: "${name}"

IMPORTANT — Name Handling:
- Generate 2-3 phonetic variants of the name. E.g. for "Momen" → "Moamen, Mu'min"
- For Arabic names: show both Latin transliteration AND Arabic script if possible.
- Ask: "Got it, ${name}. Is that right? Could also be [variant1] or [variant2]. Confirm or correct me."
- Under 25 words.

extracted_value rules:
- If user says yes/correct/right → extracted_value: "yes"
- If user spells a correction → extracted_value: the corrected name (title-cased)

Return ONLY valid JSON:
{"script": "...", "extracted_value": "yes or corrected name"}`;

// ── Islamic mode prompt ─────────────────────────────────────────────────────
const ISLAMIC_PROMPT = `You are Roger AI asking about Islamic Mode during onboarding.
${buildLanguageDirective()}
Ask if the user is Muslim and wants Islamic Mode enabled (prayer times, Qibla, salah reminders).
Keep it respectful, warm, and under 25 words. Never assume.

Process their response:
- Yes/enable/Muslim/نعم/أيوه → extracted_value: "yes"
- No/skip/لا → extracted_value: "no"

Return ONLY valid JSON:
{"script": "...", "extracted_value": "yes or no or null"}`;

// ── Extraction prompt (improved with diverse name examples) ─────────────────
const EXTRACTION_PROMPT = `You are a data extraction engine. Extract structured fields from the user's speech.
${buildLanguageDirective()}

RULES:
- Extract ONLY what the user explicitly stated. Do not infer or assume.
- Title-case names and proper nouns.
- IMPORTANT: Extract the ACTUAL name spoken. Do NOT default non-English names to "Mohammad".
  Examples: "أنا مؤمن" → name: "مؤمن", "Ana ismi Khalid" → name: "Khalid",
  "Je suis Fatima" → name: "Fatima", "My name is Al-Sayed" → name: "Al-Sayed"
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

// ── LLM call ────────────────────────────────────────────────────────────────
async function callLLM(system: string, user: string): Promise<string> {
  const token = await getAuthToken().catch(() => null);
  if (!token) throw new Error('No auth token');

  // Structurally enforce language on EVERY LLM call in the onboarding path.
  // The dialect context is prepended unconditionally — the LLM cannot ignore it.
  const dialectBlock = buildDialectContext();
  const enforcedSystem = dialectBlock ? `${dialectBlock}\n\n${system}` : system;

  console.log('[callLLM] Sending _direct_prompt request...');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/process-transmission`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ _direct_prompt: true, _json_mode: true, system: enforcedSystem, user }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[callLLM] HTTP', res.status, errText);
    throw new Error(`LLM HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json() as Record<string, unknown>;
  console.log('[callLLM] Response keys:', Object.keys(data));

  const content = typeof data.roger_response === 'string' ? data.roger_response : '';

  if (!content) {
    console.error('[callLLM] Empty roger_response. Full data:', JSON.stringify(data).substring(0, 500));
    throw new Error('LLM returned empty content');
  }

  console.log('[callLLM] Got response, length:', content.length);
  return content;
}

// ── Silent field extraction (no question generation) ────────────────────────
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

// ── "Add key info" turn (used in review phase) ──────────────────────────────
const ADD_INFO_PROMPT = (answers: OnboardingAnswers) => {
  const collected = Object.entries(answers)
    .filter(([, v]) => v && (typeof v !== 'object' || (Array.isArray(v) && v.length > 0)))
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(', ');
  return `You are Roger AI. The user wants to add more information about themselves.
${buildLanguageDirective()}
Already collected: {${collected}}

Extract any new fields from what they just said. Use the same field schema.
Do NOT overwrite existing fields unless the user explicitly corrects them.
Acknowledge what they added in under 15 words.

Return ONLY valid JSON:
{"script": "short acknowledgment", "extracted_fields": { ... }}`;
};

export async function generateAddInfoTurn(
  answers: OnboardingAnswers,
  transcript: string,
): Promise<{ script: string; extracted_fields: Partial<OnboardingAnswers> }> {
  const fallback = { script: 'Copy. Added to your profile.', extracted_fields: {} as Partial<OnboardingAnswers> };
  try {
    const raw = await callLLM(ADD_INFO_PROMPT(answers), `User said: "${transcript}"`);
    const parsed = JSON.parse(raw) as { script: string; extracted_fields: Record<string, unknown> };
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
    return { script: parsed.script ?? fallback.script, extracted_fields: extracted };
  } catch {
    const regexFields = extractFieldsRegex(transcript, answers);
    return { script: fallback.script, extracted_fields: regexFields };
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
  return `Roger understands that ${name}${role}${loc} is setting up Command.${focus}${sched}${tools}${interests} Want to add anything else, or say confirm to lock this in.`;
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
    answers.islamic_mode !== undefined && `Islamic Mode: ${answers.islamic_mode ? 'Enabled' : 'Disabled'}`,
  ].filter(Boolean).join('\n');

  try {
    const system = `You are Roger AI. Given a user profile, write a SHORT 2-3 sentence 3rd-person narrative.
${buildLanguageDirective()}
Rules:
- Speak AS Roger confirming what he learned (e.g. "Roger reads you as...")
- 3rd person, concise, intelligent, not robotic
- Reference name, profession, location, passions naturally
- Under 60 words
- End with the equivalent of: "Want to add anything else, or say confirm to lock this in."
- No emojis. Military-aide tone.`;
    const raw = await callLLM(system, summary);
    const parsed = JSON.parse(raw) as { roger_response?: string; script?: string };
    return (parsed.script ?? parsed.roger_response ?? raw) || buildReviewScriptFallback(answers);
  } catch {
    return buildReviewScriptFallback(answers);
  }
}

// ── Name extraction (Arabic-aware) ──────────────────────────────────────────
const ARABIC_CHAR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const COMPOUND_PREFIXES = /^(al|el|ul|bin|bint|ibn|abu|de|del|van|von|mc|mac|o')/i;

function extractName(raw: string): string {
  let name = raw.trim()
    .replace(/[.!?,]+$/, '')
    .replace(/^(hey[,.]?\s*|hi[,.]?\s*|hello[,.]?\s*)?/i, '')
    .replace(/^(my name is|the name is|the name'?s|i'?m called|they call me|people call me|you can call me|call me|i am|i'?m|it'?s|this is|name'?s)\s+/i, '')
    .trim();
  if (!name) name = raw.trim();

  // Arabic script → no case transforms (Arabic has no upper/lower case)
  if (ARABIC_CHAR_RE.test(name)) return name;

  // Latin script → smart title-case that preserves compound prefixes
  name = name.split(/\s+/).map(w => {
    if (w.includes('-')) {
      return w.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('-');
    }
    if (COMPOUND_PREFIXES.test(w) && w.length > 3 && /[A-Z]/.test(w.slice(1))) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
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

// ── Apply feature prefs from transcript (kept for backward compat) ──────────
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
  void userId;
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
export async function generateNodeScript(
  _node: OnboardingPhase,
  answers: OnboardingAnswers,
  previousTranscript?: string,
): Promise<NodeScriptResult> {
  const fields = previousTranscript
    ? await silentExtractFields(previousTranscript, answers)
    : {};
  return {
    script: '',
    extracted_value: fields.name ?? null,
    needs_clarification: false,
    clarification_prompt: null,
  };
}

export function applyOnboardingAnswer(
  _node: string,
  value: string,
  answers: OnboardingAnswers,
  aiValue?: string | null,
): OnboardingAnswers {
  const v = (aiValue ?? value).trim();
  if (!v) return answers;
  return { ...answers };
}

export function updateOnboardingStep(
  _userId: string,
  _step: number,
  _name?: string,
): Promise<void> {
  return Promise.resolve();
}
