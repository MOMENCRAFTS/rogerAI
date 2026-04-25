// ─── Roger Radar — useHazards Hook ────────────────────────────────────────────
// Fuses 3 data layers into a single sorted HazardEvent[] and drives TTS alerts.
//
// Layers:
//   1. Community (Supabase road_hazards + Realtime)
//   2. OSM Overpass (fixed speed cameras, 6h cache)
//   3. (Future: TomTom / HERE — add API key to .env.local)
//
// Proximity alert zones:
//   500m → awareness (pin appears on radar, no sound)
//   300m → warning  (TTS spoken alert)
//   200m → critical (full-screen overlay)
//   pass → clear    (TTS cleared)

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabase';
import { speakResponse } from './tts';
import { fetchOSMCameras } from './osmRadar';
import { fetchTomTomIncidents } from './tomtomRadar';
import { annotateAndSort, mergeHazardSources, isHazardExpired } from './hazardMath';
import { HAZARD_META } from '../types/hazard';
import type { HazardEvent, HazardType } from '../types/hazard';

export type { HazardEvent };

// ─── Supabase row shape ──────────────────────────────────────────────────────
interface DbHazardRow {
  id:              string;
  type:            HazardType;
  lat:             number;
  lng:             number;
  source:          string;
  confirmed_count: number;
  denied_count:    number;
  expires_at:      string | null;
  created_at:      string;
}

function rowToEvent(row: DbHazardRow): HazardEvent {
  return {
    id:             row.id,
    type:           row.type,
    lat:            row.lat,
    lng:            row.lng,
    source:         (row.source as HazardEvent['source']) ?? 'community',
    confirmedCount: row.confirmed_count,
    deniedCount:    row.denied_count,
    expiresAt:      row.expires_at ?? undefined,
    reportedAt:     row.created_at,
  };
}

// ─── Proximity thresholds ─────────────────────────────────────────────────────
const ZONE_WARN_M     = 300;
const ZONE_CRITICAL_M = 200;
const POLL_INTERVAL   = 90_000; // 90 s between full refreshes

// ─── Voice scripts ────────────────────────────────────────────────────────────
function warnScript(h: HazardEvent): string {
  const meta = HAZARD_META[h.type];
  const n    = h.confirmedCount > 1 ? `, confirmed by ${h.confirmedCount} users` : '';
  return `Warning — ${meta.label.toLowerCase()} ahead, approximately ${Math.round(h.distanceM ?? 0)} metres ${h.bearingLabel ?? ''}${n}.`;
}
function criticalScript(h: HazardEvent): string {
  const meta = HAZARD_META[h.type];
  return `Caution — ${meta.label.toLowerCase()} imminent. ${Math.round(h.distanceM ?? 0)} metres ${h.bearingLabel ?? ''}.`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export interface UseHazardsResult {
  hazards:      HazardEvent[];         // annotated + merged, sorted by distance
  alertHazard:  HazardEvent | null;    // current < 200m hazard for overlay
  loading:      boolean;
  reportHazard: (type: HazardType) => Promise<void>;
  voteHazard:   (id: string, vote: 'confirm' | 'deny') => Promise<void>;
  refresh:      () => void;
}

export function useHazards(
  userId: string,
  userLat: number | null,
  userLng: number | null,
): UseHazardsResult {
  const [communityHazards, setCommunityHazards] = useState<HazardEvent[]>([]);
  const [osmHazards,       setOsmHazards]       = useState<HazardEvent[]>([]);
  const [tomtomHazards,    setTomtomHazards]    = useState<HazardEvent[]>([]);
  const [hazards,          setHazards]           = useState<HazardEvent[]>([]);
  const [alertHazard,      setAlertHazard]       = useState<HazardEvent | null>(null);
  const [loading,          setLoading]           = useState(true);

  // Track which hazards have already been voiced to avoid repeat alerts
  const voicedWarn     = useRef<Set<string>>(new Set());
  const voicedCritical = useRef<Set<string>>(new Set());
  const clearedSet     = useRef<Set<string>>(new Set());

  // ── Fetch community hazards from Supabase ───────────────────────────────────
  const fetchCommunity = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('road_hazards')
        .select('*')
        .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // last 24h
        .order('created_at', { ascending: false })
        .limit(200);
      if (data) setCommunityHazards((data as DbHazardRow[]).map(rowToEvent));
    } catch { /* silent */ }
    finally    { setLoading(false); }
  }, []);

  // ── Fetch OSM fixed cameras ─────────────────────────────────────────────────
  const fetchOSM = useCallback(async () => {
    if (!userLat || !userLng) return;
    const cameras = await fetchOSMCameras(userLat, userLng, 1500);
    setOsmHazards(cameras);
  }, [userLat, userLng]);

  // ── Fetch TomTom live incidents ──────────────────────────────────────────────
  const fetchTomTom = useCallback(async () => {
    if (!userLat || !userLng) return;
    const incidents = await fetchTomTomIncidents(userLat, userLng, 1500);
    setTomtomHazards(incidents);
  }, [userLat, userLng]);

  // ── Initial load + polling ──────────────────────────────────────────────────
  useEffect(() => {
    fetchCommunity();
    fetchOSM();
    fetchTomTom();
    const interval = setInterval(() => { fetchCommunity(); fetchOSM(); fetchTomTom(); }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchCommunity, fetchOSM]);

  // ── Supabase Realtime — live community updates ──────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('road_hazards_live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'road_hazards' },
        (payload) => {
          const newHazard = rowToEvent(payload.new as DbHazardRow);
          if (!isHazardExpired(newHazard)) {
            setCommunityHazards(prev => [newHazard, ...prev.filter(h => h.id !== newHazard.id)]);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'road_hazards' },
        (payload) => {
          const updated = rowToEvent(payload.new as DbHazardRow);
          setCommunityHazards(prev =>
            isHazardExpired(updated)
              ? prev.filter(h => h.id !== updated.id)
              : prev.map(h => h.id === updated.id ? updated : h),
          );
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Merge + annotate whenever sources or position change ────────────────────
  useEffect(() => {
    if (!userLat || !userLng) {
      const raw = mergeHazardSources(communityHazards, osmHazards, tomtomHazards);
      setHazards(raw);
      return;
    }
    const merged   = mergeHazardSources(communityHazards, osmHazards, tomtomHazards);
    const annotated = annotateAndSort(merged, userLat, userLng);
    setHazards(annotated);

    // Proximity engine — voice alerts + overlay
    let newAlert: HazardEvent | null = null;

    for (const h of annotated) {
      const dist = h.distanceM ?? Infinity;

      if (dist <= ZONE_CRITICAL_M) {
        newAlert = h;
        if (!voicedCritical.current.has(h.id)) {
          voicedCritical.current.add(h.id);
          speakResponse(criticalScript(h)).catch(() => {});
        }
      } else if (dist <= ZONE_WARN_M) {
        if (!voicedWarn.current.has(h.id)) {
          voicedWarn.current.add(h.id);
          speakResponse(warnScript(h)).catch(() => {});
        }
      } else {
        // Passed this hazard — reset so it can alert again if user returns
        if ((voicedWarn.current.has(h.id) || voicedCritical.current.has(h.id))
          && !clearedSet.current.has(h.id) && dist > 400) {
          voicedWarn.current.delete(h.id);
          voicedCritical.current.delete(h.id);
          clearedSet.current.add(h.id);
          setTimeout(() => clearedSet.current.delete(h.id), 60_000);
        }
      }
    }
    setAlertHazard(newAlert);
  }, [communityHazards, osmHazards, tomtomHazards, userLat, userLng]);

  // ── Report a new hazard ─────────────────────────────────────────────────────
  const reportHazard = useCallback(async (type: HazardType) => {
    if (!userLat || !userLng) return;
    const meta = HAZARD_META[type];
    const expiresAt = new Date(Date.now() + meta.expiryMs).toISOString();

    await supabase.from('road_hazards').insert({
      type,
      lat:            userLat,
      lng:            userLng,
      reported_by:    userId || null,
      source:         'community',
      confirmed_count: 1,
      denied_count:   0,
      expires_at:     expiresAt,
    });
  }, [userId, userLat, userLng]);

  // ── Vote on existing hazard ─────────────────────────────────────────────────
  const voteHazard = useCallback(async (id: string, vote: 'confirm' | 'deny') => {
    const hazard = hazards.find(h => h.id === id);
    if (!hazard) return;

    if (vote === 'confirm') {
      await supabase.from('road_hazards')
        .update({ confirmed_count: hazard.confirmedCount + 1 })
        .eq('id', id);
    } else {
      await supabase.from('road_hazards')
        .update({ denied_count: hazard.deniedCount + 1 })
        .eq('id', id);
    }
  }, [hazards]);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchCommunity();
    fetchOSM();
    fetchTomTom();
  }, [fetchCommunity, fetchOSM]);

  return { hazards, alertHazard, loading, reportHazard, voteHazard, refresh };
}
