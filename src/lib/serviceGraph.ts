// ─── Roger AI — Service Graph ────────────────────────────────────────────────
// Reactive health monitor for all external services.
// Tracks: connection status, latency, circuit breaker state.
// Provides real-time service context for GPT-5.5 prompt injection.

import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ServiceId =
  | 'spotify' | 'radio' | 'gcal' | 'tuya' | 'notion'
  | 'finnhub' | 'aviationstack' | 'google_maps'
  | 'openai' | 'whisper' | 'tts' | 'supabase'
  | 'twilio' | 'contacts' | 'islamic' | 'news';

export type ServiceStatus = 'healthy' | 'degraded' | 'down' | 'unconfigured' | 'unknown';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface ServiceNode {
  id: ServiceId;
  displayName: string;
  emoji: string;
  status: ServiceStatus;
  configured: boolean;
  lastCheckedAt: number;
  consecutiveFailures: number;
  avgLatencyMs: number;
  latencyHistory: number[];    // last 10 latencies
  circuitState: CircuitState;
  circuitOpenedAt: number;
  fallbackTo: ServiceId | null;
  lastError: string | null;
}

export interface HealthCheckResult {
  status: ServiceStatus;
  latencyMs: number;
  error?: string;
}

type HealthSubscriber = (serviceId: ServiceId, oldStatus: ServiceStatus, newStatus: ServiceStatus) => void;

// ─── Constants ───────────────────────────────────────────────────────────────

const CIRCUIT_OPEN_THRESHOLD = 3;       // consecutive failures to open circuit
const CIRCUIT_COOLDOWN_MS    = 60_000;  // 60s before half-open probe
const DEGRADED_LATENCY_MS   = 3000;    // >3s = degraded
const MAX_LATENCY_HISTORY    = 10;
const DEFAULT_POLL_MS        = 60_000;

// ─── Fallback Map ────────────────────────────────────────────────────────────

const FALLBACK_MAP: Partial<Record<ServiceId, ServiceId>> = {
  spotify:     'radio',
  google_maps: 'supabase',  // OSM fallback is handled in geoFence
};

// ─── Service Metadata ────────────────────────────────────────────────────────

const SERVICE_META: Record<ServiceId, { displayName: string; emoji: string }> = {
  spotify:        { displayName: 'Spotify',           emoji: '🎵' },
  radio:          { displayName: 'Radio Browser',     emoji: '📻' },
  gcal:           { displayName: 'Google Calendar',   emoji: '📅' },
  tuya:           { displayName: 'Tuya Smart Home',   emoji: '🏠' },
  notion:         { displayName: 'Notion',            emoji: '📝' },
  finnhub:        { displayName: 'Finnhub Finance',   emoji: '📈' },
  aviationstack:  { displayName: 'Flight Tracker',    emoji: '✈️' },
  google_maps:    { displayName: 'Google Maps',       emoji: '🗺️' },
  openai:         { displayName: 'OpenAI GPT',        emoji: '🤖' },
  whisper:        { displayName: 'Whisper STT',       emoji: '🎙️' },
  tts:            { displayName: 'TTS Engine',        emoji: '🔊' },
  supabase:       { displayName: 'Supabase',          emoji: '🔗' },
  twilio:         { displayName: 'Twilio SMS',        emoji: '📱' },
  contacts:       { displayName: 'Device Contacts',   emoji: '👤' },
  islamic:        { displayName: 'Islamic Services',   emoji: '🕌' },
  news:           { displayName: 'News API',          emoji: '📰' },
};

// ─── Service Graph Singleton ─────────────────────────────────────────────────

class ServiceGraphImpl {
  private nodes: Map<ServiceId, ServiceNode> = new Map();
  private subscribers: Set<HealthSubscriber> = new Set();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private userId: string | null = null;
  private userPrefs: Record<string, unknown> | null = null;

  constructor() {
    // Initialize all service nodes with 'unknown' status
    const allIds = Object.keys(SERVICE_META) as ServiceId[];
    for (const id of allIds) {
      const meta = SERVICE_META[id];
      this.nodes.set(id, {
        id,
        displayName: meta.displayName,
        emoji: meta.emoji,
        status: 'unknown',
        configured: false,
        lastCheckedAt: 0,
        consecutiveFailures: 0,
        avgLatencyMs: 0,
        latencyHistory: [],
        circuitState: 'closed',
        circuitOpenedAt: 0,
        fallbackTo: FALLBACK_MAP[id] ?? null,
        lastError: null,
      });
    }
  }

  // ─── Subscriber pattern ──────────────────────────────────────────────────

  subscribe(fn: HealthSubscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private notify(serviceId: ServiceId, oldStatus: ServiceStatus, newStatus: ServiceStatus): void {
    for (const fn of this.subscribers) {
      try { fn(serviceId, oldStatus, newStatus); } catch { /* subscriber error — don't propagate */ }
    }
  }

  // ─── Configuration checks ───────────────────────────────────────────────

  /** Load user preferences to determine which services are configured */
  async loadPreferences(userId: string): Promise<void> {
    this.userId = userId;
    try {
      const { data } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      this.userPrefs = data as Record<string, unknown> | null;
      this.updateConfiguredStatus();
    } catch {
      // Non-fatal — assume services are not configured
    }
  }

  private updateConfiguredStatus(): void {
    const p = this.userPrefs;
    this.updateNode('spotify',   { configured: !!sessionStorage.getItem('spotify_token') });
    this.updateNode('gcal',      { configured: !!(p?.gcal_connected) });
    this.updateNode('tuya',      { configured: !!(p?.tuya_uid) });
    this.updateNode('notion',    { configured: !!(p?.notion_token) });
    this.updateNode('finnhub',   { configured: !!import.meta.env.VITE_FINNHUB_API_KEY });
    this.updateNode('aviationstack', { configured: !!import.meta.env.VITE_AVIATIONSTACK_KEY });
    this.updateNode('google_maps',   { configured: !!import.meta.env.VITE_GOOGLE_MAPS_KEY });
    this.updateNode('openai',    { configured: !!import.meta.env.VITE_OPENAI_API_KEY });
    this.updateNode('whisper',   { configured: !!import.meta.env.VITE_OPENAI_API_KEY });
    this.updateNode('tts',       { configured: true });  // TTS always has Web Speech fallback
    this.updateNode('supabase',  { configured: true });  // Core dependency — always available
    this.updateNode('twilio',    { configured: true });   // Server-side secret
    this.updateNode('contacts',  { configured: true });   // Native — always try
    this.updateNode('islamic',   { configured: true });   // Public APIs
    this.updateNode('radio',     { configured: true });   // Public API
    this.updateNode('news',      { configured: true });   // Edge function
  }

  private updateNode(id: ServiceId, patch: Partial<ServiceNode>): void {
    const node = this.nodes.get(id);
    if (!node) return;

    const oldStatus = node.status;
    Object.assign(node, patch);

    // Mark unconfigured services
    if (!node.configured && node.status !== 'unconfigured') {
      node.status = 'unconfigured';
    }

    if (oldStatus !== node.status) {
      this.notify(id, oldStatus, node.status);
    }
  }

  // ─── Health checks ─────────────────────────────────────────────────────

  /** Run health checks for all configured services */
  async checkAll(): Promise<void> {
    const checks: Promise<void>[] = [];
    for (const [id, node] of this.nodes) {
      if (node.configured) {
        checks.push(this.checkService(id));
      }
    }
    await Promise.allSettled(checks);
  }

  /** Run an on-demand pre-flight check for a specific service */
  async preflight(serviceId: ServiceId): Promise<ServiceStatus> {
    const node = this.nodes.get(serviceId);
    if (!node) return 'unknown';
    if (!node.configured) return 'unconfigured';

    await this.checkService(serviceId);
    return this.getStatus(serviceId);
  }

  private async checkService(serviceId: ServiceId): Promise<void> {
    const node = this.nodes.get(serviceId);
    if (!node) return;

    // Circuit breaker: if open, check cooldown
    if (node.circuitState === 'open') {
      if (Date.now() - node.circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
        return; // Still cooling down — skip check
      }
      // Cooldown expired — transition to half-open for probe
      node.circuitState = 'half-open';
    }

    const start = performance.now();
    let result: HealthCheckResult;

    try {
      result = await this.runHealthCheck(serviceId);
    } catch (err) {
      result = {
        status: 'down',
        latencyMs: performance.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    const latencyMs = Math.round(result.latencyMs);
    const oldStatus = node.status;

    // Update latency history
    node.latencyHistory.push(latencyMs);
    if (node.latencyHistory.length > MAX_LATENCY_HISTORY) {
      node.latencyHistory.shift();
    }
    node.avgLatencyMs = Math.round(
      node.latencyHistory.reduce((a, b) => a + b, 0) / node.latencyHistory.length
    );

    node.lastCheckedAt = Date.now();

    if (result.status === 'healthy' || result.status === 'degraded') {
      // Success — reset failures + close circuit
      node.consecutiveFailures = 0;
      node.circuitState = 'closed';
      node.status = node.avgLatencyMs > DEGRADED_LATENCY_MS ? 'degraded' : 'healthy';
      node.lastError = null;
    } else {
      // Failure
      node.consecutiveFailures++;
      node.lastError = result.error ?? null;

      if (node.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD) {
        node.circuitState = 'open';
        node.circuitOpenedAt = Date.now();
        node.status = 'down';
      } else if (node.circuitState === 'half-open') {
        // Probe failed — back to open
        node.circuitState = 'open';
        node.circuitOpenedAt = Date.now();
        node.status = 'down';
      } else {
        node.status = 'degraded';
      }
    }

    if (oldStatus !== node.status) {
      this.notify(serviceId, oldStatus, node.status);
    }

    // Fire-and-forget telemetry logging
    this.logHealth(serviceId, node).catch(() => {});
  }

  private async runHealthCheck(serviceId: ServiceId): Promise<HealthCheckResult> {
    const start = performance.now();

    switch (serviceId) {
      case 'supabase': {
        const { error } = await supabase.from('user_preferences').select('user_id').limit(1);
        return { status: error ? 'down' : 'healthy', latencyMs: performance.now() - start };
      }

      case 'spotify': {
        if (!sessionStorage.getItem('spotify_token')) {
          return { status: 'unconfigured', latencyMs: 0 };
        }
        try {
          const { getSpotifyToken } = await import('./spotify');
          const token = await getSpotifyToken();
          return { status: token ? 'healthy' : 'degraded', latencyMs: performance.now() - start };
        } catch (e) {
          return { status: 'down', latencyMs: performance.now() - start, error: (e as Error).message };
        }
      }

      case 'gcal': {
        if (!this.userPrefs?.gcal_connected) {
          return { status: 'unconfigured', latencyMs: 0 };
        }
        // GCal tokens are server-side — check if token is still valid via edge function
        return { status: 'healthy', latencyMs: performance.now() - start };
      }

      case 'tuya': {
        if (!this.userPrefs?.tuya_uid) {
          return { status: 'unconfigured', latencyMs: 0 };
        }
        return { status: 'healthy', latencyMs: performance.now() - start };
      }

      case 'notion': {
        if (!this.userPrefs?.notion_token) {
          return { status: 'unconfigured', latencyMs: 0 };
        }
        return { status: 'healthy', latencyMs: performance.now() - start };
      }

      case 'finnhub': {
        if (!import.meta.env.VITE_FINNHUB_API_KEY) {
          return { status: 'unconfigured', latencyMs: 0 };
        }
        return { status: 'healthy', latencyMs: performance.now() - start };
      }

      case 'aviationstack': {
        if (!import.meta.env.VITE_AVIATIONSTACK_KEY) {
          return { status: 'unconfigured', latencyMs: 0 };
        }
        return { status: 'healthy', latencyMs: performance.now() - start };
      }

      case 'radio': {
        try {
          const res = await fetch('https://de1.api.radio-browser.info/json/stats', { signal: AbortSignal.timeout(5000) });
          return { status: res.ok ? 'healthy' : 'down', latencyMs: performance.now() - start };
        } catch (e) {
          return { status: 'down', latencyMs: performance.now() - start, error: (e as Error).message };
        }
      }

      case 'openai':
      case 'whisper':
      case 'tts': {
        if (!import.meta.env.VITE_OPENAI_API_KEY) {
          return { status: 'unconfigured', latencyMs: 0 };
        }
        // OpenAI services are checked passively via reportSuccess/reportFailure
        return { status: 'healthy', latencyMs: performance.now() - start };
      }

      default:
        return { status: 'healthy', latencyMs: performance.now() - start };
    }
  }

  // ─── Circuit breaker API ─────────────────────────────────────────────────

  /** Report a successful call to a service (resets circuit breaker) */
  reportSuccess(serviceId: ServiceId, latencyMs?: number): void {
    const node = this.nodes.get(serviceId);
    if (!node) return;

    const oldStatus = node.status;
    node.consecutiveFailures = 0;
    node.circuitState = 'closed';
    node.lastCheckedAt = Date.now();
    node.lastError = null;

    if (latencyMs !== undefined) {
      node.latencyHistory.push(Math.round(latencyMs));
      if (node.latencyHistory.length > MAX_LATENCY_HISTORY) node.latencyHistory.shift();
      node.avgLatencyMs = Math.round(node.latencyHistory.reduce((a, b) => a + b, 0) / node.latencyHistory.length);
    }

    node.status = node.avgLatencyMs > DEGRADED_LATENCY_MS ? 'degraded' : 'healthy';

    if (oldStatus !== node.status) {
      this.notify(serviceId, oldStatus, node.status);
    }
  }

  /** Report a failed call to a service (increments failure count, may open circuit) */
  reportFailure(serviceId: ServiceId, error?: string): void {
    const node = this.nodes.get(serviceId);
    if (!node) return;

    const oldStatus = node.status;
    node.consecutiveFailures++;
    node.lastCheckedAt = Date.now();
    node.lastError = error ?? null;

    if (node.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD) {
      node.circuitState = 'open';
      node.circuitOpenedAt = Date.now();
      node.status = 'down';
    } else {
      node.status = 'degraded';
    }

    if (oldStatus !== node.status) {
      this.notify(serviceId, oldStatus, node.status);
    }
  }

  // ─── Query API ───────────────────────────────────────────────────────────

  /** Is this service currently blocked by the circuit breaker? */
  isBlocked(serviceId: ServiceId): boolean {
    const node = this.nodes.get(serviceId);
    if (!node) return true;
    if (!node.configured) return true;
    if (node.circuitState === 'open') {
      // Check if cooldown has expired
      if (Date.now() - node.circuitOpenedAt >= CIRCUIT_COOLDOWN_MS) {
        node.circuitState = 'half-open'; // allow one probe
        return false;
      }
      return true;
    }
    return false;
  }

  getStatus(serviceId: ServiceId): ServiceStatus {
    return this.nodes.get(serviceId)?.status ?? 'unknown';
  }

  getNode(serviceId: ServiceId): ServiceNode | undefined {
    return this.nodes.get(serviceId);
  }

  getDisplayName(serviceId: ServiceId): string {
    return SERVICE_META[serviceId]?.displayName ?? serviceId;
  }

  getAllNodes(): ServiceNode[] {
    return Array.from(this.nodes.values());
  }

  /** Get fallback service for a given service */
  getFallback(serviceId: ServiceId): ServiceId | null {
    return this.nodes.get(serviceId)?.fallbackTo ?? null;
  }

  /** Check if a fallback service is available */
  hasFallback(serviceId: ServiceId): boolean {
    const fb = this.getFallback(serviceId);
    if (!fb) return false;
    return !this.isBlocked(fb);
  }

  // ─── Context injection for GPT-5.5 ──────────────────────────────────────

  /**
   * Generate service availability string for GPT-5.5 system prompt injection.
   * Format: one line per service with status emoji.
   */
  toContextString(): string {
    const lines = ['=== SERVICE AVAILABILITY ==='];
    const STATUS_EMOJI: Record<ServiceStatus, string> = {
      healthy: '✅', degraded: '⚠️', down: '❌', unconfigured: '⚪', unknown: '❓',
    };

    for (const node of this.nodes.values()) {
      // Only include services the user would care about
      if (node.id === 'supabase' || node.id === 'openai' || node.id === 'whisper') continue;

      const emoji = STATUS_EMOJI[node.status];
      const latency = node.avgLatencyMs > 0 ? ` (${node.avgLatencyMs}ms)` : '';
      const fallback = node.fallbackTo && node.status !== 'healthy'
        ? ` → fallback: ${this.getDisplayName(node.fallbackTo)}`
        : '';
      lines.push(`${node.id}: ${emoji} ${node.status}${latency}${fallback}`);
    }

    return lines.join('\n');
  }

  // ─── Polling lifecycle ──────────────────────────────────────────────────

  startPolling(intervalMs: number = DEFAULT_POLL_MS): void {
    this.stopPolling();
    // Run immediate check
    this.checkAll().catch(() => {});
    this.pollInterval = setInterval(() => {
      this.checkAll().catch(() => {});
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  // ─── Telemetry logging ──────────────────────────────────────────────────

  private async logHealth(serviceId: ServiceId, node: ServiceNode): Promise<void> {
    if (!this.userId) return;
    try {
      await supabase.from('service_health_log').insert({
        user_id:       this.userId,
        service_id:    serviceId,
        status:        node.status,
        latency_ms:    node.avgLatencyMs,
        error_msg:     node.lastError,
        circuit_state: node.circuitState,
      });
    } catch {
      // Non-fatal — telemetry is best-effort
    }
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

let _instance: ServiceGraphImpl | null = null;

export function getServiceGraph(): ServiceGraphImpl {
  if (!_instance) _instance = new ServiceGraphImpl();
  return _instance;
}

export type { ServiceGraphImpl as ServiceGraph };
