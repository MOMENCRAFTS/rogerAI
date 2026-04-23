import type { ModuleInfo } from '../../types';

interface RichPlaceholderProps {
  info: ModuleInfo;
}

const phaseColors: Record<number, { border: string; bg: string; text: string }> = {
  2: { border: 'var(--amber-border)', bg: 'var(--amber-warn-dim)', text: 'var(--amber)' },
  3: { border: 'var(--olive-border)', bg: 'var(--olive-dim)',      text: 'var(--text-secondary)' },
  4: { border: 'var(--border-subtle)', bg: 'var(--bg-elevated)',   text: 'var(--text-muted)' },
};

export default function RichPlaceholder({ info }: RichPlaceholderProps) {
  const phase = phaseColors[info.phase] ?? phaseColors[4];

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 lg:p-6 space-y-4">
      {/* Module header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-mono text-mini tracking-widest uppercase" style={{ color: 'var(--amber)' }}>{info.title}</h1>
          <p className="font-mono text-nano" style={{ color: 'var(--text-muted)' }}>{info.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="px-2 py-0.5 border font-mono text-nano tracking-wider uppercase"
            style={{ borderColor: phase.border, color: phase.text, background: phase.bg }}
          >
            PHASE {info.phase}
          </div>
          <div
            className="px-2 py-0.5 border font-mono text-nano tracking-wider uppercase"
            style={{ borderColor: 'var(--amber-border)', color: 'var(--amber)', background: 'var(--amber-warn-dim)' }}
          >
            IN DEVELOPMENT
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{info.description}</p>
      </div>

      {/* Planned features */}
      <div className="border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
        <h2 className="font-mono text-mini tracking-widest uppercase mb-3" style={{ color: 'var(--amber)' }}>PLANNED CAPABILITIES</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {info.features.map(f => (
            <div
              key={f}
              className="flex items-center gap-2 px-3 py-2 border"
              style={{ borderColor: 'var(--border-dim)', background: 'var(--bg-cell)' }}
            >
              <div className="w-1.5 h-1.5 shrink-0" style={{ background: 'var(--olive)' }} />
              <span className="font-mono text-nano" style={{ color: 'var(--text-secondary)' }}>{f}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Mock data skeleton table */}
      <div className="border p-4 space-y-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
        <h2 className="font-mono text-mini tracking-widest uppercase mb-3" style={{ color: 'var(--text-muted)' }}>DATA PREVIEW</h2>
        {/* Table header */}
        <div className="grid grid-cols-4 gap-2 pb-1 border-b" style={{ borderColor: 'var(--border-dim)' }}>
          {['ID', 'STATUS', 'UPDATED', 'ACTION'].map(h => (
            <span key={h} className="font-mono text-micro uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{h}</span>
          ))}
        </div>
        {/* Skeleton rows */}
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="grid grid-cols-4 gap-2 py-1.5 border-b items-center" style={{ borderColor: 'var(--border-dim)' }}>
            <div className="h-3 rounded-none" style={{ background: 'var(--bg-recessed)', width: `${60 + (i * 11) % 30}%` }} />
            <div className="h-3 rounded-none" style={{ background: i % 3 === 0 ? 'var(--green-dim)' : i % 3 === 1 ? 'var(--amber-warn-dim)' : 'var(--olive-dim)', width: '60%' }} />
            <div className="h-3 rounded-none" style={{ background: 'var(--bg-recessed)', width: '70%' }} />
            <div
              className="px-2 py-0.5 border font-mono text-micro text-center"
              style={{ borderColor: 'var(--olive-border)', color: 'var(--text-muted)' }}
            >
              VIEW
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
