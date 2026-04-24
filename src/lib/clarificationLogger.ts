import { supabase } from './supabase';
import type { DbTransmission } from './api';

/**
 * Logs a clarification event to the transmissions table so the
 * admin Transmission Monitor surfaces it with status='CLARIFICATION'.
 */
export async function logClarification(opts: {
  userId: string;
  sessionId: string;
  transcript: string;
  rogerQuestion: string;
  ambiguity: number;
  intent: string;
  latencyMs: number;
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
    await supabase.from('transmissions').insert(row);
  } catch {
    // fire-and-forget — never throw from logger
  }
}
