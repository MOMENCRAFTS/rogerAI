/**
 * geoFence.ts — Roger AI Geo-fence Engine
 *
 * Provides:
 *   1. haversineDistance() — metres between two GPS coords
 *   2. geocodePlace()      — Nominatim place name → lat/lng (free)
 *   3. checkGeoFences()    — returns reminders that should fire at current position
 */

import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeoCoords {
  lat: number;
  lng: number;
}

// Matches the DB shape after migration 005_geo_location
export interface GeoReminder {
  id: string;
  user_id: string;
  text: string;
  status: string;
  due_location: string;
  due_location_lat: number;
  due_location_lng: number;
  due_radius_m: number;
  geo_triggered: boolean;
}

// ─── Haversine Distance ───────────────────────────────────────────────────────

/**
 * Returns the distance in metres between two GPS points.
 * Haversine formula — accurate enough for <500km distances.
 */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000; // Earth radius in metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Geocoding via Nominatim (free, no key) ───────────────────────────────────

/**
 * Converts a place name to GPS coordinates using OpenStreetMap Nominatim.
 * Pass nearLat/nearLng to bias the search toward the user's current area.
 * Returns null gracefully on any error.
 */
export async function geocodePlace(
  placeName: string,
  nearLat?: number,
  nearLng?: number,
): Promise<GeoCoords | null> {
  try {
    const params = new URLSearchParams({
      q: placeName,
      format: 'json',
      limit: '1',
      'accept-language': 'en',
    });
    // Bias search results toward user location (±1° bounding box)
    if (nearLat !== undefined && nearLng !== undefined) {
      params.set('viewbox', `${nearLng - 1},${nearLat + 1},${nearLng + 1},${nearLat - 1}`);
      params.set('bounded', '0'); // not strictly bounded — fallback globally
    }

    const res  = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'RogerAI/1.0' },
    });
    const data = await res.json() as { lat: string; lon: string }[];
    if (!data || data.length === 0) return null;

    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

// ─── Geo-fence Checker ────────────────────────────────────────────────────────

/**
 * Fetches all pending geo-reminders for a user from Supabase,
 * then returns those whose geocoded location is within their radius
 * of the user's current position.
 *
 * Called every time GPS updates (watchPosition fires, ~60s).
 */
export async function checkGeoFences(
  userId: string,
  currentLat: number,
  currentLng: number,
): Promise<GeoReminder[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('id, user_id, text, status, due_location, due_location_lat, due_location_lng, due_radius_m, geo_triggered')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .eq('geo_triggered', false)
    .not('due_location', 'is', null)
    .not('due_location_lat', 'is', null);

  if (error || !data) return [];

  return (data as GeoReminder[]).filter(reminder => {
    const dist = haversineDistance(
      currentLat, currentLng,
      reminder.due_location_lat,
      reminder.due_location_lng,
    );
    return dist <= (reminder.due_radius_m ?? 300);
  });
}
