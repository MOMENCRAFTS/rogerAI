import { useState, useEffect, useMemo } from 'react';
import { Brain, Zap, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { RogerIcon } from '../components/icons';
import HelpBadge from '../components/shared/HelpBadge';
import { COMMAND_PROMPT, SURFACE_PROMPT, PRIORITY_PROMPT } from '../lib/openai';
import { getVocabPrompt, getDrillPrompt, getConversationPrompt, getProgressPrompt } from '../lib/academyPrompts';
import { getServiceGraph } from '../lib/serviceGraph';
import { getIntentRegistry } from '../lib/intentRegistry';
import type { ServiceNode } from '../lib/serviceGraph';

// ─── Tab definition ───────────────────────────────────────────────────────────
const TABS = [
  { key: 'prompt',   label: 'COMMAND PROMPT', iconName: 'brain', tooltip: 'Core GPT-5.5 system prompt' },
  { key: 'edge',     label: 'EDGE FUNCTIONS', iconName: 'mode-always-on', tooltip: 'Server-side AI functions' },
  { key: 'services', label: 'SERVICE GRAPH',  iconName: 'svc-supabase', tooltip: 'Live service health' },
  { key: 'intents',  label: 'INTENT MAP',     iconName: 'badge-cadet', tooltip: 'Dispatch handler registry' },
  { key: 'aux',      label: 'AUX PROMPTS',    iconName: 'memory', tooltip: 'Secondary AI prompts' },
] as const;
type TabKey = typeof TABS[number]['key'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function estimateTokens(text: string) { return Math.ceil(text.length / 4); }

function parsePromptSections(prompt: string) {
  const lines = prompt.split('\n');
  const sections: { title: string; content: string }[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  for (const line of lines) {
    if (line.startsWith('═══') && cur) continue;
    const nextLine = lines[lines.indexOf(line) + 1];
    if (nextLine?.startsWith('═══') && !line.startsWith('═══') && line.trim()) {
      if (cur) sections.push({ title: cur.title, content: cur.lines.join('\n') });
      cur = { title: line.trim(), lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) sections.push({ title: cur.title, content: cur.lines.join('\n') });
  if (!sections.length) sections.push({ title: 'FULL PROMPT', content: prompt });
  return sections;
}

const STATUS_STYLE: Record<string, { color: string; label: string; iconName: string }> = {
  healthy:      { color: 'var(--green)', label: 'HEALTHY',      iconName: 'status-healthy' },
  degraded:     { color: 'var(--amber)', label: 'DEGRADED',     iconName: 'status-degraded' },
  down:         { color: 'var(--rust)',  label: 'DOWN',          iconName: 'status-down' },
  unconfigured: { color: 'var(--text-muted)', label: 'NOT SET', iconName: 'status-unconfigured' },
  unknown:      { color: 'var(--text-muted)', label: 'UNKNOWN', iconName: 'status-unknown' },
};

const EDGE_FNS: { name: string; category: string; desc: string }[] = [
  { name: 'process-transmission', category: 'AI Core', desc: 'Main GPT-5.5 PTT processor' },
  { name: 'extract-memory-facts', category: 'AI Core', desc: 'Memory fact extraction (gpt-5.4-mini)' },
  { name: 'classify-priority', category: 'AI Core', desc: 'Priority action classifier' },
  { name: 'generate-surface-script', category: 'AI Core', desc: 'Proactive surfacing script' },
  { name: 'response-guard', category: 'AI Core', desc: 'Output quality gate' },
  { name: 'roger-think', category: 'AI Core', desc: 'Talkative mode proactive thought' },
  { name: 'detect-patterns', category: 'AI Core', desc: 'Behavioral pattern detection' },
  { name: 'request-tune-in', category: 'PTT Network', desc: 'Initiate peer session' },
  { name: 'accept-tune-in', category: 'PTT Network', desc: 'Accept session request' },
  { name: 'decline-tune-in', category: 'PTT Network', desc: 'Decline session request' },
  { name: 'end-tune-in', category: 'PTT Network', desc: 'End active session' },
  { name: 'relay-message', category: 'PTT Network', desc: 'Voice message relay' },
  { name: 'relay-session-turn', category: 'PTT Network', desc: 'Live session turn relay' },
  { name: 'get-relay-queue', category: 'PTT Network', desc: 'Fetch pending messages' },
  { name: 'summarize-session', category: 'PTT Network', desc: 'AI session debrief' },
  { name: 'google-calendar', category: 'Integrations', desc: 'GCal event CRUD' },
  { name: 'notion-sync', category: 'Integrations', desc: 'Notion page push' },
  { name: 'twilio-sms', category: 'Integrations', desc: 'SMS via Twilio' },
  { name: 'tuya-control', category: 'Integrations', desc: 'Smart home control' },
  { name: 'radio-search', category: 'Integrations', desc: 'Radio Browser proxy' },
  { name: 'tts-proxy', category: 'Integrations', desc: 'Text-to-speech proxy' },
  { name: 'whisper-transcribe', category: 'Integrations', desc: 'Whisper STT proxy' },
  { name: 'identify-music', category: 'Integrations', desc: 'Ambient music ID' },
  { name: 'morning-briefing', category: 'Scheduled', desc: 'AM/PM daily briefing' },
  { name: 'weekly-digest', category: 'Scheduled', desc: 'Weekly summary digest' },
  { name: 'email-digest', category: 'Scheduled', desc: 'Email processing' },
  { name: 'check-reminders', category: 'Scheduled', desc: 'Due reminder checker' },
  { name: 'compute-stats', category: 'Scheduled', desc: 'Platform stats aggregator' },
  { name: 'commute-eta', category: 'Scheduled', desc: 'Commute ETA calculator' },
  { name: 'device-relay', category: 'Utilities', desc: 'Hardware device relay' },
  { name: 'analyse-ambient', category: 'Utilities', desc: 'Ambient audio analysis' },
  { name: 'generate-meeting-notes', category: 'Utilities', desc: 'Meeting notes compiler' },
];

const CATEGORY_COLORS: Record<string, string> = {
  'AI Core': '#e74c3c', 'PTT Network': '#6366f1', 'Integrations': '#2ecc71',
  'Scheduled': '#f39c12', 'Utilities': '#95a5a6',
};

// ─── Tab 1: Command Prompt ────────────────────────────────────────────────────
function PromptTab() {
  const sections = useMemo(() => parsePromptSections(COMMAND_PROMPT), []);
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));
  const [search, setSearch] = useState('');
  const tokens = estimateTokens(COMMAND_PROMPT);
  const toggle = (i: number) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });
  const q = search.toLowerCase();
  const filtered = q ? sections.filter(s => s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q)) : sections;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="border px-3 py-1.5 font-mono text-nano" style={{ borderColor: 'var(--amber-border)', color: 'var(--amber)', background: 'rgba(212,160,68,0.08)' }}>
          {COMMAND_PROMPT.split('\n').length} LINES · {COMMAND_PROMPT.length.toLocaleString()} CHARS · ~{tokens.toLocaleString()} TOKENS
        </div>
        <div className="border px-3 py-1.5 font-mono text-nano" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
          {sections.length} SECTIONS
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search prompt..."
            className="w-full font-mono text-nano" style={{ padding: '7px 10px 7px 28px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }} />
        </div>
      </div>
      {filtered.map((s, i) => {
        const idx = sections.indexOf(s);
        const isOpen = expanded.has(idx);
        const highlighted = q && s.content.toLowerCase().includes(q);
        return (
          <div key={i} className="border" style={{ borderColor: highlighted ? 'var(--amber-border)' : 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <button onClick={() => toggle(idx)} className="w-full flex items-center justify-between px-4 py-3 text-left"
              style={{ color: 'var(--text-primary)' }}>
              <span className="font-mono text-mini tracking-wider uppercase font-bold">{s.title}</span>
              {isOpen ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
            </button>
            {isOpen && (
              <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '12px 16px', maxHeight: 400, overflowY: 'auto' }}>
                <pre className="font-mono text-nano" style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7, margin: 0 }}>
                  {s.content}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab 2: Edge Functions ────────────────────────────────────────────────────
function EdgeTab() {
  const grouped = useMemo(() => {
    const map: Record<string, typeof EDGE_FNS> = {};
    EDGE_FNS.forEach(fn => { (map[fn.category] ??= []).push(fn); });
    return map;
  }, []);

  return (
    <div className="space-y-5">
      <div className="border px-3 py-1.5 font-mono text-nano inline-block" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
        {EDGE_FNS.length} EDGE FUNCTIONS · 5 CATEGORIES
      </div>
      {Object.entries(grouped).map(([cat, fns]) => (
        <div key={cat}>
          <div className="flex items-center gap-2 mb-3">
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: CATEGORY_COLORS[cat] ?? '#888' }} />
            <span className="font-mono text-nano tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>{cat} ({fns.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {fns.map(fn => (
              <div key={fn.name} className="border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <Zap size={10} style={{ color: CATEGORY_COLORS[cat] ?? '#888' }} />
                  <span className="font-mono text-mini font-bold" style={{ color: 'var(--text-primary)' }}>{fn.name}</span>
                </div>
                <p className="font-mono text-micro" style={{ color: 'var(--text-muted)', margin: 0 }}>{fn.desc}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tab 3: Service Graph ─────────────────────────────────────────────────────
function ServiceTab() {
  const [nodes, setNodes] = useState<ServiceNode[]>([]);
  useEffect(() => {
    const graph = getServiceGraph();
    setNodes(graph.getAllNodes());
    const unsub = graph.subscribe(() => setNodes([...graph.getAllNodes()]));
    return unsub;
  }, []);

  const healthy = nodes.filter(n => n.status === 'healthy').length;
  const configured = nodes.filter(n => n.configured).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="border px-3 py-1.5 font-mono text-nano" style={{ borderColor: 'var(--green-border)', color: 'var(--green)', background: 'var(--green-dim)' }}>
          {healthy}/{nodes.length} HEALTHY
        </div>
        <div className="border px-3 py-1.5 font-mono text-nano" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
          {configured} CONFIGURED
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {nodes.map(node => {
          const st = STATUS_STYLE[node.status] ?? STATUS_STYLE.unknown;
          return (
            <div key={node.id} className="border p-3 space-y-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RogerIcon name={node.iconName ?? 'mode-active'} size={16} color={st.color} />
                  <span className="font-mono text-mini font-bold" style={{ color: 'var(--text-primary)' }}>{node.displayName}</span>
                </div>
                <RogerIcon name={st.iconName} size={12} color={st.color} />
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-micro px-1.5 py-0.5 border" style={{ borderColor: st.color, color: st.color, background: 'transparent' }}>{st.label}</span>
                {node.avgLatencyMs > 0 && <span className="font-mono text-micro" style={{ color: 'var(--text-muted)' }}>{node.avgLatencyMs}ms</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-micro" style={{ color: 'var(--text-muted)' }}>
                  Circuit: <span style={{ color: node.circuitState === 'closed' ? 'var(--green)' : node.circuitState === 'open' ? 'var(--rust)' : 'var(--amber)' }}>
                    {node.circuitState.toUpperCase()}
                  </span>
                </span>
              </div>
              {node.fallbackTo && (
                <div className="font-mono text-micro" style={{ color: 'var(--text-muted)' }}>
                  Fallback → <span style={{ color: 'var(--amber)' }}>{node.fallbackTo}</span>
                </div>
              )}
              {node.lastError && (
                <div className="font-mono text-micro truncate" style={{ color: 'var(--rust)' }} title={node.lastError}>⚠ {node.lastError}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tab 4: Intent Handlers ───────────────────────────────────────────────────
function IntentTab() {
  const registry = useMemo(() => getIntentRegistry(), []);
  const intentList = useMemo(() => registry.listIntents(), [registry]);

  return (
    <div className="space-y-3">
      <div className="border px-3 py-1.5 font-mono text-nano inline-block" style={{ borderColor: 'var(--amber-border)', color: 'var(--amber)', background: 'rgba(212,160,68,0.08)' }}>
        {intentList.length} REGISTERED HANDLERS
      </div>
      <div className="border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['#', 'INTENT', 'TYPE'].map(h => (
                <th key={h} className="font-mono text-micro tracking-widest uppercase text-left px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {intentList.map((name, i) => {
              const isWild = name.endsWith('*');
              return (
                <tr key={name} style={{ borderBottom: '1px solid var(--border-dim)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(212,160,68,0.04)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td className="font-mono text-micro px-4 py-2" style={{ color: 'var(--text-muted)', width: 40 }}>{i + 1}</td>
                  <td className="font-mono text-mini px-4 py-2 font-bold" style={{ color: isWild ? 'var(--amber)' : 'var(--text-primary)' }}>{name}</td>
                  <td className="font-mono text-micro px-4 py-2" style={{ color: isWild ? 'var(--amber)' : 'var(--green)' }}>{isWild ? 'PREFIX' : 'EXACT'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab 5: Auxiliary Prompts ─────────────────────────────────────────────────
function AuxTab() {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setExpanded(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const prompts = useMemo(() => [
    { title: 'SURFACE PROMPT', desc: 'Proactive memory surfacing', text: SURFACE_PROMPT },
    { title: 'PRIORITY PROMPT', desc: 'Priority action classifier', text: PRIORITY_PROMPT },
    { title: 'ACADEMY: VOCAB', desc: 'Vocabulary teaching mode', text: getVocabPrompt('en' as never, 'fr' as never) },
    { title: 'ACADEMY: DRILL', desc: 'Quiz & drill mode', text: getDrillPrompt('en' as never, 'fr' as never) },
    { title: 'ACADEMY: CONVERSATION', desc: 'Free conversation practice', text: getConversationPrompt('en' as never, 'fr' as never) },
    { title: 'ACADEMY: PROGRESS', desc: 'Progress report generator', text: getProgressPrompt({ totalWords: 50, masteredWords: 20, streak: 7, accuracy: 85, targetLocale: 'fr' as never }) },
  ], []);

  return (
    <div className="space-y-2">
      {prompts.map((p, i) => {
        const isOpen = expanded.has(i);
        const tokens = estimateTokens(p.text);
        return (
          <div key={i} className="border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <button onClick={() => toggle(i)} className="w-full flex items-center justify-between px-4 py-3 text-left gap-3">
              <div>
                <span className="font-mono text-mini tracking-wider uppercase font-bold" style={{ color: 'var(--text-primary)' }}>{p.title}</span>
                <span className="font-mono text-micro ml-3" style={{ color: 'var(--text-muted)' }}>{p.desc}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono text-micro" style={{ color: 'var(--text-muted)' }}>~{tokens} tokens</span>
                {isOpen ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
              </div>
            </button>
            {isOpen && (
              <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '12px 16px', maxHeight: 350, overflowY: 'auto' }}>
                <pre className="font-mono text-nano" style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7, margin: 0 }}>
                  {p.text}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AIBrainViewer() {
  const [activeTab, setActiveTab] = useState<TabKey>('prompt');

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <Brain size={14} style={{ color: 'var(--amber)' }} />
          <h1 className="font-mono text-mini tracking-widest uppercase" style={{ color: 'var(--amber)' }}>AI BRAIN VIEWER</h1>
          <HelpBadge title="AI Brain Viewer" text="Read-only view of Roger's entire AI architecture: system prompts, edge functions, service graph, intent handlers, and auxiliary prompts." placement="bottom" />
          <span className="font-mono text-micro px-2 py-0.5 border ml-2" style={{ borderColor: 'var(--green-border)', color: 'var(--green)' }}>READ-ONLY</span>
        </div>
        <p className="font-mono text-nano tracking-wider" style={{ color: 'var(--text-muted)' }}>
          INSPECT ROGER'S AI ARCHITECTURE · PROMPTS · SERVICES · HANDLERS
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className="px-4 py-2.5 font-mono text-nano tracking-wider uppercase transition-all duration-150"
            style={{
              color: activeTab === tab.key ? 'var(--amber)' : 'var(--text-secondary)',
              borderBottom: activeTab === tab.key ? '2px solid var(--amber)' : '2px solid transparent',
              background: activeTab === tab.key ? 'rgba(212,160,68,0.06)' : 'transparent',
            }}
            onMouseEnter={e => { if (activeTab !== tab.key) (e.currentTarget.style.color = 'var(--text-primary)'); }}
            onMouseLeave={e => { if (activeTab !== tab.key) (e.currentTarget.style.color = 'var(--text-secondary)'); }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'prompt'   && <PromptTab />}
      {activeTab === 'edge'     && <EdgeTab />}
      {activeTab === 'services' && <ServiceTab />}
      {activeTab === 'intents'  && <IntentTab />}
      {activeTab === 'aux'      && <AuxTab />}
    </div>
  );
}
