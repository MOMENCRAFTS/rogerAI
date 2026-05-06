/**
 * whisperHint.ts — Dynamic Whisper vocabulary hint builder.
 *
 * Combines ALL name/vocabulary sources into one prompt hint string:
 * 1. Device contacts (from deviceContacts.ts)
 * 2. Roger Network contacts (roger_contacts table)
 * 3. Memory graph person facts
 * 4. User's own display name
 * 5. Static vocabulary (brands, tools)
 * 6. Location vocabulary (cities from memory)
 *
 * The hint is cached for 5 minutes and truncated to ~800 chars
 * (~200 Whisper tokens — the practical prompt limit).
 */

import { fetchDeviceContacts, buildContactNameHint } from './deviceContacts';
import { supabase } from './supabase';

// ── Cache ─────────────────────────────────────────────────────────────────────

let _hintCache: string | null = null;
let _hintCacheTime = 0;
const HINT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Static Vocabulary ─────────────────────────────────────────────────────────

const STATIC_VOCAB = [
  // AI & Tools
  'ChatGPT', 'GPT', 'Gemini', 'Claude', 'Copilot', 'Notion', 'Slack',
  'Trello', 'Figma', 'Canva', 'Zoom', 'Teams', 'WhatsApp', 'Telegram',
  // Brands
  'Tesla', 'Apple', 'Google', 'Amazon', 'Microsoft', 'Meta', 'Netflix',
  'Spotify', 'Uber', 'Careem',
  // Roger-specific
  'Roger', 'Roger AI', 'PTT', 'Push to Talk', 'Tune In', 'Relay',
  'Morning Brief', 'Drive Mode', 'Radar', 'Memory Vault', 'Encyclopedia',
  // Locations (Gulf)
  'Dubai', 'Abu Dhabi', 'Sharjah', 'Riyadh', 'Jeddah', 'KAFD', 'DIFC',
  'Jumeirah', 'Al Ain', 'Doha', 'Bahrain', 'Kuwait', 'Muscat',
].join(', ');

// ── Main Builder ──────────────────────────────────────────────────────────────

/**
 * Build a comprehensive Whisper prompt hint for a specific user.
 * Combines device contacts, roger_contacts, memory graph, and static vocab.
 *
 * @param userId - Supabase user ID
 * @returns A comma-separated vocabulary string for Whisper prompt parameter
 */
export async function buildWhisperHint(userId: string): Promise<string> {
  // Return cache if fresh
  if (_hintCache && Date.now() - _hintCacheTime < HINT_CACHE_TTL) {
    return _hintCache;
  }

  const parts: string[] = [];

  // 1. Device contacts (may be empty on web or if permission denied)
  try {
    const deviceContacts = await fetchDeviceContacts();
    const contactHint = buildContactNameHint(deviceContacts);
    if (contactHint) parts.push(contactHint);
  } catch {
    // Graceful degradation — contacts unavailable
  }

  // 2. Roger Network contacts (from database)
  try {
    const { data: rogerContacts } = await supabase
      .from('roger_contacts')
      .select('display_name')
      .eq('user_id', userId)
      .limit(50);

    if (rogerContacts?.length) {
      const names = rogerContacts
        .map(c => (c as { display_name?: string }).display_name)
        .filter(Boolean);
      parts.push(names.join(', '));
    }
  } catch {
    // DB unavailable — skip
  }

  // 3. Memory graph — person entities + family + contacts + vehicles
  try {
    const { data: personFacts } = await supabase
      .from('memory_graph')
      .select('subject, object, predicate')
      .eq('user_id', userId)
      .in('fact_type', ['person', 'preference', 'relationship'])
      .limit(80);

    if (personFacts?.length) {
      const names = new Set<string>();
      for (const f of personFacts) {
        const fact = f as { subject?: string; object?: string; predicate?: string };
        // Add subject names (skip generic "user")
        if (fact.subject && fact.subject !== 'user') names.add(fact.subject);
        // Pull names from family/contact/vehicle facts stored in the object field
        if (fact.predicate?.includes('family') || fact.predicate?.includes('works with')
            || fact.predicate?.includes('spouse') || fact.predicate?.includes('child')
            || fact.predicate?.includes('wife') || fact.predicate?.includes('husband')
            || fact.predicate?.includes('drives') || fact.predicate?.includes('rides')) {
          if (fact.object) names.add(fact.object);
        }
      }
      const subjects = [...names];
      parts.push(subjects.join(', '));
    }
  } catch {
    // DB unavailable — skip
  }

  // 4. User's own display name
  try {
    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('display_name')
      .eq('user_id', userId)
      .maybeSingle();

    if ((prefs as { display_name?: string })?.display_name) {
      parts.push((prefs as { display_name: string }).display_name);
    }
  } catch {
    // Skip
  }

  // 5. Static vocabulary (always included)
  parts.push(STATIC_VOCAB);

  // Combine, de-duplicate, and truncate
  const allNames = parts.join(', ');
  const unique = [...new Set(
    allNames.split(',').map(s => s.trim()).filter(Boolean),
  )];
  const hint = unique.join(', ').substring(0, 800);

  _hintCache = hint;
  _hintCacheTime = Date.now();
  console.log(`[WhisperHint] Built hint: ${hint.length} chars, ${unique.length} terms`);

  return hint;
}

/** Force-refresh the hint cache (e.g., after contacts sync) */
export function invalidateWhisperHint(): void {
  _hintCache = null;
  _hintCacheTime = 0;
}
