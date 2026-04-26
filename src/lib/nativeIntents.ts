/**
 * nativeIntents.ts — Store-safe native intent bridges.
 *
 * Uses standard URL schemes — no dangerous permissions required.
 * These open the NATIVE app pre-filled — the user must tap Send/Call.
 *
 * Store compliance:
 * - sms: — universally accepted (Android + iOS)
 * - tel: — universally accepted (Android + iOS)
 * - https://wa.me/ — WhatsApp deep link (works if WhatsApp installed)
 *
 * ⚠ We CANNOT send SMS silently or read incoming messages.
 *   Both stores reject this unless the app is the default SMS handler.
 */

// ── SMS ───────────────────────────────────────────────────────────────────────

/**
 * Open the native SMS composer with a pre-filled recipient and message.
 * The user must tap Send manually (store-compliant).
 *
 * iOS uses `&body=` separator, Android uses `?body=`.
 */
export function openSmsComposer(phoneNumber: string, message: string): void {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const sep = isIos ? '&' : '?';
  const url = `sms:${encodePhoneNumber(phoneNumber)}${sep}body=${encodeURIComponent(message)}`;
  window.open(url, '_system');
}

// ── Phone Call ────────────────────────────────────────────────────────────────

/**
 * Open the native phone dialer with a pre-filled number.
 * The user must tap Call manually.
 */
export function openPhoneDialer(phoneNumber: string): void {
  window.open(`tel:${encodePhoneNumber(phoneNumber)}`, '_system');
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────

/**
 * Open WhatsApp to a specific number with a pre-filled message.
 * Requires WhatsApp to be installed.
 * Phone number should include country code (e.g., +971501234567).
 */
export function openWhatsApp(phoneNumber: string, message: string): void {
  const cleaned = phoneNumber.replace(/[^0-9]/g, '');
  const url = `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
  window.open(url, '_system');
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Clean a phone number for use in URL schemes */
function encodePhoneNumber(phone: string): string {
  // Keep +, digits, and dashes — strip everything else
  return phone.replace(/[^\d+\-]/g, '');
}
