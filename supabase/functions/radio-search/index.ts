// supabase/functions/radio-search/index.ts
// Server-side proxy for the Radio Browser API.
// Routes station search, click tracking, and rankings through Supabase
// to keep architecture consistent and enable future caching/analytics.

const USER_AGENT = 'RogerAI/1.0 (https://roger.ai)';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Known fallback servers (dynamic discovery preferred) ─────────────────────
const FALLBACK_SERVERS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
];

// Cached base URL for the lifetime of this function instance
let _cachedBaseUrl: string | null = null;

async function getBaseUrl(): Promise<string> {
  if (_cachedBaseUrl) return _cachedBaseUrl;

  // Try server discovery via /json/servers on a known fallback
  for (const fallback of FALLBACK_SERVERS) {
    try {
      const res = await fetch(`${fallback}/json/servers`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;

      const servers = await res.json() as { name: string; ip: string }[];
      if (servers.length > 0) {
        // Randomize and pick one
        const shuffled = servers.sort(() => Math.random() - 0.5);
        _cachedBaseUrl = `https://${shuffled[0].name}`;
        return _cachedBaseUrl;
      }
    } catch {
      // Try next fallback
    }
  }

  // All discovery failed — use a random fallback directly
  _cachedBaseUrl = FALLBACK_SERVERS[Math.floor(Math.random() * FALLBACK_SERVERS.length)];
  return _cachedBaseUrl;
}

async function radioBrowserRequest(path: string, params?: Record<string, string>): Promise<unknown> {
  const baseUrl = await getBaseUrl();
  const url = new URL(path, baseUrl);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    // Server might be down — invalidate cache and retry once
    _cachedBaseUrl = null;
    const retryBase = await getBaseUrl();
    const retryUrl = new URL(path, retryBase);
    if (params) {
      Object.entries(params).forEach(([k, v]) => retryUrl.searchParams.set(k, v));
    }
    const retryRes = await fetch(retryUrl.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    if (!retryRes.ok) throw new Error(`Radio Browser API error: ${retryRes.status}`);
    return retryRes.json();
  }

  return res.json();
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const action = body.action as string;

    if (!action) {
      return new Response(JSON.stringify({ error: 'action required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── SEARCH: Advanced multi-field station search ──────────────────────────
    if (action === 'search') {
      const filters = (body.filters ?? {}) as Record<string, unknown>;
      const params: Record<string, string> = {};

      // Map filters to API query params
      const ALLOWED_KEYS = [
        'name', 'nameExact', 'country', 'countryExact', 'countrycode',
        'state', 'stateExact', 'language', 'languageExact',
        'tag', 'tagExact', 'tagList', 'codec',
        'bitrateMin', 'bitrateMax', 'order', 'reverse',
        'offset', 'limit', 'hidebroken', 'has_geo_info',
        'geo_lat', 'geo_long',
      ];

      for (const key of ALLOWED_KEYS) {
        if (filters[key] !== undefined && filters[key] !== null) {
          params[key] = String(filters[key]);
        }
      }

      // Safety defaults
      if (!params.hidebroken) params.hidebroken = 'true';
      if (!params.limit) params.limit = '10';

      const stations = await radioBrowserRequest('/json/stations/search', params);
      return new Response(JSON.stringify({ stations }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── CLICK: Count a play for community stats ─────────────────────────────
    if (action === 'click') {
      const uuid = body.stationuuid as string;
      if (!uuid) {
        return new Response(JSON.stringify({ error: 'stationuuid required' }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      const result = await radioBrowserRequest(`/json/url/${uuid}`);
      return new Response(JSON.stringify(result), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── TOP: Ranked station lists ───────────────────────────────────────────
    if (action === 'top') {
      const type = (body.type as string) ?? 'clicks';
      const limit = String(body.limit ?? 10);

      const orderMap: Record<string, string> = {
        clicks:   'clickcount',
        votes:    'votes',
        trending: 'clicktrend',
      };

      const stations = await radioBrowserRequest('/json/stations/search', {
        order: orderMap[type] ?? 'clickcount',
        reverse: 'true',
        limit,
        hidebroken: 'true',
      });

      return new Response(JSON.stringify({ stations }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── NEARBY: Geo-proximity search ────────────────────────────────────────
    if (action === 'nearby') {
      const lat = body.lat as number;
      const lng = body.lng as number;
      const limit = String(body.limit ?? 10);

      if (lat == null || lng == null) {
        return new Response(JSON.stringify({ error: 'lat and lng required' }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      const stations = await radioBrowserRequest('/json/stations/search', {
        geo_lat: String(lat),
        geo_long: String(lng),
        order: 'clickcount',
        reverse: 'true',
        limit,
        hidebroken: 'true',
        has_geo_info: 'true',
      });

      return new Response(JSON.stringify({ stations }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
