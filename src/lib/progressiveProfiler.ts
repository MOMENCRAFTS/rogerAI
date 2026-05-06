/**
 * progressiveProfiler.ts — Roger learns about you over time.
 *
 * Checks memory_graph for missing high-value data slots and triggers
 * natural proactive questions through the proactive engine.
 *
 * Throttled: max 1 profile question per day, only during idle moments.
 * Slots are prioritised and staggered — family on day 2, commute on day 1, etc.
 *
 * How it works:
 *   1. checkAndPromptProfile() is called from UserHome's idle timer.
 *   2. It scans memory_graph for predicate patterns that match each slot.
 *   3. If a slot is empty AND enough days have passed since onboarding, Roger asks.
 *   4. The user responds via PTT → extract-memory-facts captures the data naturally.
 *   5. Next time the profiler runs, that slot is detected as filled → skip it.
 */

import { fetchMemoryGraph, type DbMemoryFact } from './api';
import { triggerThinkingMessage } from './proactiveEngine';

// ── Slot definitions: what Roger wants to learn ──────────────────────────────
interface ProfileSlot {
  id: string;
  predicatePatterns: string[];       // how to find it in memory_graph
  prompt: string;                     // what Roger asks (naturally)
  priority: number;                   // 1 = ask first
  minDaysSinceOnboarding: number;     // don't ask too early
}

const PROFILE_SLOTS: ProfileSlot[] = [
  {
    id: 'commute',
    predicatePatterns: ['commutes to', 'drives to', 'workplace is', 'office is', 'home address'],
    prompt: "Quick one — what's your usual commute? Home to work. I can set up live traffic and radar alerts on your route. Over.",
    priority: 1,
    minDaysSinceOnboarding: 1,
  },
  {
    id: 'family',
    predicatePatterns: ['family member is', 'spouse', 'child', 'wife', 'husband', 'son', 'daughter'],
    prompt: "By the way — anyone in the family I should know about? Names, birthdays, ages. Helps me keep you on top of things. Over.",
    priority: 2,
    minDaysSinceOnboarding: 2,
  },
  {
    id: 'wake_time',
    predicatePatterns: ['wakes at', 'morning routine', 'alarm at', 'starts day at'],
    prompt: "What time do you usually start your day? I'll time your morning briefing perfectly. Over.",
    priority: 3,
    minDaysSinceOnboarding: 3,
  },
  {
    id: 'financial',
    predicatePatterns: ['watches market', 'holds', 'invested in', 'portfolio', 'tracks', 'trades'],
    prompt: "Any stocks, crypto, or commodities you follow? I'll add them to your market dashboard and morning brief. Over.",
    priority: 4,
    minDaysSinceOnboarding: 3,
  },
  {
    id: 'news_topics',
    predicatePatterns: ['follows news about', 'reads about', 'news interest', 'stays updated on'],
    prompt: "What topics do you like to stay updated on? Industry news, tech, politics, local? I'll curate your digest. Over.",
    priority: 5,
    minDaysSinceOnboarding: 4,
  },
  {
    id: 'vehicle',
    predicatePatterns: ['drives', 'rides', 'vehicle is', 'car is', 'motorcycle is', 'bike is'],
    prompt: "What do you drive day to day? I can track fuel prices and maintenance schedules for you. Over.",
    priority: 6,
    minDaysSinceOnboarding: 5,
  },
  {
    id: 'goals',
    predicatePatterns: ['goal is', 'wants to', 'aspires to', 'learning', 'training for', 'working toward'],
    prompt: "Any personal goals you're working toward? Learning a language, fitness, a project? I'll check in on your progress. Over.",
    priority: 7,
    minDaysSinceOnboarding: 7,
  },
  {
    id: 'health',
    predicatePatterns: ['diet is', 'fasting', 'allergy to', 'health condition', 'intermittent'],
    prompt: "Any dietary preferences or health routines I should know about? Fasting schedules, allergies — helps me time reminders right. Over.",
    priority: 8,
    minDaysSinceOnboarding: 10,
  },
];

// ── Throttle: max 1 profile question per day ─────────────────────────────────
const STORAGE_KEY_LAST_ASK = 'roger:profile_last_ask';
const STORAGE_KEY_ONBOARDED = 'roger:onboarded_at';
const MIN_GAP_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if a profile slot is already filled by scanning memory_graph facts.
 */
function slotIsFilled(slot: ProfileSlot, facts: DbMemoryFact[]): boolean {
  return facts.some(f =>
    slot.predicatePatterns.some(p =>
      f.predicate.toLowerCase().includes(p.toLowerCase()) ||
      f.object.toLowerCase().includes(p.toLowerCase())
    )
  );
}

/**
 * Check all profile slots and proactively ask about the highest-priority
 * unfilled one. Called from UserHome's idle timer.
 *
 * Constraints:
 * - Max 1 ask per 24 hours
 * - Respects minDaysSinceOnboarding per slot
 * - Only asks if talkative or normal mode (not muted)
 */
export async function checkAndPromptProfile(userId: string): Promise<void> {
  // Throttle: max 1 per day
  const lastAsk = parseInt(localStorage.getItem(STORAGE_KEY_LAST_ASK) ?? '0', 10);
  if (Date.now() - lastAsk < MIN_GAP_MS) return;

  // Check onboarding age
  const onboardedAt = localStorage.getItem(STORAGE_KEY_ONBOARDED);
  const daysSinceOnboarding = onboardedAt
    ? (Date.now() - new Date(onboardedAt).getTime()) / (24 * 60 * 60 * 1000)
    : 999; // assume long-time user if no timestamp

  try {
    const facts = await fetchMemoryGraph(userId);

    // Find the highest-priority unfilled slot that's old enough to ask
    const emptySlot = PROFILE_SLOTS
      .filter(s => !slotIsFilled(s, facts))
      .filter(s => daysSinceOnboarding >= s.minDaysSinceOnboarding)
      .sort((a, b) => a.priority - b.priority)[0];

    if (!emptySlot) return; // all slots filled — nothing to ask!

    // Trigger via proactive engine (uses existing haptic + TTS pipeline)
    triggerThinkingMessage(emptySlot.prompt, `profile-${emptySlot.id}`);
    localStorage.setItem(STORAGE_KEY_LAST_ASK, String(Date.now()));
  } catch {
    // Silent — never interrupt UX for profiling
  }
}

/**
 * Mark the onboarding timestamp so the profiler knows when to start asking.
 * Call this from finishOnboarding().
 */
export function markOnboardingComplete(): void {
  localStorage.setItem(STORAGE_KEY_ONBOARDED, new Date().toISOString());
}

/**
 * Get the list of profile slot IDs that are still empty.
 * Useful for settings/debug UI.
 */
export async function getEmptyProfileSlots(userId: string): Promise<string[]> {
  try {
    const facts = await fetchMemoryGraph(userId);
    return PROFILE_SLOTS
      .filter(s => !slotIsFilled(s, facts))
      .map(s => s.id);
  } catch {
    return [];
  }
}
