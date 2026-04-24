/**
 * audioPermission.ts — Runtime permission helpers for Roger AI
 *
 * Wraps microphone and location permission requests with a clean API.
 * Works in both browser (getUserMedia) and Capacitor native contexts.
 * All functions are safe to call on web desktop (gracefully degrade).
 */

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable';

// ─── Microphone ──────────────────────────────────────────────────────────────

/**
 * Check the current microphone permission state without triggering a prompt.
 * Returns 'unavailable' if the Permissions API is not supported.
 */
export async function checkMicPermission(): Promise<PermissionState> {
  try {
    if (!navigator.permissions) return 'unavailable';
    const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return result.state as PermissionState;
  } catch {
    return 'unavailable';
  }
}

/**
 * Request microphone access. Triggers the OS permission dialog if needed.
 * Returns true if access was granted, false if denied or unavailable.
 *
 * The returned MediaStream is immediately stopped — this call is only to
 * trigger the OS dialog and update the permission state; actual recording
 * is handled by audioRecorder.ts on PTT press.
 */
export async function requestMicPermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    // Stop all tracks immediately — we only needed the permission prompt
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch {
    return false;
  }
}

// ─── Location ────────────────────────────────────────────────────────────────

/**
 * Check the current location permission state without triggering a prompt.
 */
export async function checkLocationPermission(): Promise<PermissionState> {
  try {
    if (!navigator.permissions) return 'unavailable';
    const result = await navigator.permissions.query({ name: 'geolocation' });
    return result.state as PermissionState;
  } catch {
    return 'unavailable';
  }
}

/**
 * Request location access. Triggers the OS permission dialog if needed.
 * Returns true if access was granted, false if denied.
 */
export function requestLocationPermission(): Promise<boolean> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(false); return; }
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      () => resolve(false),
      { timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

// ─── Combined grant + audio unlock ───────────────────────────────────────────

const STORAGE_KEY = 'roger:perms_granted';

/** Returns true if the user has already completed the permission gate. */
export function hasGrantedPermissions(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

/** Mark permissions as granted (persists across app restarts). */
export function markPermissionsGranted(): void {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* storage unavailable */ }
}

/** Reset the permission gate (for dev/testing). */
export function resetPermissions(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
}
