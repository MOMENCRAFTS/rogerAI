/**
 * haptics.ts
 * Thin wrapper around @capacitor/haptics. Every call is wrapped in safe()
 * which silently no-ops on web/desktop where the native engine is absent.
 * All functions also respect the hapticsEnabled runtime flag.
 */
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const safe = (fn: () => Promise<void>) => fn().catch(() => {});

let hapticsEnabled = true;
/** Set by RogerSettings when the user toggles Haptic Feedback on/off. */
export function setHapticsEnabled(v: boolean): void { hapticsEnabled = v; }

const guard = (fn: () => Promise<void>) => hapticsEnabled ? safe(fn) : Promise.resolve();

/** PTT button pressed — heavy thump, like a radio PTT click */
export const hapticPTTDown = () =>
  guard(() => Haptics.impact({ style: ImpactStyle.Heavy }));

/** PTT button released — light tap on release */
export const hapticPTTUp = () =>
  guard(() => Haptics.impact({ style: ImpactStyle.Light }));

/** Roger is about to speak — success notification pulse */
export const hapticRogerSpeaking = () =>
  guard(() => Haptics.notification({ type: NotificationType.Success }));

/** AI response processed and saved — medium confirmation tap */
export const hapticResponseReceived = () =>
  guard(() => Haptics.impact({ style: ImpactStyle.Medium }));

/** Error or bad input (e.g. hold too brief) — warning buzz */
export const hapticError = () =>
  guard(() => Haptics.notification({ type: NotificationType.Warning }));

/** Geo-fence reminder triggered — sustained vibrate for attention */
export const hapticGeoAlert = () =>
  guard(() => Haptics.vibrate({ duration: 400 }));

/** Proactive surface card appeared — soft nudge */
export const hapticSurface = () =>
  guard(() => Haptics.impact({ style: ImpactStyle.Light }));

/** Onboarding: step advanced — subtle selection tick */
export const hapticTick = () =>
  guard(() => Haptics.selectionChanged());

/** Onboarding: all steps complete — celebratory success pulse */
export const hapticSuccess = () =>
  guard(() => Haptics.notification({ type: NotificationType.Success }));
