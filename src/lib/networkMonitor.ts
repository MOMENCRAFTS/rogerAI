/**
 * networkMonitor.ts — Online/offline detection + automatic queue drainer.
 *
 * Watches navigator.onLine and the 'online' browser event.
 * When connectivity returns, drains the offline recording queue by sending
 * each blob through Whisper → GPT-4o → Supabase, one item at a time.
 *
 * Usage:
 *   const stop = startNetworkMonitor({ onStatusChange, onItemProcessed, onQueueDrained });
 *   // ...
 *   stop(); // on unmount
 */

import { transcribeAudio } from './whisper';
import { processTransmission } from './openai';
import { insertTransmission, insertConversationTurn, upsertEntityMention } from './api';
import {
  getPendingRecordings,
  markProcessing,
  markProcessed,
  markFailed,
  getQueueCount,
  type QueuedRecording,
} from './offlineQueue';

const MAX_ATTEMPTS = 3;

export type NetworkStatus = 'online' | 'offline';

export interface ProcessedItem {
  txId: string;
  transcript: string;
  intent: string;
  rogerResponse: string;
  success: boolean;
  error?: string;
}

export interface NetworkMonitorCallbacks {
  /** Called whenever online/offline status changes. */
  onStatusChange?: (status: NetworkStatus) => void;
  /** Called when a queued item finishes processing (success or fail). */
  onItemProcessed?: (item: ProcessedItem) => void;
  /** Called when the queue is fully drained. */
  onQueueDrained?: () => void;
  /** Called when queue count changes (for badge updates). */
  onQueueCountChange?: (count: number) => void;
}

// ─── Internal state ──────────────────────────────────────────────────────────

let draining = false;

async function drainQueue(callbacks: NetworkMonitorCallbacks): Promise<void> {
  if (draining || !navigator.onLine) return;
  draining = true;

  try {
    const pending = await getPendingRecordings();
    for (const item of pending) {
      if (!navigator.onLine) break; // lost connection mid-drain

      await processQueuedItem(item, callbacks);

      // Update badge count after each item
      const remaining = await getQueueCount();
      callbacks.onQueueCountChange?.(remaining);
    }

    const finalCount = await getQueueCount();
    if (finalCount === 0) callbacks.onQueueDrained?.();
  } finally {
    draining = false;
  }
}

async function processQueuedItem(
  item: QueuedRecording,
  callbacks: NetworkMonitorCallbacks
): Promise<void> {
  if (item.attempts >= MAX_ATTEMPTS) {
    await markFailed(item.txId);
    callbacks.onItemProcessed?.({
      txId: item.txId, transcript: '', intent: 'UNKNOWN',
      rogerResponse: '', success: false,
      error: 'Max retries exceeded',
    });
    return;
  }

  await markProcessing(item.txId);

  try {
    // Step 1: Whisper transcription
    let transcript: string;
    if (item.blob.size > 0) {
      const result = await transcribeAudio(item.blob);
      transcript = result.transcript;
    } else {
      transcript = item.manualText ?? '';
    }

    if (!transcript.trim()) {
      await markProcessed(item.txId);
      return;
    }

    // Step 2: GPT-4o intent + response
    const aiResult = await processTransmission(transcript);

    // Step 3: Persist to Supabase
    await insertTransmission({
      id: item.txId,
      user_id: 'ADMIN-VOICE-QUEUED',
      device_id: null,
      transcript,
      intent: aiResult.intent as never,
      confidence: aiResult.confidence,
      ambiguity: aiResult.ambiguity,
      status: aiResult.outcome === 'success' ? 'SUCCESS'
        : aiResult.outcome === 'clarification' ? 'CLARIFICATION' : 'ERROR',
      latency_ms: Date.now() - item.timestamp,
      region: 'ADMIN-LAB-OFFLINE',
      is_simulated: false,
    });

    await markProcessed(item.txId);

    // ── Persist memory (fire-and-forget) ──────────────────────────────────
    const offlineUserId = 'ADMIN-TEST'; // replaced when real auth lands
    const offlineSession = `offline-${item.txId}`;
    insertConversationTurn({ user_id: offlineUserId, session_id: offlineSession, role: 'user', content: transcript, intent: null, is_admin_test: true }).catch(() => {});
    insertConversationTurn({ user_id: offlineUserId, session_id: offlineSession, role: 'assistant', content: aiResult.roger_response, intent: aiResult.intent, is_admin_test: true }).catch(() => {});
    if (aiResult.entities?.length) {
      aiResult.entities
        .filter(e => ['PERSON','COMPANY','PROJECT','TOPIC'].includes(e.type))
        .forEach(e => upsertEntityMention(offlineUserId, e.text, e.type).catch(() => {}));
    }

    callbacks.onItemProcessed?.({
      txId: item.txId,
      transcript,
      intent: aiResult.intent,
      rogerResponse: aiResult.roger_response,
      success: true,
    });
  } catch (err) {
    // Re-queue as pending for next attempt (will be retried on next drain)
    // markProcessing already incremented attempts
    // If attempts < MAX, it'll be re-picked up next drain
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.warn(`[OfflineQueue] Failed to process ${item.txId}:`, errMsg);

    if (item.attempts + 1 >= MAX_ATTEMPTS) {
      await markFailed(item.txId);
      callbacks.onItemProcessed?.({
        txId: item.txId, transcript: '', intent: 'UNKNOWN',
        rogerResponse: '', success: false, error: errMsg,
      });
    }
    // Otherwise leave as 'processing' — will be reset to 'pending' on next app load
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the network monitor. Returns a cleanup function to call on unmount.
 */
export function startNetworkMonitor(callbacks: NetworkMonitorCallbacks): () => void {
  const handleOnline = () => {
    callbacks.onStatusChange?.('online');
    drainQueue(callbacks);
  };
  const handleOffline = () => {
    callbacks.onStatusChange?.('offline');
  };

  window.addEventListener('online',  handleOnline);
  window.addEventListener('offline', handleOffline);

  // Emit initial status immediately
  callbacks.onStatusChange?.(navigator.onLine ? 'online' : 'offline');

  // If already online on mount, check for leftover queued items (e.g. from previous session)
  if (navigator.onLine) {
    getQueueCount().then(count => {
      callbacks.onQueueCountChange?.(count);
      if (count > 0) drainQueue(callbacks);
    });
  }

  return () => {
    window.removeEventListener('online',  handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}

/** Returns current network status synchronously. */
export function getNetworkStatus(): NetworkStatus {
  return navigator.onLine ? 'online' : 'offline';
}
