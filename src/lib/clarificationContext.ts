// ─── Roger AI — Clarification Context System ─────────────────────────────────
// Manages stateful context for the clarification resolution loop.
// When Roger asks for clarification, the context is captured here so the
// user's follow-up response is interpreted in context — not as a fresh command.

import type { RogerAIResponse } from './openai';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Captured when Roger returns outcome="clarification".
 * Stored in React state and passed to the next processTransmission() call.
 */
export interface ClarificationContext {
  /** The user's original ambiguous transcript */
  original_transcript: string;
  /** Roger's detected intent before clarification */
  original_intent: string;
  /** The clarification question Roger asked */
  clarification_question: string;
  /** Which entity types Roger is expecting to resolve */
  missing_entities: string[];
  /** Full original AI response for reference */
  original_response: RogerAIResponse;
  /** Which attempt this is (1 = first clarification, 2 = second) */
  attempt: number;
  /** Timestamp for auto-expiry */
  created_at: number;
}

/**
 * Intent disambiguation option — returned by GPT-5.5 when entity is clear
 * but the user's intent is ambiguous.
 */
export interface IntentOption {
  intent: string;   // e.g. "CREATE_REMINDER"
  label: string;    // e.g. "Set a reminder"
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Max number of clarification attempts before Roger gives up */
export const MAX_CLARIFICATION_ATTEMPTS = 2;

/** Auto-expire clarification context after this many ms */
export const CLARIFICATION_EXPIRY_MS = 60_000; // 60 seconds

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a ClarificationContext from a clarification response.
 * Call this when processTransmission returns outcome="clarification".
 */
export function createClarificationContext(
  transcript: string,
  response: RogerAIResponse,
  previousContext?: ClarificationContext | null,
): ClarificationContext {
  // Extract which entity types are missing from the clarification question
  const missingEntities: string[] = [];
  const q = (response.clarification_question ?? response.roger_response).toLowerCase();

  if (/\b(who|whom|which person|name)\b/.test(q)) missingEntities.push('PERSON');
  if (/\b(where|which place|location|address)\b/.test(q)) missingEntities.push('LOCATION');
  if (/\b(when|what time|what date|which day)\b/.test(q)) missingEntities.push('TIME');
  if (/\b(what|which|specify|clarify)\b/.test(q)) missingEntities.push('TOPIC');

  // If this is a follow-up clarification, increment the attempt counter
  const attempt = previousContext ? previousContext.attempt + 1 : 1;

  return {
    original_transcript: previousContext?.original_transcript ?? transcript,
    original_intent: previousContext?.original_intent ?? response.intent,
    clarification_question: response.clarification_question ?? response.roger_response,
    missing_entities: missingEntities,
    original_response: previousContext?.original_response ?? response,
    attempt,
    created_at: Date.now(),
  };
}

/**
 * Check if a ClarificationContext has expired.
 */
export function isClarificationExpired(ctx: ClarificationContext): boolean {
  return Date.now() - ctx.created_at > CLARIFICATION_EXPIRY_MS;
}

/**
 * Check if we've exceeded the maximum clarification attempts.
 */
export function isClarificationExhausted(ctx: ClarificationContext): boolean {
  return ctx.attempt >= MAX_CLARIFICATION_ATTEMPTS;
}

/**
 * Build the system message that gets injected into the edge function
 * when the user is responding to a clarification question.
 */
export function buildClarificationSystemMessage(ctx: ClarificationContext): string {
  return `═══════════════════════════════════════
CLARIFICATION RESOLUTION MODE (ACTIVE)
═══════════════════════════════════════
Roger just asked the user a clarification question. The user's next message
is a DIRECT ANSWER to that question — NOT a new command.

ORIGINAL TRANSCRIPT: "${ctx.original_transcript}"
ORIGINAL INTENT: ${ctx.original_intent}
ROGER ASKED: "${ctx.clarification_question}"
MISSING INFORMATION: ${ctx.missing_entities.join(', ') || 'unspecified'}
ATTEMPT: ${ctx.attempt} of ${MAX_CLARIFICATION_ATTEMPTS}

RULES:
1. Treat the user's message as an ANSWER to the question above
2. Use the ORIGINAL INTENT (${ctx.original_intent}) — do NOT reclassify
3. Merge the resolved information into the original context
4. Return outcome="success" if the answer resolves the ambiguity
5. Return outcome="clarification" ONLY if the answer itself is still ambiguous
6. confidence should reflect the MERGED result, not the answer alone
7. Entities array should include BOTH original entities AND newly resolved ones
8. roger_response should confirm the FULL action with resolved info`;
}
