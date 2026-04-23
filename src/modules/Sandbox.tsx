import { FlaskConical, GitCompare, Save, Upload, Play, RotateCcw } from 'lucide-react';
import ResultMetric from '../components/shared/ResultMetric';
import EntityChip from '../components/shared/EntityChip';
import { testSuites, simResults, extractedEntities } from '../data/mockData';

export default function Sandbox() {
  const passColor = (p: number, t: number) => {
    const r = p / t;
    return r === 1 ? 'var(--green)' : r > 0.9 ? 'var(--amber)' : 'var(--rust)';
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <FlaskConical size={14} style={{ color: 'var(--amber)' }} />
        <div>
          <h1 className="font-mono text-mini tracking-widest uppercase" style={{ color: 'var(--amber)' }}>SANDBOX & TESTING LAB</h1>
          <p className="font-mono text-nano" style={{ color: 'var(--text-muted)' }}>AI IMPROVEMENT / SIMULATION & TESTING ENVIRONMENT</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Left column ── */}
        <div className="space-y-4">

          {/* Test input */}
          <div className="border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <div className="flex items-center gap-2">
              <FlaskConical size={12} style={{ color: 'var(--amber)' }} />
              <span className="font-mono text-mini tracking-wider uppercase" style={{ color: 'var(--amber)' }}>TEST INPUT</span>
            </div>
            <div>
              <label className="font-mono text-micro tracking-wider uppercase block mb-1" style={{ color: 'var(--text-muted)' }}>
                SIMULATION MODE
              </label>
              <select
                className="w-full border px-2 py-1.5 font-mono text-nano appearance-none"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)', color: 'var(--text-primary)' }}
              >
                <option>SINGLE-TURN TEST</option>
                <option>MULTI-TURN CONTEXT TEST</option>
                <option>HISTORICAL REPLAY</option>
                <option>SYNTHETIC SCENARIO</option>
                <option>REGRESSION TEST PACK</option>
                <option>A/B COMPARISON TEST</option>
              </select>
            </div>
            <div>
              <label className="font-mono text-micro tracking-wider uppercase block mb-1" style={{ color: 'var(--text-muted)' }}>
                USER INPUT (SIMULATED TRANSMISSION)
              </label>
              <textarea
                className="w-full border px-3 py-2 font-mono text-sm resize-none scrollbar-thin"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)', color: 'var(--text-primary)', height: 80 }}
                defaultValue="Remind me to follow up with him next week"
              />
            </div>
            <div className="flex gap-2">
              <button
                className="flex items-center gap-2 px-4 py-2 font-mono text-nano tracking-wider uppercase border"
                style={{ background: 'rgba(212,160,68,0.15)', borderColor: 'var(--amber)', color: 'var(--amber)' }}
              >
                <Play size={12} /> RUN TEST
              </button>
              <button
                className="flex items-center gap-2 px-4 py-2 font-mono text-nano tracking-wider uppercase border"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
              >
                <RotateCcw size={12} /> RESET
              </button>
            </div>
          </div>

          {/* A/B comparison */}
          <div className="border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <div className="flex items-center gap-2">
              <GitCompare size={12} style={{ color: 'var(--amber)' }} />
              <span className="font-mono text-mini tracking-wider uppercase" style={{ color: 'var(--amber)' }}>A/B COMPARISON</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'MODEL A', options: ['GPT-4o', 'GPT-3.5', 'Claude-3.5'] },
                { label: 'MODEL B', options: ['GPT-3.5', 'GPT-4o', 'Claude-3.5'] },
              ].map(m => (
                <div key={m.label}>
                  <label className="font-mono text-micro uppercase mb-1 block" style={{ color: 'var(--text-muted)' }}>{m.label}</label>
                  <select className="w-full border px-2 py-1.5 font-mono text-nano appearance-none" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)', color: 'var(--text-primary)' }}>
                    {m.options.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div>
              <label className="font-mono text-micro uppercase mb-1 block" style={{ color: 'var(--text-muted)' }}>PROMPT VERSION</label>
              <select className="w-full border px-2 py-1.5 font-mono text-nano appearance-none" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)', color: 'var(--text-primary)' }}>
                {['v2.4.1 (current)', 'v2.4.0', 'v2.3.8'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <button
              className="w-full font-mono text-nano tracking-wider uppercase py-2 border"
              style={{ borderColor: 'var(--amber-border)', color: 'var(--amber)' }}
            >
              COMPARE SIDE-BY-SIDE
            </button>
          </div>

          {/* Test library */}
          <div className="border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <div className="flex items-center gap-2">
              <Save size={12} style={{ color: 'var(--amber)' }} />
              <span className="font-mono text-mini tracking-wider uppercase" style={{ color: 'var(--amber)' }}>TEST LIBRARY</span>
              <button
                className="ml-auto font-mono text-nano px-2 py-0.5 border"
                style={{ borderColor: 'var(--amber-border)', color: 'var(--amber)' }}
              >
                + NEW SUITE
              </button>
            </div>
            {testSuites.map(suite => {
              const pct = Math.round((suite.passed / suite.total) * 100);
              return (
                <div key={suite.name} className="flex items-center gap-3 py-1.5 border-b" style={{ borderColor: 'var(--border-dim)' }}>
                  <span className="flex-1 font-mono text-nano uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{suite.name}</span>
                  <span className="font-mono text-nano" style={{ color: 'var(--text-muted)' }}>{suite.passed}/{suite.total}</span>
                  <span className="font-mono text-nano font-semibold w-10 text-right" style={{ color: passColor(suite.passed, suite.total) }}>
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right column ── */}
        <div className="space-y-4">
          {/* Simulation results */}
          <div className="border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <div className="flex items-center gap-2">
              <FlaskConical size={12} style={{ color: 'var(--amber)' }} />
              <span className="font-mono text-mini tracking-wider uppercase" style={{ color: 'var(--amber)' }}>SIMULATION RESULTS</span>
            </div>
            <div className="space-y-2">
              {simResults.map(r => <ResultMetric key={r.label} {...r} />)}
            </div>
            {/* Clarification prompt */}
            <div>
              <p className="font-mono text-micro uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>CLARIFICATION PROMPT GENERATED</p>
              <div className="p-3 border font-mono text-sm italic" style={{ borderColor: 'var(--amber-border)', background: 'var(--amber-warn-dim)', color: 'var(--text-primary)' }}>
                "Who would you like me to remind you to follow up with?"
              </div>
            </div>
            {/* Entities */}
            <div>
              <p className="font-mono text-micro uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>ENTITIES EXTRACTED</p>
              <div className="space-y-1.5">
                {extractedEntities.map(e => <EntityChip key={e.text} {...e} />)}
              </div>
            </div>
          </div>

          {/* Publish controls */}
          <div className="border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <div className="flex items-center gap-2">
              <Upload size={12} style={{ color: 'var(--amber)' }} />
              <span className="font-mono text-mini tracking-wider uppercase" style={{ color: 'var(--amber)' }}>PUBLISH CONTROLS</span>
            </div>
            <div>
              <label className="font-mono text-micro uppercase mb-1 block" style={{ color: 'var(--text-muted)' }}>ROLLOUT TARGET</label>
              <select className="w-full border px-2 py-1.5 font-mono text-nano appearance-none" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)', color: 'var(--text-primary)' }}>
                {['SANDBOX ONLY', 'INTERNAL QA', 'BETA USERS (5%)', 'STAGED ROLLOUT (25%)', 'PRODUCTION (100%)'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="font-mono text-micro uppercase mb-1 block" style={{ color: 'var(--text-muted)' }}>CHANGE NOTES</label>
              <textarea
                className="w-full border px-3 py-2 font-mono text-sm resize-none scrollbar-thin"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)', color: 'var(--text-primary)', height: 72 }}
                placeholder="Describe what changed and why..."
              />
            </div>
            <button
              className="w-full flex items-center justify-center gap-2 py-2.5 font-mono text-nano tracking-wider uppercase border"
              style={{ background: 'var(--green-dim)', borderColor: 'var(--green-border)', color: 'var(--green)' }}
            >
              <Upload size={12} /> PUBLISH TO QA
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
