/**
 * deviceContacts.ts — Device contact book service.
 *
 * Privacy-first design:
 * - Only reads display names + phone numbers (projection: name, phones)
 * - Phone numbers stay on-device, never sent to server
 * - Names are used only for Whisper vocabulary hints + fuzzy resolution
 * - Web fallback: returns empty array (contacts only work on native)
 *
 * Requires: @capacitor-community/contacts
 * Android: READ_CONTACTS permission in AndroidManifest.xml
 * iOS:     NSContactsUsageDescription in Info.plist
 */

import { Capacitor } from '@capacitor/core';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeviceContact {
  contactId: string;
  displayName: string;
  givenName?: string;
  familyName?: string;
  phones?: { number: string; label?: string }[];
}

// ── Permission Layer ──────────────────────────────────────────────────────────

/** Check if contacts permission is granted, denied, or can be prompted */
export async function checkContactsPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  if (!Capacitor.isNativePlatform()) return 'denied';
  try {
    const { Contacts } = await import('@capacitor-community/contacts');
    const result = await Contacts.checkPermissions();
    return (result as { contacts?: string }).contacts as 'granted' | 'denied' | 'prompt' ?? 'denied';
  } catch {
    return 'denied';
  }
}

/** Request contacts permission. Returns true if granted. */
export async function requestContactsPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { Contacts } = await import('@capacitor-community/contacts');
    const result = await Contacts.requestPermissions();
    return (result as { contacts?: string }).contacts === 'granted';
  } catch {
    return false;
  }
}

// ── Fetch Layer (cached) ──────────────────────────────────────────────────────

let _cache: DeviceContact[] | null = null;
let _cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/** Fetch all device contacts (names + phones only). Cached for 10 minutes. */
export async function fetchDeviceContacts(): Promise<DeviceContact[]> {
  // Return from cache if fresh
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;

  // Web fallback — no contacts on desktop/browser
  if (!Capacitor.isNativePlatform()) return [];

  // Check permission first
  const perm = await checkContactsPermission();
  if (perm !== 'granted') return [];

  try {
    const { Contacts } = await import('@capacitor-community/contacts');
    const { contacts } = await Contacts.getContacts({
      projection: {
        name: true,
        phones: true,
        // INTENTIONALLY NOT requesting: emails, image, organization, etc.
      },
    });

    _cache = contacts
      .map(c => ({
        contactId: c.contactId ?? '',
        displayName:
          c.name?.display ??
          `${c.name?.given ?? ''} ${c.name?.family ?? ''}`.trim(),
        givenName: c.name?.given ?? undefined,
        familyName: c.name?.family ?? undefined,
        phones: c.phones?.map(p => ({
          number: p.number ?? '',
          label: p.type ?? '',
        })),
      }))
      .filter(c => c.displayName.length > 0);

    _cacheTime = Date.now();
    console.log(`[Contacts] Loaded ${_cache.length} contacts from device`);
    return _cache;
  } catch (err) {
    console.warn('[Contacts] Failed to fetch:', err);
    return [];
  }
}

// ── Whisper Hint Builder ──────────────────────────────────────────────────────

/** Build a comma-separated string of all contact names for Whisper prompt hint */
export function buildContactNameHint(contacts: DeviceContact[]): string {
  const names = contacts.map(c => c.displayName);
  const unique = [...new Set(names)];
  // Reserve ~200 chars for static vocab — so cap contact names at 600 chars
  return unique.join(', ').substring(0, 600);
}

// ── Fuzzy Name Resolution ─────────────────────────────────────────────────────

/**
 * Fuzzy-match a spoken name against the device contact list.
 * Returns all matches (sorted by relevance). Empty array = no match.
 *
 * Match priority: exact > startsWith > Levenshtein ≤ 2
 */
export function resolveContactByName(
  spokenName: string,
  contacts: DeviceContact[],
): DeviceContact[] {
  const query = spokenName.toLowerCase().trim();
  if (!query) return [];

  // 1. Exact match (case-insensitive)
  const exact = contacts.filter(
    c => c.displayName.toLowerCase() === query,
  );
  if (exact.length) return exact;

  // 2. Starts-with match
  const starts = contacts.filter(
    c => c.displayName.toLowerCase().startsWith(query),
  );
  if (starts.length) return starts;

  // 3. Contains match
  const contains = contacts.filter(
    c => c.displayName.toLowerCase().includes(query),
  );
  if (contains.length) return contains;

  // 4. Levenshtein distance ≤ 2 (fuzzy)
  return contacts
    .map(c => ({ contact: c, dist: levenshtein(c.displayName.toLowerCase(), query) }))
    .filter(x => x.dist <= 2)
    .sort((a, b) => a.dist - b.dist)
    .map(x => x.contact);
}

/** Get the first phone number for a resolved contact */
export function getPhoneNumber(contact: DeviceContact): string | null {
  return contact.phones?.[0]?.number ?? null;
}

// ── Cache Control ─────────────────────────────────────────────────────────────

/** Clear the in-memory contact cache. Call when user disconnects. */
export function clearContactsCache(): void {
  _cache = null;
  _cacheTime = 0;
}

/** Returns the current cached contact count (0 if not synced) */
export function getCachedContactCount(): number {
  return _cache?.length ?? 0;
}

/** Returns the last sync timestamp (0 if never synced) */
export function getLastSyncTime(): number {
  return _cacheTime;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Simple Levenshtein distance for fuzzy matching */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0) as number[],
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
