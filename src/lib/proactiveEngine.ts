/**
 * proactiveEngine.ts — Roger AI Proactive Attention System
 *
 * Roger pings the user with haptic + radio noise when he has something to say.
 * PTT interaction model:
 *   1× short press  → speak pending message
 *   2× short press within 1s → snooze for SNOOZE_MS
 *   No response in 30s → auto-snooze
 *
 * Mode-aware:
 *   drive      → strong haptic + loud ping + auto-speak after 3s
 *   normal     → subtle haptic + quiet ping, waits for PTT
 *   talkative  → same as normal, but also handles thinking messages from cron
 *   muted      → silent, no ping
 */

import { sfxRogerPing } from './sfx';
import { hapticTick, hapticSuccess } from './haptics';
import { speakResponse } from './tts';

// ── Config ────────────────────────────────────────────────────────────────────
const SNOOZE_MS           = 5 * 60 * 1000;   // 5 minutes
const TALKATIVE_SNOOZE_MS = 15 * 60 * 1000;  // 15 minutes (talkative double-press)
const AUTO_SNOOZE_MS      = 30 * 1000;       // 30s no-response → auto-snooze
const DRIVE_AUTO_MS       = 3 * 1000;        // drive mode: auto-speak after 3s
const TALKATIVE_AUTO_MS   = 2 * 1000;        // talkative auto_speak: auto-speak after 2s

export type ProactiveMode = 'normal' | 'drive' | 'talkative' | 'muted';
export type TalkativeDelivery = 'auto_speak' | 'ptt_pulse';

export interface PendingMessage {
  id:      string;
  text:    string;
  trigger: 'hazard' | 'reminder' | 'departure' | 'briefing' | 'idle' | 'academy' | 'thinking';
  urgent?: boolean;
}

// ── Singleton state ───────────────────────────────────────────────────────────
let _mode:       ProactiveMode   = 'normal';
let _delivery:   TalkativeDelivery = 'ptt_pulse';
let _pending:    PendingMessage | null = null;
let _snoozeUntil = 0;
let _autoTimer:  ReturnType<typeof setTimeout> | null = null;
let _lastPttAt   = 0;
let _pttCount    = 0;
let _onSpeak:    ((msg: PendingMessage) => void) | null = null;
let _onClear:    (() => void) | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

/** Call once from UserHome/CommuteRadar to register callbacks */
export function initProactive(opts: {
  onSpeak: (msg: PendingMessage) => void;
  onClear: () => void;
}) {
  _onSpeak = opts.onSpeak;
  _onClear = opts.onClear;
}

/** Update current mode (normal | drive | talkative | muted) */
export function setProactiveMode(mode: ProactiveMode) {
  _mode = mode;
}

/** Set talkative delivery preference */
export function setTalkativeDelivery(delivery: TalkativeDelivery) {
  _delivery = delivery;
}

/** Queue a message for Roger to proactively deliver */
export function queueMessage(msg: PendingMessage) {
  if (_mode === 'muted') return;
  if (Date.now() < _snoozeUntil) return;
  if (_pending?.id === msg.id) return; // already queued

  _pending = msg;
  _ping();
}

/** Clear any pending message (call after it's been spoken or dismissed) */
export function clearPending() {
  _pending = null;
  _cancelAutoTimer();
  _onClear?.();
}

/** Handle PTT press — returns true if a proactive message was consumed */
export function handleProactivePTT(): boolean {
  if (!_pending) return false;

  const now  = Date.now();
  const gap  = now - _lastPttAt;
  _lastPttAt = now;

  if (gap < 1000) {
    // 2nd press within 1s → snooze (15 min for thinking messages, 5 min otherwise)
    _pttCount++;
    if (_pttCount >= 2) {
      _snooze(_pending?.trigger === 'thinking');
      return true;
    }
  } else {
    _pttCount = 1;
  }

  // 1st press → speak
  _speak();
  return true;
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _ping() {
  if (!_pending || _mode === 'muted') return;

  // Haptic
  if (_mode === 'drive') {
    hapticSuccess(); // stronger
  } else {
    hapticTick();
  }

  // Radio ping
  sfxRogerPing(_mode === 'drive').catch(() => {});

  // Notify UI
  _onSpeak?.(_pending);

  // Drive mode: auto-speak after 3s
  if (_mode === 'drive') {
    _cancelAutoTimer();
    _autoTimer = setTimeout(() => {
      if (_pending) _speak();
    }, DRIVE_AUTO_MS);
  } else if (_mode === 'talkative' && _delivery === 'auto_speak') {
    // Talkative auto-speak: auto-speak after 2s
    _cancelAutoTimer();
    _autoTimer = setTimeout(() => {
      if (_pending) _speak();
    }, TALKATIVE_AUTO_MS);
  } else {
    // Normal / talkative+ptt_pulse: auto-snooze after 30s
    _cancelAutoTimer();
    _autoTimer = setTimeout(() => {
      if (_pending) _snooze();
    }, AUTO_SNOOZE_MS);
  }
}

async function _speak() {
  if (!_pending) return;
  _cancelAutoTimer();
  const msg = _pending;
  clearPending();
  try {
    await speakResponse(msg.text);
  } catch { /* silent */ }
}

function _snooze(isTalkative = false) {
  _snoozeUntil = Date.now() + (isTalkative ? TALKATIVE_SNOOZE_MS : SNOOZE_MS);
  clearPending();
}

function _cancelAutoTimer() {
  if (_autoTimer) { clearTimeout(_autoTimer); _autoTimer = null; }
}

// ── Trigger helpers (call from components) ────────────────────────────────────

export function triggerHazardAlert(hazardLabel: string, distanceM: number) {
  queueMessage({
    id:      `hazard-${hazardLabel}`,
    text:    `Caution. ${hazardLabel} in ${Math.round(distanceM)} metres.`,
    trigger: 'hazard',
    urgent:  distanceM < 200,
  });
}

export function triggerReminderAlert(reminderText: string) {
  queueMessage({
    id:      `reminder-${reminderText.slice(0, 20)}`,
    text:    `Reminder due: ${reminderText}`,
    trigger: 'reminder',
  });
}

export function triggerDepartureAlert(etaDuration: string) {
  queueMessage({
    id:      'departure',
    text:    `Time to leave. ETA to work is ${etaDuration}. Roger standing by.`,
    trigger: 'departure',
  });
}

export function triggerIdleCheckin(pendingCount: number) {
  queueMessage({
    id:      'idle-checkin',
    text:    pendingCount > 0
      ? `Standing by. You have ${pendingCount} pending item${pendingCount > 1 ? 's' : ''}. Hold to transmit.`
      : `Roger standing by. All clear. Hold to transmit.`,
    trigger: 'idle',
  });
}

/** Proactive academy quiz — nudge user to practice a word */
export function triggerAcademyQuiz(word: string, targetLang: string, streakDays: number) {
  queueMessage({
    id:      `academy-quiz-${word}`,
    text:    streakDays > 0
      ? `Academy check-in. ${streakDays}-day streak. Quick — how do you say "${word}" in ${targetLang}? Hold PTT to answer. Over.`
      : `Academy time. How do you say "${word}" in ${targetLang}? Hold PTT to answer. Over.`,
    trigger: 'academy',
  });
}

/** Talkative mode — Roger has a thought to share */
export function triggerThinkingMessage(thought: string, thoughtId?: string) {
  queueMessage({
    id:      thoughtId ?? `think-${Date.now()}`,
    text:    thought,
    trigger: 'thinking',
  });
}
