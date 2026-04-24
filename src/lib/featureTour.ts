// ─── Roger AI — Feature Tour Slide Definitions ────────────────────────────────
// Mission brief framing: 5 slides, fires once after voice profiling completes.

import {
  Radio, Bell, Brain, Signal, CheckCircle,
  type LucideIcon,
} from 'lucide-react';

export const TOUR_VERSION = 1; // Increment to re-show for all users on major updates

export interface TourSlide {
  id: string;
  icon: LucideIcon;
  iconColor: string;
  headline: string;
  body: string;
  exampleCommand: string;
  exampleLabel: string;
  rogerSpeech: (name?: string) => string;
}

export const TOUR_SLIDES: TourSlide[] = [
  {
    id: 'ptt_command',
    icon: Radio,
    iconColor: '#d4a044',
    headline: 'PTT Command',
    body: 'Hold the button and speak naturally. Roger hears your intent and acts — creating tasks, setting reminders, answering questions, or briefing you. No menus. No typing.',
    exampleCommand: '"Remind me to call Ahmed when I get to the office."',
    exampleLabel: 'Try saying',
    rogerSpeech: () =>
      'Hold the button, speak your command — I handle the rest. Over.',
  },
  {
    id: 'reminders_tasks',
    icon: Bell,
    iconColor: '#a78bfa',
    headline: 'Reminders & Tasks',
    body: 'Roger captures every action item from your voice. Reminders can be time-based or location-triggered — I\'ll ping you when you arrive at a place. Tasks are tracked and prioritised automatically.',
    exampleCommand: '"Add a high priority task: Review the Q3 report before Friday."',
    exampleLabel: 'Try saying',
    rogerSpeech: () =>
      "Say 'Remind me at the office to call the client' — I'll ping you on arrival. Over.",
  },
  {
    id: 'memory_vault',
    icon: Brain,
    iconColor: '#34d399',
    headline: 'Memory Vault',
    body: 'Everything you say builds your memory graph — your team, your goals, your history. Roger connects context across sessions so you never have to repeat yourself.',
    exampleCommand: '"What do I know about the Ahmed project?"',
    exampleLabel: 'Try saying',
    rogerSpeech: () =>
      "I remember your team, your focus, your history. No need to repeat yourself. Over.",
  },
  {
    id: 'tune_in',
    icon: Signal,
    iconColor: '#38bdf8',
    headline: 'Tune In',
    body: 'Connect with your contacts via encrypted PTT — just like a radio channel. Your callsign is your unique Roger handle. Share it with your team and say the word to connect.',
    exampleCommand: '"Tune in with Marcus."',
    exampleLabel: 'Try saying',
    rogerSpeech: (name) =>
      `Your callsign is your radio handle${name ? `, ${name}` : ''}. Say 'Tune in with [name]' to connect. Over.`,
  },
  {
    id: 'operational',
    icon: CheckCircle,
    iconColor: '#d4a044',
    headline: 'You Are Operational',
    body: 'Your profile is locked in. Your memory graph is seeded. Roger is standing by — proactive, context-aware, and ready to act on your command.',
    exampleCommand: '"Good morning, Roger. What\'s on my plate today?"',
    exampleLabel: 'Start with',
    rogerSpeech: (name) =>
      `${name ?? 'Commander'}, you are now operational. Hold to transmit your first command. Over.`,
  },
];

// ─── Tour version guard ────────────────────────────────────────────────────────
// Returns true if the user should see the tour (not seen yet, or version is stale).
export function tourNeedsShowing(tourSeen: boolean, tourVersion: number): boolean {
  return !tourSeen || tourVersion < TOUR_VERSION;
}
