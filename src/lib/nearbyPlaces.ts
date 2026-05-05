/**
 * nearbyPlaces.ts — Roger AI Nearby Places Intelligence
 *
 * Uses Google Places API (New) to find nearby POIs.
 * Provides gas stations, pharmacies, restaurants, ATMs etc.
 * Results are cached for 5 minutes per location+type.
 */

const GOOGLE_API_KEY = (typeof import.meta !== 'undefined')
  ? (import.meta as { env?: Record<string, string> }).env?.VITE_GOOGLE_MAPS_API_KEY ?? ''
  : '';

export interface NearbyPlace {
  id:          string;
  name:        string;
  type:        string;          // primary type e.g. "gas_station"
  address:     string;
  distanceM:   number;          // calculated via haversine
  rating?:     number;          // 1.0–5.0
  ratingCount?: number;
  isOpen?:     boolean;
  lat:         number;
  lng:         number;
}

export interface NearbyCategory {
  key:    string;
  label:  string;
  icon:   string;
  type:   string;   // Google Places type
}

/** Pre-defined categories for the UI */
export const NEARBY_CATEGORIES: NearbyCategory[] = [
  { key: 'gas',       label: 'Gas',       icon: '⛽', type: 'gas_station' },
  { key: 'pharmacy',  label: 'Pharmacy',  icon: '💊', type: 'pharmacy' },
  { key: 'food',      label: 'Food',      icon: '🍽️', type: 'restaurant' },
  { key: 'atm',       label: 'ATM',       icon: '🏧', type: 'atm' },
  { key: 'coffee',    label: 'Coffee',    icon: '☕', type: 'cafe' },
  { key: 'hospital',  label: 'Hospital',  icon: '🏥', type: 'hospital' },
];

// ─── Haversine (metres) ──────────────────────────────────────────────────────
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── In-memory cache ─────────────────────────────────────────────────────────
const _cache = new Map<string, { data: NearbyPlace[]; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch nearby places of a given type using Google Places API (New).
 * Returns up to 5 results sorted by distance.
 * Cached for 5 minutes per location + type.
 */
export async function fetchNearbyPlaces(
  lat: number,
  lng: number,
  type: string,
  radiusM = 1500,
): Promise<NearbyPlace[]> {
  if (!GOOGLE_API_KEY) return [];

  const key = `${lat.toFixed(3)},${lng.toFixed(3)}:${type}`;
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  try {
    const url = 'https://places.googleapis.com/v1/places:searchNearby';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Goog-Api-Key':   GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount,places.currentOpeningHours',
      },
      body: JSON.stringify({
        includedTypes:        [type],
        maxResultCount:       5,
        locationRestriction: {
          circle: {
            center:  { latitude: lat, longitude: lng },
            radius:  radiusM,
          },
        },
      }),
    });

    if (!res.ok) return [];

    const data = await res.json() as {
      places?: {
        id:                    string;
        displayName?:          { text: string };
        formattedAddress?:     string;
        location?:             { latitude: number; longitude: number };
        types?:                string[];
        rating?:               number;
        userRatingCount?:      number;
        currentOpeningHours?:  { openNow?: boolean };
      }[];
    };

    const results: NearbyPlace[] = (data.places ?? []).map(p => ({
      id:          p.id,
      name:        p.displayName?.text ?? 'Unknown',
      type,
      address:     p.formattedAddress ?? '',
      distanceM:   p.location ? Math.round(haversineM(lat, lng, p.location.latitude, p.location.longitude)) : 9999,
      rating:      p.rating,
      ratingCount: p.userRatingCount,
      isOpen:      p.currentOpeningHours?.openNow,
      lat:         p.location?.latitude ?? 0,
      lng:         p.location?.longitude ?? 0,
    }));

    // Sort by distance
    results.sort((a, b) => a.distanceM - b.distanceM);

    _cache.set(key, { data: results, ts: Date.now() });
    return results;
  } catch {
    return [];
  }
}

/**
 * Format a nearby place into a context string for GPT injection.
 */
export function nearbyToContextString(places: NearbyPlace[]): string {
  if (!places.length) return '';
  return places.map(p =>
    `${p.name} (${p.type.replace(/_/g, ' ')}) — ${p.distanceM}m${p.rating ? `, ${p.rating}★` : ''}${p.isOpen === false ? ' [CLOSED]' : ''}`
  ).join('; ');
}
