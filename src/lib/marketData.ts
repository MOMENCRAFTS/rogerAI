// ─── Market Data Library ──────────────────────────────────────────────────────
// Fetches live market data (gold, crypto, forex, etc.) via OpenAI web search
// and caches results in localStorage with a 30-minute TTL.

const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const CACHE_KEY        = 'roger:market_data';
const CACHE_TTL_MS     = 30 * 60 * 1000; // 30 minutes

export interface GoldData {
  karat24: number;
  karat22: number;
  karat18: number;
  currency: string;
  trend7d: number[];  // ~7 values, oldest first
  updatedAt: string;
}

export interface CryptoAsset {
  symbol: string;
  name: string;
  price: number;
  change24hPct: number;
  trend7d: number[];  // ~7 values, oldest first
}

export interface ForexRate {
  pair: string;   // e.g. "USD/SAR"
  rate: number;
  change24hPct: number;
}

export interface WeatherDay {
  day: string;       // e.g. "Wed"
  high: number;
  low: number;
  icon: string;      // emoji
  description: string;
}

export interface MarketData {
  gold?: GoldData;
  crypto?: CryptoAsset[];
  forex?: ForexRate[];
  weather5d?: WeatherDay[];
  fetchedAt: string;
  error?: string;
}

interface CacheEntry {
  data: MarketData;
  ts: number;
}

// ── Cache helpers ──────────────────────────────────────────────────────────────

export function getCachedMarketData(): MarketData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
    return entry.data;
  } catch { return null; }
}

export function setCachedMarketData(data: MarketData): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() } satisfies CacheEntry));
  } catch { /* storage full, skip */ }
}

export function clearMarketCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

export function cacheAgeMinutes(): number {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return Infinity;
    const entry: CacheEntry = JSON.parse(raw);
    return Math.round((Date.now() - entry.ts) / 60000);
  } catch { return Infinity; }
}
// ── In-flight deduplication guard ─────────────────────────────────────────────
// Prevents duplicate GPT web-search calls when the Market tab opens rapidly
// or the component remounts within the same request window.
let _inflight: Promise<MarketData> | null = null;

// ── 5-day weather forecast via Open-Meteo (free, no key) ─────────────────────

const WMO_ICON: Record<number, [string, string]> = {
  0:  ['☀️', 'Clear sky'],  1:  ['🌤️', 'Mainly clear'], 2:  ['⛅', 'Partly cloudy'],
  3:  ['☁️', 'Overcast'],   45: ['🌫️', 'Foggy'],        48: ['🌫️', 'Foggy'],
  51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'],  55: ['🌧️', 'Heavy drizzle'],
  61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'],        65: ['🌧️', 'Heavy rain'],
  71: ['🌨️', 'Light snow'], 73: ['❄️', 'Snow'],         75: ['❄️', 'Heavy snow'],
  80: ['🌦️', 'Showers'],   81: ['🌧️', 'Showers'],      82: ['⛈️', 'Violent showers'],
  95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm'], 99: ['⛈️', 'Thunderstorm'],
};

export async function fetchWeatherForecast(lat: number, lng: number): Promise<WeatherDay[]> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto&forecast_days=5`;
  const res  = await fetch(url);
  const data = await res.json() as {
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      weathercode: number[];
    };
  };
  return data.daily.time.map((dateStr, i) => {
    const d    = new Date(dateStr);
    const code = data.daily.weathercode[i] ?? 0;
    const [icon, description] = WMO_ICON[code] ?? ['🌡️', 'Unknown'];
    return {
      day: d.toLocaleDateString('en', { weekday: 'short' }),
      high: Math.round(data.daily.temperature_2m_max[i]),
      low:  Math.round(data.daily.temperature_2m_min[i]),
      icon,
      description,
    };
  });
}

// ── Live market data via OpenAI web search ─────────────────────────────────────

const MARKET_SYSTEM = `You are a financial data assistant. Search the web for current, real-time market data.
Return ONLY valid JSON matching the schema below. No prose, no markdown, just JSON.

Schema:
{
  "gold": {
    "karat24": <number — SAR per gram>,
    "karat22": <number — SAR per gram>,
    "karat18": <number — SAR per gram>,
    "currency": "SAR",
    "trend7d": [<7 approximate daily prices, oldest first, 24K SAR>]
  },
  "crypto": [
    { "symbol": "BTC", "name": "Bitcoin",  "price": <USD>, "change24hPct": <±number>, "trend7d": [<7 prices>] },
    { "symbol": "ETH", "name": "Ethereum", "price": <USD>, "change24hPct": <±number>, "trend7d": [<7 prices>] },
    { "symbol": "SOL", "name": "Solana",   "price": <USD>, "change24hPct": <±number>, "trend7d": [<7 prices>] }
  ],
  "forex": [
    { "pair": "USD/SAR", "rate": <number>, "change24hPct": <±number> },
    { "pair": "EUR/SAR", "rate": <number>, "change24hPct": <±number> }
  ]
}

For trend7d: provide 7 approximate values showing the general trend. Exact precision not required — the shape matters.
If you cannot find data for a field, use null for that top-level key.`;

const MARKET_USER = `Search the web right now for:
1. Current gold price in Saudi Riyal (SAR) per gram for 24K, 22K, 18K karats, and approximate 7-day trend
2. Current Bitcoin, Ethereum, Solana prices in USD with 24h change % and 7-day trend
3. Current USD/SAR and EUR/SAR exchange rates

Return the JSON schema above with real current data. Today is ${new Date().toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;

export async function fetchMarketData(
  interests: string[],
  lat?: number,
  lng?: number,
  authToken?: string
): Promise<MarketData> {
  // Return the in-flight promise if one is already running
  if (_inflight) return _inflight;

  _inflight = _doFetchMarketData(interests, lat, lng, authToken).finally(() => {
    _inflight = null;
  });
  return _inflight;
}

async function _doFetchMarketData(
  interests: string[],
  lat?: number,
  lng?: number,
  authToken?: string
): Promise<MarketData> {
  const now = new Date().toISOString();

  // Determine which assets to fetch based on user interests
  const wantsGold   = interests.length === 0 || interests.some(i => /gold|ذهب/i.test(i));
  const wantsCrypto = interests.length === 0 || interests.some(i => /crypto|bitcoin|btc|eth|sol|ethereum|solana/i.test(i));
  const wantsForex  = interests.some(i => /forex|exchange|currency|usd|sar|eur/i.test(i));

  const token = authToken || SUPABASE_ANON_KEY;

  // Fetch weather forecast and market data in parallel
  const weatherPromise = (lat && lng) ? fetchWeatherForecast(lat, lng).catch(() => undefined) : Promise.resolve(undefined);

  let gold: GoldData | undefined;
  let crypto: CryptoAsset[] | undefined;
  let forex: ForexRate[] | undefined;

  if (wantsGold || wantsCrypto || wantsForex) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25_000);

      const fetchResult = await fetch(`${SUPABASE_URL}/functions/v1/process-transmission`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          signal: controller.signal,
          body: JSON.stringify({
            _web_search: true,
            system: MARKET_SYSTEM,
            user: MARKET_USER,
          }),
        });
      clearTimeout(timer);

      const raw = await fetchResult.json() as { roger_response?: string };
      const text = raw.roger_response ?? '';

      // Parse the JSON — GPT should return pure JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          gold?: GoldData;
          crypto?: CryptoAsset[];
          forex?: ForexRate[];
        };
        if (wantsGold   && parsed.gold)   gold   = { ...parsed.gold,   updatedAt: now };
        if (wantsCrypto && parsed.crypto) crypto = parsed.crypto;
        if (wantsForex  && parsed.forex)  forex  = parsed.forex;
      }
    } catch { /* best effort */ }
  }

  const weather5d = await weatherPromise;

  const data: MarketData = {
    gold,
    crypto,
    forex,
    weather5d,
    fetchedAt: now,
  };

  setCachedMarketData(data);
  return data;
}
