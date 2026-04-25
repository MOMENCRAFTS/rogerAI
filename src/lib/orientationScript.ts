/**
 * orientationScript.ts — Roger's interactive orientation chapter data.
 *
 * 10 chapters, each with:
 *  - Full TTS speech Roger reads aloud
 *  - Voice example chips shown on screen
 *  - A confirm prompt asking the user to say "understood"
 *  - Optional pro tip
 */

import {
  Radio, Brain, CheckSquare, Car, TrendingUp,
  Calendar, Users, Mic, FileText, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const ORIENTATION_VERSION = 1;

export interface OrientationChapter {
  id: string;
  icon: LucideIcon;
  iconColor: string;
  chapterLabel: string;      // "Chapter 01"
  headline: string;          // large heading text
  body: string;              // written description (shown on screen)
  rogerSpeech: (name?: string) => string; // what Roger reads aloud via TTS
  confirmPrompt: string;     // shown below speech, before confirm
  keyExamples: string[];     // 2–4 PTT command examples
  tip?: string;              // optional pro tip (amber line)
}

export const ORIENTATION_CHAPTERS: OrientationChapter[] = [

  // ── 01 ── Welcome ─────────────────────────────────────────────────────────
  {
    id: 'welcome',
    icon: Radio,
    iconColor: '#d4a044',
    chapterLabel: 'Chapter 01',
    headline: 'I\'m Roger. Your Chief of Staff.',
    body: 'I\'m a voice-first AI built for executives and high-performers who don\'t have time to type. Press and hold the PTT button — that\'s Push to Talk — speak your command, release, and I\'ll handle the rest. Think of me as a trusted aide who\'s always on standby.',
    rogerSpeech: (name) =>
      `${name ? `${name}, ` : ''}welcome aboard. I'm Roger — your AI Chief of Staff. Everything in this system is voice-first. You'll use the PTT button at the bottom of the screen. Press and hold to speak, release when done. I process your words, take action, and report back. I don't do small talk — I get things done. Let's walk through what I can do. Say "understood" when you're ready to continue. Over.`,
    confirmPrompt: 'Say "understood" or tap Continue to proceed.',
    keyExamples: [
      '"Roger, remind me to call Ahmed at 3pm"',
      '"Roger, what\'s on my calendar today?"',
      '"Roger, brief me for my drive"',
    ],
    tip: 'Hold PTT for at least 0.5 seconds before speaking for best recognition.',
  },

  // ── 02 ── Memory ───────────────────────────────────────────────────────────
  {
    id: 'memory',
    icon: Brain,
    iconColor: '#8b5cf6',
    chapterLabel: 'Chapter 02',
    headline: 'I Remember Everything.',
    body: 'Every conversation I have with you builds a private memory graph — facts about people, places, preferences, and context. The more you use me, the smarter I get about you. High-confidence facts are stored immediately. Lower-confidence ones are held as drafts until confirmed a second time.',
    rogerSpeech: (name) =>
      `Every conversation we have trains my memory. ${name ? `I already know your name is ${name}. ` : ''}When you mention that a client prefers morning calls, or that your partner has a birthday next month — I store that. You can ask me to recall anything: "Roger, what do you know about Ahmad?", or "Roger, what's in my memory vault?" I'll surface what's relevant before meetings automatically. Your data is private — only you can access it. Say "understood" when ready. Over.`,
    confirmPrompt: 'Say "understood" or tap Continue.',
    keyExamples: [
      '"Roger, remember that Ahmad likes direct communication"',
      '"Roger, what do you know about the Dubai project?"',
      '"Roger, open my memory vault"',
      '"Roger, forget that last thing I said"',
    ],
    tip: 'Roger grades every fact by confidence. Draft facts (50–74%) become permanent after a second mention.',
  },

  // ── 03 ── Tasks & Reminders ────────────────────────────────────────────────
  {
    id: 'tasks',
    icon: CheckSquare,
    iconColor: '#22c55e',
    chapterLabel: 'Chapter 03',
    headline: 'I Manage Your Workload.',
    body: 'Tasks and reminders are my core engine. Create them by voice, and I\'ll track deadlines, surface overdue items proactively, and even suggest new tasks based on what you tell me. I can set geo-triggered reminders that fire when you arrive at a location.',
    rogerSpeech: () =>
      `Task and reminder management is where I earn my keep. Say "Roger, add a task: finalise Q2 report, high priority" — it's logged instantly. Need a reminder? "Roger, remind me to call the accountant tomorrow at 9am" — done. I'll surface items proactively if they're overdue and you haven't acted on them. I can also trigger reminders by location: "Roger, remind me to pick up dry cleaning when I'm near the mall." Say "understood" to continue. Over.`,
    confirmPrompt: 'Say "understood" or tap Continue.',
    keyExamples: [
      '"Roger, add task: prepare board slides, priority 9"',
      '"Roger, remind me to take my medication at 8am daily"',
      '"Roger, what tasks are due today?"',
      '"Roger, remind me when I\'m near the office"',
    ],
    tip: 'I auto-extract tasks from your natural speech — if you mention a deadline, I\'ll propose a task automatically.',
  },

  // ── 04 ── Drive & Commute ──────────────────────────────────────────────────
  {
    id: 'commute',
    icon: Car,
    iconColor: '#f97316',
    chapterLabel: 'Chapter 04',
    headline: 'I Own Your Drive.',
    body: 'Drive Mode activates when your speed exceeds 15 km/h. I switch to a hands-free, audio-only interface and brief you on your schedule, weather, and hazards before you leave. The Radar tab shows community-reported speed cameras and road incidents in real time.',
    rogerSpeech: () =>
      `When you\'re behind the wheel, I shift into Drive Mode automatically based on your GPS speed. Before you leave, say "Roger, brief me for my drive" and I\'ll give you weather, your first meeting, any pending errands, and road conditions — all spoken, no screen needed. The Radar tab is your community hazard map — speed cameras, accidents, road works reported by other Roger users. You can report hazards hands-free: "Roger, report radar ahead." And if you need a ride, "Roger, book me a car to KAFD" opens Uber pre-filled. Say "understood" to continue. Over.`,
    confirmPrompt: 'Say "understood" or tap Continue.',
    keyExamples: [
      '"Roger, brief me for my drive"',
      '"Roger, report speed camera ahead"',
      '"Roger, where did I park?"',
      '"Roger, book me a ride to the airport"',
    ],
    tip: 'Say "I\'m leaving now" to trigger your full departure brief and switch to drive mode.',
  },

  // ── 05 ── Intelligence & Briefings ────────────────────────────────────────
  {
    id: 'intel',
    icon: TrendingUp,
    iconColor: '#06b6d4',
    chapterLabel: 'Chapter 05',
    headline: 'I Brief You on the World.',
    body: 'Live stock quotes, flight tracking, market briefs, and breaking news — all on demand via PTT. Ask me about any stock ticker, any flight number, or for a full market overview. I surface relevant news based on your memory context.',
    rogerSpeech: () =>
      `Market intelligence, flight tracking, and news — all voice-accessible. "Roger, what's Apple trading at?" — I'll give you the price, change, and a one-line outlook. "Roger, is Emirates flight EK204 on time?" — I'll check live and report back. "Roger, market brief" — I'll summarise the key movers. For news, I filter by what's relevant to topics in your memory, so you're not reading irrelevant headlines. Say "understood" to continue. Over.`,
    confirmPrompt: 'Say "understood" or tap Continue.',
    keyExamples: [
      '"Roger, what\'s Tesla trading at?"',
      '"Roger, is EK201 on time?"',
      '"Roger, market brief"',
      '"Roger, any news I should know about?"',
    ],
    tip: 'I resolve company names to tickers automatically — say "Apple" not "AAPL" if you prefer.',
  },

  // ── 06 ── Calendar ─────────────────────────────────────────────────────────
  {
    id: 'calendar',
    icon: Calendar,
    iconColor: '#ec4899',
    chapterLabel: 'Chapter 06',
    headline: 'I Own Your Calendar.',
    body: 'Connect your Google Calendar and I\'ll read, book, and cancel meetings by voice. I surface your schedule each morning and alert you when a meeting is approaching. High-stakes bookings go through a confirmation gate — I\'ll read the details back before writing to your calendar.',
    rogerSpeech: () =>
      `Calendar integration is critical for a Chief of Staff. Once you\'ve linked Google Calendar in Settings, say "Roger, what\'s on my calendar today?" — I\'ll read your full schedule. Book a meeting: "Roger, book a strategy session with Layla at 2pm tomorrow" — I\'ll confirm the details and write it. Cancel: "Roger, cancel the 3pm call" — done. Before important meetings, I'll surface memory facts about the people involved so you walk in prepared. Say "understood" to continue. Over.`,
    confirmPrompt: 'Say "understood" or tap Continue.',
    keyExamples: [
      '"Roger, what\'s on my calendar today?"',
      '"Roger, book a meeting with the team at 10am"',
      '"Roger, when am I next free?"',
      '"Roger, cancel my 4pm"',
    ],
    tip: 'Link Google Calendar in Settings → Integrations. I\'ll never book without confirming first.',
  },

  // ── 07 ── Tune In ──────────────────────────────────────────────────────────
  {
    id: 'network',
    icon: Users,
    iconColor: '#6366f1',
    chapterLabel: 'Chapter 07',
    headline: 'Tune In — Your Private Radio.',
    body: 'Tune In is a private, AI-monitored voice channel between two Roger users. Every user has a unique 7-character callsign. Connect by name (if saved) or callsign. I monitor the session, take notes, flag key moments, and deliver a full debrief when you end the call.',
    rogerSpeech: () =>
      `Tune In is Roger\'s peer-to-peer voice network. Think of it as a private radio channel — you and another Roger user connect, speak freely, and I listen and take notes in the background. Your callsign is displayed in Settings — share it with colleagues. To connect: "Roger, tune in with Ahmad" if they\'re in your contacts, or "Roger, tune in with code A2F34AC" for a new contact. During the session, say "Roger, flag this" to mark an important moment. When you say "over and out", I deliver a full debrief. Relay messages if they\'re offline: "Roger, tell Ahmad I\'ll be 10 minutes late." Say "understood" to continue. Over.`,
    confirmPrompt: 'Say "understood" or tap Continue.',
    keyExamples: [
      '"Roger, tune in with Ahmad"',
      '"Roger, connect with code A2F34AC"',
      '"Roger, relay to Layla: I\'m running late"',
      '"Roger, any messages?"',
    ],
    tip: 'Your callsign is in Settings. Share it for others to reach you even when you\'re not in the app.',
  },

  // ── 08 ── Ambient Listening ────────────────────────────────────────────────
  {
    id: 'ambient',
    icon: Mic,
    iconColor: '#a855f7',
    chapterLabel: 'Chapter 08',
    headline: 'I Listen When You Ask.',
    body: 'Ambient Listening mode analyses your surroundings in 30-second chunks. I detect speech in any language, identify music via ACRCloud fingerprinting, and classify ambient noise. This is on-demand only — I never listen without your explicit command.',
    rogerSpeech: () =>
      `If you hear something and want to know what it is, say "Roger, listen to this." I\'ll open a passive microphone and analyse the audio every 30 seconds. If there\'s a conversation in Arabic, French, or any other language, I\'ll detect it and summarise what\'s being said. If music is playing, I\'ll try to identify the track — title, artist, and album — using audio fingerprinting. You\'ll see a purple banner at the top while I\'m listening. Say "what was that?" at any time for an update, or "stop listening" to end the session. A summary is saved to your history. Say "understood" to continue. Over.`,
    confirmPrompt: 'Say "understood" or tap Continue.',
    keyExamples: [
      '"Roger, listen to this"',
      '"Roger, what language is that?"',
      '"Roger, what\'s that music?"',
      '"Roger, stop listening"',
    ],
    tip: 'Music detection requires ACRCloud API keys set in your Supabase project secrets.',
  },

  // ── 09 ── Meeting Recorder ─────────────────────────────────────────────────
  {
    id: 'meeting',
    icon: FileText,
    iconColor: '#ef4444',
    chapterLabel: 'Chapter 09',
    headline: 'I Record Your Meetings.',
    body: 'Start a meeting recorder and I\'ll transcribe everything in 60-second rolling chunks. When you end the session, I generate structured notes: executive summary, action items with owners and due dates, key decisions made, and a list of participants. Everything is saved to your Meeting Archive.',
    rogerSpeech: () =>
      `Meeting documentation is time-consuming. I eliminate it. Say "Roger, record meeting" before your next session starts. I\'ll transcribe continuously using Whisper. When it\'s over, say "end meeting" — I\'ll run the full transcript through a GPT-4 analysis and produce: an executive summary, a clean action item list with owners and due dates, the key decisions made, and participant names. I\'ll also speak a short summary so you can close the tab immediately. Everything is saved under the Meetings tab. I never record without your command, and a red banner shows when recording is active. Say "understood" to continue. Over.`,
    confirmPrompt: 'Say "understood" or tap Continue.',
    keyExamples: [
      '"Roger, record meeting"',
      '"Roger, record this Q2 strategy session"',
      '"Roger, end meeting"',
      '"Roger, generate notes"',
    ],
    tip: 'Participant names mentioned during the meeting are automatically added to your memory vault as draft contacts.',
  },

  // ── 10 ── Engage ───────────────────────────────────────────────────────────
  {
    id: 'engage',
    icon: Zap,
    iconColor: '#d4a044',
    chapterLabel: 'Chapter 10',
    headline: 'You\'re Ready. Let\'s Go.',
    body: 'That\'s the full briefing. You now know how to use Roger across all 9 capability domains. Start with the PTT button — just press, speak, and release. The more you use me, the better I understand you. You can replay this orientation any time from Settings.',
    rogerSpeech: (name) =>
      `${name ? `${name}, ` : ''}that\'s your full briefing. You now have a Chief of Staff that handles your memory, tasks, calendar, commute, intelligence, communications, and meetings — all by voice. My top three tips: one, use me daily so my memory builds context. Two, speak naturally — don\'t use command syntax, just talk to me like a trusted aide. Three, the more specific you are, the more precisely I can act. If you ever need a refresher, say "Roger, replay orientation" or find it in Settings. I\'m standing by. Say "I\'m ready" or tap Engage to enter. Over.`,
    confirmPrompt: 'Say "I\'m ready" — or tap Engage to enter.',
    keyExamples: [
      '"Roger, what can you do?"',
      '"Roger, give me a morning brief"',
      '"Roger, replay orientation"',
    ],
    tip: 'Roger is always learning. The more you use PTT, the sharper the context becomes.',
  },
];
