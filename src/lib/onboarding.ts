// ─── Roger AI — Onboarding Flow ──────────────────────────────────────────────
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string;

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
}

const NODE_ORDER: OnboardingNode[] = [
  'welcome', 'name', 'name_confirm', 'role', 'key_priorities',
  'current_focus', 'work_schedule', 'location_base', 'comm_style',
  'tools_used', 'interests', 'feature_prefs', 'review_confirm', 'complete',
];

export const NODE_INDEX  = (node: OnboardingNode) => NODE_ORDER.indexOf(node);
export const TOTAL_NODES = 11; // answerable nodes (name→feature_prefs)

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
  feature_prefs:  'review_confirm',
  review_confirm: 'complete',
  complete:       'complete',
};

export const WELCOME_SCRIPT =
  "Roger AI online. I'll ask nine quick questions to set up your profile. Hold the button and speak naturally. Ready when you are.";

// ─── Build review script from answers ─────────────────────────────────────────
export function buildReviewScript(answers: OnboardingAnswers): string {
  const lines: string[] = [];
  if (answers.name)                   lines.push(`Name: ${answers.name}`);
  if (answers.role)                   lines.push(`Role: ${answers.role}`);
  if (answers.key_priorities?.length) lines.push(`Priorities: ${answers.key_priorities.join(', ')}`);
  if (answers.current_focus)          lines.push(`Focus: ${answers.current_focus}`);
  if (answers.work_schedule)          lines.push(`Schedule: ${answers.work_schedule}`);
  if (answers.location_base)          lines.push(`Location: ${answers.location_base}`);
  if (answers.comm_style)             lines.push(`Style: ${answers.comm_style}`);
  if (answers.tools_used?.length)     lines.push(`Tools: ${answers.tools_used.join(', ')}`);
  if (answers.interests?.length)      lines.push(`Interests: ${answers.interests.join(', ')}`);
  if (answers.feature_prefs?.length)  lines.push(`Roger will help with: ${answers.feature_prefs.join(', ')}`);
  return `Here's what I have. ${lines.join('. ')}. Say confirm to lock it in, or tell me what to change.`;
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
    return { script: buildReviewScript(answers), extracted_value: null, needs_clarification: false, clarification_prompt: null };
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
    review_confirm: buildReviewScript(answers),
    complete:       `Profile locked, ${answers.name ?? 'Commander'}. Roger standing by.`,
  };

  if (!OPENAI_API_KEY) {
    return { script: FALLBACK[node], extracted_value: previousTranscript ?? null, needs_clarification: false, clarification_prompt: null };
  }

  try {
    const content = previousTranscript
      ? `User said: "${previousTranscript}"\nGenerate node question for: ${node}`
      : `Generate opening question for: ${node}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.5,
        messages: [
          { role: 'system', content: ONBOARDING_PROMPT(node, answers) },
          { role: 'user',   content },
        ],
      }),
    });
    const data   = await res.json() as { choices: { message: { content: string } }[] };
    const parsed = JSON.parse(data.choices[0].message.content) as NodeScriptResult;
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
  }
  return updated;
}

// ─── Parse re-edit intent from review_confirm ──────────────────────────────────
export function parseReviewIntent(transcript: string): OnboardingNode | 'confirm' {
  const lv = transcript.toLowerCase();
  if (/\b(confirm|yes|correct|good|lock|done|proceed|that'?s (right|it|good))\b/.test(lv)) return 'confirm';
  if (/\bname\b/.test(lv))                        return 'name';
  if (/\brole\b|\bjob\b|\btitle\b/.test(lv))      return 'role';
  if (/\bpriorit/.test(lv))                       return 'key_priorities';
  if (/\bfocus\b|\bchallenge\b/.test(lv))         return 'current_focus';
  if (/\bschedul\b|\btime\b|\bhours\b/.test(lv))  return 'work_schedule';
  if (/\bcity\b|\blocation\b|\bbased\b/.test(lv)) return 'location_base';
  if (/\bstyle\b|\bbrief\b|\bdetail\b/.test(lv))  return 'comm_style';
  if (/\btool\b|\bapp\b/.test(lv))                return 'tools_used';
  if (/\binterest\b|\bpassion\b|\bhobb/.test(lv)) return 'interests';
  if (/\bfeature\b|\bhelp\b|\bmodule\b/.test(lv)) return 'feature_prefs';
  return 'confirm';
}
