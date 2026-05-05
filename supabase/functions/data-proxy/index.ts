// supabase/functions/data-proxy/index.ts
// Secure server-side proxy for third-party data APIs.
// Keeps API keys in Supabase secrets — never exposed to the client.
// Supports: NewsAPI, Finnhub, AviationStack, TomTom.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const NEWS_API_KEY         = Deno.env.get('NEWS_API_KEY') ?? '';
const FINNHUB_API_KEY      = Deno.env.get('FINNHUB_API_KEY') ?? '';
const AVIATIONSTACK_API_KEY = Deno.env.get('AVIATIONSTACK_API_KEY') ?? '';
const TOMTOM_API_KEY       = Deno.env.get('TOMTOM_API_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Auth helper ───────────────────────────────────────────────────────────────

async function verifyAuth(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return null; // Auth passed
}

// ── News API ──────────────────────────────────────────────────────────────────

async function handleNews(params: Record<string, string>): Promise<unknown> {
  if (!NEWS_API_KEY) throw new Error('NEWS_API_KEY not configured in Supabase secrets');

  const { endpoint = 'top-headlines', q, country = 'us', category, pageSize = '5' } = params;
  const qs = new URLSearchParams({ apiKey: NEWS_API_KEY });

  if (endpoint === 'everything') {
    if (q) qs.set('q', q);
    qs.set('pageSize', pageSize);
    qs.set('sortBy', 'publishedAt');
  } else {
    qs.set('country', country);
    if (category) qs.set('category', category);
    qs.set('pageSize', pageSize);
  }

  const url = `https://newsapi.org/v2/${endpoint}?${qs.toString()}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== 'ok') throw new Error(data.message ?? `NewsAPI error: ${res.status}`);
  return data;
}

// ── Finnhub (Finance) ─────────────────────────────────────────────────────────

async function handleFinance(params: Record<string, string>): Promise<unknown> {
  if (!FINNHUB_API_KEY) throw new Error('FINNHUB_API_KEY not configured in Supabase secrets');

  const { action = 'quote', symbol, q } = params;
  const BASE = 'https://finnhub.io/api/v1';

  if (action === 'quote') {
    if (!symbol) throw new Error('symbol required for stock quote');
    const res = await fetch(`${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`);
    if (!res.ok) throw new Error(`Finnhub error: ${res.status}`);
    return await res.json();
  }

  if (action === 'search') {
    if (!q) throw new Error('q required for symbol search');
    const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}&token=${FINNHUB_API_KEY}`);
    if (!res.ok) throw new Error(`Finnhub error: ${res.status}`);
    return await res.json();
  }

  if (action === 'candles') {
    if (!symbol) throw new Error('symbol required for candles');
    const resolution = params.resolution ?? 'D';
    const to = params.to ?? String(Math.floor(Date.now() / 1000));
    const from = params.from ?? String(Math.floor(Date.now() / 1000) - 30 * 86400);
    const res = await fetch(`${BASE}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`);
    if (!res.ok) throw new Error(`Finnhub error: ${res.status}`);
    return await res.json();
  }

  throw new Error(`Unknown finance action: ${action}`);
}

// ── AviationStack (Flights) ───────────────────────────────────────────────────

async function handleFlight(params: Record<string, string>): Promise<unknown> {
  if (!AVIATIONSTACK_API_KEY) throw new Error('AVIATIONSTACK_API_KEY not configured in Supabase secrets');

  const { flight_iata } = params;
  if (!flight_iata) throw new Error('flight_iata required');

  // Use HTTPS server-side (free tier only supports HTTP from browser, but server-side HTTPS works)
  const res = await fetch(
    `http://api.aviationstack.com/v1/flights?access_key=${AVIATIONSTACK_API_KEY}&flight_iata=${encodeURIComponent(flight_iata)}`
  );
  if (!res.ok) throw new Error(`AviationStack error: ${res.status}`);
  return await res.json();
}

// ── TomTom (Traffic) ──────────────────────────────────────────────────────────

async function handleTraffic(params: Record<string, string>): Promise<unknown> {
  if (!TOMTOM_API_KEY) throw new Error('TOMTOM_API_KEY not configured in Supabase secrets');

  const { bbox, lat, lng, radius = '5000' } = params;

  // Bounding box: "minLon,minLat,maxLon,maxLat"
  let url: string;
  if (bbox) {
    url = `https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=${bbox}&key=${TOMTOM_API_KEY}&fields={incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers}}}`;
  } else if (lat && lng) {
    // Point + radius mode — convert to bbox approximation
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    const r = parseFloat(radius) / 111320; // rough degrees
    const minLon = lngN - r;
    const minLat = latN - r;
    const maxLon = lngN + r;
    const maxLat = latN + r;
    url = `https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=${minLon},${minLat},${maxLon},${maxLat}&key=${TOMTOM_API_KEY}&fields={incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers}}}`;
  } else {
    throw new Error('bbox or lat+lng required for traffic query');
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`TomTom error: ${res.status}`);
  return await res.json();
}

// ── Main Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Auth check
  const authError = await verifyAuth(req);
  if (authError) return authError;

  try {
    const body = await req.json() as { action: string; params?: Record<string, string> };
    const { action, params = {} } = body;

    let result: unknown;

    switch (action) {
      case 'news':
        result = await handleNews(params);
        break;
      case 'finance':
        result = await handleFinance(params);
        break;
      case 'flight':
        result = await handleFlight(params);
        break;
      case 'traffic':
        result = await handleTraffic(params);
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
