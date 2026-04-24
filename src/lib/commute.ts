// ─── Roger AI — Commute ETA Client Library ────────────────────────────────────
// Calls the commute-eta Supabase edge function and caches results.

import { supabase } from './supabase';
import { fetchCommuteProfile } from './api';

export interface CommuteDestination {
  label: string;
  address: string;
}

export interface CommuteResult {
  label:           string;
  address:         string;
  status:          string;
  durationText:    string;
  durationSeconds: number | null;
  distanceText:    string;
  distanceMeters:  number | null;
  resolvedAddress?: string;
}

export interface CommuteSnapshot {
  results:    CommuteResult[];
  mode:       string;
  fetchedAt:  string;
  fromCache?: boolean;
}

export type CommuteMode = 'driving' | 'walking' | 'transit';

// In-memory cache — keyed by "lat,lng:mode"
const _cache = new Map<string, { data: CommuteSnapshot; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Default destinations pulled from user_preferences.work_address / home_address.
 * Fallback to env-configured defaults if no prefs found.
 */
export const DEFAULT_DESTINATIONS: CommuteDestination[] = [
  { label: 'Office',   address: 'Riyadh, Saudi Arabia' },
  { label: 'Home',     address: 'Riyadh, Saudi Arabia' },
];

/**
 * Fetch commute ETAs from the edge function.
 * Results are cached for 5 minutes to avoid hammering the Maps API.
 */
export async function fetchCommuteETAs(
  lat: number,
  lng: number,
  destinations: CommuteDestination[],
  mode: CommuteMode = 'driving',
  userId?: string,
): Promise<CommuteSnapshot> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}:${mode}`;
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...cached.data, fromCache: true };
  }

  const { data, error } = await supabase.functions.invoke('commute-eta', {
    body: { origin: { lat, lng }, destinations, mode, userId },
  });

  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error ?? 'Commute fetch failed');

  const snapshot: CommuteSnapshot = {
    results:   data.results as CommuteResult[],
    mode:      data.mode,
    fetchedAt: data.fetchedAt,
  };

  _cache.set(key, { data: snapshot, ts: Date.now() });
  return snapshot;
}

/** Format seconds into a human-readable string like "23 min" or "1 hr 5 min" */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs  = Math.floor(mins / 60);
  const rem  = mins % 60;
  return rem > 0 ? `${hrs} hr ${rem} min` : `${hrs} hr`;
}

/** Returns a traffic-level label based on duration vs typical */
export function trafficLevel(durationSeconds: number | null): 'clear' | 'moderate' | 'heavy' {
  if (durationSeconds === null) return 'clear';
  const mins = durationSeconds / 60;
  if (mins < 20) return 'clear';
  if (mins < 40) return 'moderate';
  return 'heavy';
}

/** Load user's saved home/work addresses from commute profile */
export async function loadUserDestinations(userId: string): Promise<CommuteDestination[]> {
  try {
    const profile = await fetchCommuteProfile(userId);
    if (!profile) return DEFAULT_DESTINATIONS;

    const dests: CommuteDestination[] = [];
    if (profile.home_address) dests.push({ label: 'Home',   address: profile.home_address });
    if (profile.work_address) dests.push({ label: 'Office', address: profile.work_address });
    return dests.length > 0 ? dests : DEFAULT_DESTINATIONS;
  } catch {
    return DEFAULT_DESTINATIONS;
  }
}
