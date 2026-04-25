/**
 * islamicApi.ts — Islamic Mode API helpers for Roger AI
 *
 * Sources used (all free, no API key required):
 *  - AlAdhan.com  — prayer times by lat/lng
 *  - AlQuran.cloud — verse of the day
 *  - Qibla direction — computed locally from GPS bearing math
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PrayerTimes {
  Fajr: string;
  Sunrise: string;
  Dhuhr: string;
  Asr: string;
  Maghrib: string;
  Isha: string;
}

export interface NextPrayer {
  name: string;        // 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha'
  timeStr: string;     // '17:32'
  secondsUntil: number;
}

export interface VerseOfDay {
  arabic: string;
  transliteration: string;
  translation: string;
  ref: string;         // 'Al-Baqarah 2:286'
}

// ── Prayer Times ──────────────────────────────────────────────────────────────

/**
 * Fetch today's prayer times from AlAdhan for the given coordinates.
 * Method 3 = Muslim World League (default), also common: 2=ISNA, 5=Egypt, 4=Makkah
 */
export async function fetchPrayerTimes(
  lat: number,
  lng: number,
  method = 3,
): Promise<PrayerTimes> {
  const today = new Date();
  const d = today.getDate();
  const m = today.getMonth() + 1;
  const y = today.getFullYear();

  const url = `https://api.aladhan.com/v1/timings/${d}-${m}-${y}?latitude=${lat}&longitude=${lng}&method=${method}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`AlAdhan error: ${res.status}`);
  const json = await res.json() as {
    data: { timings: Record<string, string> };
  };

  const t = json.data.timings;
  return {
    Fajr:    stripSeconds(t.Fajr),
    Sunrise: stripSeconds(t.Sunrise),
    Dhuhr:   stripSeconds(t.Dhuhr),
    Asr:     stripSeconds(t.Asr),
    Maghrib: stripSeconds(t.Maghrib),
    Isha:    stripSeconds(t.Isha),
  };
}

function stripSeconds(t: string): string {
  // AlAdhan returns 'HH:MM (timezone)' or 'HH:MM' — keep HH:MM only
  return t.slice(0, 5);
}

// ── Next Prayer Computation ───────────────────────────────────────────────────

const PRAYER_ORDER: (keyof PrayerTimes)[] = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

export function getNextPrayer(times: PrayerTimes): NextPrayer {
  const now      = new Date();
  const nowSecs  = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  for (const name of PRAYER_ORDER) {
    const [h, min] = times[name].split(':').map(Number);
    const prayerSecs = h * 3600 + min * 60;
    if (prayerSecs > nowSecs) {
      return { name, timeStr: times[name], secondsUntil: prayerSecs - nowSecs };
    }
  }
  // Past Isha — next is tomorrow's Fajr
  const [h, min] = times.Fajr.split(':').map(Number);
  const fajrSecs = h * 3600 + min * 60;
  return {
    name: 'Fajr',
    timeStr: times.Fajr,
    secondsUntil: (86400 - nowSecs) + fajrSecs,
  };
}

/** Returns the prayer currently active (started but not yet replaced by next) */
export function getCurrentPrayer(times: PrayerTimes): string | null {
  const now     = new Date();
  const nowSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  for (let i = PRAYER_ORDER.length - 1; i >= 0; i--) {
    const name = PRAYER_ORDER[i];
    const [h, min] = times[name].split(':').map(Number);
    const prayerSecs = h * 3600 + min * 60;
    if (nowSecs >= prayerSecs) return name;
  }
  return null;
}

// ── Qibla Direction ───────────────────────────────────────────────────────────

const KAABA_LAT =  21.4225;
const KAABA_LNG =  39.8262;

/**
 * Returns the bearing (0–360°, 0=North, 90=East) from the given
 * coordinates toward the Kaaba in Makkah.
 * Uses the standard great-circle bearing formula.
 */
export function getQiblaDirection(lat: number, lng: number): number {
  const φ1 = toRad(lat);
  const φ2 = toRad(KAABA_LAT);
  const Δλ = toRad(KAABA_LNG - lng);

  const x = Math.sin(Δλ) * Math.cos(φ2);
  const y = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  const bearing = (toDeg(Math.atan2(x, y)) + 360) % 360;
  return Math.round(bearing);
}

function toRad(deg: number) { return (deg * Math.PI) / 180; }
function toDeg(rad: number) { return (rad * 180) / Math.PI; }

/** Human-readable compass direction from bearing */
export function bearingToCardinal(bearing: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(bearing / 45) % 8];
}

// ── Verse of the Day ──────────────────────────────────────────────────────────

// A curated list of commonly recited / well-known ayat used as fallbacks
// and cycled daily by day-of-year when the API is unavailable.
const FALLBACK_VERSES: VerseOfDay[] = [
  {
    arabic: 'لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا',
    transliteration: 'Lā yukallifu llāhu nafsan illā wusʿahā',
    translation: 'Allah does not burden a soul beyond that it can bear.',
    ref: 'Al-Baqarah 2:286',
  },
  {
    arabic: 'إِنَّ مَعَ الْعُسْرِ يُسْرًا',
    transliteration: 'Inna maʿa l-ʿusri yusrā',
    translation: 'Verily, with hardship comes ease.',
    ref: 'Ash-Sharh 94:6',
  },
  {
    arabic: 'وَتَوَكَّلْ عَلَى اللَّهِ ۚ وَكَفَىٰ بِاللَّهِ وَكِيلًا',
    transliteration: 'Wa tawakkal ʿalā llāh, wa kafā billāhi wakīlā',
    translation: 'Put your trust in Allah, and sufficient is Allah as a disposer of affairs.',
    ref: 'Al-Ahzab 33:3',
  },
  {
    arabic: 'فَاذْكُرُونِي أَذْكُرْكُمْ',
    transliteration: 'Fadhkurūnī adhkurkum',
    translation: 'Remember Me; I will remember you.',
    ref: 'Al-Baqarah 2:152',
  },
  {
    arabic: 'وَإِذَا سَأَلَكَ عِبَادِي عَنِّي فَإِنِّي قَرِيبٌ',
    transliteration: "Wa idhā sa'alaka ʿibādī ʿannī fa'innī qarīb",
    translation: 'And when My servants ask you about Me — indeed I am near.',
    ref: 'Al-Baqarah 2:186',
  },
  {
    arabic: 'حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ',
    transliteration: 'Ḥasbunā llāhu wa niʿma l-wakīl',
    translation: 'Sufficient for us is Allah, and He is the best Disposer of affairs.',
    ref: 'Al-Imran 3:173',
  },
  {
    arabic: 'إِنَّ اللَّهَ مَعَ الصَّابِرِينَ',
    transliteration: 'Inna llāha maʿa ṣ-ṣābirīn',
    translation: 'Indeed, Allah is with the patient.',
    ref: 'Al-Baqarah 2:153',
  },
];

export async function fetchVerseOfDay(): Promise<VerseOfDay> {
  const dayOfYear = getDayOfYear();
  // Cycle through fallbacks — always available, no network needed
  return FALLBACK_VERSES[dayOfYear % FALLBACK_VERSES.length];
}

function getDayOfYear(): number {
  const now   = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff  = now.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// ── Prayer method labels ──────────────────────────────────────────────────────

export const PRAYER_METHODS: { id: number; label: string }[] = [
  { id: 3,  label: 'Muslim World League' },
  { id: 2,  label: 'ISNA (North America)' },
  { id: 4,  label: 'Umm Al-Qura (Makkah)' },
  { id: 5,  label: 'Egyptian Authority' },
];

// ── Format helpers ────────────────────────────────────────────────────────────

export function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
