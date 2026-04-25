/**
 * useLocation.ts — Roger AI Location Awareness
 *
 * Watches the user's GPS position using the browser Geolocation API.
 * Reverse-geocodes to a human-readable city using OpenStreetMap Nominatim (free).
 * Writes the location to:
 *   1. Supabase `user_location` table (for Edge Functions to use)
 *   2. memory_graph as a `location` fact (so Roger can reference it in speech)
 *
 * Throttling (fixes Nominatim 429 storm):
 *   - Nominatim is only called if device moved >50 m AND 90 s have elapsed.
 *   - user_location DB upsert is throttled to once every 30 s.
 *   - memory_graph is only written when the city actually changes.
 *
 * Usage:
 *   const { location, locationLabel } = useLocation(userId);
 */

import { useEffect, useRef, useState } from 'react';
import { upsertUserLocation, upsertMemoryFact } from './api';

export interface UserLocation {
  latitude:  number;
  longitude: number;
  accuracy:  number;
  speed?:    number;   // m/s (from Geolocation API)
  heading?:  number;  // degrees 0-360, NaN if no heading
  city?:     string;
  country?:  string;
}

// ─── Haversine distance (metres) ─────────────────────────────────────────────
function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Nominatim gate: 50 m movement + 90 s minimum gap ────────────────────────
const GEO_MIN_MOVE_M = 50;      // metres before we re-geocode
const GEO_MIN_GAP_MS = 90_000;  // 90 s minimum between Nominatim calls

let _lastGeoLat  = 0;
let _lastGeoLng  = 0;
let _lastGeoAt   = 0;
let _lastGeoCity = '';

async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<{ city?: string; country?: string } | null> {
  const now  = Date.now();
  const dist = haversineMetres(lat, lng, _lastGeoLat, _lastGeoLng);

  // Skip if not moved enough AND recently called
  if (dist < GEO_MIN_MOVE_M && now - _lastGeoAt < GEO_MIN_GAP_MS) return null;

  _lastGeoLat = lat;
  _lastGeoLng = lng;
  _lastGeoAt  = now;

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) return null; // silently swallow 429 / other errors
    const data = await res.json() as {
      address?: {
        city?: string; town?: string; village?: string;
        county?: string; country?: string;
      };
    };
    const city =
      data.address?.city ??
      data.address?.town ??
      data.address?.village ??
      data.address?.county;
    return { city, country: data.address?.country };
  } catch {
    return null;
  }
}

// ─── DB write gate: 30 s between user_location upserts ───────────────────────
const DB_MIN_GAP_MS = 30_000;
let _lastDbWrite = 0;

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useLocation(userId: string): {
  location:        UserLocation | null;
  locationLabel:   string;
  permissionState: 'unknown' | 'granted' | 'denied' | 'unsupported';
} {
  const [location,  setLocation]  = useState<UserLocation | null>(null);
  const [permState, setPermState] = useState<'unknown' | 'granted' | 'denied' | 'unsupported'>('unknown');
  const watchId      = useRef<number | null>(null);
  const locationRef  = useRef<UserLocation | null>(null); // stable ref for last known city

  useEffect(() => {
    if (!navigator.geolocation) {
      setPermState('unsupported');
      return;
    }

    const onSuccess = async (pos: GeolocationPosition) => {
      setPermState('granted');
      const { latitude, longitude, accuracy } = pos.coords;

      // Throttled geocode — returns null when gated
      const geo = await reverseGeocode(latitude, longitude);

      // Retain previous city/country if geocode was throttled
      const loc: UserLocation = {
        latitude, longitude, accuracy,
        speed:   pos.coords.speed   ?? undefined,
        heading: pos.coords.heading ?? undefined,
        city:    geo?.city    ?? locationRef.current?.city,
        country: geo?.country ?? locationRef.current?.country,
      };
      locationRef.current = loc;
      setLocation(loc);

      // Throttle Supabase upsert to once per 30 s
      const now = Date.now();
      if (now - _lastDbWrite >= DB_MIN_GAP_MS) {
        _lastDbWrite = now;
        upsertUserLocation(userId, {
          latitude,
          longitude,
          city:       loc.city,
          country:    loc.country,
          accuracy_m: accuracy,
        }).catch(() => {});
      }

      // Write to memory graph only when city actually changes
      if (geo?.city && geo.city !== _lastGeoCity) {
        _lastGeoCity = geo.city;
        upsertMemoryFact({
          user_id:      userId,
          fact_type:    'location',
          subject:      'user',
          predicate:    'current location is',
          object:       geo.country ? `${geo.city}, ${geo.country}` : geo.city,
          confidence:   90,
          source_tx:    'geolocation',
          is_confirmed: true,
        }).catch(() => {});
      }
    };

    const onError = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) setPermState('denied');
    };

    watchId.current = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      timeout:     15_000,
      maximumAge:  60_000,
    });

    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const locationLabel =
    location?.city
      ? location.country
        ? `${location.city}, ${location.country}`
        : location.city
      : permState === 'denied'
      ? 'Location denied'
      : permState === 'unsupported'
      ? 'GPS unavailable'
      : 'Locating...';

  return { location, locationLabel, permissionState: permState };
}
