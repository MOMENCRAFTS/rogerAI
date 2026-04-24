// useArrivalDebrief — fires a spoken debrief when the user arrives within
// 300m of their work or home address. Triggers at most once per location per day.

import { useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { fetchCommuteProfile, fetchErrands } from './api';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
const ARRIVAL_RADIUS_M    = 300; // metres — considered "arrived"

interface LatLng { lat: number; lng: number }
interface UserLocation { latitude: number; longitude: number }

// ─── Geocode a text address → lat/lng ────────────────────────────────────────
async function geocodeAddress(address: string): Promise<LatLng | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;
    const data = await fetch(url).then(r => r.json()) as { results?: { geometry?: { location?: LatLng } }[] };
    const loc = data.results?.[0]?.geometry?.location;
    return loc ?? null;
  } catch { return null; }
}

// ─── Haversine distance in metres ────────────────────────────────────────────
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toR = (d: number) => d * Math.PI / 180;
  const Δφ = toR(lat2 - lat1);
  const Δλ = toR(lng2 - lng1);
  const a = Math.sin(Δφ / 2) ** 2
           + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Main hook ────────────────────────────────────────────────────────────────
export function useArrivalDebrief(
  userId: string,
  location: UserLocation | null,
  onDebrief: (text: string) => void,
) {
  const workRef    = useRef<LatLng | null>(null);
  const homeRef    = useRef<LatLng | null>(null);
  const profileRef = useRef<{ work_address?: string | null; home_address?: string | null } | null>(null);
  const loadedRef  = useRef(false);

  // Load commute profile + geocode addresses once per mount
  useEffect(() => {
    if (!userId || loadedRef.current) return;
    loadedRef.current = true;

    fetchCommuteProfile(userId).then(async prof => {
      profileRef.current = prof;
      if (prof?.work_address) {
        workRef.current = await geocodeAddress(prof.work_address).catch(() => null);
      }
      if (prof?.home_address) {
        homeRef.current = await geocodeAddress(prof.home_address).catch(() => null);
      }
    }).catch(() => {});
  }, [userId]);

  // Watch location changes
  useEffect(() => {
    if (!location || !userId) return;
    const { latitude: lat, longitude: lng } = location;

    const check = async (dest: LatLng, type: 'work' | 'home') => {
      if (haversine(lat, lng, dest.lat, dest.lng) > ARRIVAL_RADIUS_M) return;

      // Deduplicate — once per type per day per user
      const key = `roger_arrival_${userId}_${type}_${new Date().toDateString()}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');

      const hour = new Date().getHours();

      // Parallel DB fetches
      const [errands, surfaceRes, tasksRes, relaysRes] = await Promise.allSettled([
        fetchErrands(userId, 'pending'),
        supabase.from('surface_items').select('id').eq('user_id', userId).eq('dismissed', false),
        supabase.from('tasks').select('id, text').eq('user_id', userId).eq('status', 'pending')
          .lte('due_date', new Date(new Date().setHours(23, 59, 59)).toISOString()).limit(5),
        supabase.from('relay_messages').select('id, sender_name').eq('recipient_id', userId)
          .eq('status', 'delivered').limit(5),
      ]);

      const errandList   = errands.status    === 'fulfilled' ? errands.value    : [];
      const surfaceItems = surfaceRes.status === 'fulfilled' ? (surfaceRes.value.data ?? []) : [];
      const tasks        = tasksRes.status   === 'fulfilled' ? (tasksRes.value.data   ?? []) : [];
      const relays       = relaysRes.status  === 'fulfilled' ? (relaysRes.value.data   ?? []) : [];

      const parts: string[] = [];

      if (type === 'work') {
        const greeting = hour < 12 ? 'morning' : 'afternoon';
        parts.push(`Good ${greeting}. You've arrived at the office.`);

        if (tasks.length > 0)
          parts.push(`${tasks.length} task${tasks.length > 1 ? 's' : ''} due today.`);

        if (relays.length > 0) {
          const names = [...new Set(relays.map(r => (r as { sender_name: string }).sender_name))]
            .slice(0, 2).join(' and ');
          parts.push(`${relays.length} message${relays.length > 1 ? 's' : ''} from ${names}.`);
        }

        if (surfaceItems.length > 0)
          parts.push(`${surfaceItems.length} item${surfaceItems.length > 1 ? 's' : ''} in your briefing queue.`);

        if (parts.length === 1)
          parts.push('Your slate is clear. Good start.');

        parts.push(`Say "brief me" for details. Over.`);

      } else {
        // Home arrival — evening wind-down
        parts.push('Welcome home.');

        if (errandList.length > 0)
          parts.push(`You have ${errandList.length} open errand${errandList.length > 1 ? 's' : ''} still on your list.`);

        if (tasks.length > 0)
          parts.push(`${tasks.length} task${tasks.length > 1 ? 's' : ''} still pending today.`);

        if (relays.length > 0)
          parts.push(`${relays.length} unread message${relays.length > 1 ? 's' : ''} waiting.`);

        if (parts.length === 1)
          parts.push(`Nothing urgent. Enjoy your evening.`);

        parts.push(`Roger signing off. Over.`);
      }

      onDebrief(parts.join(' '));
    };

    if (workRef.current) check(workRef.current, 'work').catch(() => {});
    if (homeRef.current) check(homeRef.current, 'home').catch(() => {});
  }, [location, userId, onDebrief]);
}
