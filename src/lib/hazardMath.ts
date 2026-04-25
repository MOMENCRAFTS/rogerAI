// ─── Roger Radar — Hazard Math Utilities ──────────────────────────────────────
// Pure functions: distance, bearing, merge dedup, expiry check.

import type { HazardEvent, HazardSource } from '../types/hazard';

/** Haversine distance in metres between two lat/lng points */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Compass bearing in degrees (0–360) from point A to point B */
export function bearingDegrees(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1R = lat1 * Math.PI / 180;
  const lat2R = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/** Convert bearing degrees to 2-letter cardinal label */
export function bearingToCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

/**
 * Annotate hazards with distance/bearing from user's current position.
 * Returns sorted by distanceM ascending.
 */
export function annotateAndSort(
  hazards: HazardEvent[],
  userLat: number,
  userLng: number,
): HazardEvent[] {
  return hazards
    .map(h => {
      const distanceM  = distanceMeters(userLat, userLng, h.lat, h.lng);
      const bearingDeg = bearingDegrees(userLat, userLng, h.lat, h.lng);
      return {
        ...h,
        distanceM,
        bearingDeg,
        bearingLabel: bearingToCardinal(bearingDeg),
      };
    })
    .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
}

/** True if hazard has expired */
export function isHazardExpired(h: HazardEvent): boolean {
  if (h.expiresAt && new Date(h.expiresAt) < new Date()) return true;
  // Community hazards auto-expire if denied by more than 3 people
  if (h.source === 'community' && h.deniedCount >= 3) return true;
  return false;
}

const MERGE_RADIUS_M = 60; // merge pins within 60m of each other

/**
 * Merge hazards from multiple sources into deduplicated pins.
 * - Two hazards of the SAME type within MERGE_RADIUS_M are merged.
 * - The community report takes precedence; extras become mergedSources.
 */
export function mergeHazardSources(...sourceLists: HazardEvent[][]): HazardEvent[] {
  const all = sourceLists.flat().filter(h => !isHazardExpired(h));
  const merged: HazardEvent[] = [];

  for (const candidate of all) {
    const existing = merged.find(m =>
      m.type === candidate.type &&
      distanceMeters(m.lat, m.lng, candidate.lat, candidate.lng) < MERGE_RADIUS_M
    );
    if (existing) {
      // Merge: accumulate sources, pick higher confirm count
      const existingSources: HazardSource[] = existing.mergedSources ?? [existing.source];
      if (!existingSources.includes(candidate.source)) {
        existing.mergedSources = [...existingSources, candidate.source];
        existing.confirmedCount = Math.max(existing.confirmedCount, candidate.confirmedCount);
      }
    } else {
      merged.push({ ...candidate });
    }
  }

  return merged;
}

/**
 * Convert polar coordinates (distance in m, bearing in deg) to SVG x/y
 * within a circle of given radiusPx centred at (cx, cy).
 * maxDistM defines what distance maps to the outer ring radius.
 */
export function polarToSVG(
  distanceM: number,
  bearingDeg: number,
  cx: number,
  cy: number,
  radiusPx: number,
  maxDistM: number,
): { x: number; y: number } {
  const r   = Math.min(distanceM / maxDistM, 1) * radiusPx;
  const rad = (bearingDeg - 90) * Math.PI / 180; // SVG 0° = right; compass 0° = up
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}
