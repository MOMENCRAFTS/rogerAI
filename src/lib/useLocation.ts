/**
 * useLocation.ts — Roger AI Location Awareness
 *
 * Watches the user's GPS position using the browser Geolocation API.
 * Reverse-geocodes to a human-readable city using OpenStreetMap Nominatim (free).
 * Writes the location to:
 *   1. Supabase `user_location` table (for Edge Functions to use)
 *   2. memory_graph as a `location` fact (so Roger can reference it in speech)
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
  city?:     string;
  country?:  string;
}

async function reverseGeocode(lat: number, lng: number): Promise<{ city?: string; country?: string }> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json() as {
      address?: { city?: string; town?: string; village?: string; county?: string; country?: string };
    };
    const city = data.address?.city ?? data.address?.town ?? data.address?.village ?? data.address?.county;
    return { city, country: data.address?.country };
  } catch {
    return {};
  }
}

export function useLocation(userId: string): {
  location: UserLocation | null;
  locationLabel: string;
  permissionState: 'unknown' | 'granted' | 'denied' | 'unsupported';
} {
  const [location, setLocation]   = useState<UserLocation | null>(null);
  const [permState, setPermState] = useState<'unknown' | 'granted' | 'denied' | 'unsupported'>('unknown');
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setPermState('unsupported');
      return;
    }

    const onSuccess = async (pos: GeolocationPosition) => {
      setPermState('granted');
      const { latitude, longitude, accuracy } = pos.coords;

      // Reverse geocode (throttled — only if moved significantly)
      const geo = await reverseGeocode(latitude, longitude);
      const loc: UserLocation = { latitude, longitude, accuracy, ...geo };
      setLocation(loc);

      // Persist to Supabase user_location table
      upsertUserLocation(userId, { latitude, longitude, city: geo.city, country: geo.country, accuracy_m: accuracy }).catch(() => {});

      // Write to memory_graph so GPT-4o knows location
      if (geo.city) {
        upsertMemoryFact({
          user_id: userId,
          fact_type: 'location',
          subject: 'user',
          predicate: 'current location is',
          object: geo.country ? `${geo.city}, ${geo.country}` : geo.city,
          confidence: 90,
          source_tx: 'geolocation',
          is_confirmed: true,
        }).catch(() => {});
      }
    };

    const onError = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) setPermState('denied');
    };

    // High accuracy, watch for updates every ~60s
    watchId.current = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60_000,
    });

    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [userId]);

  const locationLabel = location?.city
    ? (location.country ? `${location.city}, ${location.country}` : location.city)
    : permState === 'denied' ? 'Location denied'
    : permState === 'unsupported' ? 'GPS unavailable'
    : 'Locating...';

  return { location, locationLabel, permissionState: permState };
}
