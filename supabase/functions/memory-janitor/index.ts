// ─── Roger AI — Memory Janitor ────────────────────────────────────────────────
// Cron-triggered edge function that cleans and curates each user's memory_graph.
// Runs nightly at 3 AM UTC via pg_cron.
//
// Internal AI Nodes (run sequentially per user):
//   Node A — Noise Judge       : gpt-5.4-mini — flags/deletes gibberish facts
//   Node B — Semantic Curator  : gpt-5.4-mini — merges semantically duplicate facts
//   Node C — Conflict Resolver : gpt-5.4-mini — handles contradictory facts
//
// Pre-AI  : Rule-based noise filter (free, instant)
// Post-AI : Confidence decay via SQL (free)
//
// Deploy: supabase functions deploy memory-janitor --no-verify-jwt

import { trackUsage } from '../_shared/tokenTracker.ts';

const OPENAI_API_KEY       = Deno.env.get('OPENAI_API_KEY') ?? '';
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ── Supabase REST helper ───────────────────────────────────────────────────────
async function sb(path: string, method = 'GET', body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  if (method === 'DELETE' || res.status === 204) return null;
  return res.json();
}

// ── gpt-5.4-mini call (cheap, fast, structured) ───────────────────────────────
async function gptMini(
  systemPrompt: string,
  userPrompt: string,
  userId: string,
  nodeName: string,
): Promise<string> {
  const start = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      temperature: 0.1, // Low temp for deterministic curation decisions
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  const data = await res.json() as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  await trackUsage({
    functionName: `memory-janitor:${nodeName}`,
    model: 'gpt-5.4-mini',
    userId,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
    latencyMs: Date.now() - start,
    success: !!data.choices?.[0]?.message?.content,
  });

  return data.choices?.[0]?.message?.content ?? '{}';
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 0 — Rule-based noise filter (no AI, runs first)
// ─────────────────────────────────────────────────────────────────────────────

const WHISPER_HALLUCINATIONS = new Set([
  'thank you', 'thanks for watching', 'you', 'the', 'a', 'an', 'um', 'uh',
  'okay', 'ok', 'yes', 'no', 'hmm', '...', 'undefined', 'null', 'none',
  'test', 'testing', 'hello', 'hi', 'bye', 'goodbye', 'subscribe',
  'like and subscribe', 'see you next time', 'stay tuned',
  'over', 'roger', 'copy', 'wilco',
]);

interface MemoryFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  is_confirmed: boolean;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  fact_type: string;
}

function isRuleGibberish(obj: string): boolean {
  const s = obj.trim();
  if (s.length < 3) return true;                              // too short
  if (/^[^a-zA-Z\u0600-\u06FF\u4e00-\u9fff]+$/.test(s)) return true; // no meaningful chars
  if (/^(.)\1{4,}$/.test(s)) return true;                    // repeated: "aaaaaaa"
  if (WHISPER_HALLUCINATIONS.has(s.toLowerCase())) return true;
  if (/^[\s\W]+$/.test(s)) return true;                      // only whitespace/punctuation
  return false;
}

function ruleFilter(facts: MemoryFact[]): { keep: MemoryFact[]; deleted: string[] } {
  const deleted: string[] = [];
  const keep: MemoryFact[] = [];

  // Pass 1: gibberish filter
  for (const f of facts) {
    if (isRuleGibberish(f.object) || isRuleGibberish(f.subject)) {
      deleted.push(f.id);
    } else {
      keep.push(f);
    }
  }

  // Pass 2: exact-match dedup (same subject+predicate+object, case-insensitive)
  // Keep the one with highest confidence; delete the rest
  const seen = new Map<string, MemoryFact>();
  const exactDupeDeletes: string[] = [];

  for (const f of keep) {
    const key = `${f.subject.toLowerCase()}|${f.predicate.toLowerCase()}|${f.object.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, f);
    } else {
      // Keep higher confidence; if equal keep confirmed/newer
      if (f.confidence > existing.confidence ||
          (f.confidence === existing.confidence && f.is_confirmed && !existing.is_confirmed)) {
        exactDupeDeletes.push(existing.id);
        seen.set(key, f);
      } else {
        exactDupeDeletes.push(f.id);
      }
    }
  }

  return {
    keep: [...seen.values()],
    deleted: [...deleted, ...exactDupeDeletes],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE A — Noise Judge (AI-powered secondary filter)
// Catches subtle noise that rule-based can't: partial sentences, mis-transcribed
// words, context-free fragments that look valid but aren't meaningful facts.
// ─────────────────────────────────────────────────────────────────────────────

const NOISE_JUDGE_SYSTEM = `You are Roger AI's Memory Noise Judge.
You are given a list of facts stored about a user.
Your job: identify facts whose "object" value is NOT a meaningful, durable personal fact.

FLAG as noise if the object:
- Is a partial sentence fragment with no clear meaning (e.g., "the meeting", "going to")
- Is a filler word or phrase with no informational content
- Is clearly a speech transcription error (garbled, nonsensical)
- Contains only metadata, not actual content (e.g., "undefined", "null", "[object Object]")
- Is so vague it could apply to anyone and adds zero personal signal (e.g., "things", "stuff", "it")

DO NOT flag:
- Short but meaningful values (names, cities, job titles, specific tools)
- Preferences that are clear even if brief ("early mornings", "dark mode", "halal")
- Facts that are unusual or surprising but genuine

Return JSON only:
{
  "noise_ids": ["id1", "id2"]
}
Return noise_ids: [] if everything looks clean.`;

async function runNoiseJudge(
  facts: MemoryFact[],
  userId: string,
): Promise<string[]> {
  if (facts.length === 0) return [];

  const factList = facts
    .map((f, i) => `[${i}] id=${f.id} | ${f.subject} ${f.predicate} "${f.object}"`)
    .join('\n');

  const raw = await gptMini(
    NOISE_JUDGE_SYSTEM,
    `Facts to review:\n${factList}`,
    userId,
    'noise-judge',
  );

  try {
    const result = JSON.parse(raw) as { noise_ids?: string[] };
    return result.noise_ids ?? [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE B — Semantic Curator (AI deduplication)
// Identifies facts that say the same thing in different words.
// Picks the most specific/complete version to keep.
// ─────────────────────────────────────────────────────────────────────────────

const SEMANTIC_CURATOR_SYSTEM = `You are Roger AI's Memory Semantic Curator.
You are given a list of personal facts about one specific user.
Your job: find facts that are semantically equivalent — same meaning, different wording.

For each duplicate group:
- Keep the more SPECIFIC, COMPLETE, or RECENTLY UPDATED fact
- Delete the less specific one(s)
- Prefer: longer objects, higher confidence, confirmed over unconfirmed

EXAMPLES of semantic duplicates:
- "name is Ahmad" + "name is Ahmad Al-Rashidi" → keep the full name
- "role is CEO" + "is a chief executive" → keep canonical "CEO"
- "priority is family" + "cares about family" → keep "priority is family"
- "uses iPhone" + "device is iPhone" → keep "uses iPhone"

Do NOT merge facts that are genuinely different even if related:
- "priority is family" + "priority is work" → KEEP BOTH (different priorities)
- "likes coffee" + "drinks tea" → KEEP BOTH (different preferences)

Return JSON only:
{
  "groups": [
    {
      "keep_id": "uuid-of-fact-to-keep",
      "delete_ids": ["uuid-to-delete", "..."],
      "reason": "brief reason (max 15 words)"
    }
  ]
}
Return groups: [] if no duplicates found.`;

interface CuratorGroup {
  keep_id: string;
  delete_ids: string[];
  reason: string;
}

async function runSemanticCurator(
  facts: MemoryFact[],
  userId: string,
): Promise<CuratorGroup[]> {
  if (facts.length < 2) return [];

  const factList = facts
    .map(f => `id=${f.id} | ${f.subject} ${f.predicate} "${f.object}" (confidence:${f.confidence}, confirmed:${f.is_confirmed})`)
    .join('\n');

  const raw = await gptMini(
    SEMANTIC_CURATOR_SYSTEM,
    `User facts:\n${factList}`,
    userId,
    'semantic-curator',
  );

  try {
    const result = JSON.parse(raw) as { groups?: CuratorGroup[] };
    return result.groups ?? [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE C — Conflict Resolver (AI contradiction detection)
// Finds facts that directly conflict (e.g., two different names, two locations).
// Resolves by keeping the newer/more-confident fact and flagging the old one.
// ─────────────────────────────────────────────────────────────────────────────

const CONFLICT_RESOLVER_SYSTEM = `You are Roger AI's Memory Conflict Resolver.
You are given personal facts about one specific user.
Your job: detect CONTRADICTIONS — facts that cannot both be true at the same time.

REAL contradictions (flag these):
- Two different names: "name is Ahmad" + "name is Marcus"
- Two incompatible locations: "based in Riyadh" + "based in London" (same predicate category)
- Conflicting preferences: "prefers mornings" + "prefers evenings"
- Directly opposing facts: "is married" + "is single"

NOT contradictions (do not flag):
- Different priorities (user can have multiple)
- Different tools used (user can use many)
- Past vs. present (if dates are different)
- Complementary facts about the same topic

For each contradiction:
- "action": "keep_newer" if one is clearly more recent
- "action": "keep_higher_confidence" if one has significantly higher confidence (>20 difference)
- "action": "flag_for_user" if it's genuinely ambiguous and the user should decide

Return JSON only:
{
  "contradictions": [
    {
      "fact_a_id": "uuid",
      "fact_b_id": "uuid",
      "reason": "brief description of conflict",
      "action": "keep_newer | keep_higher_confidence | flag_for_user",
      "delete_id": "uuid-to-delete-if-keep_newer-or-keep_higher_confidence"
    }
  ]
}
Return contradictions: [] if no conflicts found.`;

interface Contradiction {
  fact_a_id: string;
  fact_b_id: string;
  reason: string;
  action: 'keep_newer' | 'keep_higher_confidence' | 'flag_for_user';
  delete_id?: string;
}

async function runConflictResolver(
  facts: MemoryFact[],
  userId: string,
): Promise<Contradiction[]> {
  if (facts.length < 2) return [];

  // Only run on facts sharing the same subject+predicate category to reduce noise
  const factList = facts
    .map(f => `id=${f.id} | ${f.subject} ${f.predicate} "${f.object}" (confidence:${f.confidence}, updated:${f.updated_at?.slice(0, 10) ?? 'unknown'})`)
    .join('\n');

  const raw = await gptMini(
    CONFLICT_RESOLVER_SYSTEM,
    `User facts:\n${factList}`,
    userId,
    'conflict-resolver',
  );

  try {
    const result = JSON.parse(raw) as { contradictions?: Contradiction[] };
    return result.contradictions ?? [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — Confidence Decay (pure SQL, no AI)
// ─────────────────────────────────────────────────────────────────────────────

async function runConfidenceDecay(userId: string): Promise<{ decayed: number; culled: number }> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch stale, unconfirmed, non-draft facts
  const stale = await sb(
    `memory_graph?user_id=eq.${userId}&is_confirmed=eq.false&is_draft=eq.false&updated_at=lt.${thirtyDaysAgo}&select=id,confidence`
  ) as { id: string; confidence: number }[] | null;

  if (!Array.isArray(stale) || stale.length === 0) return { decayed: 0, culled: 0 };

  const toDecay  = stale.filter(f => (f.confidence - 5) >= 20);
  const toCull   = stale.filter(f => (f.confidence - 5) < 20);

  // Decay: lower confidence by 5
  for (const f of toDecay) {
    await sb(`memory_graph?id=eq.${f.id}`, 'PATCH', {
      confidence: f.confidence - 5,
      updated_at: new Date().toISOString(),
    });
  }

  // Cull: delete facts that have decayed below minimum viability
  for (const f of toCull) {
    await sb(`memory_graph?id=eq.${f.id}`, 'DELETE');
  }

  return { decayed: toDecay.length, culled: toCull.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN per-user orchestrator
// ─────────────────────────────────────────────────────────────────────────────

interface JanitorStats {
  ruleDeleted: number;
  noiseDeleted: number;
  semanticMerged: number;
  conflictsResolved: number;
  conflictsFlagged: number;
  decayed: number;
  culled: number;
}

async function processUser(userId: string): Promise<JanitorStats> {
  const stats: JanitorStats = {
    ruleDeleted: 0,
    noiseDeleted: 0,
    semanticMerged: 0,
    conflictsResolved: 0,
    conflictsFlagged: 0,
    decayed: 0,
    culled: 0,
  };

  // Fetch all facts for this user
  const allFacts = await sb(
    `memory_graph?user_id=eq.${userId}&select=id,subject,predicate,object,confidence,is_confirmed,is_draft,fact_type,created_at,updated_at&order=confidence.desc`
  ) as MemoryFact[] | null;

  if (!Array.isArray(allFacts) || allFacts.length === 0) {
    const decay = await runConfidenceDecay(userId);
    stats.decayed = decay.decayed;
    stats.culled  = decay.culled;
    return stats;
  }

  // ── Phase 0: Rule filter (free) ─────────────────────────────────────────
  const { keep: afterRules, deleted: ruleIds } = ruleFilter(allFacts);
  stats.ruleDeleted = ruleIds.length;

  if (ruleIds.length > 0) {
    // Delete in batches of 20
    for (let i = 0; i < ruleIds.length; i += 20) {
      const batch = ruleIds.slice(i, i + 20);
      await sb(`memory_graph?id=in.(${batch.join(',')})`, 'DELETE');
    }
  }

  // Nothing left? Skip AI nodes.
  if (afterRules.length === 0) {
    const decay = await runConfidenceDecay(userId);
    stats.decayed = decay.decayed;
    stats.culled  = decay.culled;
    return stats;
  }

  // ── Node A: Noise Judge (AI) — process in batches of 30 ────────────────
  let surviving = afterRules;
  const noiseIdsAll: string[] = [];

  for (let i = 0; i < surviving.length; i += 30) {
    const batch = surviving.slice(i, i + 30);
    const noiseIds = await runNoiseJudge(batch, userId);
    noiseIdsAll.push(...noiseIds);
  }

  if (noiseIdsAll.length > 0) {
    for (let i = 0; i < noiseIdsAll.length; i += 20) {
      const batch = noiseIdsAll.slice(i, i + 20);
      await sb(`memory_graph?id=in.(${batch.join(',')})`, 'DELETE');
    }
    surviving = surviving.filter(f => !noiseIdsAll.includes(f.id));
    stats.noiseDeleted = noiseIdsAll.length;
  }

  // Skip semantic/conflict nodes if too few facts remain
  if (surviving.length < 2) {
    const decay = await runConfidenceDecay(userId);
    stats.decayed = decay.decayed;
    stats.culled  = decay.culled;
    return stats;
  }

  // ── Node B: Semantic Curator (AI) — batches of 30 ──────────────────────
  const allDeleteIds = new Set<string>();

  for (let i = 0; i < surviving.length; i += 30) {
    const batch = surviving.slice(i, i + 30);
    const groups = await runSemanticCurator(batch, userId);

    for (const group of groups) {
      for (const did of group.delete_ids) {
        allDeleteIds.add(did);
      }
      stats.semanticMerged += group.delete_ids.length;
    }
  }

  if (allDeleteIds.size > 0) {
    const ids = [...allDeleteIds];
    for (let i = 0; i < ids.length; i += 20) {
      const batch = ids.slice(i, i + 20);
      await sb(`memory_graph?id=in.(${batch.join(',')})`, 'DELETE');
    }
    surviving = surviving.filter(f => !allDeleteIds.has(f.id));
  }

  // ── Node C: Conflict Resolver (AI) ─────────────────────────────────────
  if (surviving.length >= 2) {
    // Run on the full surviving set (conflicts span predicates)
    for (let i = 0; i < surviving.length; i += 40) {
      const batch = surviving.slice(i, i + 40);
      const contradictions = await runConflictResolver(batch, userId);

      for (const c of contradictions) {
        if (c.action === 'flag_for_user') {
          // Mark both facts as needing review (don't delete)
          // We store this as a special memory_insights entry
          await sb('memory_insights', 'POST', {
            user_id: userId,
            insight_type: 'CONFLICT',
            insight: `Conflicting facts detected: ${c.reason}`,
            metadata: { fact_a_id: c.fact_a_id, fact_b_id: c.fact_b_id },
            discarded: false,
          });
          stats.conflictsFlagged++;
        } else if (c.delete_id) {
          await sb(`memory_graph?id=eq.${c.delete_id}`, 'DELETE');
          stats.conflictsResolved++;
        }
      }
    }
  }

  // ── Phase 3: Confidence Decay (SQL) ────────────────────────────────────
  const decay = await runConfidenceDecay(userId);
  stats.decayed = decay.decayed;
  stats.culled  = decay.culled;

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async () => {
  try {
    // Fetch all users who have at least one memory_graph entry
    // We do this by fetching distinct user_ids from memory_graph
    const users = await sb(
      `user_preferences?select=user_id`
    ) as { user_id: string }[] | null;

    if (!Array.isArray(users) || users.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, reason: 'no users' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let processed = 0;
    const summary: Record<string, JanitorStats> = {};

    for (const user of users) {
      try {
        const stats = await processUser(user.user_id);
        processed++;

        // Only log users where something actually happened
        const totalActions = stats.ruleDeleted + stats.noiseDeleted +
          stats.semanticMerged + stats.conflictsResolved + stats.conflictsFlagged +
          stats.decayed + stats.culled;

        if (totalActions > 0) {
          summary[user.user_id.slice(0, 8)] = stats;
        }

        console.log(`[memory-janitor] user=${user.user_id.slice(0,8)}`, JSON.stringify(stats));
      } catch (err) {
        console.error(`[memory-janitor] Error for user ${user.user_id}:`, err);
      }
    }

    return new Response(JSON.stringify({ ok: true, processed, summary }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[memory-janitor] Fatal error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});
