/**
 * weather.ts — Roger AI Weather Intelligence
 *
 * Primary: Google Weather API (requires VITE_GOOGLE_MAPS_API_KEY)
 * Fallback: Open-Meteo API (free, no API key required)
 *
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
  // ── Google Weather extras (null when falling back to Open-Meteo) ──
  uvIndex?:       number;     // 0–11+
  dewPointC?:     number;
  visibilityKm?:  number;
  pressureHPa?:   number;
  feelsLikeC?:    number;     // apparent temperature
  isDaytime?:     boolean;
}

// ── Google Weather condition → emoji + description mapping ────────────────────
const GOOGLE_CONDITION_MAP: Record<string, { description: string; icon: string; iconName: string }> = {
  CLEAR:                 { description: 'Clear skies',         icon: '☀️',  iconName: 'weather-clear' },
  MOSTLY_CLEAR:          { description: 'Mostly clear',        icon: '🌤️', iconName: 'weather-mostly-clear' },
  PARTLY_CLOUDY:         { description: 'Partly cloudy',       icon: '⛅',  iconName: 'weather-partly-cloudy' },
  MOSTLY_CLOUDY:         { description: 'Mostly cloudy',       icon: '🌥️', iconName: 'weather-mostly-cloudy' },
  CLOUDY:                { description: 'Cloudy',              icon: '☁️',  iconName: 'weather-overcast' },
  FOGGY:                 { description: 'Foggy',               icon: '🌫️', iconName: 'weather-fog' },
  LIGHT_RAIN:            { description: 'Light rain',          icon: '🌦️', iconName: 'weather-drizzle' },
  RAIN:                  { description: 'Rain',                icon: '🌧️', iconName: 'weather-rain' },
  HEAVY_RAIN:            { description: 'Heavy rain',          icon: '🌧️', iconName: 'weather-rain' },
  SNOW:                  { description: 'Snow',                icon: '❄️',  iconName: 'weather-snow' },
  LIGHT_SNOW:            { description: 'Light snow',          icon: '🌨️', iconName: 'weather-snow-light' },
  HEAVY_SNOW:            { description: 'Heavy snowfall',      icon: '❄️',  iconName: 'weather-snow' },
  HAIL:                  { description: 'Hail',                icon: '🌨️', iconName: 'weather-snow' },
  THUNDERSTORM:          { description: 'Thunderstorm',        icon: '⛈️',  iconName: 'weather-storm' },
  TORNADO:               { description: 'Tornado',             icon: '🌪️', iconName: 'weather-storm' },
  DUST:                  { description: 'Dusty',               icon: '🌫️', iconName: 'weather-fog' },
  SANDSTORM:             { description: 'Sandstorm',           icon: '🌫️', iconName: 'weather-fog' },
  WINDY:                 { description: 'Windy',               icon: '💨',  iconName: 'weather-clear' },
  DRIZZLE:               { description: 'Drizzle',             icon: '🌦️', iconName: 'weather-drizzle' },
  FREEZING_RAIN:         { description: 'Freezing rain',       icon: '🌧️', iconName: 'weather-rain' },
  BLOWING_SNOW:          { description: 'Blowing snow',        icon: '🌨️', iconName: 'weather-snow-light' },
  ICE_PELLETS:           { description: 'Ice pellets',         icon: '🌨️', iconName: 'weather-snow' },
};

// WMO Weather Interpretation Codes → description + emoji + iconName (Open-Meteo fallback)
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

const GOOGLE_API_KEY = (typeof import.meta !== 'undefined')
  ? (import.meta as { env?: Record<string, string> }).env?.VITE_GOOGLE_MAPS_API_KEY ?? ''
  : '';

// ─── Google Weather API fetch ────────────────────────────────────────────────
async function fetchGoogleWeather(lat: number, lng: number, city?: string): Promise<WeatherData | null> {
  if (!GOOGLE_API_KEY) return null;

  try {
    const url = `https://weather.googleapis.com/v1/currentConditions:lookup?key=${GOOGLE_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: { latitude: lat, longitude: lng },
      }),
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      temperature?:         { degrees: number };
      feelsLike?:           { degrees: number };
      humidity?:            number;
      isDaytime?:           boolean;
      weatherCondition?:    string;
      wind?:                { speed: { value: number } };
      uvIndex?:             number;
      dewPoint?:            { degrees: number };
      visibility?:          { distance: number };
      pressure?:            { meanSeaLevel: number };
    };

    const conditionKey = data.weatherCondition ?? '';
    const condInfo = GOOGLE_CONDITION_MAP[conditionKey]
      ?? { description: conditionKey.replace(/_/g, ' ').toLowerCase(), icon: '🌡️', iconName: 'weather-unknown' };

    const tempC = Math.round(data.temperature?.degrees ?? 0);

    return {
      tempC,
      description:  condInfo.description,
      icon:         condInfo.icon,
      iconName:     condInfo.iconName,
      humidity:     data.humidity ?? 0,
      windKph:      Math.round(data.wind?.speed?.value ?? 0),
      feelsLike:    getFeelsLike(tempC),
      city,
      // Google-specific extras
      uvIndex:      data.uvIndex,
      feelsLikeC:   data.feelsLike ? Math.round(data.feelsLike.degrees) : undefined,
      dewPointC:    data.dewPoint ? Math.round(data.dewPoint.degrees) : undefined,
      visibilityKm: data.visibility ? Math.round(data.visibility.distance / 1000) : undefined,
      pressureHPa:  data.pressure ? Math.round(data.pressure.meanSeaLevel) : undefined,
      isDaytime:    data.isDaytime,
    };
  } catch {
    return null;
  }
}

// ─── Open-Meteo fallback fetch ───────────────────────────────────────────────
async function fetchOpenMeteoWeather(lat: number, lng: number, city?: string): Promise<WeatherData | null> {
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

    return {
      tempC:       Math.round(c.temperature_2m),
      description: wmo.description,
      icon:        wmo.icon,
      iconName:    wmo.iconName,
      humidity:    Math.round(c.relative_humidity_2m),
      windKph:     Math.round(c.windspeed_10m),
      feelsLike:   getFeelsLike(c.temperature_2m),
      city,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches current weather for a GPS coordinate.
 * Primary: Google Weather API (requires API key with Weather API enabled).
 * Fallback: Open-Meteo (free, no key required).
 * Results are cached for 10 minutes.
 * Returns null gracefully on any network or parsing error.
 */
export async function fetchWeather(lat: number, lng: number, city?: string): Promise<WeatherData | null> {
  // Round to 2dp — avoids cache misses from GPS noise at the same location
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...cached.data, city };
  }

  // Try Google first, fall back to Open-Meteo
  let result = await fetchGoogleWeather(lat, lng, city);
  if (!result) {
    result = await fetchOpenMeteoWeather(lat, lng, city);
  }

  if (result) {
    _cache.set(key, { data: result, ts: Date.now() });
  }
  return result;
}


/**
 * Formats weather data into a concise string for GPT-5.5 context injection.
 */
export function weatherToContextString(w: WeatherData): string {
  let s = `${w.icon} ${w.tempC}°C, ${w.description}, Humidity ${w.humidity}%, Wind ${w.windKph} kph`;
  if (w.uvIndex !== undefined) s += `, UV ${w.uvIndex}`;
  if (w.feelsLikeC !== undefined) s += `, Feels ${w.feelsLikeC}°C`;
  if (w.city) s += ` · ${w.city}`;
  return s;
}
