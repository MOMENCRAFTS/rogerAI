// ─── OSM Overpass — Fixed Speed Cameras ───────────────────────────────────────
// Fetches highway=speed_camera nodes from OpenStreetMap Overpass API.
// Results are cached in sessionStorage by rounded bounding box to avoid
// hammering the free API. Cache TTL: 6 hours.

import type { HazardEvent } from '../types/hazard';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CacheEntry {
  data:      HazardEvent[];
  fetchedAt: number;
}

const _cache = new Map<string, CacheEntry>();

/** Round coordinate to ~1km grid for cache key */
function roundCoord(n: number, dp = 2): number {
  return Math.round(n * Math.pow(10, dp)) / Math.pow(10, dp);
}

function buildBbox(lat: number, lng: number, radiusM: number): string {
  const latOff = radiusM / 111_000;
  const lngOff = radiusM / (111_000 * Math.cos(lat * Math.PI / 180));
  return `${lat - latOff},${lng - lngOff},${lat + latOff},${lng + lngOff}`;
}

export async function fetchOSMCameras(
  lat: number,
  lng: number,
  radiusM = 1500,
): Promise<HazardEvent[]> {
  const key = `osm_${roundCoord(lat)}_${roundCoord(lng)}_${radiusM}`;

  const cached = _cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const bbox  = buildBbox(lat, lng, radiusM);
  const query = `[out:json][timeout:10];node["highway"="speed_camera"](${bbox});out body;`;

  try {
    const res = await fetch(OVERPASS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return [];

    const json = await res.json() as {
      elements: { id: number; lat: number; lon: number }[];
    };

    const hazards: HazardEvent[] = (json.elements ?? []).map(el => ({
      id:             `osm_${el.id}`,
      type:           'speed_cam' as const,
      lat:            el.lat,
      lng:            el.lon,
      source:         'osm' as const,
      confirmedCount: 1,
      deniedCount:    0,
      reportedAt:     new Date().toISOString(),
      expiresAt:      new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    }));

    _cache.set(key, { data: hazards, fetchedAt: Date.now() });
    return hazards;
  } catch {
    return [];
  }
}
