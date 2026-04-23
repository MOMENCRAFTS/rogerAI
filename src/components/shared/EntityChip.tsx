interface EntityChipProps {
  text: string;
  type: string;
  confidence: number;
}

export default function EntityChip({ text, type, confidence }: EntityChipProps) {
  const confColor = confidence > 70 ? 'var(--green)' : confidence > 40 ? 'var(--amber)' : 'var(--rust)';

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)' }}
    >
      <span className="font-mono text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        "{text}"
      </span>
      <span className="font-mono text-micro px-1 py-0.5" style={{ background: 'var(--bg-recessed)', color: 'var(--text-secondary)' }}>
        {type}
      </span>
      <span className="font-mono text-nano ml-auto" style={{ color: confColor }}>
        {confidence}%
      </span>
    </div>
  );
}
