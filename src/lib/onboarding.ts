// ─── Roger AI — Onboarding AI Flow ───────────────────────────────────────────
// AI-generated PTT onboarding conversation. 6 nodes → seeds memory_graph.

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string;

export type OnboardingNode =
  | 'welcome'
  | 'name'
  | 'role'
  | 'key_people'
  | 'current_focus'
  | 'comm_style'
  | 'complete';

export interface OnboardingAnswers {
  name?: string;
  role?: string;
  key_people?: string[];
  current_focus?: string;
  comm_style?: 'brief' | 'balanced' | 'detailed';
}

const NODE_ORDER: OnboardingNode[] = [
  'welcome', 'name', 'role', 'key_people', 'current_focus', 'comm_style', 'complete',
];

export const NODE_INDEX = (node: OnboardingNode) => NODE_ORDER.indexOf(node);
export const TOTAL_NODES = NODE_ORDER.length - 2; // exclude welcome + complete

// ─── Welcome script (no user input) ──────────────────────────────────────────
export const WELCOME_SCRIPT =
  "Roger AI online. Before we begin, I want to get to know you — so I can serve you properly. I'll ask five quick questions. Hold the button and speak naturally. Ready when you are.";

// ─── AI-Generated node questions ─────────────────────────────────────────────

const ONBOARDING_PROMPT = (
  node: OnboardingNode,
  answers: OnboardingAnswers
) => `You are Roger AI — a voice-first AI chief of staff — conducting onboarding.
You are on node: ${node}
Previous answers: ${JSON.stringify(answers)}

Node questions:
- name: Ask the user's name warmly. First time meeting them.
- role: Ask what they do / their main role. Acknowledge their name if known.
- key_people: Ask who the 2-3 most important people in their work orbit are. Acknowledge their role if known.
- current_focus: Ask what their biggest focus or challenge is right now. Keep it natural.
- comm_style: Ask if they prefer Roger to be brief and terse, or give full context. Frame it as a preference.

Rules:
- Under 25 words
- Acknowledge something from previous answers before asking (except 'name' node)
- Warm but not sycophantic. Military-aide tone — direct and personal.
- Do NOT say "certainly" / "absolutely" / "great"
- Extract the VALUE from the user's last answer cleanly

Return ONLY JSON:
{
  "script": "The spoken question for this node (under 25 words)",
  "extracted_value": "Clean extracted value from the previous answer, or null if this is the first node"
}`;

export async function generateNodeScript(
  node: OnboardingNode,
  answers: OnboardingAnswers,
  previousTranscript?: string
): Promise<{ script: string; extracted_value: string | null }> {
  if (node === 'welcome') return { script: WELCOME_SCRIPT, extracted_value: null };
  if (node === 'complete') return {
    script: `Memory initialized, ${answers.name ?? 'Commander'}. I know what matters to you. Hold to transmit anytime. Over.`,
    extracted_value: null,
  };

  if (!OPENAI_API_KEY) {
    // Fallback hardcoded scripts
    const FALLBACK: Record<OnboardingNode, string> = {
      welcome: WELCOME_SCRIPT,
      name: "I'm Roger. Before we begin — what's your name?",
      role: `Good to meet you${answers.name ? `, ${answers.name}` : ''}. What do you do — what's your main role?`,
      key_people: 'Who are the two or three people you work with most closely?',
      current_focus: "What's the one thing you're most focused on right now?",
      comm_style: 'Last one — do you prefer I keep things brief and direct, or give you full context?',
      complete: `Memory initialized, ${answers.name ?? 'Commander'}. Ready. Over.`,
    };
    return { script: FALLBACK[node], extracted_value: previousTranscript ?? null };
  }

  try {
    const content = previousTranscript
      ? `User just said: "${previousTranscript}"\nGenerate the next node question.`
      : 'Generate the first node question.';

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
          { role: 'user', content },
        ],
      }),
    });

    const data = await res.json() as { choices: { message: { content: string } }[] };
    return JSON.parse(data.choices[0].message.content) as { script: string; extracted_value: string | null };
  } catch {
    return { script: WELCOME_SCRIPT, extracted_value: previousTranscript ?? null };
  }
}

// ─── Apply onboarding answer to memory structures ─────────────────────────────

export function applyOnboardingAnswer(
  node: OnboardingNode,
  value: string,
  answers: OnboardingAnswers
): OnboardingAnswers {
  const updated = { ...answers };
  switch (node) {
    case 'name':         updated.name = value; break;
    case 'role':         updated.role = value; break;
    case 'key_people':   updated.key_people = value.split(/,|and/).map(s => s.trim()).filter(Boolean); break;
    case 'current_focus': updated.current_focus = value; break;
    case 'comm_style': {
      const v = value.toLowerCase();
      updated.comm_style = v.includes('brief') || v.includes('short') || v.includes('direct')
        ? 'brief'
        : v.includes('detail') || v.includes('full') || v.includes('context')
        ? 'detailed'
        : 'balanced';
      break;
    }
  }
  return updated;
}

export const NEXT_NODE: Record<OnboardingNode, OnboardingNode> = {
  welcome:       'name',
  name:          'role',
  role:          'key_people',
  key_people:    'current_focus',
  current_focus: 'comm_style',
  comm_style:    'complete',
  complete:      'complete',
};
