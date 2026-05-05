import { useState, useEffect, useCallback } from 'react';
import {
  Users, ChevronRight, ChevronLeft, RefreshCw, Globe,
  Brain, Bell, ListChecks, Radio, MessageSquare,
  Moon, Shield, Trash2, AlertTriangle, Bot, Play,
  FileText, Zap, Eye,
} from 'lucide-react';
import {
  fetchAllUserProfiles, fetchUserStats, flushAllMemory, fullUserReset,
  fetchAiPersonas, previewAiPersona, commitAiPersona,
  advancePersonaLife, fetchPersonaEvents, fetchPersonaAiUsage,
  generatePersonaReport, deleteAdminUser,
  fetchPersonaConversation, fetchLiveSnapshot, simulatePersonaSession,
  fetchExecutionAudit, verifyAuditEntry,
  type DbUserProfile, type AiPersonaIdentity, type AiPersonaEvent,
  type AiUsageRow, type PersonaReport, type ConvTurn, type LiveSnapshot,
  type TraceEntry, type SessionResult, type SessionTraceTurn,
  type ExecutionAuditEntry, type ExecutionAuditSummary, type ExecutionAuditCategory,
} from '../lib/api';

const LANG: Record<string, string> = { en: 'English', ar: 'العربية', fr: 'Français', es: 'Español' };
const MC: Record<string, string> = {
  active:   'var(--green)',
  quiet:    'var(--text-muted)',
  briefing: 'var(--amber)',
};

function rel(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'NOW';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** Sanitise display_name — strip transcripts accidentally stored as names */
function cleanName(raw: string | null): string {
  if (!raw) return 'Unnamed';
  const t = raw.trim();
  // If it contains sentence-ending punctuation or is > 20 chars it's a transcript
  if (t.length > 20 || /[?.!]/.test(t)) {
    // Try to extract first capitalised word
    const m = t.match(/\b([A-Z][a-z]{1,14})\b/);
    return m ? m[1] : 'Unnamed';
  }
  return t;
}

type Stats = { memories: number; reminders: number; tasks: number; transmissions: number; conversations: number };

// ── Monospace stat card ──────────────────────────────────────────────────────
function StatCard({ label, value, color, Icon }: { label: string; value: number; color: string; Icon: React.ElementType }) {
  return (
    <div style={{
      padding: '12px 8px', background: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)', textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    }}>
      <Icon size={15} style={{ color }} />
      <span style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</span>
      <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────
function UserDetail({
  user, onBack, stats, sLoad, confirm, setConfirm, acting, doAction,
}: {
  user: DbUserProfile;
  onBack: () => void;
  stats: Stats | null;
  sLoad: boolean;
  confirm: 'flush' | 'reset' | null;
  setConfirm: (v: 'flush' | 'reset' | null) => void;
  acting: boolean;
  doAction: (t: 'flush' | 'reset') => void;
}) {
  const name = cleanName(user.display_name);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Detail header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: '1px solid var(--border-subtle)',
          padding: '6px 10px', cursor: 'pointer', color: 'var(--text-muted)',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <ChevronLeft size={13} />
          <span style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase' }}>Back</span>
        </button>
        <div style={{
          width: 34, height: 34, borderRadius: '50%',
          background: 'rgba(212,160,68,0.12)', border: '1px solid rgba(212,160,68,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <span style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--amber)', fontWeight: 700 }}>
            {name[0]?.toUpperCase() ?? '?'}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--amber)', margin: 0, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
          <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.user_id}</p>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

        {/* Badges */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: `1px solid ${user.onboarding_complete ? 'var(--green-border)' : 'var(--amber-border)'}`, background: user.onboarding_complete ? 'var(--green-dim)' : 'var(--amber-warn-dim)' }}>
            <Shield size={9} style={{ color: user.onboarding_complete ? 'var(--green)' : 'var(--amber)' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', color: user.onboarding_complete ? 'var(--green)' : 'var(--amber)' }}>
              {user.onboarding_complete ? 'Onboarded' : 'Pending'}
            </span>
          </div>
          {user.islamic_mode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: '1px solid var(--olive-border)', background: 'var(--olive-dim)' }}>
              <Moon size={9} style={{ color: 'var(--text-secondary)' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Islamic</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <Globe size={9} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {LANG[user.language] ?? user.language} · {user.timezone}
            </span>
          </div>
        </div>

        {/* Profile grid — 2 cols on mobile */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
          {([
            ['Mode',     user.roger_mode.toUpperCase()],
            ['Language', LANG[user.language] ?? user.language],
            ['Timezone', user.timezone],
            ['Tour',     user.tour_seen ? 'Yes' : 'No'],
            ['Islamic',  user.islamic_mode ? 'On' : 'Off'],
            ['Active',   rel(user.updated_at)],
          ] as [string, string][]).map(([l, v]) => (
            <div key={l} style={{ padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 3px' }}>{l}</p>
              <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</p>
            </div>
          ))}
        </div>

        {/* Stats */}
        <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 8 }}>User Data</p>
        {sLoad ? (
          <div style={{ height: 72, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 20, opacity: 0.5 }} />
        ) : stats ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 20 }}>
            <StatCard label="MEM"  value={stats.memories}      color="var(--amber)"          Icon={Brain} />
            <StatCard label="REM"  value={stats.reminders}     color="var(--green)"           Icon={Bell} />
            <StatCard label="TASK" value={stats.tasks}         color="var(--olive)"           Icon={ListChecks} />
            <StatCard label="TX"   value={stats.transmissions} color="var(--text-secondary)"  Icon={Radio} />
            <StatCard label="CONV" value={stats.conversations} color="var(--text-secondary)"  Icon={MessageSquare} />
          </div>
        ) : null}

        {/* Danger zone */}
        <p style={{ fontFamily: 'monospace', fontSize: 9, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 8 }}>Danger Zone</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button onClick={() => setConfirm('flush')} style={{
            flex: 1, minWidth: 120, padding: '10px 12px', fontFamily: 'monospace', fontSize: 10,
            textTransform: 'uppercase', cursor: 'pointer',
            border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#f87171',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Brain size={11} />Flush Memory
          </button>
          <button onClick={() => setConfirm('reset')} style={{
            flex: 1, minWidth: 120, padding: '10px 12px', fontFamily: 'monospace', fontSize: 10,
            textTransform: 'uppercase', cursor: 'pointer',
            border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.1)', color: '#f87171',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Trash2 size={11} />Factory Reset
          </button>
        </div>

        {confirm && (
          <div style={{ padding: '14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <AlertTriangle size={12} style={{ color: '#f87171', flexShrink: 0 }} />
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#f87171' }}>
                {confirm === 'flush' ? 'Erase all memory & conversations?' : 'Full factory reset — all data wiped?'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => doAction(confirm)} disabled={acting} style={{
                flex: 1, padding: '9px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase',
                cursor: 'pointer', border: '1px solid rgba(239,68,68,0.5)',
                background: 'rgba(239,68,68,0.15)', color: '#f87171', opacity: acting ? 0.5 : 1,
              }}>
                {acting ? 'Working…' : 'Confirm'}
              </button>
              <button onClick={() => setConfirm(null)} style={{
                flex: 1, padding: '9px', fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase',
                cursor: 'pointer', border: '1px solid var(--border-subtle)',
                background: 'transparent', color: 'var(--text-muted)',
              }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function UserRegistry({ initialTab = 'users' }: { initialTab?: 'users' | 'personas' }) {
  const [tab,     setTab]     = useState<'users' | 'personas'>(initialTab);
  const [users,   setUsers]   = useState<DbUserProfile[]>([]);
  const [sel,     setSel]     = useState<DbUserProfile | null>(null);
  const [stats,   setStats]   = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [search,  setSearch]  = useState('');
  const [sLoad,   setSLoad]   = useState(false);
  const [confirm, setConfirm] = useState<'flush' | 'reset' | null>(null);
  const [acting,  setActing]  = useState(false);

  // AI Personas state
  const [personas,      setPersonas]      = useState<DbUserProfile[]>([]);
  const [pLoading,      setPLoading]      = useState(false);
  const [pError,        setPError]        = useState<string | null>(null);
  const [selPersona,    setSelPersona]    = useState<DbUserProfile | null>(null);
  const [inspectorTab,  setInspectorTab]  = useState<'overview' | 'story' | 'aistack' | 'live' | 'audit'>('overview');

  // Audit tab state
  const [auditEntries,  setAuditEntries]  = useState<ExecutionAuditEntry[]>([]);
  const [auditSummary,  setAuditSummary]  = useState<ExecutionAuditSummary | null>(null);
  const [auditLoading,  setAuditLoading]  = useState(false);
  const [auditError,    setAuditError]    = useState<string | null>(null);
  const [auditFilter,   setAuditFilter]   = useState<ExecutionAuditCategory | 'all'>('all');
  const [auditRange,    setAuditRange]    = useState<'today' | '7d' | '30d' | 'all'>('7d');
  const [verifyingId,   setVerifyingId]   = useState<string | null>(null);
  const [verifyResult,  setVerifyResult]  = useState<Record<string, { exists: boolean; current_status: string | null }>>({});
  const [personaEvents, setPersonaEvents] = useState<AiPersonaEvent[]>([]);
  const [personaUsage,  setPersonaUsage]  = useState<AiUsageRow[]>([]);
  const [personaReport, setPersonaReport] = useState<PersonaReport | null>(null);
  const [spawnPhase,    setSpawnPhase]    = useState<'idle' | 'generating' | 'review' | 'committing' | 'done'>('idle');
  const [previewData,   setPreviewData]   = useState<AiPersonaIdentity | null>(null);
  const [spawnArch,     setSpawnArch]     = useState('');
  const [spawnResult,   setSpawnResult]   = useState<{ callsign: string; name: string } | null>(null);
  const [advancingId,   setAdvancingId]   = useState<string | null>(null);
  const [advResult,     setAdvResult]     = useState<{ summary: string; detail: Record<string, unknown> } | null>(null);
  const [scenario,      setScenario]      = useState('');
  const [useScenario,   setUseScenario]   = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [deletingId,    setDeletingId]    = useState<string | null>(null);
  const [pSearch,       setPSearch]       = useState('');
  // Live tab state

  // Analytics bar state (Phase 2)
  const [analyticsData,   setAnalyticsData]   = useState<import('../lib/api').PersonaAnalytics | null>(null);
  const [analyticsLoad,   setAnalyticsLoad]   = useState(false);
  const [analyticsOpen,   setAnalyticsOpen]   = useState(true);
  // Batch advance state (Phase 3)
  const [batchRunning,    setBatchRunning]    = useState(false);
  const [batchProgress,   setBatchProgress]   = useState<{ done: number; total: number; current: string } | null>(null);
  // Quick Test state (Phase 4)
  const [quickTestOpen,   setQuickTestOpen]   = useState(false);
  const [qtInput,         setQtInput]         = useState('');
  const [qtPersona,       setQtPersona]       = useState<string>('');
  const [qtRunning,       setQtRunning]       = useState(false);
  const [qtResult,        setQtResult]        = useState<SessionResult | null>(null);
  const [qtError,         setQtError]         = useState<string | null>(null);

  // Live tab state
  const [convTurns,     setConvTurns]     = useState<ConvTurn[]>([]);
  const [liveSnap,      setLiveSnap]      = useState<LiveSnapshot | null>(null);
  const [liveLoading,   setLiveLoading]   = useState(false);
  const [livePoll,      setLivePoll]      = useState<ReturnType<typeof setInterval> | null>(null);
  const [pttInput,      setPttInput]      = useState('');
  const [pttFiring,     setPttFiring]     = useState(false);
  const [lastRefresh,   setLastRefresh]   = useState<Date | null>(null);
  const [expandedTrace, setExpandedTrace] = useState<Set<string>>(new Set());
  const [sessionRunning, setSessionRunning] = useState(false);
  const [sessionResult,  setSessionResult]  = useState<SessionResult | null>(null);
  const [sessionTurns,   setSessionTurns]   = useState(4);
  const [sessionError,   setSessionError]   = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchAllUserProfiles()
      .then(d => { setUsers(d); setLoading(false); })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load users');
        setLoading(false);
      });
  }, []);

  const loadPersonas = useCallback(() => {
    setPLoading(true); setPError(null);
    fetchAiPersonas()
      .then(d => { setPersonas(d); setPLoading(false); })
      .catch((e: unknown) => { setPError(String(e)); setPLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === 'personas') loadPersonas(); }, [tab, loadPersonas]);

  // Load analytics when Personas tab opens
  useEffect(() => {
    if (tab !== 'personas') return;
    setAnalyticsLoad(true);
    import('../lib/api').then(m => m.fetchPersonaAnalytics())
      .then(d => { setAnalyticsData(d); setAnalyticsLoad(false); })
      .catch(() => setAnalyticsLoad(false));
  }, [tab]);

  useEffect(() => {
    if (!sel) { setStats(null); return; }
    setSLoad(true);
    fetchUserStats(sel.user_id)
      .then(s => { setStats(s); setSLoad(false); })
      .catch(() => setSLoad(false));
  }, [sel]);

  useEffect(() => {
    if (!selPersona) { setPersonaEvents([]); setPersonaUsage([]); setPersonaReport(null); return; }
    const uid = selPersona.user_id;
    fetchPersonaEvents(uid).then(setPersonaEvents).catch(() => {});
    fetchPersonaAiUsage(uid).then(setPersonaUsage).catch(() => {});
  }, [selPersona]);

  // Live tab: load + poll every 6s
  const loadLive = useCallback((uid: string) => {
    setLiveLoading(true);
    Promise.all([
      fetchPersonaConversation(uid, 80),
      fetchLiveSnapshot(uid),
    ]).then(([turns, snap]) => {
      setConvTurns(turns);
      setLiveSnap(snap);
      setLastRefresh(new Date());
      setLiveLoading(false);
    }).catch(() => setLiveLoading(false));
  }, []);

  useEffect(() => {
    if (!selPersona || inspectorTab !== 'live') {
      if (livePoll) { clearInterval(livePoll); setLivePoll(null); }
      return;
    }
    const uid = selPersona.user_id;
    loadLive(uid);
    const id = setInterval(() => loadLive(uid), 6000);
    setLivePoll(id);
    return () => { clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selPersona, inspectorTab]);

  const filtered = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.user_id.toLowerCase().includes(q)
      || (u.display_name ?? '').toLowerCase().includes(q)
      || cleanName(u.display_name).toLowerCase().includes(q);
  });

  const filteredPersonas = personas.filter(p => {
    if (!pSearch) return true;
    const q = pSearch.toLowerCase();
    const id = (p.ai_persona_identity as Record<string,unknown>) ?? {};
    return (p.display_name ?? '').toLowerCase().includes(q)
      || String(id.archetype ?? '').toLowerCase().includes(q)
      || String(id.city ?? '').toLowerCase().includes(q);
  });

  const doAction = async (type: 'flush' | 'reset') => {
    if (!sel) return;
    setActing(true);
    try {
      type === 'flush' ? await flushAllMemory(sel.user_id) : await fullUserReset(sel.user_id);
    } catch {}
    setConfirm(null);
    setActing(false);
    if (type === 'reset') { setSel(null); load(); }
    else fetchUserStats(sel.user_id).then(setStats).catch(() => {});
  };

  // ── Vitality score ──────────────────────────────────────────────────────────
  function vitality(u: DbUserProfile): number {
    const ev = personaEvents.filter(e => e.user_id === u.user_id);
    const mem  = Math.min((personaUsage.filter(r => r.function_name === 'advance-persona-life').length / 30) * 40, 40);
    const conv = Math.min((ev.length / 10) * 30, 30);
    const spawned = new Date((u as unknown as Record<string,string>).last_advanced_at ?? u.updated_at);
    const ageH = (Date.now() - spawned.getTime()) / 3600000;
    const age  = ageH < 72 ? 10 : ageH < 168 ? 7 : 3;
    return Math.round(mem + conv + 20 + age);
  }

  function vColor(score: number) { return score >= 80 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444'; }

  // ── Persona advance handler ─────────────────────────────────────────────────
  const handleAdvance = async (uid: string) => {
    setAdvancingId(uid); setAdvResult(null);
    try {
      const r = await advancePersonaLife(uid, useScenario && scenario ? scenario : undefined);
      setAdvResult({ summary: r.summary, detail: r.detail });
      setScenario(''); setUseScenario(false);
      loadPersonas();
      if (selPersona?.user_id === uid) {
        fetchPersonaEvents(uid).then(setPersonaEvents).catch(() => {});
      }
    } catch (e) { setAdvResult({ summary: String(e), detail: {} }); }
    setAdvancingId(null);
  };

  // ── Spawn handlers ──────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    setSpawnPhase('generating'); setPreviewData(null);
    try {
      const r = await previewAiPersona(spawnArch || undefined);
      setPreviewData(r.persona); setSpawnPhase('review');
    } catch { setSpawnPhase('idle'); }
  };

  const handleCommit = async () => {
    if (!previewData) return;
    setSpawnPhase('committing');
    try {
      const r = await commitAiPersona(previewData);
      setSpawnResult({ callsign: r.callsign, name: String(previewData.name) });
      setSpawnPhase('done'); loadPersonas();
    } catch { setSpawnPhase('review'); }
  };

  // ── Report handler ──────────────────────────────────────────────────────────
  const handleReport = async (uid: string) => {
    setReportLoading(true); setPersonaReport(null);
    try {
      const r = await generatePersonaReport(uid);
      setPersonaReport(r);
      fetchPersonaEvents(uid).then(setPersonaEvents).catch(() => {});
    } catch {}
    setReportLoading(false);
  };

  // ── Delete handler ──────────────────────────────────────────────────────────
  const handleDelete = async (uid: string) => {
    if (!window.confirm('Permanently delete this persona and ALL their data?')) return;
    setDeletingId(uid);
    try {
      await deleteAdminUser(uid);
      if (selPersona?.user_id === uid) setSelPersona(null);
      loadPersonas();
    } catch (e) { alert(String(e)); }
    setDeletingId(null);
  };

  // ── Detail view ─────────────────────────────────────────────────────────────
  if (sel) {
    return (
      <UserDetail
        user={sel}
        onBack={() => { setSel(null); setConfirm(null); }}
        stats={stats}
        sLoad={sLoad}
        confirm={confirm}
        setConfirm={setConfirm}
        acting={acting}
        doAction={doAction}
      />
    );
  }

  // ── AI Persona Inspector ────────────────────────────────────────────────────
  if (selPersona) {
    const id = (selPersona.ai_persona_identity as AiPersonaIdentity) ?? {} as AiPersonaIdentity;
    const spawnEvent = personaEvents.find(e => e.event_type === 'spawn');
    const spawnedAt  = spawnEvent ? new Date(spawnEvent.created_at) : new Date(selPersona.updated_at);
    const lifespanH  = Math.round((Date.now() - spawnedAt.getTime()) / 3600000);
    const totalCost  = personaUsage.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    const totalTok   = personaUsage.reduce((s, r) => s + (r.total_tokens ?? 0), 0);
    const fnMap: Record<string, { calls: number; tokens: number; cost: number; latMs: number[] }> = {};
    personaUsage.forEach(r => {
      if (!fnMap[r.function_name]) fnMap[r.function_name] = { calls: 0, tokens: 0, cost: 0, latMs: [] };
      fnMap[r.function_name].calls++;
      fnMap[r.function_name].tokens += r.total_tokens ?? 0;
      fnMap[r.function_name].cost   += Number(r.cost_usd ?? 0);
      fnMap[r.function_name].latMs.push(r.latency_ms ?? 0);
    });
    const score = vitality(selPersona);

    const tabBtn = (t: 'overview' | 'story' | 'aistack' | 'audit', label: string, tColor?: string) => (
      <button onClick={() => setInspectorTab(t)} style={{
        padding: '7px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
        letterSpacing: '0.1em', cursor: 'pointer', border: 'none',
        borderBottom: inspectorTab === t ? `2px solid ${tColor ?? 'var(--amber)'}` : '2px solid transparent',
        background: 'transparent',
        color: inspectorTab === t ? (tColor ?? 'var(--amber)') : 'var(--text-muted)',
      }}>{label}</button>
    );

    // ── Audit tab data loader ──────────────────────────────────────────────
    const loadAudit = () => {
      if (!selPersona) return;
      setAuditLoading(true); setAuditError(null);
      const now = new Date();
      let dateFrom: string | undefined;
      if (auditRange === 'today') dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      else if (auditRange === '7d') dateFrom = new Date(now.getTime() - 7 * 86400000).toISOString();
      else if (auditRange === '30d') dateFrom = new Date(now.getTime() - 30 * 86400000).toISOString();
      fetchExecutionAudit(selPersona.user_id, {
        dateFrom,
        category: auditFilter === 'all' ? undefined : auditFilter,
        limit: 200,
      }).then(r => {
        setAuditEntries(r.entries ?? []);
        setAuditSummary(r.summary ?? null);
        setAuditLoading(false);
      }).catch(e => {
        setAuditError(String(e));
        setAuditLoading(false);
      });
    };

    const handleVerify = async (entry: ExecutionAuditEntry) => {
      if (!entry.db_table || !entry.db_row_id) return;
      setVerifyingId(entry.id);
      try {
        const r = await verifyAuditEntry(entry.db_table, entry.db_row_id);
        setVerifyResult(prev => ({ ...prev, [entry.id]: r }));
      } catch { setVerifyResult(prev => ({ ...prev, [entry.id]: { exists: false, current_status: null } })); }
      setVerifyingId(null);
    };

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
        {/* Inspector header */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => setSelPersona(null)} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', padding: '5px 9px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <ChevronLeft size={12} /><span style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase' }}>Back</span>
          </button>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: vColor(score), flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--amber)', margin: 0, fontWeight: 700, textTransform: 'uppercase' }}>{id.name ?? selPersona.display_name}</p>
            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0 }}>{id.archetype} · {id.city} · Vitality {score}/100</p>
          </div>
          {/* View as User button */}
          <button style={{ padding: '7px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer', background: 'rgba(212,160,68,0.12)', border: '1px solid rgba(212,160,68,0.4)', color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Eye size={11} />View as User
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, padding: '0 8px' }}>
          {tabBtn('overview', 'Overview')}
          {tabBtn('story', 'Story')}
          {tabBtn('aistack', 'AI Stack')}
          <button onClick={() => setInspectorTab('live')} style={{
            padding: '7px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
            letterSpacing: '0.1em', cursor: 'pointer', border: 'none',
            borderBottom: inspectorTab === 'live' ? '2px solid #22c55e' : '2px solid transparent',
            background: 'transparent',
            color: inspectorTab === 'live' ? '#22c55e' : 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: inspectorTab === 'live' ? '#22c55e' : 'var(--text-muted)', display: 'inline-block', animation: inspectorTab === 'live' ? 'pulse 1.5s infinite' : 'none' }} />
            LIVE
          </button>
          {tabBtn('audit', '⚡ Audit', '#a78bfa')}
        </div>

        <div style={{ flex: 1, overflowY: inspectorTab === 'live' ? 'hidden' : 'auto', padding: inspectorTab === 'live' ? 0 : 16, display: 'flex', flexDirection: 'column' }}>

          {/* OVERVIEW TAB */}
          {inspectorTab === 'overview' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {([
                  ['Age', `${lifespanH}h`], ['Life Events', personaEvents.length],
                  ['AI Cost', `$${totalCost.toFixed(3)}`], ['Tokens', totalTok.toLocaleString()],
                  ['Profession', id.profession?.slice(0, 22) ?? '—'], ['Language', id.language ?? selPersona.language],
                  ['Islamic', id.islamic_mode ? 'On' : 'Off'], ['Mode', (id.roger_mode ?? selPersona.roger_mode)?.toUpperCase()],
                ] as [string, string | number][]).map(([l, v]) => (
                  <div key={l} style={{ padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', margin: '0 0 3px', letterSpacing: '0.1em' }}>{l}</p>
                    <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</p>
                  </div>
                ))}
              </div>
              <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', margin: '0 0 16px', lineHeight: 1.5 }}>"{id.why_roger}"</p>

              {/* Advance / Scenario panel */}
              <div style={{ padding: 14, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 16 }}>
                <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 10px' }}>Advance Life</p>
                <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                  <label style={{ fontFamily: 'monospace', fontSize: 10, color: useScenario ? 'var(--text-muted)' : 'var(--amber)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input type="radio" checked={!useScenario} onChange={() => setUseScenario(false)} /> Random (gpt-4o-mini)
                  </label>
                  <label style={{ fontFamily: 'monospace', fontSize: 10, color: useScenario ? 'var(--amber)' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input type="radio" checked={useScenario} onChange={() => setUseScenario(true)} /> Inject Scenario (gpt-5.5)
                  </label>
                </div>
                {useScenario && (
                  <textarea value={scenario} onChange={e => setScenario(e.target.value)} placeholder={`e.g. "${id.name?.split(' ')[0]} discovers her lab partner is leaving"`} rows={2} style={{ width: '100%', padding: '8px 10px', fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', boxSizing: 'border-box', marginBottom: 8, resize: 'vertical', outline: 'none' }} />
                )}
                <button
                  onClick={() => handleAdvance(selPersona.user_id)}
                  disabled={advancingId === selPersona.user_id}
                  style={{ padding: '9px 18px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: 'rgba(212,160,68,0.1)', border: '1px solid rgba(212,160,68,0.35)', color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 6, opacity: advancingId === selPersona.user_id ? 0.5 : 1 }}>
                  <Play size={10} />{advancingId === selPersona.user_id ? 'Simulating…' : 'Simulate Event'}
                </button>
                {advResult && (
                  <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
                    <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#22c55e', margin: '0 0 4px' }}>{advResult.summary}</p>
                    {(advResult.detail.new_conv_preview as string | null | undefined) && (
                      <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>+Conv: "{String(advResult.detail.new_conv_preview)}"</p>
                    )}
                  </div>
                )}
              </div>

              {/* Report */}
              <button onClick={() => handleReport(selPersona.user_id)} disabled={reportLoading} style={{ width: '100%', padding: '10px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 16, opacity: reportLoading ? 0.5 : 1 }}>
                <FileText size={11} />{reportLoading ? 'Generating Report…' : 'Generate Full Report'}
              </button>

              {personaReport && (() => {
                const tlog = (personaReport.trace_log ?? []) as TraceEntry[];
                const toggleTrace = (id: string) => setExpandedTrace(prev => {
                  const n = new Set(prev);
                  n.has(id) ? n.delete(id) : n.add(id);
                  return n;
                });
                return (
                  <div>
                    {/* Header */}
                    <div style={{ padding: '12px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>
                          Report v{personaReport.version} · {tlog.length} events traced
                        </p>
                        <button onClick={() => { const b = new Blob([JSON.stringify(personaReport, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `persona-report-v${personaReport.version}.json`; a.click(); }} style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border-subtle)', padding: '3px 8px', cursor: 'pointer', textTransform: 'uppercase' }}>⬇ JSON</button>
                      </div>
                      <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-primary)', margin: '0 0 10px', lineHeight: 1.6 }}>{personaReport.executive_summary}</p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                        {[
                          ['Events', personaReport.stats.life_events],
                          ['Conv Turns', personaReport.stats.total_conversations],
                          ['AI Tokens', personaReport.stats.total_tokens?.toLocaleString()],
                          ['Cost', `$${Number(personaReport.stats.total_cost_usd ?? 0).toFixed(4)}`],
                        ].map(([l, v]) => (
                          <div key={String(l)} style={{ padding: '6px', background: 'var(--bg-recessed)', textAlign: 'center' }}>
                            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: '0 0 1px', fontWeight: 700 }}>{v}</p>
                            <p style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase' }}>{l}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Trace log accordion */}
                    <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 6px' }}>
                      Backend Trace Log — Per Event
                    </p>
                    {tlog.map(entry => {
                      const open = expandedTrace.has(entry.event_id);
                      const typeColor = entry.event_type === 'spawn' ? '#22c55e' : entry.event_type === 'scenario' ? '#a78bfa' : entry.event_type === 'report' ? 'var(--amber)' : 'var(--text-muted)';
                      return (
                        <div key={entry.event_id} style={{ marginBottom: 4, border: `1px solid ${open ? 'rgba(212,160,68,0.3)' : 'var(--border-subtle)'}`, background: open ? 'rgba(212,160,68,0.03)' : 'var(--bg-elevated)' }}>
                          {/* Collapsed row — always visible */}
                          <button onClick={() => toggleTrace(entry.event_id)} style={{ width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}>
                            <span style={{ fontFamily: 'monospace', fontSize: 7, color: typeColor, border: `1px solid ${typeColor}`, padding: '1px 5px', textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>{entry.event_type.replace('_', ' ')}</span>
                            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.narrative ?? entry.summary}</span>
                            <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)', flexShrink: 0 }}>{entry.exchanges.length} Q&A · {entry.ai_calls.length} AI · ${entry.cost_usd.toFixed(4)}</span>
                            <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
                          </button>

                          {open && (
                            <div style={{ padding: '0 12px 12px' }}>
                              <p style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)', margin: '0 0 10px' }}>
                                {new Date(entry.timestamp).toLocaleString()} · {entry.model_used} · {entry.tokens_used} tokens · ${entry.cost_usd.toFixed(5)}
                              </p>

                              {/* Cron / Trigger */}
                              {entry.cron_triggers.length > 0 && (
                                <div style={{ marginBottom: 10 }}>
                                  <p style={{ fontFamily: 'monospace', fontSize: 7, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 4px' }}>⚙ Trigger</p>
                                  {entry.cron_triggers.map((t, i) => <p key={i} style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-secondary)', margin: '0 0 2px', paddingLeft: 8, borderLeft: '2px solid #22c55e' }}>{t}</p>)}
                                </div>
                              )}

                              {/* Q&A Exchanges */}
                              {entry.exchanges.length > 0 && (
                                <div style={{ marginBottom: 10 }}>
                                  <p style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 6px' }}>🎙 Conversation</p>
                                  {entry.exchanges.map((ex, i) => (
                                    <div key={i} style={{ marginBottom: 8 }}>
                                      <div style={{ padding: '6px 10px', background: 'rgba(212,160,68,0.08)', border: '1px solid rgba(212,160,68,0.2)', borderRadius: '6px 6px 0 0', marginBottom: 1 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                          <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--amber)', textTransform: 'uppercase' }}>User PTT</span>
                                          {ex.user_intent && <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'rgba(212,160,68,0.6)', border: '1px solid rgba(212,160,68,0.3)', padding: '0 4px' }}>{ex.user_intent}</span>}
                                        </div>
                                        <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--amber)', margin: 0 }}>{ex.user_msg}</p>
                                      </div>
                                      <div style={{ padding: '6px 10px', background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', borderTop: 'none', borderRadius: '0 0 6px 6px' }}>
                                        <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 2 }}>Roger Response</span>
                                        <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-primary)', margin: 0 }}>{ex.roger_reply}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* AI Nodes */}
                              {entry.ai_calls.length > 0 && (
                                <div style={{ marginBottom: 10 }}>
                                  <p style={{ fontFamily: 'monospace', fontSize: 7, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 4px' }}>🤖 AI Nodes Called</p>
                                  {entry.ai_calls.map((call, i) => (
                                    <div key={i} style={{ padding: '5px 8px', borderLeft: '2px solid #60a5fa', marginBottom: 3, background: 'rgba(96,165,250,0.04)' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-primary)' }}>{call.node}</span>
                                        <span style={{ fontFamily: 'monospace', fontSize: 8, color: call.success ? '#22c55e' : '#ef4444' }}>{call.success ? '✓' : '✗'}</span>
                                      </div>
                                      <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
                                        <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)' }}>Model: {call.model}</span>
                                        <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)' }}>↑{call.prompt_tokens} ↓{call.completion_tokens} tok</span>
                                        <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)' }}>${call.cost_usd.toFixed(5)}</span>
                                        <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)' }}>{call.latency_ms}ms</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Silent Nodes */}
                              {entry.silent_nodes.length > 0 && (
                                <div style={{ marginBottom: 10 }}>
                                  <p style={{ fontFamily: 'monospace', fontSize: 7, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 4px' }}>🔇 Silent Nodes</p>
                                  {entry.silent_nodes.map((n, i) => <p key={i} style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-secondary)', margin: '0 0 2px', paddingLeft: 8, borderLeft: '2px solid #a78bfa' }}>{n}</p>)}
                                </div>
                              )}

                              {/* DB Changes */}
                              {(() => {
                                const ch = entry.db_changes;
                                const any = ch.memories_added.length + ch.facts_added.length + ch.tasks_added.length + ch.tasks_completed.length + ch.reminders_triggered.length > 0;
                                if (!any) return null;
                                return (
                                  <div>
                                    <p style={{ fontFamily: 'monospace', fontSize: 7, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 4px' }}>💾 DB Changes</p>
                                    {ch.memories_added.map((m, i) => <p key={`m${i}`} style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-secondary)', margin: '0 0 2px', paddingLeft: 8, borderLeft: '2px solid #f59e0b' }}>+Memory: {m}</p>)}
                                    {ch.facts_added.map((f, i) => <p key={`f${i}`} style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-secondary)', margin: '0 0 2px', paddingLeft: 8, borderLeft: '2px solid #f59e0b' }}>+Fact: {f}</p>)}
                                    {ch.tasks_added.map((t, i) => <p key={`ta${i}`} style={{ fontFamily: 'monospace', fontSize: 8, color: '#22c55e', margin: '0 0 2px', paddingLeft: 8, borderLeft: '2px solid #22c55e' }}>+Task: {t}</p>)}
                                    {ch.tasks_completed.map((t, i) => <p key={`tc${i}`} style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', margin: '0 0 2px', paddingLeft: 8, borderLeft: '2px solid #22c55e', textDecoration: 'line-through' }}>✓ Task done: {t}</p>)}
                                    {ch.reminders_triggered.map((r, i) => <p key={`r${i}`} style={{ fontFamily: 'monospace', fontSize: 8, color: '#60a5fa', margin: '0 0 2px', paddingLeft: 8, borderLeft: '2px solid #60a5fa' }}>🔔 Fired: {r}</p>)}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* STORY TAB */}
          {inspectorTab === 'story' && (
            <div>
              <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 8px' }}>Life Events</p>
              {personaEvents.length === 0 && <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', marginBottom: 16 }}>No events yet.</p>}
              {personaEvents.slice(0, 20).map(e => (
                <div key={e.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 8, color: e.event_type === 'spawn' ? 'var(--green)' : e.event_type === 'scenario' ? '#a78bfa' : e.event_type === 'report' ? 'var(--amber)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap', marginTop: 1, border: '1px solid currentColor', padding: '1px 5px' }}>{e.event_type.replace('_', ' ')}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-primary)', margin: '0 0 2px' }}>{e.summary}</p>
                    <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', margin: 0 }}>{new Date(e.created_at).toLocaleString()} · {e.model_used} · ${Number(e.cost_usd ?? 0).toFixed(3)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* AI STACK TAB */}
          {inspectorTab === 'aistack' && (
            <div>
              <div style={{ padding: '12px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 16, display: 'flex', gap: 24 }}>
                <div><p style={{ fontFamily: 'monospace', fontSize: 18, color: 'var(--amber)', margin: 0, fontWeight: 700 }}>{personaUsage.length}</p><p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0 }}>AI Calls</p></div>
                <div><p style={{ fontFamily: 'monospace', fontSize: 18, color: 'var(--amber)', margin: 0, fontWeight: 700 }}>{totalTok.toLocaleString()}</p><p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0 }}>Tokens</p></div>
                <div><p style={{ fontFamily: 'monospace', fontSize: 18, color: 'var(--amber)', margin: 0, fontWeight: 700 }}>${totalCost.toFixed(3)}</p><p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0 }}>Cost</p></div>
              </div>
              <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 8px' }}>By Function</p>
              {Object.entries(fnMap).map(([fn, d]) => {
                const avgLat = d.latMs.length ? Math.round(d.latMs.reduce((a, b) => a + b, 0) / d.latMs.length) : 0;
                return (
                  <div key={fn} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 12, alignItems: 'center' }}>
                    <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-primary)', margin: 0 }}>{fn}</p>
                    <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>{d.calls}×</p>
                    <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>${d.cost.toFixed(3)}</p>
                    <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0 }}>{avgLat}ms</p>
                  </div>
                );
              })}
              {Object.keys(fnMap).length === 0 && <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>No AI calls yet.</p>}
            </div>
          )}

          {/* ── LIVE TAB ───────────────────────────────────────────────────── */}
          {inspectorTab === 'live' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>

              {/* Status bar */}
              <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: 'rgba(34,197,94,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: liveLoading ? 'var(--amber)' : '#22c55e', display: 'inline-block' }} />
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    {liveLoading ? 'Refreshing…' : `Live · ${convTurns.length} turns · refresh 6s`}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)' }}>
                    {lastRefresh ? lastRefresh.toLocaleTimeString() : ''}
                  </span>
                  <button onClick={() => loadLive(selPersona.user_id)} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', padding: '3px 7px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                    <RefreshCw size={9} />
                  </button>
                </div>
              </div>

              {/* Main area: left=conversation, right=widgets */}
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

                {/* PTT Conversation feed */}
                <div style={{ flex: 2, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-subtle)', overflow: 'hidden' }}>

                  {/* Persona avatar strip */}
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, background: 'var(--bg-elevated)' }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(212,160,68,0.15)', border: '2px solid rgba(212,160,68,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 13, color: 'var(--amber)', fontWeight: 700 }}>
                      {(id.name as string ?? '?')[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-primary)', margin: 0, fontWeight: 600 }}>{id.name ?? selPersona.display_name}</p>
                      <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', margin: 0 }}>{id.profession} · {id.city}</p>
                    </div>
                    <div style={{ marginLeft: 'auto', padding: '2px 7px', border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.08)' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#22c55e', textTransform: 'uppercase' }}>● Active</span>
                    </div>
                  </div>

                  {/* Bubbles scroll area */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {convTurns.length === 0 && !liveLoading && (
                      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <p style={{ fontFamily: 'monospace', fontSize: 28, margin: '0 0 8px' }}>🎙️</p>
                        <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>No conversations yet</p>
                        <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>Use Advance Life to generate the first interaction</p>
                      </div>
                    )}
                    {convTurns.map((turn, i) => {
                      const isUser = turn.role === 'user';
                      const showDate = i === 0 || new Date(convTurns[i-1].created_at).toDateString() !== new Date(turn.created_at).toDateString();
                      return (
                        <div key={turn.id}>
                          {showDate && (
                            <div style={{ textAlign: 'center', margin: '8px 0' }}>
                              <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '2px 10px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                {new Date(turn.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                              </span>
                            </div>
                          )}
                          <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 6 }}>
                            {!isUser && (
                              <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(212,160,68,0.15)', border: '1px solid rgba(212,160,68,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 2 }}>
                                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)' }}>R</span>
                              </div>
                            )}
                            <div style={{ maxWidth: '72%' }}>
                              <div style={{
                                padding: '8px 12px',
                                background: isUser ? 'rgba(212,160,68,0.12)' : 'var(--bg-elevated)',
                                border: `1px solid ${isUser ? 'rgba(212,160,68,0.25)' : 'var(--border-subtle)'}`,
                                borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                              }}>
                                <p style={{ fontFamily: 'monospace', fontSize: 11, color: isUser ? 'var(--amber)' : 'var(--text-primary)', margin: 0, lineHeight: 1.5 }}>
                                  {turn.content}
                                </p>
                              </div>
                              <div style={{ display: 'flex', gap: 6, marginTop: 2, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                                <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)' }}>
                                  {new Date(turn.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                {turn.intent && (
                                  <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'rgba(212,160,68,0.6)', border: '1px solid rgba(212,160,68,0.2)', padding: '0 4px' }}>
                                    {turn.intent}
                                  </span>
                                )}
                              </div>
                            </div>
                            {isUser && (
                              <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(212,160,68,0.2)', border: '1px solid rgba(212,160,68,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 2 }}>
                                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', fontWeight: 700 }}>
                                  {(id.name as string ?? '?')[0]?.toUpperCase()}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Bottom controls: UserAI Session + Quick Inject */}
                  <div style={{ borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>

                    {/* ── UserAI Real Session panel ── */}
                    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', background: 'rgba(96,165,250,0.04)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <p style={{ fontFamily: 'monospace', fontSize: 8, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>
                          🧠 UserAI ↔ RogerAI — Reactive Session
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)' }}>Max turns/topic:</span>
                          {[3, 5].map(n => (
                            <button key={n} onClick={() => setSessionTurns(n)} style={{ padding: '2px 7px', fontFamily: 'monospace', fontSize: 8, cursor: 'pointer', border: `1px solid ${sessionTurns === n ? '#60a5fa' : 'var(--border-subtle)'}`, background: sessionTurns === n ? 'rgba(96,165,250,0.1)' : 'transparent', color: sessionTurns === n ? '#60a5fa' : 'var(--text-muted)' }}>{n}</button>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          value={pttInput}
                          onChange={e => setPttInput(e.target.value)}
                          placeholder={`Optional scenario: "Focus on NEOM project" (or leave blank for autonomous)`}
                          disabled={sessionRunning}
                          style={{ flex: 1, padding: '7px 10px', fontFamily: 'monospace', fontSize: 9, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }}
                        />
                        <button
                          disabled={sessionRunning}
                          onClick={() => {
                            setSessionRunning(true);
                            setSessionError(null);
                            setSessionResult(null);
                            simulatePersonaSession(selPersona.user_id, pttInput.trim() || undefined, sessionTurns)
                              .then(r => { setSessionResult(r); setPttInput(''); loadLive(selPersona.user_id); })
                              .catch(e => setSessionError(String(e)))
                              .finally(() => setSessionRunning(false));
                          }}
                          style={{ padding: '7px 14px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', cursor: 'pointer', background: sessionRunning ? 'var(--bg-elevated)' : 'rgba(96,165,250,0.12)', border: `1px solid ${sessionRunning ? 'var(--border-subtle)' : 'rgba(96,165,250,0.4)'}`, color: sessionRunning ? 'var(--text-muted)' : '#60a5fa', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                          <Play size={10} />{sessionRunning ? `UserAI thinking…` : `Run Session`}
                        </button>
                      </div>
                      {sessionError && <p style={{ fontFamily: 'monospace', fontSize: 8, color: '#ef4444', margin: '6px 0 0' }}>{sessionError}</p>}

                      {/* Session result — grouped by engagement */}
                      {sessionResult && !sessionRunning && (() => {
                        const r = sessionResult as SessionResult & {
                          engagements?: number;
                          reactive_turns?: number;
                          engagement_plan?: { topic: string; opener: string; goal: string }[];
                          trace: (SessionTraceTurn & { engagement?: number; userai_action?: string; userai_reasoning?: string })[];
                        };
                        const engagementGroups: Record<number, typeof r.trace> = {};
                        r.trace.forEach(t => {
                          const eNum = (t.engagement ?? 1);
                          if (!engagementGroups[eNum]) engagementGroups[eNum] = [];
                          engagementGroups[eNum].push(t);
                        });
                        return (
                          <div style={{ marginTop: 8, padding: '6px 8px', background: 'rgba(96,165,250,0.05)', border: '1px solid rgba(96,165,250,0.2)', maxHeight: 200, overflowY: 'auto' }}>
                            <p style={{ fontFamily: 'monospace', fontSize: 8, color: '#60a5fa', margin: '0 0 6px' }}>
                              ✓ {r.engagements ?? 1} engagements · {r.total_turns ?? r.turns} turns · {r.reactive_turns ?? 0} reactive · {(r.total_latency_ms / 1000).toFixed(1)}s
                            </p>
                            {Object.entries(engagementGroups).map(([eNum, turns]) => {
                              const plan = r.engagement_plan?.[Number(eNum) - 1];
                              return (
                                <div key={eNum} style={{ marginBottom: 8 }}>
                                  <p style={{ fontFamily: 'monospace', fontSize: 7, color: '#a78bfa', textTransform: 'uppercase', margin: '0 0 3px' }}>
                                    ◆ Engagement {eNum}{plan ? `: ${plan.topic}` : ''}
                                  </p>
                                  {turns.map((t, i) => {
                                    const action = t.userai_action ?? 'accept';
                                    const actionColor = action === 'continue' ? '#fbbf24' : action === 'accept' ? '#22c55e' : '#a78bfa';
                                    return (
                                      <div key={i} style={{ marginBottom: 5, paddingLeft: 8, borderLeft: `2px solid ${actionColor}40` }}>
                                        <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--amber)', margin: '0 0 1px' }}>→ "{t.utterance}"</p>
                                        <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-secondary)', margin: '0 0 2px', lineHeight: 1.4 }}>← {t.roger_response}</p>
                                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                          <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', padding: '0 4px' }}>{t.intent}</span>
                                          <span style={{ fontFamily: 'monospace', fontSize: 7, color: actionColor, border: `1px solid ${actionColor}50`, padding: '0 4px' }}>
                                            UserAI: {action}
                                          </span>
                                          <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)' }}>{t.latency_ms}ms</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                    {/* ── Quick Scenario (single life event) ── */}
                    <div style={{ padding: '8px 12px', background: 'var(--bg-elevated)' }}>
                      <p style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 5px' }}>Quick scenario (single life event via advance-persona-life)</p>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          id="quickScenarioInput"
                          placeholder={`e.g. "${(id.name as string ?? '').split(' ')[0]} just got a new project from NEOM"`}
                          disabled={pttFiring}
                          onKeyDown={e => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (!v || pttFiring) return; setPttFiring(true); advancePersonaLife(selPersona.user_id, v).then(() => { (e.target as HTMLInputElement).value = ''; loadLive(selPersona.user_id); }).catch(() => {}).finally(() => setPttFiring(false)); } }}
                          style={{ flex: 1, padding: '6px 10px', fontFamily: 'monospace', fontSize: 8, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }}
                        />
                        <button
                          onClick={() => { const el = document.getElementById('quickScenarioInput') as HTMLInputElement; const v = el?.value.trim(); if (!v || pttFiring) return; setPttFiring(true); advancePersonaLife(selPersona.user_id, v).then(() => { if (el) el.value = ''; loadLive(selPersona.user_id); }).catch(() => {}).finally(() => setPttFiring(false)); }}
                          disabled={pttFiring}
                          style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 8, textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Play size={8} />{pttFiring ? '…' : 'Fire'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right sidebar: tasks / reminders / memories */}
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

                  {/* Tasks widget */}
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>
                      ✅ Tasks ({liveSnap?.tasks.filter(t => t.status === 'open').length ?? 0} open)
                    </p>
                    {(liveSnap?.tasks ?? []).slice(0, 8).map(t => (
                      <div key={t.id} style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <span style={{ fontSize: 9, marginTop: 1, flexShrink: 0 }}>{t.status === 'done' ? '✓' : '○'}</span>
                        <p style={{ fontFamily: 'monospace', fontSize: 9, color: t.status === 'done' ? 'var(--text-muted)' : 'var(--text-secondary)', margin: 0, textDecoration: t.status === 'done' ? 'line-through' : 'none', lineHeight: 1.4 }}>{t.text}</p>
                        <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 8, color: t.priority >= 8 ? '#ef4444' : t.priority >= 5 ? 'var(--amber)' : 'var(--text-muted)', flexShrink: 0 }}>P{t.priority}</span>
                      </div>
                    ))}
                    {!liveSnap && <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>—</p>}
                  </div>

                  {/* Reminders widget */}
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>
                      🔔 Reminders ({liveSnap?.reminders.filter(r => r.status === 'pending').length ?? 0} pending)
                    </p>
                    {(liveSnap?.reminders ?? []).slice(0, 6).map(r => (
                      <div key={r.id} style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <p style={{ fontFamily: 'monospace', fontSize: 9, color: r.status === 'done' ? 'var(--text-muted)' : 'var(--text-secondary)', margin: '0 0 2px', textDecoration: r.status === 'done' ? 'line-through' : 'none', lineHeight: 1.4 }}>{r.text}</p>
                        <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', margin: 0 }}>{new Date(r.due_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</p>
                      </div>
                    ))}
                    {!liveSnap && <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>—</p>}
                  </div>

                  {/* Memories widget */}
                  <div style={{ padding: '10px 12px' }}>
                    <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>
                      🧠 Memories ({liveSnap?.memories.length ?? 0})
                    </p>
                    {(liveSnap?.memories ?? []).slice(0, 5).map(m => (
                      <div key={m.id} style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-secondary)', margin: '0 0 2px', lineHeight: 1.4 }}>{m.text}</p>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {(m.tags ?? []).slice(0, 3).map((tag, i) => (
                            <span key={i} style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--amber)', border: '1px solid rgba(212,160,68,0.2)', padding: '0 4px' }}>{String(tag)}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                    {!liveSnap && <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>—</p>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* AUDIT TAB — Proof-of-execution timeline */}
          {inspectorTab === 'audit' && (() => {
            // Auto-load on tab switch
            if (!auditLoading && auditEntries.length === 0 && !auditError) {
              setTimeout(loadAudit, 0);
            }

            const statusIcon = (s: ExecutionAuditEntry['status']) =>
              s === 'success' ? '✅' : s === 'warning' ? '⚠️' : '❌';
            const categoryIcon = (c: ExecutionAuditEntry['category']) =>
              ({ reminder: '🔔', task: '✅', memory: '🧠', fact: '📌', service: '⚡', conversation: '💬' })[c] ?? '•';
            const statusColor = (s: ExecutionAuditEntry['status']) =>
              s === 'success' ? '#22c55e' : s === 'warning' ? '#f59e0b' : '#ef4444';

            const filteredEntries = auditFilter === 'all'
              ? auditEntries
              : auditEntries.filter(e => e.category === auditFilter);

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1 }}>

                {/* Filter bar */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10, alignItems: 'center' }}>
                  {(['all', 'reminder', 'task', 'memory', 'fact', 'service', 'conversation'] as const).map(cat => (
                    <button
                      key={cat}
                      onClick={() => { setAuditFilter(cat); setTimeout(loadAudit, 0); }}
                      style={{
                        padding: '4px 10px', fontFamily: 'monospace', fontSize: 8, textTransform: 'uppercase',
                        cursor: 'pointer', letterSpacing: '0.08em',
                        border: `1px solid ${auditFilter === cat ? '#a78bfa' : 'var(--border-subtle)'}`,
                        background: auditFilter === cat ? 'rgba(167,139,250,0.1)' : 'transparent',
                        color: auditFilter === cat ? '#a78bfa' : 'var(--text-muted)',
                      }}
                    >
                      {cat === 'all' ? '● All' : `${categoryIcon(cat)} ${cat}`}
                    </button>
                  ))}

                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    {(['today', '7d', '30d', 'all'] as const).map(r => (
                      <button
                        key={r}
                        onClick={() => { setAuditRange(r); setTimeout(loadAudit, 0); }}
                        style={{
                          padding: '4px 8px', fontFamily: 'monospace', fontSize: 8,
                          cursor: 'pointer',
                          border: `1px solid ${auditRange === r ? '#a78bfa' : 'var(--border-subtle)'}`,
                          background: auditRange === r ? 'rgba(167,139,250,0.08)' : 'transparent',
                          color: auditRange === r ? '#a78bfa' : 'var(--text-muted)',
                        }}
                      >
                        {r}
                      </button>
                    ))}
                    <button
                      onClick={loadAudit}
                      style={{ padding: '4px 8px', background: 'transparent', border: '1px solid var(--border-subtle)', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
                    >
                      <RefreshCw size={9} />
                    </button>
                  </div>
                </div>

                {/* Summary bar */}
                {auditSummary && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 12 }}>
                    {([
                      ['TOTAL', auditSummary.total, '#a78bfa'],
                      ['✅ OK', auditSummary.success, '#22c55e'],
                      ['⚠️ WARN', auditSummary.warning, '#f59e0b'],
                      ['❌ ERR', auditSummary.error, '#ef4444'],
                      ['COST', `$${auditSummary.total_cost_usd.toFixed(3)}`, '#60a5fa'],
                    ] as [string, string | number, string][]).map(([label, value, color]) => (
                      <div key={label} style={{ padding: '8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                        <p style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color, margin: '0 0 2px' }}>{value}</p>
                        <p style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>{label}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Loading / Error states */}
                {auditLoading && (
                  <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#a78bfa', textAlign: 'center', padding: 20 }}>
                    Loading execution audit…
                  </p>
                )}
                {auditError && (
                  <div style={{ padding: 12, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', marginBottom: 8 }}>
                    <p style={{ fontFamily: 'monospace', fontSize: 9, color: '#f87171', margin: 0, wordBreak: 'break-all' }}>⚠ {auditError}</p>
                  </div>
                )}

                {/* Empty state */}
                {!auditLoading && !auditError && filteredEntries.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                    <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', margin: '0 0 6px' }}>
                      No execution entries found
                    </p>
                    <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0 }}>
                      Run a session or advance the persona to generate audit data
                    </p>
                  </div>
                )}

                {/* Timeline entries */}
                {!auditLoading && filteredEntries.length > 0 && (
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {filteredEntries.map(entry => {
                      const vr = verifyResult[entry.id];
                      return (
                        <div
                          key={entry.id}
                          style={{
                            padding: '10px 12px',
                            borderLeft: `3px solid ${statusColor(entry.status)}`,
                            borderBottom: '1px solid var(--border-subtle)',
                            background: entry.status === 'error' ? 'rgba(239,68,68,0.03)' : entry.status === 'warning' ? 'rgba(245,158,11,0.03)' : 'transparent',
                          }}
                        >
                          {/* Header row */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <span style={{ fontSize: 11 }}>{statusIcon(entry.status)}</span>
                            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>
                              {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                            <span style={{ fontFamily: 'monospace', fontSize: 8, color: statusColor(entry.status), textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                              {categoryIcon(entry.category)} {entry.category} {entry.action}
                            </span>
                            {entry.tokens != null && (
                              <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)' }}>
                                {entry.tokens?.toLocaleString()} tok · ${entry.cost_usd?.toFixed(3) ?? '0'} · {entry.latency_ms}ms
                              </span>
                            )}
                          </div>

                          {/* Details */}
                          <div style={{ paddingLeft: 20 }}>
                            {/* Trigger */}
                            {entry.trigger_transcript && (
                              <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--amber)', margin: '0 0 2px' }}>
                                → "{entry.trigger_transcript}"
                              </p>
                            )}
                            {/* Intent */}
                            {entry.trigger_intent && (
                              <div style={{ display: 'flex', gap: 6, marginBottom: 2, alignItems: 'center' }}>
                                <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)', padding: '0 5px' }}>
                                  {entry.trigger_intent}
                                </span>
                                {entry.trigger_confidence != null && (
                                  <span style={{ fontFamily: 'monospace', fontSize: 7, color: entry.trigger_confidence >= 0.8 ? '#22c55e' : entry.trigger_confidence >= 0.6 ? '#f59e0b' : '#ef4444' }}>
                                    conf: {entry.trigger_confidence.toFixed(2)}
                                  </span>
                                )}
                              </div>
                            )}
                            {/* Description */}
                            <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-secondary)', margin: '2px 0', lineHeight: 1.5 }}>
                              {entry.description}
                            </p>
                            {/* Service response */}
                            {entry.service_name && (
                              <p style={{ fontFamily: 'monospace', fontSize: 8, color: '#a78bfa', margin: '2px 0' }}>
                                Service: {entry.service_name}(){entry.service_response ? ` → ${entry.service_response}` : ''}
                              </p>
                            )}
                            {/* Roger response */}
                            {entry.roger_response && (
                              <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-muted)', margin: '2px 0', fontStyle: 'italic', maxHeight: 36, overflow: 'hidden' }}>
                                ← {entry.roger_response.slice(0, 120)}{entry.roger_response.length > 120 ? '…' : ''}
                              </p>
                            )}
                            {/* DB row + verify */}
                            {entry.db_table && entry.db_row_id && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                                <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)' }}>
                                  DB: {entry.db_table}.id = {entry.db_row_id.slice(0, 12)}…
                                </span>
                                {entry.db_current_status && (
                                  <span style={{ fontFamily: 'monospace', fontSize: 7, color: '#60a5fa', border: '1px solid rgba(96,165,250,0.2)', padding: '0 4px' }}>
                                    {entry.db_current_status}
                                  </span>
                                )}
                                <button
                                  onClick={() => handleVerify(entry)}
                                  disabled={verifyingId === entry.id}
                                  style={{
                                    padding: '1px 6px', fontFamily: 'monospace', fontSize: 7,
                                    cursor: 'pointer', textTransform: 'uppercase',
                                    border: '1px solid rgba(167,139,250,0.3)',
                                    background: 'rgba(167,139,250,0.06)',
                                    color: '#a78bfa',
                                    opacity: verifyingId === entry.id ? 0.5 : 1,
                                  }}
                                >
                                  {verifyingId === entry.id ? '…' : 'Verify ↗'}
                                </button>
                                {/* Verify result */}
                                {vr && (
                                  <span style={{ fontFamily: 'monospace', fontSize: 7, color: vr.exists ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                                    {vr.exists
                                      ? `✓ Exists${vr.current_status ? ` · status: ${vr.current_status}` : ''}`
                                      : '✗ NOT FOUND — data integrity issue'}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Bottom summary */}
                {auditSummary && !auditLoading && (
                  <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', flexShrink: 0 }}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 7, color: 'var(--text-muted)' }}>
                        {auditSummary.total_tokens.toLocaleString()} tokens · ${auditSummary.total_cost_usd.toFixed(3)} · avg {auditSummary.avg_latency_ms.toFixed(0)}ms
                      </span>
                      {Object.entries(auditSummary.by_category ?? {}).map(([cat, count]) => (
                        <span key={cat} style={{ fontFamily: 'monospace', fontSize: 7, color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)', padding: '0 4px' }}>
                          {cat}({count})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

        </div>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Header */}

      <div style={{
        padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Users size={15} style={{ color: 'var(--amber)' }} />
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
            User Registry
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>
            {users.length} registered
          </span>
        </div>
        <button onClick={load} style={{
          background: 'transparent', border: '1px solid var(--border-subtle)',
          padding: '5px 9px', cursor: 'pointer', color: 'var(--text-muted)',
          display: 'flex', alignItems: 'center',
        }}>
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, padding: '0 8px' }}>
        {(['users', 'personas'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase',
            letterSpacing: '0.1em', cursor: 'pointer', border: 'none',
            borderBottom: tab === t ? '2px solid var(--amber)' : '2px solid transparent',
            background: 'transparent',
            color: tab === t ? 'var(--amber)' : 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            {t === 'users' ? <Users size={10} /> : <Bot size={10} />}
            {t === 'users' ? `All Users (${users.length})` : `AI Personas (${personas.length})`}
          </button>
        ))}
      </div>

      {/* ── USERS TAB ── */}
      {tab === 'users' && <>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or ID…"
            style={{ width: '100%', padding: '9px 12px', fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', padding: 16 }}>Loading…</p>}
          {error && <div style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.2)' }}><p style={{ fontFamily: 'monospace', fontSize: 10, color: '#f87171', margin: 0, wordBreak: 'break-all' }}>⚠ {error}</p></div>}
          {filtered.map(u => {
            const name = cleanName(u.display_name);
            return (
              <button key={u.user_id} onClick={() => { setSel(u); setConfirm(null); }} style={{ width: '100%', padding: '14px 16px', textAlign: 'left', cursor: 'pointer', background: 'transparent', borderLeft: '2px solid transparent', borderBottom: '1px solid var(--border-subtle)', borderTop: 'none', borderRight: 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(212,160,68,0.1)', border: '1px solid rgba(212,160,68,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--amber)', fontWeight: 700 }}>{name[0]?.toUpperCase() ?? '?'}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{name}</p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: MC[u.roger_mode] ?? 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{u.roger_mode}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{LANG[u.language] ?? u.language}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)' }}>{rel(u.updated_at)} ago</span>
                  </div>
                </div>
                <div style={{ padding: '2px 7px', border: `1px solid ${u.onboarding_complete ? 'var(--green-border)' : 'var(--amber-border)'}`, background: u.onboarding_complete ? 'var(--green-dim)' : 'var(--amber-warn-dim)', flexShrink: 0 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 8, textTransform: 'uppercase', color: u.onboarding_complete ? 'var(--green)' : 'var(--amber)' }}>{u.onboarding_complete ? 'OK' : 'PEND'}</span>
                </div>
                <ChevronRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              </button>
            );
          })}
          {!loading && filtered.length === 0 && <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', padding: 24, textAlign: 'center', textTransform: 'uppercase' }}>No users found</p>}
        </div>
      </>}

      {/* ── AI PERSONAS TAB ── */}
      {tab === 'personas' && <>
        {/* Spawn panel */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          {spawnPhase === 'idle' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={spawnArch} onChange={e => setSpawnArch(e.target.value)} style={{ flex: 1, padding: '7px 10px', fontFamily: 'monospace', fontSize: 10, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }}>
                <option value="">🎲 Random Archetype</option>
                <optgroup label="── Saudi Arabia ──────────────">
                  <option value="Saudi Aramco Engineer">Saudi Aramco Engineer</option>
                  <option value="Saudi Vision 2030 Startup Founder">Vision 2030 Startup Founder</option>
                  <option value="Saudi Government Official">Saudi Government Official</option>
                  <option value="Saudi Working Mother">Saudi Working Mother</option>
                  <option value="Saudi University Student">Saudi University Student</option>
                </optgroup>
                <optgroup label="── UAE ───────────────────────">
                  <option value="Emirati Smart City Planner">Emirati Smart City Planner</option>
                  <option value="Emirati Government Officer">Emirati Government Officer</option>
                  <option value="Dubai Expat Professional">Dubai Expat Professional</option>
                  <option value="Abu Dhabi Investment Director">Abu Dhabi Investment Director</option>
                </optgroup>
                <optgroup label="── Qatar ─────────────────────">
                  <option value="Qatari Real Estate Developer">Qatari Real Estate Developer</option>
                  <option value="Qatar Airways Crew Member">Qatar Airways Crew Member</option>
                </optgroup>
                <optgroup label="── Kuwait / Bahrain / Oman ───">
                  <option value="Kuwaiti Investment Banker">Kuwaiti Investment Banker</option>
                  <option value="Bahraini Fintech Founder">Bahraini Fintech Founder</option>
                  <option value="Omani Tourism Executive">Omani Tourism Executive</option>
                  <option value="GCC Family Patriarch">GCC Family Patriarch</option>
                </optgroup>
                <optgroup label="── Global ────────────────────">
                  <option value="Gulf Executive">Gulf Executive</option>
                  <option value="Muslim Professional">Muslim Professional</option>
                  <option value="Working Parent">Working Parent</option>
                  <option value="Language Learner">Language Learner</option>
                  <option value="Tech Entrepreneur">Tech Entrepreneur</option>
                  <option value="Smart Home User">Smart Home User</option>
                  <option value="Field Researcher">Field Researcher</option>
                  <option value="Daily Commuter">Daily Commuter</option>
                  <option value="Finance Trader">Finance Trader</option>
                  <option value="Social Connector">Social Connector</option>
                </optgroup>
              </select>
              <button onClick={handleGenerate} style={{ padding: '7px 14px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', cursor: 'pointer', background: 'rgba(212,160,68,0.1)', border: '1px solid rgba(212,160,68,0.35)', color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Zap size={10} />Generate Preview
              </button>
              <button onClick={loadPersonas} style={{ padding: '7px 9px', background: 'transparent', border: '1px solid var(--border-subtle)', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}><RefreshCw size={11} /></button>
            </div>
          )}
          {spawnPhase === 'generating' && <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--amber)', margin: 0 }}>⚡ Generating persona with GPT-5.5…</p>}
          {spawnPhase === 'review' && previewData && (
            <div style={{ padding: '12px 14px', background: 'var(--bg-elevated)', border: '1px solid rgba(212,160,68,0.3)' }}>
              <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--amber)', margin: '0 0 4px', fontWeight: 700, textTransform: 'uppercase' }}>{previewData.name} · {previewData.age} · {previewData.city}</p>
              <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-secondary)', margin: '0 0 4px' }}>{previewData.profession}</p>
              <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: '0 0 10px', fontStyle: 'italic' }}>"{previewData.why_roger}"</p>
              <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: '0 0 10px' }}>{previewData.memory_facts?.length ?? 0} facts · {previewData.memories?.length ?? 0} memories · {previewData.tasks?.length ?? 0} tasks · {previewData.reminders?.length ?? 0} reminders</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleCommit} style={{ flex: 1, padding: '8px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', cursor: 'pointer', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e' }}>✓ Commit Persona</button>
                <button onClick={() => { setSpawnPhase('idle'); setPreviewData(null); }} style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>Discard</button>
                <button onClick={handleGenerate} style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>Regenerate</button>
              </div>
            </div>
          )}
          {spawnPhase === 'committing' && <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#22c55e', margin: 0 }}>⚡ Seeding persona into all tables…</p>}
          {spawnPhase === 'done' && spawnResult && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#22c55e', margin: 0 }}>✓ {spawnResult.name} spawned · {spawnResult.callsign}</p>
              <button onClick={() => { setSpawnPhase('idle'); setSpawnResult(null); }} style={{ fontFamily: 'monospace', fontSize: 9, padding: '4px 8px', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer', textTransform: 'uppercase' }}>New Spawn</button>
            </div>
          )}
        </div>

        {/* ── Analytics Bar (Phase 2) ── */}
        {analyticsOpen && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Cross-Persona Analytics</span>
              <button onClick={() => setAnalyticsOpen(false)} style={{ background: 'transparent', border: 'none', fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', cursor: 'pointer' }}>▴ Hide</button>
            </div>
            {analyticsLoad && <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0 }}>Loading analytics…</p>}
            {analyticsData && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 5 }}>
                {([
                  ['Active', analyticsData.active_personas, '#22c55e'],
                  ['Sessions', analyticsData.total_sessions_today, '#60a5fa'],
                  ['Accuracy', `${(analyticsData.avg_intent_accuracy * 100).toFixed(0)}%`, analyticsData.avg_intent_accuracy >= 0.8 ? '#22c55e' : '#f59e0b'],
                  ['Fallback', `${(analyticsData.fallback_rate * 100).toFixed(0)}%`, analyticsData.fallback_rate <= 0.15 ? '#22c55e' : '#ef4444'],
                  ['🚩 Flags', analyticsData.red_flags, analyticsData.red_flags === 0 ? '#22c55e' : '#ef4444'],
                  ['Cost 7d', `$${analyticsData.total_cost_7d.toFixed(2)}`, '#a78bfa'],
                ] as [string, string | number, string][]).map(([label, value, color]) => (
                  <div key={label} style={{ padding: '6px 4px', textAlign: 'center', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
                    <p style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color, margin: '0 0 1px' }}>{value}</p>
                    <p style={{ fontFamily: 'monospace', fontSize: 6, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>{label}</p>
                  </div>
                ))}
              </div>
            )}
            {analyticsData && analyticsData.worst_persona && (
              <div style={{ display: 'flex', gap: 10, marginTop: 6, alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 7, color: '#ef4444' }}>Worst: {analyticsData.worst_persona.name} ({(analyticsData.worst_persona.fallback_pct * 100).toFixed(0)}% fallback)</span>
                {analyticsData.best_persona && <span style={{ fontFamily: 'monospace', fontSize: 7, color: '#22c55e' }}>Best: {analyticsData.best_persona.name} ({(analyticsData.best_persona.fallback_pct * 100).toFixed(0)}% fallback)</span>}
                {analyticsData.service_failures_24h > 0 && <span style={{ fontFamily: 'monospace', fontSize: 7, color: '#ef4444', marginLeft: 'auto' }}>⚠ {analyticsData.service_failures_24h} service failures (24h)</span>}
              </div>
            )}
          </div>
        )}
        {!analyticsOpen && (
          <div style={{ padding: '4px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
            <button onClick={() => setAnalyticsOpen(true)} style={{ background: 'transparent', border: 'none', fontFamily: 'monospace', fontSize: 8, color: '#a78bfa', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.1em' }}>▾ Show Analytics</button>
          </div>
        )}

        {/* ── Batch Advance / Run All (Phase 3) ── */}
        <div style={{ padding: '6px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button
            onClick={async () => {
              if (batchRunning) return;
              setBatchRunning(true);
              const ids = personas.map(p => ({ uid: p.user_id, name: (p.ai_persona_identity as AiPersonaIdentity)?.name ?? p.display_name ?? '?' }));
              for (let i = 0; i < ids.length; i++) {
                setBatchProgress({ done: i, total: ids.length, current: ids[i].name });
                try { await advancePersonaLife(ids[i].uid); } catch {}
              }
              setBatchProgress({ done: ids.length, total: ids.length, current: 'Done' });
              setBatchRunning(false);
              loadPersonas();
            }}
            disabled={batchRunning || personas.length === 0}
            style={{
              padding: '5px 12px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase',
              cursor: batchRunning ? 'wait' : 'pointer', letterSpacing: '0.08em',
              background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e',
              display: 'flex', alignItems: 'center', gap: 5, opacity: batchRunning ? 0.6 : 1,
            }}
          >
            <Play size={9} />{batchRunning ? `Running ${batchProgress?.done ?? 0}/${batchProgress?.total ?? 0}…` : `⚡ Run All (${personas.length})`}
          </button>
          {batchProgress && (
            <span style={{ fontFamily: 'monospace', fontSize: 8, color: batchRunning ? 'var(--amber)' : '#22c55e' }}>
              {batchRunning ? `Advancing: ${batchProgress.current}…` : `✓ All ${batchProgress.total} personas advanced`}
            </span>
          )}
        </div>

        {/* ── Quick Test Panel (Phase 4) ── */}
        <div style={{ borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <button
            onClick={() => setQuickTestOpen(o => !o)}
            style={{ width: '100%', padding: '6px 16px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left' }}
          >
            <Zap size={10} style={{ color: '#f59e0b' }} />
            <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Quick Test</span>
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto' }}>{quickTestOpen ? '▴' : '▾'}</span>
          </button>
          {quickTestOpen && (
            <div style={{ padding: '8px 16px 12px' }}>
              {/* Mode selection */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                <select
                  value={qtPersona}
                  onChange={e => setQtPersona(e.target.value)}
                  style={{ flex: 1, padding: '5px 8px', fontFamily: 'monospace', fontSize: 9, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }}
                >
                  <option value="">🎯 Anonymous (no user context)</option>
                  {personas.map(p => {
                    const pid = (p.ai_persona_identity as AiPersonaIdentity);
                    return <option key={p.user_id} value={p.user_id}>🤖 {pid?.name ?? p.display_name} ({pid?.archetype?.slice(0, 20)})</option>;
                  })}
                </select>
              </div>
              {/* Input + fire */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input
                  value={qtInput}
                  onChange={e => setQtInput(e.target.value)}
                  placeholder="Type a test message… e.g. 'What's the gold price today?'"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && qtInput.trim() && !qtRunning) {
                      e.preventDefault();
                      (async () => {
                        setQtRunning(true); setQtError(null); setQtResult(null);
                        try {
                          const uid = qtPersona || personas[0]?.user_id;
                          if (!uid) throw new Error('No persona available for testing');
                          const r = await simulatePersonaSession(uid, qtInput.trim(), 1);
                          setQtResult(r);
                        } catch (err) { setQtError(String(err)); }
                        setQtRunning(false);
                      })();
                    }
                  }}
                  style={{ flex: 1, padding: '7px 10px', fontFamily: 'monospace', fontSize: 10, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none' }}
                />
                <button
                  onClick={async () => {
                    if (!qtInput.trim() || qtRunning) return;
                    setQtRunning(true); setQtError(null); setQtResult(null);
                    try {
                      const uid = qtPersona || personas[0]?.user_id;
                      if (!uid) throw new Error('No persona available for testing');
                      const r = await simulatePersonaSession(uid, qtInput.trim(), 1);
                      setQtResult(r);
                    } catch (err) { setQtError(String(err)); }
                    setQtRunning(false);
                  }}
                  disabled={qtRunning || !qtInput.trim()}
                  style={{
                    padding: '7px 14px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase',
                    cursor: 'pointer', letterSpacing: '0.08em',
                    background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', color: '#f59e0b',
                    display: 'flex', alignItems: 'center', gap: 4, opacity: qtRunning ? 0.5 : 1,
                  }}
                >
                  <Play size={9} />{qtRunning ? '…' : 'Fire'}
                </button>
              </div>
              {/* Result */}
              {qtRunning && <p style={{ fontFamily: 'monospace', fontSize: 9, color: '#f59e0b', margin: 0 }}>⚡ Running through pipeline…</p>}
              {qtError && <p style={{ fontFamily: 'monospace', fontSize: 9, color: '#ef4444', margin: '0 0 6px', wordBreak: 'break-all' }}>⚠ {qtError}</p>}
              {qtResult && (
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '8px 10px', maxHeight: 200, overflowY: 'auto' }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', padding: '1px 5px' }}>
                      {qtResult.turns_completed} turn(s)
                    </span>
                    <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)', padding: '1px 5px' }}>
                      {qtResult.total_tokens?.toLocaleString() ?? '?'} tokens
                    </span>
                    <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#a78bfa', border: '1px solid rgba(167,139,250,0.3)', padding: '1px 5px' }}>
                      ${qtResult.total_cost?.toFixed(4) ?? '?'}
                    </span>
                  </div>
                  {/* Show trace turns */}
                  {(qtResult.trace ?? []).map((turn, i) => (
                    <div key={i} style={{ marginBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 6 }}>
                      <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--amber)', margin: '0 0 2px' }}>
                        → {turn.user_input}
                      </p>
                      {turn.intent && (
                        <span style={{ fontFamily: 'monospace', fontSize: 7, color: '#60a5fa', border: '1px solid rgba(96,165,250,0.2)', padding: '0 4px', marginRight: 4 }}>
                          {turn.intent}
                        </span>
                      )}
                      <p style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-secondary)', margin: '2px 0', lineHeight: 1.5, maxHeight: 50, overflow: 'hidden' }}>
                        ← {turn.roger_response?.slice(0, 200)}{(turn.roger_response?.length ?? 0) > 200 ? '…' : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Filter */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <input value={pSearch} onChange={e => setPSearch(e.target.value)} placeholder="Filter by name, archetype, city…"
            style={{ width: '100%', padding: '7px 10px', fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-recessed)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }} />
        </div>

        {/* Persona list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {pLoading && <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', padding: 16 }}>Loading personas…</p>}
          {pError && <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#f87171', padding: 16 }}>⚠ {pError}</p>}
          {!pLoading && filteredPersonas.length === 0 && <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', padding: 24, textAlign: 'center', textTransform: 'uppercase' }}>No personas — generate one above</p>}
          {filteredPersonas.map(p => {
            const pid = (p.ai_persona_identity as AiPersonaIdentity) ?? {} as AiPersonaIdentity;
            const score = vitality(p);
            const lastAdv = (p as unknown as Record<string, string>).last_advanced_at;
            const ageH = lastAdv ? Math.round((Date.now() - new Date(lastAdv).getTime()) / 3600000) : null;
            return (
              <div key={p.user_id} style={{ borderBottom: '1px solid var(--border-subtle)', padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: vColor(score), flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', margin: 0, fontWeight: 600, textTransform: 'uppercase' }}>{pid.name ?? p.display_name}</p>
                    <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: 0 }}>{pid.archetype} · {pid.city} · Vitality {score}/100{ageH !== null ? ` · ${ageH}h old` : ''}</p>
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--amber)', border: '1px solid rgba(212,160,68,0.3)', padding: '2px 6px', textTransform: 'uppercase' }}>AI</span>
                </div>
                <p style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', margin: '0 0 8px', fontStyle: 'italic' }}>"{(pid.why_roger ?? '').slice(0, 90)}{(pid.why_roger ?? '').length > 90 ? '…' : ''}"</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => { setSelPersona(p); setInspectorTab('overview'); }} style={{ flex: 2, padding: '6px 10px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', cursor: 'pointer', background: 'rgba(212,160,68,0.1)', border: '1px solid rgba(212,160,68,0.3)', color: 'var(--amber)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}><Eye size={9} />Inspect</button>
                  <button onClick={() => handleAdvance(p.user_id)} disabled={advancingId === p.user_id} style={{ flex: 1, padding: '6px 10px', fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', cursor: 'pointer', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, opacity: advancingId === p.user_id ? 0.5 : 1 }}><Play size={9} />{advancingId === p.user_id ? '…' : 'Advance'}</button>
                  <button onClick={() => handleDelete(p.user_id)} disabled={deletingId === p.user_id} style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 9, cursor: 'pointer', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', opacity: deletingId === p.user_id ? 0.5 : 1 }}><Trash2 size={9} /></button>
                </div>
              </div>
            );
          })}
        </div>
      </>}
    </div>
  );
}
