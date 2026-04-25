// ─── Roger Radar — Hazard Types ───────────────────────────────────────────────

export type HazardType =
  | 'speed_cam'
  | 'police'
  | 'accident'
  | 'road_works'
  | 'debris'
  | 'flood'
  | 'closure';

export type HazardSource = 'community' | 'osm' | 'tomtom';

export interface HazardEvent {
  id:              string;
  type:            HazardType;
  lat:             number;
  lng:             number;
  source:          HazardSource;
  confirmedCount:  number;
  deniedCount:     number;
  reportedAt:      string;         // ISO timestamp
  expiresAt?:      string;
  // ── Calculated at runtime by useHazards ──
  distanceM?:      number;
  bearingDeg?:     number;
  bearingLabel?:   string;         // "NE", "SSW" etc.
  // ── Multi-source merge ──
  mergedSources?:  HazardSource[];
}

export const HAZARD_META: Record<HazardType, { icon: string; label: string; color: string; expiryMs: number }> = {
  speed_cam:  { icon: '📷', label: 'SPEED CAM',   color: '#d4a044', expiryMs: 60 * 60 * 1000 },
  police:     { icon: '🚔', label: 'POLICE',       color: '#ef4444', expiryMs: 60 * 60 * 1000 },
  accident:   { icon: '⚠️', label: 'ACCIDENT',     color: '#f97316', expiryMs: 4 * 60 * 60 * 1000 },
  road_works: { icon: '🚧', label: 'ROAD WORKS',   color: '#eab308', expiryMs: 24 * 60 * 60 * 1000 },
  debris:     { icon: '🪨', label: 'DEBRIS',        color: '#a78bfa', expiryMs: 2 * 60 * 60 * 1000 },
  flood:      { icon: '🌊', label: 'FLOOD',         color: '#3b82f6', expiryMs: 6 * 60 * 60 * 1000 },
  closure:    { icon: '🚫', label: 'ROAD CLOSED',   color: '#a84832', expiryMs: 24 * 60 * 60 * 1000 },
};
