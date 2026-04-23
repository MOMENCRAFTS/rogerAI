interface FilterChipProps {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}

export default function FilterChip({ label, count, active, onClick }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1 border font-mono text-nano tracking-wider uppercase transition-all duration-150"
      style={{
        background: active ? 'rgba(212,160,68,0.15)' : 'var(--bg-elevated)',
        borderColor: active ? 'var(--amber)' : 'var(--border-subtle)',
        color: active ? 'var(--amber)' : 'var(--text-secondary)',
      }}
      onMouseEnter={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--olive)';
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)';
        }
      }}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className="px-1 font-mono text-micro"
          style={{
            background: active ? 'rgba(212,160,68,0.2)' : 'var(--bg-recessed)',
            color: active ? 'var(--amber)' : 'var(--text-muted)',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
