/**
 * orientationTranslate.ts — Robust dynamic translation system for orientation chapters.
 *
 * Uses GPT to translate chapter content into the user's chosen language,
 * with aggressive caching, quality validation gates, pre-warming, and
 * graceful fallback to English.
 */

import { getAuthToken } from './getAuthToken';
import { getCurrentLocale, getBaseLanguage, type Locale } from './i18n';
import { DIALECT_CONFIG } from './translations/dialects';
import { ORIENTATION_VERSION, type OrientationChapter } from './orientationScript';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

// ── Types ───────────────────────────────────────────────────────────────────

export interface TranslatedChapter {
  headline: string;
  body: string;
  rogerSpeech: string;
  confirmPrompt: string;
  keyExamples: string[];
  tip: string | null;
}

interface CachedChapter extends TranslatedChapter {
  _cachedAt: string;
  _version: number;
}

// ── Cache helpers ───────────────────────────────────────────────────────────

function cacheKey(locale: Locale, chapterId: string): string {
  return `roger_orient_v${ORIENTATION_VERSION}_${locale}_${chapterId}`;
}

function readCache(locale: Locale, chapterId: string): TranslatedChapter | null {
  try {
    const raw = localStorage.getItem(cacheKey(locale, chapterId));
    if (!raw) return null;
    const parsed: CachedChapter = JSON.parse(raw);
    if (parsed._version !== ORIENTATION_VERSION) {
      localStorage.removeItem(cacheKey(locale, chapterId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(locale: Locale, chapterId: string, data: TranslatedChapter): void {
  try {
    const entry: CachedChapter = {
      ...data,
      _cachedAt: new Date().toISOString(),
      _version: ORIENTATION_VERSION,
    };
    localStorage.setItem(cacheKey(locale, chapterId), JSON.stringify(entry));
  } catch {
    console.warn('[OrientationTranslate] Cache write failed');
  }
}

// ── Validation gates ────────────────────────────────────────────────────────

const REQUIRED_FIELDS: (keyof TranslatedChapter)[] = [
  'headline', 'body', 'rogerSpeech', 'confirmPrompt', 'keyExamples',
];

function validateTranslation(
  translated: TranslatedChapter,
  original: { rogerSpeech: string },
  locale: Locale,
): { valid: boolean; reason?: string } {
  // Gate 1: Non-empty — all required fields present and length > 10
  for (const field of REQUIRED_FIELDS) {
    const val = translated[field];
    if (field === 'keyExamples') {
      if (!Array.isArray(val) || val.length === 0) {
        return { valid: false, reason: `Missing or empty field: ${field}` };
      }
    } else if (typeof val !== 'string' || val.length < 10) {
      return { valid: false, reason: `Field too short or missing: ${field} (length: ${typeof val === 'string' ? val.length : 0})` };
    }
  }

  // Gate 2: Script detection
  const base = getBaseLanguage(locale);
  const speech = translated.rogerSpeech;
  if (base === 'ar') {
    // Must contain Arabic characters
    if (!/[\u0600-\u06FF]/.test(speech)) {
      return { valid: false, reason: 'Arabic locale but rogerSpeech contains no Arabic characters' };
    }
  } else if (base === 'fr') {
    // Must contain some French-specific characters
    if (!/[éèêëàâçùûôïîœæ]/i.test(speech)) {
      return { valid: false, reason: 'French locale but rogerSpeech contains no French accented characters' };
    }
  } else if (base === 'es') {
    // Must contain some Spanish-specific characters
    if (!/[ñáéíóúü¿¡]/i.test(speech)) {
      return { valid: false, reason: 'Spanish locale but rogerSpeech contains no Spanish-specific characters' };
    }
  }

  // Gate 3: Length ratio — translated speech should be 40%–200% of original
  const ratio = speech.length / original.rogerSpeech.length;
  if (ratio < 0.4 || ratio > 2.0) {
    return { valid: false, reason: `Length ratio out of bounds: ${(ratio * 100).toFixed(0)}% (expected 40%–200%)` };
  }

  // Gate 4: Already checked via JSON.parse in caller

  // Gate 5: English leak check (soft gate — warn only)
  if (base !== 'en') {
    const words = speech.split(/\s+/);
    const asciiWords = words.filter(w => /^[a-zA-Z]+$/.test(w));
    // Exclude known proper nouns
    const PROPER_NOUNS = new Set(['roger', 'ptt', 'push', 'talk', 'gps', 'api', 'whisper', 'ai', 'ok', 'commander']);
    const leakedWords = asciiWords.filter(w => !PROPER_NOUNS.has(w.toLowerCase()));
    const leakRatio = leakedWords.length / Math.max(words.length, 1);
    if (leakRatio > 0.20) {
      console.warn(`[OrientationTranslate] WARN: English leak detected (${(leakRatio * 100).toFixed(0)}% ASCII words)`);
      // Soft gate — accept but warn
    }
  }

  return { valid: true };
}

// ── Translation prompt builder ──────────────────────────────────────────────

function buildTranslationPrompt(locale: Locale): string {
  const base = getBaseLanguage(locale);
  const dc = DIALECT_CONFIG[locale];
  const langName = base === 'ar' ? 'Arabic' : base === 'fr' ? 'French' : base === 'es' ? 'Spanish' : 'English';

  return `You are a professional translator for Roger AI — a voice-first military-style AI chief of staff.

TRANSLATION RULES:
1. Translate the following English orientation chapter into ${langName} (${dc?.displayName ?? locale}).
2. Preserve Roger's military-aide tone: direct, confident, no filler.
3. ${dc?.aiPersonality ?? ''}
4. Keep proper nouns unchanged: "Roger", "PTT", "Push to Talk".
5. Keep technical terms recognizable: "GPS", "Whisper", "API" stay as-is.
6. Match the original length ±50%. Do not add or remove content.
7. ${base === 'ar' ? 'Write in Arabic script. Never transliterate.' : ''}
8. Return ONLY a JSON object with the translated fields. No explanation, no markdown.

Translate ALL of these fields into ${langName}:`;
}

// ── LLM call (reuses process-transmission edge function) ────────────────────

async function callTranslationLLM(system: string, user: string): Promise<string> {
  const token = await getAuthToken().catch(() => null);
  if (!token) throw new Error('No auth token');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/process-transmission`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ _direct_prompt: true, system, user }),
  });

  if (!res.ok) {
    throw new Error(`Translation LLM HTTP ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const content = typeof data.roger_response === 'string' ? data.roger_response : '';
  if (!content) throw new Error('Translation LLM returned empty content');
  return content;
}

// ── Core translation function ───────────────────────────────────────────────

async function translateChapter(
  chapter: OrientationChapter,
  locale: Locale,
): Promise<TranslatedChapter> {
  const system = buildTranslationPrompt(locale);
  const payload = JSON.stringify({
    headline: chapter.headline,
    body: chapter.body,
    rogerSpeech: chapter.rogerSpeech(),
    confirmPrompt: chapter.confirmPrompt,
    keyExamples: chapter.keyExamples,
    tip: chapter.tip ?? null,
  }, null, 2);

  const raw = await callTranslationLLM(system, payload);

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
  const parsed = JSON.parse(cleaned) as TranslatedChapter;

  // Ensure keyExamples is array
  if (!Array.isArray(parsed.keyExamples)) {
    parsed.keyExamples = [];
  }

  return parsed;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get a translated orientation chapter. Uses cache first, then GPT, with validation and retry.
 * Falls back to English original on any failure.
 */
export async function getTranslatedChapter(
  chapter: OrientationChapter,
  locale: Locale,
  userName?: string,
): Promise<TranslatedChapter> {
  const base = getBaseLanguage(locale);

  // English = return original directly (no translation needed)
  if (base === 'en') {
    return {
      headline: chapter.headline,
      body: chapter.body,
      rogerSpeech: chapter.rogerSpeech(userName),
      confirmPrompt: chapter.confirmPrompt,
      keyExamples: chapter.keyExamples,
      tip: chapter.tip ?? null,
    };
  }

  // Check cache first
  const cached = readCache(locale, chapter.id);
  if (cached) {
    console.log(`[OrientationTranslate] Cache HIT: ${chapter.id} (${locale})`);
    // Inject user name into cached speech
    if (userName && cached.rogerSpeech) {
      cached.rogerSpeech = cached.rogerSpeech.replace(/\{name\}/g, userName);
    }
    return cached;
  }

  console.log(`[OrientationTranslate] Cache MISS: ${chapter.id} (${locale}) — translating...`);

  const originalSpeech = chapter.rogerSpeech(userName);

  // Attempt 1
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const translated = await translateChapter(chapter, locale);
      const validation = validateTranslation(translated, { rogerSpeech: originalSpeech }, locale);

      if (validation.valid) {
        writeCache(locale, chapter.id, translated);
        console.log(`[OrientationTranslate] ✓ Translated: ${chapter.id} (${locale}) [attempt ${attempt}]`);
        return translated;
      } else {
        console.warn(`[OrientationTranslate] Validation FAILED (attempt ${attempt}): ${validation.reason}`);
        if (attempt === 2) break; // Don't retry after 2nd attempt
      }
    } catch (err) {
      console.warn(`[OrientationTranslate] Translation ERROR (attempt ${attempt}):`, err);
      if (attempt === 2) break;
    }
  }

  // FALLBACK: Return English original (never blank)
  console.warn(`[OrientationTranslate] FALLBACK to English: ${chapter.id}`);
  return {
    headline: chapter.headline,
    body: chapter.body,
    rogerSpeech: originalSpeech,
    confirmPrompt: chapter.confirmPrompt,
    keyExamples: chapter.keyExamples,
    tip: chapter.tip ?? null,
  };
}

/**
 * Pre-warm translation cache for upcoming chapters.
 * Fire-and-forget — failures are silently logged.
 */
export function prewarmChapters(
  chapters: OrientationChapter[],
  locale: Locale,
  startIndex: number,
): void {
  const base = getBaseLanguage(locale);
  if (base === 'en') return; // No translation needed for English

  const remaining = chapters.slice(startIndex);
  if (remaining.length === 0) return;

  console.log(`[OrientationTranslate] Pre-warming ${remaining.length} chapters from index ${startIndex}...`);

  // Batch in groups of 4 to avoid overwhelming the API
  const BATCH_SIZE = 4;
  let batchIndex = 0;

  function processBatch() {
    const batch = remaining.slice(batchIndex, batchIndex + BATCH_SIZE);
    if (batch.length === 0) return;

    const promises = batch.map(ch => {
      // Skip if already cached
      if (readCache(locale, ch.id)) return Promise.resolve();
      return getTranslatedChapter(ch, locale).catch(err => {
        console.warn(`[OrientationTranslate] Pre-warm failed for ${ch.id}:`, err);
      });
    });

    Promise.allSettled(promises).then(() => {
      batchIndex += BATCH_SIZE;
      if (batchIndex < remaining.length) {
        // Small delay between batches
        setTimeout(processBatch, 500);
      }
    });
  }

  // Start the first batch after a brief delay (let chapter 1 render first)
  setTimeout(processBatch, 1000);
}

/**
 * Clear all cached translations (e.g. on language change).
 */
export function clearTranslationCache(): void {
  try {
    const keys = Object.keys(localStorage);
    let cleared = 0;
    for (const key of keys) {
      if (key.startsWith('roger_orient_v')) {
        localStorage.removeItem(key);
        cleared++;
      }
    }
    console.log(`[OrientationTranslate] Cleared ${cleared} cached translations`);
  } catch {
    console.warn('[OrientationTranslate] Cache clear failed');
  }
}
