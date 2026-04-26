import { supabase } from './supabase';
import type { DbTransmission } from './api';

/**
 * Logs a clarification event to the transmissions table so the
 * admin Transmission Monitor surfaces it with status='CLARIFICATION'.
 *
 * Enhanced with resolution tracking for the 3-layer ambiguity system:
 * - resolution_status: 'pending' | 'resolved' | 'abandoned'
 * - attempt_number: which clarification attempt this is
 * - original_transcript: the original vague transcript that triggered clarification
 * - clarification_question: what Roger asked
 */
export async function logClarification(opts: {
  userId: string;
  sessionId: string;
  transcript: string;
  rogerQuestion: string;
  ambiguity: number;
  intent: string;
  latencyMs: number;
  attemptNumber?: number;
  originalTranscript?: string;
  resolutionStatus?: 'pending' | 'resolved' | 'abandoned';
}): Promise<void> {
  try {
    const row: Omit<DbTransmission, 'created_at'> = {
      id:           `TX-CLR-${Date.now()}`,
      user_id:      opts.userId,
      device_id:    null,
      transcript:   opts.transcript,
      intent:       opts.intent,
      confidence:   Math.max(0, 100 - opts.ambiguity),
      ambiguity:    opts.ambiguity,
      status:       'CLARIFICATION',
      latency_ms:   opts.latencyMs,
      region:       'USER-APP',
      is_simulated: false,
    };
    await supabase.from('transmissions').insert({
      ...row,
      // Extended clarification tracking columns (added in migration 024)
      resolution_status:      opts.resolutionStatus ?? 'pending',
      attempt_number:         opts.attemptNumber ?? 1,
      original_transcript:    opts.originalTranscript ?? null,
      clarification_question: opts.rogerQuestion,
    });
  } catch {
    // fire-and-forget — never throw from logger
  }
}

/**
 * Update the resolution status of a clarification log entry.
 * Called when a clarification is resolved or abandoned.
 */
export async function updateClarificationResolution(
  txIdPrefix: string,
  status: 'resolved' | 'abandoned'
): Promise<void> {
  try {
    await supabase
      .from('transmissions')
      .update({ resolution_status: status })
      .like('id', `${txIdPrefix}%`)
      .eq('status', 'CLARIFICATION');
  } catch {
    // fire-and-forget
  }
}
