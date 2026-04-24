// ─── Status System ───────────────────────────────────────────────────────────
export type StatusTier = 'success' | 'warning' | 'error' | 'neutral';

// ─── Navigation ──────────────────────────────────────────────────────────────
export interface NavItem {
  key: string;
  label: string;
  icon: string; // lucide icon name
  group: NavGroup;
}

export type NavGroup =
  | 'PTT NETWORK'
  | 'OPERATIONS'
  | 'AI & TESTING'
  | 'CONTENT'
  | 'ANALYTICS'
  | 'ADMIN';

// ─── Transmissions ───────────────────────────────────────────────────────────
export type TransmissionStatus = 'SUCCESS' | 'CLARIFICATION' | 'ERROR' | 'HIGH_AMBIGUITY';
export type IntentType =
  | 'CREATE_REMINDER'
  | 'MEMORY_CAPTURE'
  | 'WATCHLIST_QUERY'
  | 'BRIEFING_REQUEST'
  | 'CREATE_TASK'
  | 'BOOK_UPDATE'
  | 'UNKNOWN';

export interface Transmission {
  id: string;
  userId: string;
  deviceId: string;
  transcript: string;
  intent: IntentType;
  confidence: number; // 0–100
  ambiguity: number;  // 0–100
  status: TransmissionStatus;
  latencyMs: number;
  timestamp: string; // ISO string
  region: string;
}

// ─── Devices ─────────────────────────────────────────────────────────────────
export type DeviceStatus = 'online' | 'offline' | 'sync_issue';

export interface Device {
  id: string;
  userId: string;
  region: string;
  firmware: string;
  battery: number;    // 0–100
  signal: number;     // 0–100
  syncHealth: number; // 0–100
  queueDepth: number;
  status: DeviceStatus;
  lastSync: string; // relative string e.g. "2 MIN AGO"
}

// ─── Flow Steps ──────────────────────────────────────────────────────────────
export type FlowStepStatus = 'complete' | 'running' | 'failed' | 'skipped';

export interface FlowStep {
  index: number;
  label: string;
  latencyMs: number;
  status: FlowStepStatus;
  details?: { key: string; value: string }[];
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
export interface StatCardData {
  label: string;
  value: string;
  trend: string;
  trendUp: boolean;
  status: StatusTier;
  icon: string;
  /** Optional tooltip description shown on label hover via HelpBadge */
  tooltip?: string;
}

export interface HealthMetric {
  label: string;
  value: number; // 0–100
  status: StatusTier;
}

export interface AlertItem {
  level: 'warning' | 'info' | 'critical';
  message: string;
  time: string;
}

// ─── Sandbox ─────────────────────────────────────────────────────────────────
export interface TestSuite {
  name: string;
  passed: number;
  total: number;
}

export interface SimResult {
  label: string;
  value: string;
  status: StatusTier;
}

export interface ExtractedEntity {
  text: string;
  type: string;
  confidence: number;
}

// ─── Module Metadata (for placeholders) ──────────────────────────────────────
export interface ModuleInfo {
  key: string;
  title: string;
  subtitle: string;
  description: string;
  features: string[];
  phase: number;
}
