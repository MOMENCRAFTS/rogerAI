// ─── TomTom Traffic Incidents ─────────────────────────────────────────────────
// Fetches live road incidents (accidents, closures, roadworks) via secure
// data-proxy edge function. API key never leaves the server.
// Polled every 90s by useHazards. Returns [] silently on auth/config errors.
//
// TomTom incident category → HazardType mapping:
//   0 = Unknown → skip
//   1 = Accident → accident
//   2 = Fog → skip (weather, not road hazard)
//   3 = DangerousConditions → debris
//   4 = Rain → skip
//   5 = Ice → debris
//   6 = Jam → skip (traffic, not hazard)
//   7 = LaneClosed → closure
//   8 = RoadClosed → closure
//   9 = RoadWorks → road_works
//   10 = Wind → skip
//   11 = Flooding → flood
//   14 = BrokenDownVehicle → debris

import type { HazardEvent, HazardType } from '../types/hazard';
import { HAZARD_META } from '../types/hazard';
import { getAuthToken } from './getAuthToken';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

const CATEGORY_MAP: Record<number, HazardType | null> = {
  0:  null,
  1:  'accident',
  2:  null,
  3:  'debris',
  4:  null,
  5:  'debris',
  6:  null,
  7:  'closure',
  8:  'closure',
  9:  'road_works',
  10: null,
  11: 'flood',
  14: 'debris',
};

interface TTIncident {
  id:         string;
  type:       string;
  geometry?: { coordinates: number[] | number[][] };
  properties?: {
    iconCategory: number;
    startTime?:   string;
    endTime?:     string;
  };
}

export async function fetchTomTomIncidents(
  lat: number,
  lng: number,
  radiusM = 1500,
): Promise<HazardEvent[]> {
  try {
    const token = await getAuthToken();
    const bbox = buildBbox(lat, lng, radiusM);

    const res = await fetch(`${SUPABASE_URL}/functions/v1/data-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ action: 'traffic', params: { bbox } }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn('[TomTom] proxy error', res.status);
      return [];
    }

    const json = await res.json() as { incidents: TTIncident[] };
    const hazards: HazardEvent[] = [];

    for (const inc of (json.incidents ?? [])) {
      const cat  = inc.properties?.iconCategory ?? 0;
      const type = CATEGORY_MAP[cat];
      if (!type) continue;

      // Extract lat/lng from geometry
      let incLat: number | null = null;
      let incLng: number | null = null;
      const coords = inc.geometry?.coordinates;
      if (Array.isArray(coords) && typeof coords[0] === 'number') {
        incLng = coords[0] as number;
        incLat = coords[1] as number;
      } else if (Array.isArray(coords) && Array.isArray(coords[0])) {
        incLng = (coords[0] as number[])[0];
        incLat = (coords[0] as number[])[1];
      }
      if (incLat === null || incLng === null) continue;

      const expiresAt = inc.properties?.endTime
        ?? new Date(Date.now() + HAZARD_META[type].expiryMs).toISOString();

      hazards.push({
        id:             `tt_${inc.id}`,
        type,
        lat:            incLat,
        lng:            incLng,
        source:         'tomtom',
        confirmedCount: 1,
        deniedCount:    0,
        reportedAt:     inc.properties?.startTime ?? new Date().toISOString(),
        expiresAt,
      });
    }
    return hazards;
  } catch (err) {
    console.warn('[TomTom] fetch failed:', err);
    return [];
  }
}

function buildBbox(lat: number, lng: number, radiusM: number): string {
  const latOff = radiusM / 111_000;
  const lngOff = radiusM / (111_000 * Math.cos(lat * Math.PI / 180));
  // TomTom bbox: minLng,minLat,maxLng,maxLat
  return `${(lng - lngOff).toFixed(6)},${(lat - latOff).toFixed(6)},${(lng + lngOff).toFixed(6)},${(lat + latOff).toFixed(6)}`;
}
