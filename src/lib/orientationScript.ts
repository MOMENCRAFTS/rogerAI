/**
 * orientationScript.ts — Roger's interactive orientation chapter data.
 *
 * 5 domain-based chapters (consolidated from 13), each with:
 *  - Full TTS speech Roger reads aloud
 *  - Voice example chips shown on screen
 *  - A confirm prompt asking the user to say "understood"
 *  - Optional pro tip
 *
 * +1 conditional Islamic Mode chapter for users who opted in.
 */

import {
  Radio, Brain,
  Calendar, Users, Zap, Moon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const ORIENTATION_VERSION = 4;

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

  // ── 01 ── Welcome + PTT Mastery ─────────────────────────────────────────────
  {
    id: 'welcome-ptt',
    icon: Radio,
    iconColor: '#d4a044',
    chapterLabel: 'Chapter 01',
    headline: 'I\'m Roger. Voice First.',
    body: 'I\'m your AI Chief of Staff — built for executives who don\'t have time to type. Everything runs through the PTT button: hold to speak, tap to stop me, double-tap to replay. One button, three powers.',
    rogerSpeech: (name) =>
      `${name ? `${name}, ` : ''}welcome aboard. I'm Roger — your AI Chief of Staff. Everything here is voice-first. The PTT button at the bottom is your only control. Hold it and speak to give me a command. Tap once to stop me mid-sentence. Double-tap to replay my last message. That's it — hold, tap, double-tap. I don't do small talk — I get things done. Say "understood" when you're ready. Over.`,
    confirmPrompt: 'Say "understood" or tap Continue to proceed.',
    keyExamples: [
      'HOLD — Record your voice command',
      'TAP — Stop Roger mid-sentence',
      'DOUBLE-TAP — Replay last message',
    ],
    tip: 'Hold PTT for at least 0.5 seconds before speaking for best recognition.',
  },

  // ── 02 ── Your Day (Tasks + Calendar + Commute) ─────────────────────────────
  {
    id: 'your-day',
    icon: Calendar,
    iconColor: '#22c55e',
    chapterLabel: 'Chapter 02',
    headline: 'I Run Your Day.',
    body: 'Tasks, reminders, calendar, and commute — all by voice. I create tasks from natural speech, manage your Google Calendar, and brief you before every drive with weather, schedule, and road conditions.',
    rogerSpeech: (name) =>
      `${name ? `${name}, ` : ''}this is where I earn my keep. Say "Roger, add task: finalize Q2 report, high priority" — it's logged. "Remind me to call the accountant at 9am" — done. I also own your calendar — "what's on today?" or "book a meeting with the team at 10am." Before you drive, say "brief me for my drive" and I'll give you weather, your next meeting, and road hazards — all spoken, no screen needed. I even detect when you're driving and switch to hands-free mode automatically. Say "understood" to continue. Over.`,
    confirmPrompt: 'Say "understood" or tap Continue.',
    keyExamples: [
      '"Roger, add task: prepare board slides"',
      '"Roger, what\'s on my calendar today?"',
      '"Roger, brief me for my drive"',
      '"Roger, remind me at 8am daily"',
    ],
    tip: 'Link Google Calendar in Settings → Integrations. I\'ll never book without confirming first.',
  },

  // ── 03 ── Your Intel (Memory + Knowledge + News + Stocks) ───────────────────
  {
    id: 'your-intel',
    icon: Brain,
    iconColor: '#8b5cf6',
    chapterLabel: 'Chapter 03',
    headline: 'I Know Everything You Tell Me.',
    body: 'Every conversation builds your private memory graph. I remember people, places, preferences, and context. Ask me about any topic and I\'ll brief you — then go deeper. I also track stocks, flights, and news on demand.',
    rogerSpeech: (name) =>
      `${name ? `${name}, ` : ''}I build a private memory of everything you tell me. Mention that a client prefers morning calls — I store it and surface it before your next meeting with them. Ask "what do you know about Ahmad?" and I'll recall everything. I'm also your research aide — ask me anything, say "tell me more" to go deeper, and I'll build a personal encyclopedia over time. For markets: "what's Tesla trading at?" For flights: "is EK201 on time?" For news: "anything I should know?" — I filter by what's relevant to you. Say "understood" to continue. Over.`,
    confirmPrompt: 'Say "understood" or tap Continue.',
    keyExamples: [
      '"Roger, remember that Ahmad prefers email"',
      '"Roger, tell me about quantum computing"',
      '"Roger, what\'s Apple trading at?"',
      '"Roger, any news I should know?"',
    ],
    tip: 'The more you use me, the smarter my memory gets. High-confidence facts are stored instantly.',
  },

  // ── 04 ── Your Network (Contacts + Tune In + Meetings + Ambient) ────────────
  {
    id: 'your-network',
    icon: Users,
    iconColor: '#6366f1',
    chapterLabel: 'Chapter 04',
    headline: 'I Handle Your People.',
    body: 'Sync your contacts and I\'ll recognize names instantly — text, call, or WhatsApp hands-free. Tune In connects you with other Roger users via private voice channels. I can also record meetings with full AI-generated notes.',
    rogerSpeech: (name) =>
      `${name ? `${name}, ` : ''}when you sync your contacts, I know exactly who you mean when you say a name — no more mis-transcriptions. Say "text Mom I'm on my way" or "call Ahmad" — hands-free. Tune In is Roger's private voice network — connect with other Roger users by name or callsign, and I'll take notes in the background. For meetings: say "Roger, record meeting" and I'll transcribe everything. When it's over, I generate an executive summary, action items, and key decisions. And if you hear something you want identified — say "Roger, listen to this" and I'll detect the language or identify the music. Say "understood" to continue. Over.`,
    confirmPrompt: 'Say "understood" or tap Continue.',
    keyExamples: [
      '"Roger, text Ahmad I\'m running late"',
      '"Roger, tune in with Sarah"',
      '"Roger, record meeting"',
      '"Roger, listen to this"',
    ],
    tip: 'Sync contacts in Settings. Only display names are read — phone numbers never leave your device.',
  },

  // ── 05 ── Engage ────────────────────────────────────────────────────────────
  {
    id: 'engage',
    icon: Zap,
    iconColor: '#d4a044',
    chapterLabel: 'Chapter 05',
    headline: 'You\'re Ready. Let\'s Go.',
    body: 'That\'s the full briefing. Use me daily so my memory builds context. Speak naturally — just talk to me like a trusted aide. The more specific you are, the more precisely I act. Replay this orientation any time from Settings.',
    rogerSpeech: (name) =>
      `${name ? `${name}, ` : ''}that's your briefing. You now have a Chief of Staff that handles your memory, tasks, calendar, commute, intelligence, and communications — all by voice. Three tips: one, use me daily so my memory builds context. Two, speak naturally — don't use command syntax, just talk to me. Three, the more specific you are, the better I perform. If you ever need a refresher, say "Roger, replay orientation" or find it in Settings. I'm standing by. Say "I'm ready" or tap Engage. Over.`,
    confirmPrompt: 'Say "I\'m ready" — or tap Engage to enter.',
    keyExamples: [
      '"Roger, what can you do?"',
      '"Roger, give me a morning brief"',
      '"Roger, replay orientation"',
    ],
    tip: 'Roger is always learning. The more you use PTT, the sharper the context becomes.',
  },
];

// ── Islamic Mode (conditional, shown only to Islamic Mode users) ────────────
export const ISLAMIC_CHAPTER: OrientationChapter = {
  id: 'islamic',
  icon: Moon,
  iconColor: '#10b981',
  chapterLabel: 'Chapter 05 · Islamic Mode',
  headline: 'Salah. I\'ve Got You Covered.',
  body: 'Islamic Mode is now active. The SALAH tab gives you live prayer times, Qibla compass, daily Quran verse with audio, Hadith of the Day, Dua of the Day, the 99 Names of Allah, and a Hijri calendar. I\'ll also remind you 10 minutes before each prayer.',
  rogerSpeech: (name) =>
    `${name ? `${name}, ` : ''}Islamic Mode is active. I'll track your five daily prayers based on your live location. The Salah tab has your prayer times, Qibla direction, daily Quran verse with audio recitation, a Hadith, a Dua, and the 99 Names of Allah — all refreshed daily. 10 minutes before each prayer, I'll alert you by voice — even while you're driving. You can adjust your prayer calculation method from Settings. Say "understood" when ready. Over.`,
  confirmPrompt: 'Say "understood" or tap Continue to enter.',
  keyExamples: [
    '"Roger, when is Asr today?"',
    '"Roger, which direction is Qibla?"',
    '"Roger, verse of the day"',
    '"Roger, hadith of the day"',
  ],
  tip: 'Prayer times update automatically as you travel. The compass works best on a flat surface away from metal.',
};
