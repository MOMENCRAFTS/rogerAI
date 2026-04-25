// ─── Roger AI — Onboarding Flow ──────────────────────────────────────────────
import { getAuthToken } from './getAuthToken';
import { supabase } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export type OnboardingNode =
  | 'welcome'
  | 'name'
  | 'name_confirm'
  | 'role'
  | 'key_priorities'
  | 'current_focus'
  | 'work_schedule'
  | 'location_base'
  | 'comm_style'
  | 'tools_used'
  | 'interests'
  | 'feature_prefs'
  | 'islamic_mode'
  | 'review_confirm'
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

const NODE_ORDER: OnboardingNode[] = [
  'welcome', 'name', 'name_confirm', 'role', 'key_priorities',
  'current_focus', 'work_schedule', 'location_base', 'comm_style',
  'tools_used', 'interests', 'feature_prefs', 'islamic_mode', 'review_confirm', 'complete',
];

export const NODE_INDEX  = (node: OnboardingNode) => NODE_ORDER.indexOf(node);
export const TOTAL_NODES = 12; // answerable nodes (name→islamic_mode)

export const NODE_LABELS: Partial<Record<OnboardingNode, string>> = {
  name:           'NAME',
  name_confirm:   'NAME CHECK',
  role:           'ROLE',
  key_priorities: 'PRIORITIES',
  current_focus:  'FOCUS',
  work_schedule:  'SCHEDULE',
  location_base:  'LOCATION',
  comm_style:     'STYLE',
  tools_used:     'TOOLS',
  interests:      'INTERESTS',
  feature_prefs:  'FEATURES',
  islamic_mode:   'ISLAMIC MODE',
  review_confirm: 'REVIEW',
};

// Available Roger features shown to user during onboarding
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

export const NEXT_NODE: Record<OnboardingNode, OnboardingNode> = {
  welcome:        'name',
  name:           'name_confirm',
  name_confirm:   'role',
  role:           'key_priorities',
  key_priorities: 'current_focus',
  current_focus:  'work_schedule',
  work_schedule:  'location_base',
  location_base:  'comm_style',
  comm_style:     'tools_used',
  tools_used:     'interests',
  interests:      'feature_prefs',
  feature_prefs:  'islamic_mode',
  islamic_mode:   'review_confirm',
  review_confirm: 'complete',
  complete:       'complete',
};

export const WELCOME_SCRIPT =
  "Roger AI online. I'll ask nine quick questions to set up your profile. Hold the button and speak naturally. Ready when you are.";

// ─── Build review script from answers ─────────────────────────────────────────

/** Synchronous fallback used when AI is unavailable */
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

/** AI-generated 3rd-person interpretation of the user profile */
export async function buildReviewScript(answers: OnboardingAnswers): Promise<string> {
  if (!OPENAI_API_KEY) return buildReviewScriptFallback(answers);

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
    answers.feature_prefs?.length && `Features wanted: ${answers.feature_prefs.join(', ')}`,
  ].filter(Boolean).join('\n');

  try {
    const token = await getAuthToken().catch(() => null);
    if (!token) return buildReviewScriptFallback(answers);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/process-transmission`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        _direct_prompt: true,
        system: `You are Roger AI, a voice-first military-aide chief of staff. Given a user profile, write a SHORT 2-3 sentence 3rd-person narrative summarising what Roger understood about this person.
Rules:
- Speak AS Roger confirming what he learned (e.g. "Roger reads you as...")
- 3rd person perspective, concise, intelligent, not robotic
- Reference their actual name, profession, location, passions, schedule naturally
- Do NOT just list fields — synthesize them into a human description
- Under 60 words
- End with: "Say confirm to lock this in, or name the field to change."
- No emojis. Military-aide tone.`,
        user: summary,
      }),
    });
    const data = await res.json() as { roger_response?: string; choices?: { message: { content: string } }[] };
    const text = data.roger_response?.trim() ?? data.choices?.[0]?.message?.content?.trim();
    return text || buildReviewScriptFallback(answers);
  } catch {
    return buildReviewScriptFallback(answers);
  }
}

// ─── AI prompt ────────────────────────────────────────────────────────────────
const ONBOARDING_PROMPT = (node: OnboardingNode, answers: OnboardingAnswers) =>
`You are Roger AI — a voice-first AI chief of staff — conducting onboarding.
Node: ${node}
Answers so far: ${JSON.stringify(answers)}

Node questions:
- name: Ask warmly for their name. First time meeting.
- name_confirm: Echo their name and ask if the spelling is correct. E.g. "Got it, Ahmed — is that right? Say yes or spell it for me."
- role: Ask their main role. Echo their name if known.
- key_priorities: Ask what their top 2-3 work priorities are this week. Reference role if known.
- current_focus: Ask their biggest challenge or focus right now.
- work_schedule: Ask when they typically start and end their day.
- location_base: Ask what city or area they're based in. Very short.
- comm_style: Ask if they prefer brief and direct, or full context. Frame as a preference.
- tools_used: Ask what 2-3 digital tools or apps they rely on most. Very short.
- interests: Ask what their main interests or passions are outside of work. Keep it light and curious.
- feature_prefs: Tell them Roger can help with: calendar, tasks, briefings, hazard alerts, weather, news, finance, and commute. Ask which features matter most to them.
- islamic_mode: Ask sensitively if they are Muslim and would like to enable Islamic Mode — which adds prayer times, Qibla direction, and salah reminders. Say: "One final question. Are you Muslim? If so, I can activate Islamic Mode — prayer times, Qibla, and salah reminders. Say yes to enable, or skip." Do NOT deviate from this phrasing.

Rules:
- Under 25 words
- Warm but direct. Military-aide tone.
- Echo previous answer naturally.
- No "certainly" / "absolutely" / "great" / "perfect"

Return ONLY valid JSON:
{"script":"...","extracted_value":"...or null","needs_clarification":false,"clarification_prompt":null}`;

export interface NodeScriptResult {
  script: string;
  extracted_value: string | null;
  needs_clarification: boolean;
  clarification_prompt: string | null;
}

export async function generateNodeScript(
  node: OnboardingNode,
  answers: OnboardingAnswers,
  previousTranscript?: string
): Promise<NodeScriptResult> {
  if (node === 'welcome') {
    return { script: WELCOME_SCRIPT, extracted_value: null, needs_clarification: false, clarification_prompt: null };
  }
  if (node === 'review_confirm') {
    const reviewScript = await buildReviewScript(answers);
    return { script: reviewScript, extracted_value: null, needs_clarification: false, clarification_prompt: null };
  }
  if (node === 'complete') {
    const name = answers.name ?? 'Commander';
    const focus = answers.current_focus ? ` Focus locked: ${answers.current_focus}.` : '';
    return { script: `Profile locked, ${name}.${focus} Roger standing by. Over.`, extracted_value: null, needs_clarification: false, clarification_prompt: null };
  }

  // Fallback
  const FALLBACK: Record<OnboardingNode, string> = {
    welcome:        WELCOME_SCRIPT,
    name:           "I'm Roger. What's your name?",
    name_confirm:   `Got it${answers.name ? `, ${answers.name}` : ''}. Is that spelled correctly? Say yes or spell it for me.`,
    role:           `Good to meet you${answers.name ? `, ${answers.name}` : ''}. What's your main role?`,
    key_priorities: `Got it. What are your top 2 or 3 work priorities this week?`,
    current_focus:  `What's the one thing you're most focused on right now?`,
    work_schedule:  `What time do you usually start and wrap up your day?`,
    location_base:  'What city or area are you based in?',
    comm_style:     'Style preference — brief and direct, or full context?',
    tools_used:     'What 2 or 3 digital tools do you rely on most?',
    interests:      'What are your main interests or passions outside of work?',
    feature_prefs:  'I can help with calendar, tasks, briefings, hazard alerts, weather, news, finance, and commute. Which matter most to you?',
    islamic_mode:   'One final question. Are you Muslim? If so, I can activate Islamic Mode — prayer times, Qibla direction, and salah reminders. Say yes to enable, or skip.',
    review_confirm: buildReviewScriptFallback(answers),
    complete:       `Profile locked, ${answers.name ?? 'Commander'}. Roger standing by.`,
  };

  const token = await getAuthToken().catch(() => null);
  if (!token) {
    return { script: FALLBACK[node], extracted_value: previousTranscript ?? null, needs_clarification: false, clarification_prompt: null };
  }

  try {
    const content = previousTranscript
      ? `User said: "${previousTranscript}"\nGenerate node question for: ${node}`
      : `Generate opening question for: ${node}`;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/process-transmission`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        _direct_prompt: true,
        system: ONBOARDING_PROMPT(node, answers),
        user: content,
      }),
    });
    const data   = await res.json() as { roger_response?: string; choices?: { message: { content: string } }[] };
    const raw    = data.roger_response ?? data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as NodeScriptResult;
    return {
      script:               parsed.script               ?? FALLBACK[node],
      extracted_value:      parsed.extracted_value      ?? null,
      needs_clarification:  parsed.needs_clarification  ?? false,
      clarification_prompt: parsed.clarification_prompt ?? null,
    };
  } catch {
    return { script: FALLBACK[node], extracted_value: previousTranscript ?? null, needs_clarification: false, clarification_prompt: null };
  }
}

// ─── Apply answer ──────────────────────────────────────────────────────────────
export function applyOnboardingAnswer(
  node: OnboardingNode,
  value: string,
  answers: OnboardingAnswers
): OnboardingAnswers {
  const updated = { ...answers };
  const v = value.trim();
  if (!v) return updated;

  switch (node) {
    case 'name': updated.name = v; break;

    case 'name_confirm': {
      const lv = v.toLowerCase();
      const isYes = /^(yes|yeah|yep|correct|right|that'?s (right|it|correct)|confirmed?|affirmative|roger|good|ok|okay)/.test(lv);
      if (!isYes) {
        // Strip filler and take the corrected spelling
        const corrected = v
          .replace(/^(no[,.]?\s*|actually[,.]?\s*|it'?s\s+(spelled?|spelt)\s+|my name is\s+|spell(ing)?\s+is\s+)/i, '')
          .replace(/\s*-\s*/g, '')
          .trim();
        if (corrected) updated.name = corrected;
      }
      break;
    }

    case 'role': updated.role = v; break;

    case 'key_priorities': {
      const parts = v.split(/,|\band\b|\bwith\b/i).map(s => s.trim()).filter(Boolean);
      updated.key_priorities = parts.length > 0 ? parts : [v];
      break;
    }

    case 'current_focus':  updated.current_focus = v; break;
    case 'work_schedule':  updated.work_schedule  = v; break;
    case 'location_base':  updated.location_base  = v; break;

    case 'comm_style': {
      const lv = v.toLowerCase();
      updated.comm_style =
        /brief|short|terse|direct|concise|essentials|key points|less is more|to the point/.test(lv) ? 'brief'
        : /detail|full|context|everything|big picture|all of it|comprehensive/.test(lv) ? 'detailed'
        : 'balanced';
      break;
    }

    case 'tools_used': {
      const parts = v.split(/,|\band\b/i).map(s => s.trim()).filter(Boolean);
      updated.tools_used = parts.length > 0 ? parts : [v];
      break;
    }

    case 'interests': {
      const parts = v.split(/,|\band\b/i).map(s => s.trim()).filter(Boolean);
      updated.interests = parts.length > 0 ? parts : [v];
      break;
    }

    case 'feature_prefs': {
      // Match spoken features against known list
      const lv = v.toLowerCase();
      const matched: string[] = [];
      const map: [RegExp, string][] = [
        [/calendar/,                         'Calendar management'],
        [/task|remind/,                      'Task & reminder tracking'],
        [/brief|morning/,                    'Morning briefings'],
        [/hazard|radar|speed|trap/,          'Road hazard & radar alerts'],
        [/weather/,                          'Weather updates'],
        [/news|digest/,                      'News digest'],
        [/financ|stock|market/,              'Finance & stock updates'],
        [/commut|traffic|drive|navigation/,  'Commute assistance'],
        [/memory|vault|rememb/,              'Memory vault'],
      ];
      for (const [re, label] of map) {
        if (re.test(lv)) matched.push(label);
      }
      // If nothing matched specifically, store raw
      updated.feature_prefs = matched.length > 0 ? matched : [v];
      break;
    }

    case 'islamic_mode': {
      const lv = v.toLowerCase();
      // Affirmative: yes, yeah, enable, activate, Muslim, Islam, نعم (Arabic 'yes')
      updated.islamic_mode = /\b(yes|yeah|yep|sure|enable|activate|muslim|islam|نعم|اسلام|مسلم)\b/.test(lv);
      break;
    }
  }
  return updated;
}

// ─── Parse re-edit intent from review_confirm ──────────────────────────────────
export function parseReviewIntent(transcript: string): OnboardingNode | 'confirm' {
  const lv = transcript.toLowerCase();
  if (/\b(confirm|yes|correct|good|lock|done|proceed|that'?s (right|it|good))\b/.test(lv)) return 'confirm';
  if (/\bname\b/.test(lv))                                return 'name';
  if (/\brole\b|\bjob\b|\btitle\b/.test(lv))             return 'role';
  if (/\bpriorit/.test(lv))                              return 'key_priorities';
  if (/\bfocus\b|\bchallenge\b/.test(lv))                return 'current_focus';
  if (/\bschedul\b|\btime\b|\bhours\b/.test(lv))         return 'work_schedule';
  if (/\bcity\b|\blocation\b|\bbased\b/.test(lv))        return 'location_base';
  if (/\bstyle\b|\bbrief\b|\bdetail\b/.test(lv))         return 'comm_style';
  if (/\btool\b|\bapp\b/.test(lv))                       return 'tools_used';
  if (/\binterest\b|\bpassion\b|\bhobb/.test(lv))        return 'interests';
  if (/\bfeature\b|\bhelp\b|\bmodule\b/.test(lv))        return 'feature_prefs';
  if (/\bislam\b|\bmuslim\b|\bsalah\b|\bprayer\b/.test(lv)) return 'islamic_mode';
  return 'confirm';
}
