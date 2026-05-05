// ─── Roger AI — Commute ETA Edge Function ─────────────────────────────────────
// Calculates commute time/distance from user's current location to their
// saved destinations (home, office, etc.) using the Google Routes API
// (Compute Route Matrix — replacement for legacy Distance Matrix API).
//
// Deploy: supabase functions deploy commute-eta --no-verify-jwt
//
// Request body:
//   { origin: { lat: number, lng: number }, destinations: { label: string, address: string }[] }
// Response:
//   { results: { label: string, address: string, durationText: string, durationSeconds: number,
//                distanceText: string, distanceMeters: number, status: string }[] }

const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;

interface Destination { label: string; address: string; }
interface RequestBody {
  origin: { lat: number; lng: number };
  destinations: Destination[];
  mode?: 'driving' | 'walking' | 'transit';
  userId?: string;
}

// ─── Routes API types ─────────────────────────────────────────────────────────
interface RouteMatrixElement {
  originIndex:      number;
  destinationIndex: number;
  status?:          { code: number; message: string };
  condition?:       string; // "ROUTE_EXISTS" or "ROUTE_NOT_FOUND"
  duration?:        string; // "1234s" format
  distanceMeters?:  number;
  staticDuration?:  string; // without traffic
}

// ─── Travel mode mapping ──────────────────────────────────────────────────────
const ROUTE_MODE_MAP: Record<string, string> = {
  driving: 'DRIVE',
  walking: 'WALK',
  transit: 'TRANSIT',
};

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse Google duration string "1234s" → seconds */
function parseDuration(d?: string): number | null {
  if (!d) return null;
  const match = d.match(/^(\d+)s$/);
  return match ? parseInt(match[1], 10) : null;
}

/** Format seconds into human-readable "23 min" or "1 hr 5 min" */
function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs} hr ${rem} min` : `${hrs} hr`;
}

/** Format metres into human-readable "3.2 km" or "450 m" */
function formatDistance(meters: number | null): string {
  if (meters === null) return '—';
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body: RequestBody = await req.json();
    const { origin, destinations, mode = 'driving', userId } = body;

    if (!origin?.lat || !origin?.lng || !destinations?.length) {
      return new Response(JSON.stringify({ error: 'Missing origin or destinations' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const travelMode = ROUTE_MODE_MAP[mode] ?? 'DRIVE';

    // ── Build Routes API request body ───────────────────────────────────────
    const routeMatrixBody = {
      origins: [{
        waypoint: {
          location: {
            latLng: { latitude: origin.lat, longitude: origin.lng },
          },
        },
      }],
      destinations: destinations.map(d => ({
        waypoint: { address: d.address },
      })),
      travelMode,
      routingPreference: travelMode === 'DRIVE' ? 'TRAFFIC_AWARE' : undefined,
    };

    // ── Call Routes API ─────────────────────────────────────────────────────
    const url = `https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`;

    const gmRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Goog-Api-Key':   GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition,status',
      },
      body: JSON.stringify(routeMatrixBody),
    });

    if (!gmRes.ok) {
      const errText = await gmRes.text().catch(() => 'unknown');
      return new Response(JSON.stringify({ error: `Routes API error: ${gmRes.status} — ${errText}` }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Routes API returns an array of RouteMatrixElement (one per origin–dest pair)
    const elements = await gmRes.json() as RouteMatrixElement[];

    // ── Normalize response to match our existing client contract ────────────
    const results = destinations.map((dest, i) => {
      // Find the element for this destination
      const el = Array.isArray(elements)
        ? elements.find(e => e.destinationIndex === i)
        : undefined;

      if (!el || el.condition === 'ROUTE_NOT_FOUND' || el.status?.code) {
        return {
          label:           dest.label,
          address:         dest.address,
          status:          el?.status?.message ?? 'NOT_FOUND',
          durationText:    '—',
          durationSeconds: null,
          distanceText:    '—',
          distanceMeters:  null,
        };
      }

      const durationSeconds = parseDuration(el.duration);
      return {
        label:           dest.label,
        address:         dest.address,
        status:          'OK',
        durationText:    formatDuration(durationSeconds),
        durationSeconds,
        distanceText:    formatDistance(el.distanceMeters ?? null),
        distanceMeters:  el.distanceMeters ?? null,
      };
    });

    // ── Persist to Supabase (for morning briefing context) ──────────────────
    if (userId && SUPABASE_SERVICE_KEY && SUPABASE_URL) {
      try {
        const record = {
          user_id:    userId,
          origin_lat: origin.lat,
          origin_lng: origin.lng,
          mode,
          results:    JSON.stringify(results),
          fetched_at: new Date().toISOString(),
        };
        await fetch(`${SUPABASE_URL}/rest/v1/commute_snapshots`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'apikey':        SUPABASE_SERVICE_KEY,
            'Prefer':        'resolution=merge-duplicates',
          },
          body: JSON.stringify(record),
        });
      } catch { /* non-fatal */ }
    }

    return new Response(JSON.stringify({ ok: true, results, mode, fetchedAt: new Date().toISOString() }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
