import type { StatusTier } from '../../types';
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';

interface ResultMetricProps {
  label: string;
  value: string;
  status: StatusTier;
}

export default function ResultMetric({ label, value, status }: ResultMetricProps) {
  const map = {
    success: { border: 'var(--green-border)', bg: 'var(--green-dim)',       color: 'var(--green)', Icon: CheckCircle2  },
    warning: { border: 'var(--amber-border)', bg: 'var(--amber-warn-dim)', color: 'var(--amber)', Icon: AlertTriangle },
    error:   { border: 'var(--rust-border)',  bg: 'var(--rust-dim)',        color: 'var(--rust)',  Icon: XCircle       },
    neutral: { border: 'var(--olive-border)', bg: 'var(--bg-elevated)',     color: 'var(--text-secondary)', Icon: Info },
  };
  const { border, bg, color, Icon } = map[status];

  return (
    <div className="flex items-center justify-between gap-3 p-3 border" style={{ borderColor: border, background: bg }}>
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-mini tracking-widest uppercase" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
        <span className="font-mono text-sm font-semibold" style={{ color }}>
          {value}
        </span>
      </div>
      <Icon size={16} style={{ color, flexShrink: 0 }} />
    </div>
  );
}
