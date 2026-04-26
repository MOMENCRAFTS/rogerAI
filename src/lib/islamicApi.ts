/**
 * islamicApi.ts — Islamic Mode API helpers for Roger AI
 *
 * Single unified source: UmmahAPI.com
 *   - Prayer times, Quran, Hadith, Duas, 99 Names, Hijri Calendar, Islamic Events
 *   - Free, no API key required
 *   - Qibla direction computed locally from GPS bearing math
 */

const BASE = 'https://ummahapi.com/api';

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
  audioUrl?: string;   // ayah audio from Alafasy reciter
}

export interface HadithOfDay {
  arabic: string;
  english: string;
  collection: string;
  grade: string;
  id: string;
}

export interface DuaOfDay {
  arabic: string;
  transliteration: string;
  translation: string;
  source: string;
  category: string;
  title: string;
}

export interface NameOfAllah {
  number: number;
  arabic: string;
  transliteration: string;
  english: string;
  meaning: string;
}

export interface HijriDate {
  day: number;
  month: number;
  monthName: string;
  monthNameArabic: string;
  year: number;
  formatted: string;
}

export interface IslamicEvent {
  name: string;
  description: string;
}

// ── Daily Cache Helper ────────────────────────────────────────────────────────

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`roger_islamic_${key}_${todayKey()}`);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}

function setCache<T>(key: string, data: T): void {
  try {
    // Clean old keys for this endpoint
    const prefix = `roger_islamic_${key}_`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix) && !k.endsWith(todayKey())) {
        localStorage.removeItem(k);
      }
    }
    localStorage.setItem(`roger_islamic_${key}_${todayKey()}`, JSON.stringify(data));
  } catch { /* localStorage full — non-critical */ }
}

// ── Prayer Method Mapping (DB integer → UmmahAPI string) ──────────────────────

const METHOD_MAP: Record<number, string> = {
  2: 'NorthAmerica',      // ISNA
  3: 'MuslimWorldLeague',
  4: 'UmmAlQura',          // Makkah
  5: 'Egyptian',
};

function resolveMethod(method: number | string): string {
  if (typeof method === 'string') return method;
  return METHOD_MAP[method] ?? 'MuslimWorldLeague';
}

// ── Prayer Times ──────────────────────────────────────────────────────────────

/**
 * Fetch today's prayer times from UmmahAPI for the given coordinates.
 * Accepts either legacy integer method codes (2,3,4,5) or UmmahAPI string names.
 */
export async function fetchPrayerTimes(
  lat: number,
  lng: number,
  method: number | string = 3,
): Promise<PrayerTimes> {
  const m = resolveMethod(method);
  const url = `${BASE}/prayer-times?lat=${lat}&lng=${lng}&method=${m}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`UmmahAPI prayer-times error: ${res.status}`);
  const json = await res.json() as {
    data: { prayer_times: Record<string, string> };
  };

  const t = json.data.prayer_times;
  return {
    Fajr:    t.fajr    ?? '—',
    Sunrise: t.sunrise  ?? '—',
    Dhuhr:   t.dhuhr    ?? '—',
    Asr:     t.asr      ?? '—',
    Maghrib: t.maghrib  ?? '—',
    Isha:    t.isha     ?? '—',
  };
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

// ── Verse of the Day (Quran Random — cached per day) ──────────────────────────

// Hardcoded fallbacks for offline / API failure
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
  // Check daily cache first
  const cached = getCached<VerseOfDay>('verse');
  if (cached) return cached;

  try {
    const res = await fetch(`${BASE}/quran/random`);
    if (!res.ok) throw new Error(`UmmahAPI quran error: ${res.status}`);
    const json = await res.json() as {
      data: {
        surah: { name_arabic: string; name_english: string; number: number };
        verse: {
          ayah: number;
          arabic: string;
          transliteration: string;
          translations: { sahih_international: string };
        };
        audio: Array<{ reciter: string; ayah_audio: string }>;
      };
    };

    const d = json.data;
    const verse: VerseOfDay = {
      arabic: d.verse.arabic,
      transliteration: d.verse.transliteration,
      translation: d.verse.translations.sahih_international,
      ref: `${d.surah.name_english} ${d.surah.number}:${d.verse.ayah}`,
      audioUrl: d.audio?.[0]?.ayah_audio, // Alafasy reciter (first in list)
    };
    setCache('verse', verse);
    return verse;
  } catch {
    // Fallback to hardcoded verses
    const dayOfYear = getDayOfYear();
    return FALLBACK_VERSES[dayOfYear % FALLBACK_VERSES.length];
  }
}

// ── Hadith of the Day ─────────────────────────────────────────────────────────

export async function fetchHadithOfDay(): Promise<HadithOfDay | null> {
  const cached = getCached<HadithOfDay>('hadith');
  if (cached) return cached;

  try {
    const res = await fetch(`${BASE}/hadith/random`);
    if (!res.ok) return null;
    const json = await res.json() as {
      data: {
        id: string;
        collection_name: string;
        arabic: string;
        english: string;
        grade: string;
      };
    };
    const d = json.data;
    const hadith: HadithOfDay = {
      id: d.id,
      arabic: d.arabic,
      english: d.english,
      collection: d.collection_name,
      grade: d.grade,
    };
    setCache('hadith', hadith);
    return hadith;
  } catch { return null; }
}

// ── Dua of the Day ────────────────────────────────────────────────────────────

export async function fetchDuaOfDay(): Promise<DuaOfDay | null> {
  const cached = getCached<DuaOfDay>('dua');
  if (cached) return cached;

  try {
    const res = await fetch(`${BASE}/duas/random`);
    if (!res.ok) return null;
    const json = await res.json() as {
      data: {
        title: string;
        arabic: string;
        transliteration: string;
        translation: string;
        source: string;
        category_info: { name: string };
      };
    };
    const d = json.data;
    const dua: DuaOfDay = {
      title: d.title,
      arabic: d.arabic,
      transliteration: d.transliteration,
      translation: d.translation,
      source: d.source,
      category: d.category_info.name,
    };
    setCache('dua', dua);
    return dua;
  } catch { return null; }
}

// ── 99 Names of Allah ─────────────────────────────────────────────────────────

export async function fetchNameOfAllah(): Promise<NameOfAllah | null> {
  const cached = getCached<NameOfAllah>('name');
  if (cached) return cached;

  try {
    const res = await fetch(`${BASE}/asma-ul-husna/random`);
    if (!res.ok) return null;
    const json = await res.json() as {
      data: {
        name: {
          number: number;
          arabic: string;
          transliteration: string;
          english: string;
          meaning: string;
        };
      };
    };
    const d = json.data.name;
    const name: NameOfAllah = {
      number: d.number,
      arabic: d.arabic,
      transliteration: d.transliteration,
      english: d.english,
      meaning: d.meaning,
    };
    setCache('name', name);
    return name;
  } catch { return null; }
}

// ── Hijri Calendar ────────────────────────────────────────────────────────────

export async function fetchHijriDate(): Promise<HijriDate | null> {
  const cached = getCached<HijriDate>('hijri');
  if (cached) return cached;

  try {
    const res = await fetch(`${BASE}/today-hijri`);
    if (!res.ok) return null;
    const json = await res.json() as {
      data: {
        hijri: {
          day: number;
          month: number;
          month_name: string;
          month_name_arabic: string;
          year: number;
          formatted: string;
        };
      };
    };
    const h = json.data.hijri;
    const hijri: HijriDate = {
      day: h.day,
      month: h.month,
      monthName: h.month_name,
      monthNameArabic: h.month_name_arabic,
      year: h.year,
      formatted: h.formatted,
    };
    setCache('hijri', hijri);
    return hijri;
  } catch { return null; }
}

// ── Islamic Events ────────────────────────────────────────────────────────────

export async function fetchNextIslamicEvent(): Promise<IslamicEvent | null> {
  const cached = getCached<IslamicEvent>('event');
  if (cached) return cached;

  try {
    const res = await fetch(`${BASE}/islamic-events`);
    if (!res.ok) return null;
    const json = await res.json() as {
      data: {
        next_event: { name: string; hijri_date: string };
      };
    };
    const e = json.data.next_event;
    const event: IslamicEvent = {
      name: e.name,
      description: e.hijri_date,
    };
    setCache('event', event);
    return event;
  } catch { return null; }
}

// ── Prayer method labels (expanded to 22 UmmahAPI methods) ────────────────────

export const PRAYER_METHODS: { id: number; label: string; apiName: string }[] = [
  { id: 3,  label: 'Muslim World League',        apiName: 'MuslimWorldLeague' },
  { id: 2,  label: 'ISNA (North America)',        apiName: 'NorthAmerica' },
  { id: 4,  label: 'Umm Al-Qura (Makkah)',       apiName: 'UmmAlQura' },
  { id: 5,  label: 'Egyptian Authority',          apiName: 'Egyptian' },
  { id: 10, label: 'Karachi (Pakistan/India)',     apiName: 'Karachi' },
  { id: 11, label: 'Dubai',                       apiName: 'Dubai' },
  { id: 12, label: 'Kuwait',                      apiName: 'Kuwait' },
  { id: 13, label: 'Qatar',                       apiName: 'Qatar' },
  { id: 14, label: 'Singapore / Malaysia',         apiName: 'Singapore' },
  { id: 15, label: 'Turkey (Diyanet)',             apiName: 'Turkey' },
  { id: 16, label: 'Tehran',                      apiName: 'Tehran' },
  { id: 17, label: 'Morocco',                     apiName: 'Morocco' },
  { id: 18, label: 'Jordan',                      apiName: 'Jordan' },
  { id: 19, label: 'Moonsighting Committee',      apiName: 'MoonsightingCommittee' },
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

function getDayOfYear(): number {
  const now   = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff  = now.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
