// ─── Roger AI — Dynamic Whisper Vocabulary Hint Builder ──────────────────────
// Builds context-aware vocabulary hints for Whisper transcription accuracy.
// Pulls names, entities, and domain terms from the user's own data.

import { supabase } from './supabase';

// ── Cache ─────────────────────────────────────────────────────────────────────
let _cachedHints: string | null = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build dynamic Whisper vocabulary hints from the user's data.
 * Returns a concatenated string of names, entities, and terms
 * to pass as the `prompt` parameter to Whisper.
 *
 * Cached for 5 minutes to avoid DB load on rapid PTT presses.
 */
export async function buildWhisperHints(userId: string): Promise<string> {
  // Return cached if fresh
  if (_cachedHints && Date.now() - _cachedAt < CACHE_TTL_MS) {
    return _cachedHints;
  }

  const parts: string[] = [];

  try {
    // 1. Contact names
    const { data: contacts } = await supabase
      .from('roger_contacts')
      .select('display_name')
      .eq('user_id', userId)
      .limit(50);

    if (contacts?.length) {
      const names = contacts
        .map(c => c.display_name)
        .filter(Boolean)
        .join(', ');
      parts.push(names);
    }

    // 2. Memory graph entities (high confidence subjects & objects)
    const { data: entities } = await supabase
      .from('memory_graph')
      .select('subject, object')
      .eq('user_id', userId)
      .gte('confidence', 0.7)
      .order('confidence', { ascending: false })
      .limit(30);

    if (entities?.length) {
      const entityNames = new Set<string>();
      for (const e of entities) {
        if (e.subject && e.subject.length > 2 && e.subject.length < 40) entityNames.add(e.subject);
        if (e.object && e.object.length > 2 && e.object.length < 40) entityNames.add(e.object);
      }
      parts.push([...entityNames].join(', '));
    }

    // 3. Task & reminder keywords
    const { data: tasks } = await supabase
      .from('tasks')
      .select('text')
      .eq('user_id', userId)
      .eq('status', 'open')
      .limit(10);

    if (tasks?.length) {
      // Extract key words from task text (first 3 words of each)
      const keywords = tasks
        .map(t => t.text.split(' ').slice(0, 3).join(' '))
        .join(', ');
      parts.push(keywords);
    }

    // 4. Smart home device names (from Tuya)
    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('display_name, smart_home_devices')
      .eq('user_id', userId)
      .maybeSingle();

    // Include user's own name
    if (prefs?.display_name) {
      parts.push(prefs.display_name);
    }

    // Include device names if stored
    if (prefs?.smart_home_devices && Array.isArray(prefs.smart_home_devices)) {
      const deviceNames = (prefs.smart_home_devices as { name: string }[])
        .map(d => d.name)
        .filter(Boolean)
        .join(', ');
      if (deviceNames) parts.push(deviceNames);
    }

  } catch (err) {
    console.warn('[whisperHintBuilder] Error building hints:', err);
    // Return partial or empty hints — never block transcription
  }

  // Whisper prompt has a soft limit around 224 tokens (~800 chars).
  // Truncate to stay safe.
  const combined = parts.filter(Boolean).join(', ');
  _cachedHints = combined.length > 700 ? combined.substring(0, 700) : combined;
  _cachedAt = Date.now();

  return _cachedHints;
}

/** Force-clear the hint cache (call after contact sync, memory update, etc.) */
export function clearWhisperHintCache(): void {
  _cachedHints = null;
  _cachedAt = 0;
}
