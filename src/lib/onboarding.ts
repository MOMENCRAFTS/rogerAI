// ─── Roger AI — Onboarding AI Flow ───────────────────────────────────────────
// AI-generated PTT onboarding conversation. 8 nodes → seeds memory_graph.

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string;

export type OnboardingNode =
  | 'welcome'
  | 'name'
  | 'role'
  | 'key_people'
  | 'current_focus'
  | 'work_schedule'
  | 'location_base'
  | 'comm_style'
  | 'complete';

export interface OnboardingAnswers {
  name?: string;
  role?: string;
  key_people?: string[];
  current_focus?: string;
  work_schedule?: string;
  location_base?: string;
  comm_style?: 'brief' | 'balanced' | 'detailed';
}

const NODE_ORDER: OnboardingNode[] = [
  'welcome', 'name', 'role', 'key_people', 'current_focus',
  'work_schedule', 'location_base', 'comm_style', 'complete',
];

export const NODE_INDEX  = (node: OnboardingNode) => NODE_ORDER.indexOf(node);
export const TOTAL_NODES = NODE_ORDER.length - 2; // exclude welcome + complete

export const NODE_LABELS: Partial<Record<OnboardingNode, string>> = {
  name:          'NAME',
  role:          'ROLE',
  key_people:    'TEAM',
  current_focus: 'FOCUS',
  work_schedule: 'SCHEDULE',
  location_base: 'LOCATION',
  comm_style:    'STYLE',
};

// ─── Welcome script (no user input) ──────────────────────────────────────────
export const WELCOME_SCRIPT =
  "Roger AI online. Before we begin, I want to get to know you — so I can serve you properly. I'll ask seven quick questions. Hold the button and speak naturally. Ready when you are.";

// ─── AI-Generated node questions ─────────────────────────────────────────────
const ONBOARDING_PROMPT = (
  node: OnboardingNode,
  answers: OnboardingAnswers
) => `You are Roger AI — a voice-first AI chief of staff — conducting onboarding.
You are on node: ${node}
Previous answers collected so far: ${JSON.stringify(answers)}

Node questions to ask:
- name: Ask the user's name warmly. First time meeting them.
- role: Ask what they do / their main role. Echo their name if known (e.g. "Good to meet you, Ahmed. What do you do?").
- key_people: Ask who the 2-3 most important people in their work orbit are. Echo their role if known.
- current_focus: Ask what their biggest focus or challenge is right now. Keep it natural, reference their role.
- work_schedule: Ask when they typically start and wrap up their day. Reference their role if known.
- location_base: Ask what city or area they're based in. Keep it very short.
- comm_style: Ask if they prefer Roger to be brief and direct, or give full context. Frame it as a preference.

Rules:
- Under 25 words total
- Echo something from the previous answer naturally before asking (except the 'name' node)
- Warm but not sycophantic. Military-aide tone — direct and personal.
- Do NOT say "certainly" / "absolutely" / "great" / "perfect"
- If the user's transcript is too short, vague, or unclear — set needs_clarification to true and write a short clarification_prompt asking them to repeat or clarify.

Return ONLY valid JSON:
{
  "script": "The spoken question for this node (under 25 words, includes echo of previous answer)",
  "extracted_value": "Clean extracted value from the previous answer, or null if this is the first node",
  "needs_clarification": false,
  "clarification_prompt": null
}`;

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
  // ── Static nodes ──────────────────────────────────────────────────────────
  if (node === 'welcome') {
    return { script: WELCOME_SCRIPT, extracted_value: null, needs_clarification: false, clarification_prompt: null };
  }

  if (node === 'complete') {
    const name      = answers.name ?? 'Commander';
    const focusHint = answers.current_focus ? ` Focus locked on ${answers.current_focus}.` : '';
    const locHint   = answers.location_base ? ` Based in ${answers.location_base}.` : '';
    const script    = `Memory initialized, ${name}.${focusHint}${locHint} Hold to transmit anytime. Over.`;
    return { script, extracted_value: null, needs_clarification: false, clarification_prompt: null };
  }

  // ── Fallback (no API key) ─────────────────────────────────────────────────
  if (!OPENAI_API_KEY) {
    const FALLBACK: Record<OnboardingNode, string> = {
      welcome:       WELCOME_SCRIPT,
      name:          "I'm Roger. What's your name?",
      role:          `Good to meet you${answers.name ? `, ${answers.name}` : ''}. What's your main role?`,
      key_people:    'Who are the two or three people you work closest with?',
      current_focus: `What's the one thing you're most focused on right now?`,
      work_schedule: `What time do you usually start your day${answers.role ? ` as ${answers.role}` : ''}?`,
      location_base: 'What city or area are you based in?',
      comm_style:    'Last one — brief and direct, or full context?',
      complete:      `Memory initialized, ${answers.name ?? 'Commander'}. Ready. Over.`,
    };
    return {
      script: FALLBACK[node],
      extracted_value: previousTranscript ?? null,
      needs_clarification: false,
      clarification_prompt: null,
    };
  }

  // ── AI-generated ──────────────────────────────────────────────────────────
  try {
    const content = previousTranscript
      ? `User just said: "${previousTranscript}"\nGenerate the node question for: ${node}`
      : `Generate the opening question for: ${node}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
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
      script:               parsed.script               ?? WELCOME_SCRIPT,
      extracted_value:      parsed.extracted_value      ?? null,
      needs_clarification:  parsed.needs_clarification  ?? false,
      clarification_prompt: parsed.clarification_prompt ?? null,
    };
  } catch {
    return {
      script: WELCOME_SCRIPT,
      extracted_value: previousTranscript ?? null,
      needs_clarification: false,
      clarification_prompt: null,
    };
  }
}

// ─── Apply onboarding answer to memory structures ─────────────────────────────
// `value` should be the AI-extracted clean value, falling back to raw transcript.

export function applyOnboardingAnswer(
  node: OnboardingNode,
  value: string,
  answers: OnboardingAnswers
): OnboardingAnswers {
  const updated = { ...answers };
  const v = value.trim();
  if (!v) return updated;

  switch (node) {
    case 'name':          updated.name = v; break;
    case 'role':          updated.role = v; break;

    case 'key_people': {
      // Handle comma-separated, "and"-joined, or space-separated spoken lists
      const parts = v
        .split(/,|\band\b|\bwith\b/i)
        .map(s => s.trim())
        .filter(Boolean);
      updated.key_people = parts.length > 0 ? parts : [v];
      break;
    }

    case 'current_focus':  updated.current_focus = v; break;
    case 'work_schedule':  updated.work_schedule  = v; break;
    case 'location_base':  updated.location_base  = v; break;

    case 'comm_style': {
      const lv = v.toLowerCase();
      updated.comm_style =
        /brief|short|terse|direct|concise|essentials|key points|less is more|to the point/.test(lv)
          ? 'brief'
          : /detail|full|context|everything|big picture|all of it|comprehensive/.test(lv)
          ? 'detailed'
          : 'balanced';
      break;
    }
  }
  return updated;
}

export const NEXT_NODE: Record<OnboardingNode, OnboardingNode> = {
  welcome:        'name',
  name:           'role',
  role:           'key_people',
  key_people:     'current_focus',
  current_focus:  'work_schedule',
  work_schedule:  'location_base',
  location_base:  'comm_style',
  comm_style:     'complete',
  complete:       'complete',
};
