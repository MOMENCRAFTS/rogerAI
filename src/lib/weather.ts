/**
 * weather.ts — Roger AI Weather Intelligence
 *
 * Uses the Open-Meteo API (free, no API key required).
 * Fetches current conditions for a lat/lng and returns a
 * structured WeatherData object ready for GPT-4o injection and UI display.
 */

export interface WeatherData {
  tempC:       number;   // e.g. 29
  description: string;  // e.g. "Clear skies"
  humidity:    number;  // 0–100
  windKph:     number;
  icon:        string;  // emoji
  feelsLike:   string;  // "Hot" | "Warm" | "Comfortable" | "Cool" | "Cold"
  city?:       string;  // passed through from caller if available
}

// WMO Weather Interpretation Codes → description + emoji
// https://open-meteo.com/en/docs#weathervariables
const WMO_MAP: Record<number, { description: string; icon: string }> = {
  0:  { description: 'Clear skies',         icon: '☀️' },
  1:  { description: 'Mainly clear',        icon: '🌤️' },
  2:  { description: 'Partly cloudy',       icon: '⛅' },
  3:  { description: 'Overcast',            icon: '☁️' },
  45: { description: 'Foggy',               icon: '🌫️' },
  48: { description: 'Icy fog',             icon: '🌫️' },
  51: { description: 'Light drizzle',       icon: '🌦️' },
  53: { description: 'Drizzle',             icon: '🌦️' },
  55: { description: 'Heavy drizzle',       icon: '🌧️' },
  61: { description: 'Light rain',          icon: '🌧️' },
  63: { description: 'Moderate rain',       icon: '🌧️' },
  65: { description: 'Heavy rain',          icon: '🌧️' },
  71: { description: 'Light snow',          icon: '🌨️' },
  73: { description: 'Moderate snow',       icon: '❄️' },
  75: { description: 'Heavy snowfall',      icon: '❄️' },
  77: { description: 'Snow grains',         icon: '🌨️' },
  80: { description: 'Light showers',       icon: '🌦️' },
  81: { description: 'Moderate showers',    icon: '🌧️' },
  82: { description: 'Violent showers',     icon: '⛈️' },
  85: { description: 'Snow showers',        icon: '🌨️' },
  86: { description: 'Heavy snow showers',  icon: '❄️' },
  95: { description: 'Thunderstorm',        icon: '⛈️' },
  96: { description: 'Thunderstorm + hail', icon: '⛈️' },
  99: { description: 'Thunderstorm + hail', icon: '⛈️' },
};

function getFeelsLike(tempC: number): string {
  if (tempC >= 38) return 'Extremely hot';
  if (tempC >= 30) return 'Hot';
  if (tempC >= 22) return 'Warm';
  if (tempC >= 15) return 'Comfortable';
  if (tempC >= 8)  return 'Cool';
  return 'Cold';
}

// ─── Weather cache — 10 min TTL, keyed by rounded lat/lng ────────────────────
const _cache = new Map<string, { data: WeatherData; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetches current weather for a GPS coordinate.
 * Uses Open-Meteo — completely free, no API key required.
 * Results are cached for 10 minutes to prevent 429 rate-limit errors.
 * Returns null gracefully on any network or parsing error.
 */
export async function fetchWeather(lat: number, lng: number, city?: string): Promise<WeatherData | null> {
  // Round to 2dp — avoids cache misses from GPS noise at the same location
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...cached.data, city };
  }

  try {
    const url = [
      'https://api.open-meteo.com/v1/forecast',
      `?latitude=${lat.toFixed(4)}`,
      `&longitude=${lng.toFixed(4)}`,
      '&current=temperature_2m,weathercode,windspeed_10m,relative_humidity_2m',
      '&temperature_unit=celsius',
      '&windspeed_unit=kmh',
      '&timezone=auto',
    ].join('');

    const res  = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json() as {
      current?: {
        temperature_2m:       number;
        weathercode:          number;
        windspeed_10m:        number;
        relative_humidity_2m: number;
      };
    };

    const c = data.current;
    if (!c) return null;

    const wmo = WMO_MAP[c.weathercode] ?? { description: 'Unknown conditions', icon: '🌡️' };

    const result: WeatherData = {
      tempC:       Math.round(c.temperature_2m),
      description: wmo.description,
      icon:        wmo.icon,
      humidity:    Math.round(c.relative_humidity_2m),
      windKph:     Math.round(c.windspeed_10m),
      feelsLike:   getFeelsLike(c.temperature_2m),
      city,
    };

    _cache.set(key, { data: result, ts: Date.now() });
    return result;
  } catch {
    return null; // Never interrupt the app — weather is best-effort
  }
}


/**
 * Formats weather data into a concise string for GPT-4o context injection.
 */
export function weatherToContextString(w: WeatherData): string {
  return `${w.icon} ${w.tempC}°C, ${w.description}, Humidity ${w.humidity}%, Wind ${w.windKph} kph${w.city ? ` · ${w.city}` : ''}`;
}
