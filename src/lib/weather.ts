/**
 * weather.ts — Roger AI Weather Intelligence
 *
 * Uses the Open-Meteo API (free, no API key required).
 * Fetches current conditions for a lat/lng and returns a
 * structured WeatherData object ready for GPT-5.5 injection and UI display.
 */

export interface WeatherData {
  tempC:       number;   // e.g. 29
  description: string;  // e.g. "Clear skies"
  humidity:    number;  // 0–100
  windKph:     number;
  icon:        string;  // emoji (kept for GPT context injection)
  iconName:    string;  // RogerIcon name for UI rendering
  feelsLike:   string;  // "Hot" | "Warm" | "Comfortable" | "Cool" | "Cold"
  city?:       string;  // passed through from caller if available
}

// WMO Weather Interpretation Codes → description + emoji + iconName
// https://open-meteo.com/en/docs#weathervariables
const WMO_MAP: Record<number, { description: string; icon: string; iconName: string }> = {
  0:  { description: 'Clear skies',         icon: '☀️',  iconName: 'weather-clear' },
  1:  { description: 'Mainly clear',        icon: '🌤️', iconName: 'weather-mostly-clear' },
  2:  { description: 'Partly cloudy',       icon: '⛅',  iconName: 'weather-partly-cloudy' },
  3:  { description: 'Overcast',            icon: '☁️',  iconName: 'weather-overcast' },
  45: { description: 'Foggy',               icon: '🌫️', iconName: 'weather-fog' },
  48: { description: 'Icy fog',             icon: '🌫️', iconName: 'weather-fog' },
  51: { description: 'Light drizzle',       icon: '🌦️', iconName: 'weather-drizzle' },
  53: { description: 'Drizzle',             icon: '🌦️', iconName: 'weather-drizzle' },
  55: { description: 'Heavy drizzle',       icon: '🌧️', iconName: 'weather-rain' },
  61: { description: 'Light rain',          icon: '🌧️', iconName: 'weather-rain' },
  63: { description: 'Moderate rain',       icon: '🌧️', iconName: 'weather-rain' },
  65: { description: 'Heavy rain',          icon: '🌧️', iconName: 'weather-rain' },
  71: { description: 'Light snow',          icon: '🌨️', iconName: 'weather-snow-light' },
  73: { description: 'Moderate snow',       icon: '❄️',  iconName: 'weather-snow' },
  75: { description: 'Heavy snowfall',      icon: '❄️',  iconName: 'weather-snow' },
  77: { description: 'Snow grains',         icon: '🌨️', iconName: 'weather-snow-light' },
  80: { description: 'Light showers',       icon: '🌦️', iconName: 'weather-drizzle' },
  81: { description: 'Moderate showers',    icon: '🌧️', iconName: 'weather-rain' },
  82: { description: 'Violent showers',     icon: '⛈️',  iconName: 'weather-storm' },
  85: { description: 'Snow showers',        icon: '🌨️', iconName: 'weather-snow-light' },
  86: { description: 'Heavy snow showers',  icon: '❄️',  iconName: 'weather-snow' },
  95: { description: 'Thunderstorm',        icon: '⛈️',  iconName: 'weather-storm' },
  96: { description: 'Thunderstorm + hail', icon: '⛈️',  iconName: 'weather-storm' },
  99: { description: 'Thunderstorm + hail', icon: '⛈️',  iconName: 'weather-storm' },
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

    const wmo = WMO_MAP[c.weathercode] ?? { description: 'Unknown conditions', icon: '🌡️', iconName: 'weather-unknown' };

    const result: WeatherData = {
      tempC:       Math.round(c.temperature_2m),
      description: wmo.description,
      icon:        wmo.icon,
      iconName:    wmo.iconName,
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
 * Formats weather data into a concise string for GPT-5.5 context injection.
 */
export function weatherToContextString(w: WeatherData): string {
  return `${w.icon} ${w.tempC}°C, ${w.description}, Humidity ${w.humidity}%, Wind ${w.windKph} kph${w.city ? ` · ${w.city}` : ''}`;
}
