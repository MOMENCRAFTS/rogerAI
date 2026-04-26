/**
 * offlineQueue.ts — IndexedDB-backed queue for offline PTT recordings.
 *
 * When the user records a PTT transmission while offline, the audio blob
 * is stored here. When connectivity returns, networkMonitor drains this
 * queue by sending each blob through the Whisper → GPT-5.5 pipeline.
 *
 * Schema (store: 'recordings'):
 *   txId       string   — e.g. "TX-SIM-0003"
 *   blob       Blob     — WebM/Opus audio
 *   timestamp  number   — unix ms when recorded
 *   attempts   number   — retry counter (max 3 before marking failed)
 *   status     string   — 'pending' | 'processing' | 'failed'
 *   manualText string?  — fallback typed text (if no valid audio)
 */

const DB_NAME    = 'roger-offline-queue';
const DB_VERSION = 1;
const STORE      = 'recordings';
const MAX_QUEUE  = 20;

export interface QueuedRecording {
  txId: string;
  blob: Blob;
  timestamp: number;
  attempts: number;
  status: 'pending' | 'processing' | 'failed';
  manualText?: string;
}

// ── DB bootstrap ─────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'txId' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('status',    'status',    { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Add a recording to the queue. Rejects if queue is full (MAX_QUEUE).
 */
export async function enqueueRecording(
  item: Pick<QueuedRecording, 'txId' | 'blob' | 'timestamp' | 'manualText'>
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);

    // Check size first
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result >= MAX_QUEUE) {
        reject(new Error(`Offline queue full (max ${MAX_QUEUE})`));
        return;
      }
      const record: QueuedRecording = {
        ...item,
        attempts: 0,
        status: 'pending',
      };
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve();
      putReq.onerror   = () => reject(putReq.error);
    };
    countReq.onerror = () => reject(countReq.error);
  });
}

/**
 * Get all pending recordings ordered by timestamp ascending.
 */
export async function getPendingRecordings(): Promise<QueuedRecording[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const index = store.index('timestamp');
    const req   = index.getAll();
    req.onsuccess = () => {
      const all = req.result as QueuedRecording[];
      resolve(all.filter(r => r.status === 'pending'));
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get total count of ALL queued items (pending + failed).
 */
export async function getQueueCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req   = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Mark a recording as processing (prevents double-processing).
 */
export async function markProcessing(txId: string): Promise<void> {
  return updateStatus(txId, 'processing', r => ({ ...r, status: 'processing', attempts: r.attempts + 1 }));
}

/**
 * Remove a recording after successful processing.
 */
export async function markProcessed(txId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req   = store.delete(txId);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Mark a recording as failed (after max retries).
 */
export async function markFailed(txId: string): Promise<void> {
  return updateStatus(txId, 'failed', r => ({ ...r, status: 'failed' }));
}

/**
 * Re-queue a failed item for retry.
 */
export async function retryFailed(txId: string): Promise<void> {
  return updateStatus(txId, 'pending', r => ({ ...r, status: 'pending', attempts: 0 }));
}

/**
 * Clear all items (processed or failed).
 */
export async function clearQueue(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req   = store.clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function updateStatus(
  txId: string,
  _status: QueuedRecording['status'],
  transform: (r: QueuedRecording) => QueuedRecording
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const getReq = store.get(txId);
    getReq.onsuccess = () => {
      if (!getReq.result) { resolve(); return; }
      const updated = transform(getReq.result as QueuedRecording);
      const putReq  = store.put(updated);
      putReq.onsuccess = () => resolve();
      putReq.onerror   = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}
