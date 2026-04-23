interface DetailChipProps {
  label: string;
  value: string;
}

export default function DetailChip({ label, value }: DetailChipProps) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 border text-nano font-mono"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)' }}
    >
      <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
      <span style={{ color: 'var(--amber)' }}>{value}</span>
    </span>
  );
}
