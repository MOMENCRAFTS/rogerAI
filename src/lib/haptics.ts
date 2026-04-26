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

/** Delay helper for multi-tap patterns */
const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** PTT button pressed — heavy thump + medium follow-up, like a satisfying radio click */
export const hapticPTTDown = () =>
  guard(async () => {
    await Haptics.impact({ style: ImpactStyle.Heavy });
    await delay(50);
    await Haptics.impact({ style: ImpactStyle.Medium });
  });

/** PTT button released — crisp light tap */
export const hapticPTTUp = () =>
  guard(() => Haptics.impact({ style: ImpactStyle.Light }));

/** Roger is about to speak — anticipation pulse: light → pause → success notification */
export const hapticRogerSpeaking = () =>
  guard(async () => {
    await Haptics.impact({ style: ImpactStyle.Light });
    await delay(80);
    await Haptics.notification({ type: NotificationType.Success });
  });

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

/** Milestone celebration — triple-tap burst pattern */
export const hapticMilestone = () =>
  guard(async () => {
    await Haptics.notification({ type: NotificationType.Success });
    await delay(120);
    await Haptics.impact({ style: ImpactStyle.Heavy });
    await delay(120);
    await Haptics.notification({ type: NotificationType.Success });
  });
