import { useState, useEffect } from 'react';
import { Workflow, CheckCircle2, AlertCircle, XCircle, ArrowRight, Radio, CheckCircle, AlertTriangle, RefreshCw, ChevronDown, ChevronRight as ChevronR } from 'lucide-react';
import DetailChip from '../components/shared/DetailChip';
import { fetchTransmissions } from '../lib/api';
import type { DbTransmission } from '../lib/api';

// ─── Derive pipeline steps from a real TX record ─────────────────────────────

interface PipelineStep {
  index: number;
  label: string;
  latencyMs: number;
  status: 'complete' | 'failed' | 'skipped';
  details?: { key: string; value: string }[];
}

function deriveSteps(tx: DbTransmission): PipelineStep[] {
  const total = tx.latency_ms;
  // Distribute latency proportionally across steps (realistic weights)
  const weights = [0.05, 0.30, 0.12, 0.10, 0.15, 0.07, 0.04, 0.09, 0.05, 0.03];
  const ms = weights.map(w => Math.round(w * total));

  const isError = tx.status === 'ERROR';
  const isClarif = tx.status === 'CLARIFICATION';
  const confColor = tx.confidence > 85 ? 'HIGH' : tx.confidence > 65 ? 'MED' : 'LOW';
  const ambigColor = tx.ambiguity > 60 ? 'HIGH' : tx.ambiguity > 30 ? 'MED' : 'LOW';

  return [
    {
      index: 1, label: 'PTT CAPTURE',       latencyMs: ms[0], status: 'complete',
      details: [{ key: 'AUDIO', value: 'BUFFERED' }],
    },
    {
      index: 2, label: 'TRANSCRIPTION',     latencyMs: ms[1], status: 'complete',
      details: [{ key: 'ENGINE', value: 'WHISPER-V3' }, { key: 'LANG', value: 'EN' }],
    },
    {
      index: 3, label: 'INTENT DETECTION',  latencyMs: ms[2], status: isError ? 'failed' : 'complete',
      details: [
        { key: 'INTENT', value: tx.intent },
        { key: 'CONFIDENCE', value: `${tx.confidence}% (${confColor})` },
      ],
    },
    {
      index: 4, label: 'ENTITY EXTRACTION', latencyMs: ms[3], status: isError ? 'skipped' : 'complete',
      details: isError ? [] : [{ key: 'ENTITIES', value: extractEntitiesSummary(tx.transcript) }],
    },
    {
      index: 5, label: 'CONTEXT RETRIEVAL', latencyMs: ms[4], status: isError ? 'skipped' : 'complete',
      details: isError ? [] : [{ key: 'RETRIEVED', value: '3 items' }],
    },
    {
      index: 6, label: 'AMBIGUITY CHECK',   latencyMs: ms[5], status: isError ? 'failed' : 'complete',
      details: [
        { key: 'SCORE', value: `${tx.ambiguity}% (${ambigColor})` },
        { key: 'RESULT', value: isClarif ? 'INTERCEPT' : isError ? 'FAIL' : 'PASS' },
      ],
    },
    {
      index: 7,  label: 'ACTION ROUTER',    latencyMs: ms[6], status: isError ? 'failed' : 'complete',
      details: isError ? [{ key: 'PATH', value: 'FALLBACK' }] : [{ key: 'ROUTED TO', value: `${tx.intent}_NODE` }],
    },
    {
      index: 8,  label: 'NODE EXECUTION',   latencyMs: ms[7], status: isError ? 'skipped' : 'complete',
    },
    {
      index: 9,  label: 'MEMORY UPDATE',    latencyMs: ms[8], status: isError ? 'skipped' : 'complete',
    },
    {
      index: 10, label: 'PTT FEEDBACK',     latencyMs: ms[9], status: 'complete',
      details: [{ key: 'RESPONSE', value: isClarif ? 'CLARIFICATION_PROMPT' : isError ? 'ERROR_MSG' : 'CONFIRMATION' }],
    },
  ];
}

function extractEntitiesSummary(transcript: string): string {
  const words = transcript.split(' ');
  const caps  = words.filter(w => /^[A-Z][a-z]/.test(w));
  return caps.length > 0 ? caps.join(', ') : 'DETECTED';
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'JUST NOW';
  if (mins < 60) return `${mins} MIN AGO`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs} HR AGO` : `${Math.floor(hrs / 24)}D AGO`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function statusBorderColor(s: DbTransmission['status']) {
  return s === 'SUCCESS' ? 'var(--green-border)' : s === 'CLARIFICATION' ? 'var(--amber-border)' : 'var(--rust-border)';
}
function statusBg(s: DbTransmission['status']) {
  return s === 'SUCCESS' ? 'var(--green-dim)' : s === 'CLARIFICATION' ? 'var(--amber-warn-dim)' : 'var(--rust-dim)';
}
function statusColor(s: DbTransmission['status']) {
  return s === 'SUCCESS' ? 'var(--green)' : s === 'CLARIFICATION' ? 'var(--amber)' : 'var(--rust)';
}

function StepIcon({ status }: { status: PipelineStep['status'] }) {
  if (status === 'complete') return <CheckCircle2 size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />;
  if (status === 'failed')   return <XCircle      size={14} style={{ color: 'var(--rust)',  flexShrink: 0 }} />;
  return                            <AlertCircle  size={14} style={{ color: 'var(--olive)', flexShrink: 0, opacity: 0.4 }} />;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function FlowInspector() {
  const [transmissions, setTransmissions] = useState<DbTransmission[]>([]);
  const [selectedTx, setSelectedTx]       = useState<DbTransmission | null>(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [pickerOpen, setPickerOpen]       = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTransmissions(50);
      setTransmissions(data);
      if (data.length > 0 && !selectedTx) setSelectedTx(data[0]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const steps = selectedTx ? deriveSteps(selectedTx) : [];
  const totalLatency = steps.reduce((s, f) => s + f.latencyMs, 0);
  const failedSteps  = steps.filter(s => s.status === 'failed').length;
  const skippedSteps = steps.filter(s => s.status === 'skipped').length;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 lg:p-6 space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Workflow size={14} style={{ color: 'var(--amber)' }} />
          <div>
            <h1 className="font-mono text-mini tracking-widest uppercase" style={{ color: 'var(--amber)' }}>FLOW INSPECTOR</h1>
            <p className="font-mono text-nano" style={{ color: 'var(--text-muted)' }}>AI PIPELINE TRACE / EXECUTION VISUALIZATION</p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 border px-2 py-1 font-mono text-nano uppercase tracking-wider"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> REFRESH
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="border px-4 py-3 font-mono text-nano" style={{ borderColor: 'var(--rust-border)', background: 'var(--rust-dim)', color: 'var(--rust)' }}>
          ⚠ {error}
        </div>
      )}

      {/* TX Picker */}
      {!loading && transmissions.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setPickerOpen(o => !o)}
            className="w-full flex items-center gap-2 border p-3"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
          >
            <span className="font-mono text-nano uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>INSPECTING</span>
            {selectedTx && (
              <>
                <span className="font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedTx.id}</span>
                <span className="font-mono text-nano italic truncate flex-1 text-left" style={{ color: 'var(--text-secondary)' }}>
                  "{selectedTx.transcript}"
                </span>
                <span className="font-mono text-nano" style={{ color: 'var(--text-muted)' }}>{relativeTime(selectedTx.created_at)}</span>
              </>
            )}
            {pickerOpen ? <ChevronDown size={12} style={{ color: 'var(--amber)', flexShrink: 0 }} /> : <ChevronR size={12} style={{ color: 'var(--amber)', flexShrink: 0 }} />}
          </button>

          {pickerOpen && (
            <div
              className="absolute top-full left-0 right-0 z-20 border-l border-r border-b max-h-48 overflow-y-auto scrollbar-thin"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
            >
              {transmissions.map(tx => (
                <button
                  key={tx.id}
                  onClick={() => { setSelectedTx(tx); setPickerOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2 border-b text-left"
                  style={{
                    borderColor: 'var(--border-dim)',
                    background: selectedTx?.id === tx.id ? 'rgba(212,160,68,0.08)' : 'transparent',
                  }}
                >
                  <span
                    className="font-mono text-micro w-1.5 h-1.5 shrink-0"
                    style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: tx.status === 'SUCCESS' ? 'var(--green)' : tx.status === 'CLARIFICATION' ? 'var(--amber)' : 'var(--rust)',
                      display: 'inline-block',
                    }}
                  />
                  <span className="font-mono text-nano" style={{ color: 'var(--text-secondary)' }}>{tx.id}</span>
                  <span className="font-mono text-nano italic flex-1 truncate" style={{ color: 'var(--text-muted)' }}>"{tx.transcript}"</span>
                  <span className="font-mono text-nano" style={{ color: statusColor(tx.status) }}>{tx.status}</span>
                  {tx.is_simulated && <span className="font-mono text-micro border px-1" style={{ borderColor: 'var(--olive-border)', color: 'var(--olive)' }}>SIM</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selected TX context */}
      {selectedTx && (
        <div className="border p-4 space-y-3" style={{ borderColor: statusBorderColor(selectedTx.status), background: statusBg(selectedTx.status) }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              TRANSMISSION: {selectedTx.id}
            </span>
            <div className="px-2 py-0.5 border font-mono text-nano" style={{ borderColor: statusBorderColor(selectedTx.status), color: statusColor(selectedTx.status) }}>
              {selectedTx.status}
            </div>
            <div className="px-2 py-0.5 border font-mono text-nano" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
              {totalLatency}ms TOTAL
            </div>
            {selectedTx.is_simulated && (
              <div className="px-2 py-0.5 border font-mono text-nano" style={{ borderColor: 'var(--olive-border)', color: 'var(--olive)' }}>
                SIMULATED
              </div>
            )}
            <span className="font-mono text-nano ml-auto" style={{ color: 'var(--text-muted)' }}>
              {relativeTime(selectedTx.created_at)} · {selectedTx.region}
            </span>
          </div>

          <div className="flex items-start gap-2">
            <Radio size={12} style={{ color: 'var(--text-muted)', marginTop: 2, flexShrink: 0 }} />
            <p className="text-sm italic" style={{ color: 'var(--text-secondary)' }}>"{selectedTx.transcript}"</p>
          </div>

          {/* Quick stats */}
          <div className="flex gap-2 flex-wrap">
            {[
              { label: 'INTENT',     value: selectedTx.intent.replace('_', ' ') },
              { label: 'SIGNAL STR', value: `${selectedTx.confidence}%`,  color: selectedTx.confidence > 85 ? 'var(--green)' : selectedTx.confidence > 65 ? 'var(--amber)' : 'var(--rust)' },
              { label: 'AMBIGUITY',  value: `${selectedTx.ambiguity}%`,   color: selectedTx.ambiguity < 30  ? 'var(--green)' : selectedTx.ambiguity < 60  ? 'var(--amber)' : 'var(--rust)'  },
              { label: 'STEPS',      value: `${steps.length}` },
              { label: 'FAILED',     value: `${failedSteps}`,  color: failedSteps > 0 ? 'var(--rust)' : 'var(--text-primary)' },
              { label: 'SKIPPED',    value: `${skippedSteps}`, color: skippedSteps > 0 ? 'var(--olive)' : 'var(--text-primary)' },
            ].map(q => (
              <div key={q.label} className="flex gap-1.5 items-center px-2 py-1 border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)' }}>
                <span className="font-mono text-micro uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{q.label}</span>
                <span className="font-mono text-nano font-semibold" style={{ color: q.color ?? 'var(--text-primary)' }}>{q.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="border p-4 h-64 animate-pulse" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }} />
      )}

      {/* Pipeline steps */}
      {!loading && selectedTx && (
        <div className="border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <h2 className="font-mono text-mini tracking-widest uppercase mb-4" style={{ color: 'var(--amber)' }}>
            EXECUTION PIPELINE
          </h2>
          <div className="space-y-2">
            {steps.map((step, idx) => (
              <div key={step.index}>
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Index badge */}
                  <div
                    className="w-6 h-6 flex items-center justify-center border shrink-0 font-mono text-micro"
                    style={{
                      borderColor: step.status === 'complete' ? 'var(--green-border)' : step.status === 'failed' ? 'var(--rust-border)' : 'var(--olive-border)',
                      color: step.status === 'complete' ? 'var(--green)' : step.status === 'failed' ? 'var(--rust)' : 'var(--olive)',
                      background: 'var(--bg-recessed)',
                    }}
                  >
                    {step.index}
                  </div>
                  <StepIcon status={step.status} />
                  <span
                    className="font-mono text-mini tracking-wider uppercase"
                    style={{ color: step.status === 'skipped' ? 'var(--text-muted)' : 'var(--text-primary)', opacity: step.status === 'skipped' ? 0.45 : 1 }}
                  >
                    {step.label}
                  </span>
                  {step.status === 'skipped' && (
                    <span className="font-mono text-nano border px-1" style={{ borderColor: 'var(--olive-border)', color: 'var(--olive)' }}>SKIPPED</span>
                  )}
                  <span className="font-mono text-nano ml-auto shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {step.latencyMs}ms
                  </span>
                </div>
                {step.details && step.details.length > 0 && step.status !== 'skipped' && (
                  <div className="ml-9 mt-1 flex gap-2 flex-wrap">
                    {step.details.map(d => <DetailChip key={d.key} label={d.key} value={d.value} />)}
                  </div>
                )}
                {idx < steps.length - 1 && (
                  <div className="ml-9 mt-1">
                    <ArrowRight size={10} style={{ color: 'var(--border-subtle)' }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Final result */}
      {!loading && selectedTx && (
        <div
          className="border p-4 space-y-2"
          style={{
            borderColor: statusBorderColor(selectedTx.status),
            background: statusBg(selectedTx.status),
          }}
        >
          <div className="flex items-center gap-2">
            {selectedTx.status === 'SUCCESS'
              ? <CheckCircle  size={14} style={{ color: 'var(--green)' }} />
              : selectedTx.status === 'CLARIFICATION'
              ? <AlertTriangle size={14} style={{ color: 'var(--amber)' }} />
              : <XCircle size={14} style={{ color: 'var(--rust)' }} />
            }
            <span className="font-mono text-mini tracking-widest uppercase" style={{ color: statusColor(selectedTx.status) }}>
              FINAL RESULT — {selectedTx.status}
            </span>
          </div>
          <p className="font-mono text-nano" style={{ color: 'var(--text-secondary)' }}>
            {selectedTx.status === 'SUCCESS'
              ? `${selectedTx.intent.replace('_', ' ')} executed · ${selectedTx.latency_ms}ms · COMMITTED TO MEMORY`
              : selectedTx.status === 'CLARIFICATION'
              ? `CLARIFICATION REQUIRED · Ambiguity ${selectedTx.ambiguity}% exceeded threshold · Awaiting user response`
              : `PIPELINE FAILED · Intent ${selectedTx.intent} · Confidence ${selectedTx.confidence}% below minimum threshold`
            }
          </p>
          <div className="flex items-center gap-2 pt-1">
            <Radio size={11} style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm italic" style={{ color: 'var(--text-primary)' }}>
              {selectedTx.status === 'SUCCESS'
                ? '"Roger that. Action confirmed. Over."'
                : selectedTx.status === 'CLARIFICATION'
                ? '"Need clarification before proceeding. Please specify. Over."'
                : '"Unable to process that transmission. Please retry. Over."'
              }
            </p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && transmissions.length === 0 && (
        <div className="flex items-center justify-center py-16">
          <span className="font-mono text-mini tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>
            NO TRANSMISSIONS IN DATABASE
          </span>
        </div>
      )}
    </div>
  );
}
