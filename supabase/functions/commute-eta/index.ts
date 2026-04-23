// ─── Roger AI — Commute ETA Edge Function ─────────────────────────────────────
// Calculates commute time/distance from user's current location to their
// saved destinations (home, office, etc.) using Google Distance Matrix API.
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

interface DistanceMatrixRow {
  elements: {
    status: string;
    duration?: { text: string; value: number };
    duration_in_traffic?: { text: string; value: number };
    distance?: { text: string; value: number };
  }[];
}

interface DistanceMatrixResponse {
  status: string;
  rows: DistanceMatrixRow[];
  destination_addresses: string[];
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

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

    // Build destination string for Distance Matrix API
    const destAddresses = destinations.map(d => encodeURIComponent(d.address)).join('|');
    const originStr     = `${origin.lat},${origin.lng}`;
    const departureNow  = mode === 'driving' ? '&departure_time=now&traffic_model=best_guess' : '';

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json`
      + `?origins=${encodeURIComponent(originStr)}`
      + `&destinations=${destAddresses}`
      + `&mode=${mode}`
      + `&units=metric`
      + departureNow
      + `&key=${GOOGLE_MAPS_API_KEY}`;

    const gmRes  = await fetch(url);
    const gmData = await gmRes.json() as DistanceMatrixResponse;

    if (gmData.status !== 'OK') {
      return new Response(JSON.stringify({ error: `Google Maps error: ${gmData.status}` }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const row = gmData.rows[0];
    const results = destinations.map((dest, i) => {
      const el = row.elements[i];
      if (el.status !== 'OK') {
        return { label: dest.label, address: dest.address, status: el.status, durationText: '—', durationSeconds: null, distanceText: '—', distanceMeters: null };
      }
      // Prefer in-traffic duration for driving
      const duration = el.duration_in_traffic ?? el.duration;
      return {
        label:           dest.label,
        address:         dest.address,
        status:          'OK',
        durationText:    duration?.text   ?? '—',
        durationSeconds: duration?.value  ?? null,
        distanceText:    el.distance?.text  ?? '—',
        distanceMeters:  el.distance?.value ?? null,
        resolvedAddress: gmData.destination_addresses[i],
      };
    });

    // Persist to Supabase if userId provided (for morning briefing context)
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
