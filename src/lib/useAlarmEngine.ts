/**
 * useAlarmEngine — polls pending reminders and fires voice + haptic alerts
 * when a reminder's due_at is within the next 2 minutes and hasn't fired yet.
 *
 * Usage: call inside UserHome (or UserApp) with the userId and a speak callback.
 */
import { useEffect, useRef } from 'react';
import { fetchReminders } from './api';
import { hapticGeoAlert } from './haptics';
import { speakResponse } from './tts';
import { supabase } from './supabase';

const POLL_INTERVAL_MS = 60_000; // check every 60 seconds
const ALERT_WINDOW_MS  = 2 * 60_000; // fire if due within 2 minutes

/** IDs we've already alerted this session so we don't double-fire */
const alertedIds = new Set<string>();

/** Map recurrence_rule to a human-readable suffix for TTS */
function recurrenceSuffix(rule: string | null, time: string | null): string {
  if (!rule) return '';
  const timeLabel = time ? ` at ${time}` : '';
  const ruleLabels: Record<string, string> = {
    daily: 'tomorrow', weekdays: 'next weekday', weekly: 'next week',
    monthly: 'next month', custom: 'next scheduled day',
  };
  return ` Recurring — next: ${ruleLabels[rule] ?? 'next occurrence'}${timeLabel}.`;
}

export function useAlarmEngine(userId: string) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const reminders = await fetchReminders(userId, 'pending').catch(() => []);
        const now = Date.now();
        for (const r of reminders) {
          if (!r.due_at) continue;
          if (alertedIds.has(r.id)) continue;
          const due = new Date(r.due_at).getTime();
          const diff = due - now;
          if (diff >= 0 && diff <= ALERT_WINDOW_MS) {
            alertedIds.add(r.id);
            hapticGeoAlert();
            const minLeft = Math.max(0, Math.round(diff / 60_000));
            const suffix = recurrenceSuffix(r.recurrence_rule, r.recurrence_time);
            const msg = minLeft === 0
              ? `Reminder now due: ${r.text}.${suffix} Over.`
              : `Reminder in ${minLeft} minute${minLeft > 1 ? 's' : ''}: ${r.text}.${suffix} Over.`;
            speakResponse(msg).catch(() => {
              window.speechSynthesis.cancel();
              window.speechSynthesis.speak(new SpeechSynthesisUtterance(msg));
            });
            // Mark as done so it won't fire again
            // (server-side check-reminders cron will spawn next occurrence for recurring)
            Promise.resolve(
              supabase.from('reminders').update({ status: 'done' }).eq('id', r.id)
            ).then(() => {}).catch(() => {});
            // Dispatch refresh so RemindersView updates
            window.dispatchEvent(new CustomEvent('roger:refresh'));
          }
        }
      } catch { /* silent */ }
    };

    // Run immediately on mount then every minute
    check();
    timerRef.current = setInterval(check, POLL_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [userId]);
}

