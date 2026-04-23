import type { Transmission, Device, FlowStep, StatCardData, HealthMetric, AlertItem, TestSuite, SimResult, ExtractedEntity, ModuleInfo } from '../types';

// ─── Dashboard KPIs ──────────────────────────────────────────────────────────
export const topKpis: StatCardData[] = [
  { label: 'ACTIVE USERS',       value: '24,847', trend: '+12.5%', trendUp: true,  status: 'success', icon: 'Users' },
  { label: 'CONNECTED DEVICES',  value: '18,203', trend: '+8.2%',  trendUp: true,  status: 'success', icon: 'Smartphone' },
  { label: 'TX TODAY',           value: '156.3K', trend: '+15.8%', trendUp: true,  status: 'neutral', icon: 'Radio' },
  { label: 'SUCCESS RATE',       value: '98.7%',  trend: '+0.3%',  trendUp: true,  status: 'success', icon: 'ShieldCheck' },
];

export const bottomKpis: StatCardData[] = [
  { label: 'SMART MOMENTUM',     value: '94.2%',  trend: '+1.8%',  trendUp: true,  status: 'neutral', icon: 'Zap' },
  { label: 'CLARIFICATION RATE', value: '4.3%',   trend: '-0.5%',  trendUp: false, status: 'neutral', icon: 'HelpCircle' },
  { label: 'AVG NODE LATENCY',   value: '127ms',  trend: '-12ms',  trendUp: false, status: 'success', icon: 'Timer' },
  { label: 'BRIEFING SUCCESS',   value: '99.1%',  trend: '+0.2%',  trendUp: true,  status: 'success', icon: 'Newspaper' },
];

export const healthMetrics: HealthMetric[] = [
  { label: 'AI PIPELINE',   value: 99.2, status: 'success' },
  { label: 'DEVICE SYNC',   value: 97.8, status: 'success' },
  { label: 'BRIEFING GEN',  value: 98.5, status: 'success' },
  { label: 'MEMORY GRAPH',  value: 99.8, status: 'success' },
];

export const alerts: AlertItem[] = [
  { level: 'warning', message: 'Ambiguity rate elevated in EU region (+2.3%)', time: '14 MIN AGO' },
  { level: 'info',    message: 'Device firmware 2.4.1 rolling out (34% complete)', time: '1 HR AGO' },
];

// ─── Transmissions ───────────────────────────────────────────────────────────
export const transmissions: Transmission[] = [
  {
    id: 'TX-89234', userId: 'USR-0041', deviceId: 'DEV-2049',
    transcript: 'Remind me to call Ahmad tomorrow at 2pm',
    intent: 'CREATE_REMINDER', confidence: 97, ambiguity: 12,
    status: 'SUCCESS', latencyMs: 142, timestamp: '14 MIN AGO', region: 'US-WEST',
  },
  {
    id: 'TX-89233', userId: 'USR-0117', deviceId: 'DEV-1847',
    transcript: 'Add this to my project notes',
    intent: 'MEMORY_CAPTURE', confidence: 94, ambiguity: 23,
    status: 'SUCCESS', latencyMs: 189, timestamp: '18 MIN AGO', region: 'EU-CENTRAL',
  },
  {
    id: 'TX-89232', userId: 'USR-0284', deviceId: 'DEV-5612',
    transcript: 'Remind me to follow up with him next week',
    intent: 'CREATE_REMINDER', confidence: 61, ambiguity: 78,
    status: 'CLARIFICATION', latencyMs: 156, timestamp: '22 MIN AGO', region: 'APAC-EAST',
  },
  {
    id: 'TX-89231', userId: 'USR-0041', deviceId: 'DEV-2049',
    transcript: "What's the price of gold right now",
    intent: 'WATCHLIST_QUERY', confidence: 99, ambiguity: 4,
    status: 'SUCCESS', latencyMs: 213, timestamp: '31 MIN AGO', region: 'US-WEST',
  },
  {
    id: 'TX-89230', userId: 'USR-0398', deviceId: 'DEV-8234',
    transcript: 'Tell me my morning briefing',
    intent: 'BRIEFING_REQUEST', confidence: 98, ambiguity: 8,
    status: 'SUCCESS', latencyMs: 298, timestamp: '47 MIN AGO', region: 'US-EAST',
  },
  {
    id: 'TX-89229', userId: 'USR-0519', deviceId: 'DEV-3928',
    transcript: 'Send error report to server',
    intent: 'UNKNOWN', confidence: 32, ambiguity: 91,
    status: 'ERROR', latencyMs: 504, timestamp: '1 HR AGO', region: 'EU-WEST',
  },
];

// ─── Devices ─────────────────────────────────────────────────────────────────
export const devices: Device[] = [
  { id: 'DEV-2049', userId: 'USR-0041', region: 'US-WEST',    firmware: '2.4.1', battery: 87, signal: 98, syncHealth: 99.8, queueDepth: 0,  status: 'online',      lastSync: '1 MIN AGO' },
  { id: 'DEV-1847', userId: 'USR-0117', region: 'EU-CENTRAL', firmware: '2.4.1', battery: 45, signal: 92, syncHealth: 99.2, queueDepth: 2,  status: 'online',      lastSync: '3 MIN AGO' },
  { id: 'DEV-5612', userId: 'USR-0284', region: 'APAC-EAST',  firmware: '2.4.0', battery: 23, signal: 78, syncHealth: 96.4, queueDepth: 5,  status: 'online',      lastSync: '7 MIN AGO' },
  { id: 'DEV-8234', userId: 'USR-0398', region: 'US-EAST',    firmware: '2.4.1', battery: 92, signal: 95, syncHealth: 100,  queueDepth: 0,  status: 'online',      lastSync: '2 MIN AGO' },
  { id: 'DEV-3928', userId: 'USR-0519', region: 'EU-WEST',    firmware: '2.3.8', battery: 68, signal: 88, syncHealth: 82.1, queueDepth: 18, status: 'sync_issue',  lastSync: '18 MIN AGO' },
];

// ─── Flow Steps ──────────────────────────────────────────────────────────────
export const flowSteps: FlowStep[] = [
  { index: 1,  label: 'PTT CAPTURE',       latencyMs: 12,  status: 'complete' },
  { index: 2,  label: 'TRANSCRIPTION',     latencyMs: 89,  status: 'complete' },
  { index: 3,  label: 'INTENT DETECTION',  latencyMs: 34,  status: 'complete', details: [{ key: 'CONFIDENCE', value: '97%' }] },
  { index: 4,  label: 'ENTITY EXTRACTION', latencyMs: 28,  status: 'complete', details: [{ key: 'ENTITIES', value: 'Ahmad, tomorrow, 2pm' }] },
  { index: 5,  label: 'CONTEXT RETRIEVAL', latencyMs: 45,  status: 'complete', details: [{ key: 'RETRIEVED', value: '3 items' }] },
  { index: 6,  label: 'AMBIGUITY CHECK',   latencyMs: 18,  status: 'complete', details: [{ key: 'SCORE', value: '12%' }] },
  { index: 7,  label: 'ACTION ROUTER',     latencyMs: 8,   status: 'complete', details: [{ key: 'ROUTED TO', value: 'REMINDER_NODE' }] },
  { index: 8,  label: 'NODE EXECUTION',    latencyMs: 67,  status: 'complete' },
  { index: 9,  label: 'MEMORY UPDATE',     latencyMs: 52,  status: 'complete' },
  { index: 10, label: 'SMART MOMENTUM',    latencyMs: 31,  status: 'complete' },
  { index: 11, label: 'PTT FEEDBACK',      latencyMs: 15,  status: 'complete' },
  { index: 12, label: 'UI COMPOSER',       latencyMs: 23,  status: 'complete' },
];

// ─── Sandbox ─────────────────────────────────────────────────────────────────
export const testSuites: TestSuite[] = [
  { name: 'REMINDERS',        passed: 23, total: 24 },
  { name: 'AMBIGUITY CASES',  passed: 14, total: 18 },
  { name: 'MEMORY CAPTURE',   passed: 31, total: 31 },
  { name: 'REGRESSION TESTS', passed: 45, total: 47 },
];

export const simResults: SimResult[] = [
  { label: 'INTENT DETECTED',    value: 'CREATE_REMINDER', status: 'success' },
  { label: 'CONFIDENCE SCORE',   value: '61%',             status: 'warning' },
  { label: 'AMBIGUITY SCORE',    value: '78%',             status: 'error'   },
  { label: 'CLARIFICATION',      value: 'REQUIRED',        status: 'warning' },
];

export const extractedEntities: ExtractedEntity[] = [
  { text: 'him',       type: 'PERSON', confidence: 34 },
  { text: 'next week', type: 'TIME',   confidence: 89 },
];

// ─── Under-Construction Module Metadata ──────────────────────────────────────
export const moduleInfoMap: Record<string, ModuleInfo> = {
  users: {
    key: 'users', phase: 2,
    title: 'USER REGISTRY', subtitle: 'ACCOUNT MANAGEMENT / OPERATOR RECORDS',
    description: 'Full operator and end-user account management. Inspect subscription tiers, linked devices, usage trends, support history, risk flags, and data compliance states.',
    features: ['User profiles & subscription tiers', 'Linked device state inspection', 'Usage trend timelines', 'Recent transmission history', 'Support case history', 'Data export & deletion requests', 'Account suspension controls'],
  },
  automation: {
    key: 'automation', phase: 2,
    title: 'AUTOMATION NODES', subtitle: 'AI WORKFLOW ENGINE / NODE LIBRARY',
    description: 'Manage the full node-based automation engine. Inspect routing logic, confidence thresholds, fallback chains, retry policies, and ambiguity gates across all AI flows.',
    features: ['Node library & definitions', 'Trigger & dependency mapping', 'Fallback / retry / timeout config', 'Confidence threshold management', 'Ambiguity gate controls', 'Draft / publish / rollback workflows', 'A/B workflow testing'],
  },
  clarifications: {
    key: 'clarifications', phase: 2,
    title: 'CLARIFICATION CENTER', subtitle: 'AMBIGUITY CONTROL / INTERCEPT MANAGEMENT',
    description: 'Inspect and tune the ambiguity handling system. Review high-ambiguity transmissions, configure clarification thresholds, manage disambiguation templates, and track unresolved intercept loops.',
    features: ['High-ambiguity transmission feed', 'Clarification rate analytics', 'Top ambiguous phrases', 'Person & time disambiguation rules', 'Clarification template manager', 'Safe-save-as-note fallback config', 'Unresolved loop tracker'],
  },
  memory: {
    key: 'memory', phase: 2,
    title: 'MEMORY GRAPH', subtitle: 'CONTEXT ENGINE / KNOWLEDGE NETWORK',
    description: 'Inspect the persistent AI memory and knowledge graph. Understand entity relationships, context retrieval logic, memory tagging, and why the system made specific associations.',
    features: ['Entity graph visualization', 'People, projects, topics, stories', 'Importance & recency scoring', 'Continuity link inspection', 'Memory update audit trail', 'Context retrieval explainability', 'Book & chapter routing logic'],
  },
  momentum: {
    key: 'momentum', phase: 2,
    title: 'SMART MOMENTUM', subtitle: 'PRIORITY ENGINE / DYNAMO CONTROL',
    description: 'Control the Smart Momentum priority engine. Tune ranking algorithms, manage card templates, monitor acceptance/snooze/dismiss rates, and configure suggestion timing.',
    features: ['Momentum card type management', 'Ranking algorithm tuning', 'Trigger source configuration', 'Open loop & overdue logic', 'Acceptance rate analytics', 'Time-of-day scheduling', 'Book & memory prompt control'],
  },
  briefings: {
    key: 'briefings', phase: 3,
    title: 'BRIEFING OPS', subtitle: 'AM/PM BRIEFING ENGINE / CONTENT OPERATIONS',
    description: 'Manage AM and PM briefing generation. Monitor source health, topic catalog, template quality, and generation success rates. Control personalization rules and regional content packs.',
    features: ['AM/PM generation monitoring', 'Topic catalog management', 'News source health dashboard', 'Template style management', 'Region & market packs', 'Fallback provider routing', 'Briefing latency tracking'],
  },
  watchlists: {
    key: 'watchlists', phase: 3,
    title: 'WATCHLISTS', subtitle: 'ASSET TRACKING / MARKET DATA FEEDS',
    description: 'Manage supported assets, market data feeds, alert thresholds, and user watchlist behaviors. Monitor data provider health and watch-to-briefing linking.',
    features: ['Asset & topic catalog', 'Alert threshold configuration', 'Data provider health monitoring', 'Fallback provider management', 'Regional interest configuration', 'Watch-to-briefing linking', 'User behavior analytics'],
  },
  books: {
    key: 'books', phase: 3,
    title: 'BOOKS & MEMORY VAULT', subtitle: 'LONG-FORM CONTENT / KNOWLEDGE ARCHIVE',
    description: 'Inspect and manage the Memory Vault and Book Builder systems. Monitor memory clustering, chapter generation quality, continuation prompts, and export operations.',
    features: ['Memory entry clustering', 'Theme & timeline grouping', 'Book & chapter management', 'Continuation prompt control', 'Export format configuration', 'Writing style options', 'Draft failure monitoring'],
  },
  voice: {
    key: 'voice', phase: 3,
    title: 'VOICE & AUDIO', subtitle: 'PTT FEEDBACK ENGINE / AUDIO OPERATIONS',
    description: 'Manage voice packs, PTT feedback phrase libraries, audio prompt templates, TTS provider routing, radio FX presets, and audio latency metrics.',
    features: ['Voice pack management', 'PTT feedback phrase library', 'Radio FX preset control', 'TTS provider routing', 'Cache rate monitoring', 'Latency metrics', 'Regional rollout controls'],
  },
  notifications: {
    key: 'notifications', phase: 3,
    title: 'NOTIFICATION CONTROL', subtitle: 'SIGNAL DISPATCH / ALERT MANAGEMENT',
    description: 'Manage all notification types — reminders, briefings, watchlist alerts, momentum prompts, and memory/chapter triggers. Control timing, frequency caps, and copy templates.',
    features: ['Notification type catalog', 'Quiet hours configuration', 'Frequency cap controls', 'Channel selection rules', 'Copy template editor', 'Delivery rate monitoring', 'User preference overrides'],
  },
  analytics: {
    key: 'analytics', phase: 2,
    title: 'ANALYTICS & TELEMETRY', subtitle: 'PLATFORM INTELLIGENCE / GROWTH METRICS',
    description: 'Full platform analytics. Monitor DAU/WAU/MAU, feature adoption, retention curves, premium conversion, flow latency, node performance, and device reliability.',
    features: ['DAU / WAU / MAU tracking', 'Feature adoption funnels', 'Retention cohort analysis', 'Premium conversion metrics', 'Ambiguity & clarification rates', 'Node performance analytics', 'Device reliability scoring'],
  },
  billing: {
    key: 'billing', phase: 4,
    title: 'BILLING & ENTITLEMENTS', subtitle: 'SUBSCRIPTION MANAGEMENT / PLAN CONTROL',
    description: 'Manage subscription plans, feature entitlements, usage limits, trial management, and premium upgrades. Monitor conversion and churn at plan level.',
    features: ['Free vs premium plan management', 'Feature entitlement controls', 'Usage limit configuration', 'Trial lifecycle management', 'Premium voice pack access', 'Device-linked subscriptions', 'Churn & conversion analytics'],
  },
  support: {
    key: 'support', phase: 3,
    title: 'SUPPORT OPS', subtitle: 'CASE MANAGEMENT / OPERATOR ASSIST',
    description: 'Support operations center. Inspect user issues, failed transmissions, device sync problems, and replay safe AI traces. Manage tickets, escalations, and resolutions.',
    features: ['Support ticket management', 'User & device context panel', 'Failed flow inspection', 'Safe transmission replay', 'Support action toolkit', 'Case notes & escalation', 'Resolution tracking'],
  },
  safety: {
    key: 'safety', phase: 4,
    title: 'TRUST & SAFETY', subtitle: 'POLICY ENFORCEMENT / COMPLIANCE CONTROL',
    description: 'Monitor and manage content policy, flagged transmissions, privacy compliance, deletion requests, and abuse detection. Review safe admin access logs.',
    features: ['Flagged content feed', 'Policy trigger management', 'Deletion & export requests', 'Retention policy controls', 'Abuse detection patterns', 'Admin access audit', 'Compliance reporting'],
  },
  flags: {
    key: 'flags', phase: 4,
    title: 'FEATURE FLAGS', subtitle: 'EXPERIMENT CONTROL / STAGED ROLLOUTS',
    description: 'Manage feature flags, A/B experiments, staged rollouts, and regional releases. Control beta features, voice experiments, UI tests, and threshold experiments with one-click rollback.',
    features: ['Feature flag catalog', 'A/B experiment management', 'Staged rollout controls', 'Regional release targeting', 'Voice & UI experiments', 'Threshold experiment testing', 'One-click rollback'],
  },
  audit: {
    key: 'audit', phase: 4,
    title: 'AUDIT LOG', subtitle: 'SYSTEM JOURNAL / ADMIN ACTION TRAIL',
    description: 'Complete audit trail of every admin action. Who changed what, when, with before/after state, reason codes, and approval chains for sensitive operations.',
    features: ['Full admin action journal', 'Before/after state diffs', 'Reason & approval trails', 'Sensitive action flagging', 'Filterable by admin & module', 'Exportable compliance reports', 'Tamper-evident log storage'],
  },
  settings: {
    key: 'settings', phase: 4,
    title: 'SYSTEM SETTINGS', subtitle: 'GLOBAL CONFIGURATION / PLATFORM CONTROLS',
    description: 'Global platform configuration. Manage AI model routing, default confidence thresholds, ambiguity policies, Smart Momentum weights, briefing sources, and retention policies.',
    features: ['AI model routing config', 'Default confidence thresholds', 'Ambiguity policy rules', 'Smart Momentum weight tuning', 'Briefing source priorities', 'Notification defaults', 'Retention & privacy policies'],
  },
};
