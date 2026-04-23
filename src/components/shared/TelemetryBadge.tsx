import type { StatusTier } from '../../types';

interface TelemetryBadgeProps {
  label: string;
  value: string | number;
  unit?: string;
  status: StatusTier;
}

function borderColor(s: StatusTier) {
  switch (s) {
    case 'success': return 'var(--green-border)';
    case 'warning': return 'var(--amber-border)';
    case 'error':   return 'var(--rust-border)';
    default:        return 'var(--olive-border)';
  }
}
function textColor(s: StatusTier) {
  switch (s) {
    case 'success': return 'var(--green)';
    case 'warning': return 'var(--amber)';
    case 'error':   return 'var(--rust)';
    default:        return 'var(--text-secondary)';
  }
}

export default function TelemetryBadge({ label, value, unit, status }: TelemetryBadgeProps) {
  return (
    <div
      className="flex flex-col gap-0.5 px-2 py-1.5 border"
      style={{ borderColor: borderColor(status), background: 'var(--bg-cell)' }}
    >
      <span className="font-mono text-micro tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span className="font-mono text-nano font-semibold" style={{ color: textColor(status) }}>
        {value}{unit}
      </span>
    </div>
  );
}
