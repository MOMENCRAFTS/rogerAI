// ─── Roger AI — Silent Node Orchestrator ────────────────────────────────────
// Central coordinator that bridges ServiceGraph health monitoring with
// IntentRegistry dispatch. This is the single entry point for the
// intent-routing pipeline, replacing the monolithic UserHome.tsx if/else chain.

import { getServiceGraph } from './serviceGraph';
import type { ServiceGraph } from './serviceGraph';
import { getIntentRegistry, buildIntentContext } from './intentRegistry';
import type { IntentRegistry, IntentContext } from './intentRegistry';
import type { RogerAIResponse } from './openai';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SilentNodeConfig {
  userId: string;
  pollIntervalMs?: number;
}

// ─── Silent Node ─────────────────────────────────────────────────────────────

class SilentNodeImpl {
  private graph: ServiceGraph;
  private registry: IntentRegistry;
  private userId: string | null = null;
  private started = false;

  constructor() {
    this.graph = getServiceGraph();
    this.registry = getIntentRegistry();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Initialize the Silent Node.
   * Starts health polling and loads user service preferences.
   * Call this once on app mount (e.g., in UserHome useEffect).
   */
  async start(config: SilentNodeConfig): Promise<void> {
    if (this.started) return;
    this.userId = config.userId;

    // Load user preferences to determine which services are configured
    await this.graph.loadPreferences(config.userId);

    // Start polling health checks (default 60s)
    this.graph.startPolling(config.pollIntervalMs ?? 60_000);

    this.started = true;
    console.log(`[SilentNode] Started for user ${config.userId} — ${this.registry.size} handlers registered`);
    console.log(`[SilentNode] Registered intents: ${this.registry.listIntents().join(', ')}`);
  }

  /**
   * Stop health monitoring and cleanup.
   * Call this on component unmount.
   */
  stop(): void {
    this.graph.stopPolling();
    this.started = false;
    console.log('[SilentNode] Stopped');
  }

  // ─── GPT Context Injection ─────────────────────────────────────────────

  /**
   * Generate the service availability context string for GPT-5.5.
   * Inject this into processTransmission() as the `serviceContext` parameter.
   *
   * Returns a formatted block like:
   *   === SERVICE AVAILABILITY ===
   *   spotify: ✅ healthy (120ms)
   *   tuya: ❌ unconfigured
   *   gcal: ⚠️ degraded (1200ms)
   */
  getServiceContext(): string {
    return this.graph.toContextString();
  }

  // ─── Intent Dispatch ───────────────────────────────────────────────────

  /**
   * Route a classified intent to its registered handler.
   *
   * Flow:
   * 1. Look up handler in IntentRegistry
   * 2. Check service dependencies via circuit breaker
   * 3. If blocked → run fallback handler (or speak error)
   * 4. If confirmation gate → set pending action
   * 5. Otherwise → execute directly
   * 6. Report success/failure to ServiceGraph
   *
   * @returns true if a handler was found and executed, false if no handler exists
   */
  async dispatch(result: RogerAIResponse, ctx: IntentContext): Promise<boolean> {
    return this.registry.dispatch(result, ctx);
  }

  /**
   * Convenience method to build an IntentContext from raw parameters.
   * Use this in UserHome.tsx to construct the context object.
   */
  buildContext(params: Parameters<typeof buildIntentContext>[0]): IntentContext {
    return buildIntentContext(params);
  }

  // ─── Query API ─────────────────────────────────────────────────────────

  /** Check if the node is currently running */
  get isRunning(): boolean {
    return this.started;
  }

  /** Get the current user ID */
  get currentUserId(): string | null {
    return this.userId;
  }

  /** Get the underlying ServiceGraph for direct queries */
  get serviceGraph(): ServiceGraph {
    return this.graph;
  }

  /** Get the underlying IntentRegistry for handler inspection */
  get intentRegistry(): IntentRegistry {
    return this.registry;
  }

  /** Get all service node statuses (for admin dashboard) */
  getServiceSnapshot() {
    return this.graph.getAllNodes().map(node => ({
      id: node.id,
      displayName: node.displayName,
      emoji: node.emoji,
      status: node.status,
      configured: node.configured,
      latencyMs: node.avgLatencyMs,
      circuitState: node.circuitState,
      lastError: node.lastError,
      lastChecked: node.lastCheckedAt,
    }));
  }

  /**
   * Force a pre-flight health check for a specific service.
   * Use before critical operations to ensure freshness.
   * Adds ~100-300ms but guarantees the service status is current.
   */
  async preflight(serviceId: Parameters<ServiceGraph['preflight']>[0]) {
    return this.graph.preflight(serviceId);
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _node: SilentNodeImpl | null = null;

export function getSilentNode(): SilentNodeImpl {
  if (!_node) _node = new SilentNodeImpl();
  return _node;
}

export type { SilentNodeImpl as SilentNode };
