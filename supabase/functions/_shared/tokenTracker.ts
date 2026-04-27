// ─── Roger AI — Token Usage Tracker ──────────────────────────────────────────
// Shared utility for all AI edge functions to log token usage to ai_usage_log.
// Import in any edge function that calls OpenAI.
//
// Usage:
//   import { trackUsage, estimateCost } from '../_shared/tokenTracker.ts';
//   const data = await callOpenAI(...);
//   await trackUsage({ functionName: 'process-transmission', model, usage: data.usage, userId, latencyMs });

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ── Cost estimation per 1K tokens (USD) ──────────────────────────────────────
const COST_PER_1K: Record<string, { input: number; output: number }> = {
  'gpt-5.5':       { input: 0.005,  output: 0.015 },
  'gpt-5.4-mini':  { input: 0.0002, output: 0.0006 },
  'whisper-1':     { input: 0.006,  output: 0 },   // per minute, approximated
  'tts-1':         { input: 0.015,  output: 0 },   // per 1K chars
  'tts-1-hd':      { input: 0.030,  output: 0 },
};

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const rates = COST_PER_1K[model] ?? COST_PER_1K['gpt-5.5'];
  return (promptTokens / 1000) * rates.input + (completionTokens / 1000) * rates.output;
}

export interface TrackUsageParams {
  functionName: string;
  model: string;
  userId?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  success?: boolean;
  errorMessage?: string;
}

/**
 * Log AI usage to the ai_usage_log table.
 * Non-blocking — fire and forget. Errors are silently caught.
 */
export async function trackUsage(params: TrackUsageParams): Promise<void> {
  const {
    functionName,
    model,
    userId = null,
    promptTokens = 0,
    completionTokens = 0,
    totalTokens = promptTokens + completionTokens,
    latencyMs = 0,
    success = true,
    errorMessage,
  } = params;

  const cost = estimateCost(model, promptTokens, completionTokens);

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ai_usage_log`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        function_name: functionName,
        model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        cost_usd: cost,
        latency_ms: latencyMs,
        success,
        error_message: errorMessage ?? null,
      }),
    });
  } catch {
    // Silent — never let tracking failures break AI calls
  }
}

/**
 * Helper to extract usage from an OpenAI response and track it.
 * Call immediately after getting a response from OpenAI.
 */
export async function trackOpenAIResponse(
  functionName: string,
  model: string,
  response: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } },
  userId: string | null,
  startTime: number
): Promise<void> {
  const usage = response.usage;
  await trackUsage({
    functionName,
    model,
    userId,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
    latencyMs: Date.now() - startTime,
    success: true,
  });
}
