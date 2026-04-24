import * as LucideIcons from 'lucide-react';
import type { StatusTier } from '../../types';
import HelpBadge from './HelpBadge';

interface StatCardProps {
  label: string;
  value: string;
  trend: string;
  trendUp: boolean;
  status: StatusTier;
  icon: string;
  /** Optional tooltip description shown on label hover */
  tooltip?: string;
}

function statusColors(status: StatusTier) {
  switch (status) {
    case 'success': return { border: 'var(--green-border)', bg: 'var(--green-dim)', icon: 'var(--green)' };
    case 'warning': return { border: 'var(--amber-border)', bg: 'var(--amber-warn-dim)', icon: 'var(--amber)' };
    case 'error':   return { border: 'var(--rust-border)',  bg: 'var(--rust-dim)',  icon: 'var(--rust)' };
    default:        return { border: 'var(--olive-border)', bg: 'var(--bg-elevated)', icon: 'var(--text-secondary)' };
  }
}

export default function StatCard({ label, value, trend, trendUp, status, icon, tooltip }: StatCardProps) {
  const colors = statusColors(status);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const IconComp = (LucideIcons as any)[icon] as React.FC<{ size?: number; style?: React.CSSProperties; className?: string }>;

  return (
    <div
      className="relative p-4 border overflow-hidden group"
      style={{ background: colors.bg, borderColor: colors.border, transition: 'border-color 200ms ease' }}
    >
      {/* Hover glow overlay */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200"
        style={{ background: 'radial-gradient(ellipse at top left, rgba(212,160,68,0.04), transparent 70%)' }}
      />

      {/* Watermark ghost icon */}
      {IconComp && (
        <div className="absolute top-1 right-1 opacity-[0.05] pointer-events-none">
          <IconComp size={72} style={{ color: colors.icon }} />
        </div>
      )}

      {/* Label row */}
      <div className="flex items-center gap-2 mb-2">
        {IconComp && <IconComp size={14} style={{ color: colors.icon }} />}
        <span
          className="font-mono text-mini tracking-wider uppercase flex-1"
          style={{ color: 'var(--text-secondary)' }}
        >
          {label}
        </span>
        {tooltip && (
          <HelpBadge title={label} text={tooltip} placement="top" />
        )}
      </div>

      {/* Value */}
      <div
        className="font-mono text-2xl font-semibold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        {value}
      </div>

      {/* Trend */}
      <div className="flex items-center gap-1">
        <span style={{ color: trendUp ? 'var(--green)' : 'var(--rust)', fontSize: 12 }}>
          {trendUp ? '↑' : '↓'}
        </span>
        <span className="font-mono text-nano" style={{ color: 'var(--text-secondary)' }}>
          {trend}
        </span>
      </div>
    </div>
  );
}
