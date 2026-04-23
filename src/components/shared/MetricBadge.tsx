import type { StatusTier } from '../../types';

interface MetricBadgeProps {
  label: string;
  value: string;
  status: StatusTier;
}

function statusColor(status: StatusTier) {
  switch (status) {
    case 'success': return 'var(--green)';
    case 'warning': return 'var(--amber)';
    case 'error':   return 'var(--rust)';
    default:        return 'var(--text-secondary)';
  }
}

export default function MetricBadge({ label, value, status }: MetricBadgeProps) {
  return (
    <div
      className="flex flex-col gap-0.5 px-2 py-1.5 border"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-cell)' }}
    >
      <span className="font-mono text-micro tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span className="font-mono text-nano font-semibold tracking-wide" style={{ color: statusColor(status) }}>
        {value}
      </span>
    </div>
  );
}
