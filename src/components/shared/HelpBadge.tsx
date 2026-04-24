/**
 * Roger AI Admin — HelpBadge Component
 * ─────────────────────────────────────────────────────────────────────────────
 * A small amber "?" badge that shows a richly-formatted tooltip on hover.
 * Use it next to section headers, stat labels, or any control that needs a
 * brief description to make the admin panel more intuitive.
 *
 * Usage:
 *   <HelpBadge text="This shows the number of devices currently online." />
 *
 *   // With a title:
 *   <HelpBadge title="TX TODAY" text="Total voice transmissions processed in the last 24 hours." />
 */

import Tooltip from './Tooltip';

interface HelpBadgeProps {
  /** Short title shown bold at top of tooltip (optional) */
  title?: string;
  /** Main description text */
  text: string;
  /** Preferred placement (default 'top') */
  placement?: 'top' | 'bottom' | 'right' | 'left';
  /** Extra class names for the trigger badge */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

export default function HelpBadge({ title, text, placement = 'top', className = '', size = 'sm' }: HelpBadgeProps) {
  const dim = size === 'sm' ? 14 : 16;

  const tipContent = (
    <div>
      {title && (
        <div style={{
          fontFamily: "'JetBrains Mono','Space Mono',monospace",
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: '#d4a044',
          marginBottom: 3,
        }}>
          {title}
        </div>
      )}
      <div style={{
        fontFamily: "'JetBrains Mono','Space Mono',monospace",
        fontSize: 10,
        lineHeight: 1.55,
        color: '#e8e5d8',
      }}>
        {text}
      </div>
    </div>
  );

  return (
    <Tooltip content={tipContent} placement={placement} maxWidth={260}>
      <span
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: dim,
          height: dim,
          border: '1px solid rgba(212,160,68,0.28)',
          color: 'rgba(212,160,68,0.55)',
          fontFamily: "'JetBrains Mono','Space Mono',monospace",
          fontSize: size === 'sm' ? 8 : 9,
          fontWeight: 700,
          lineHeight: 1,
          cursor: 'help',
          flexShrink: 0,
          transition: 'border-color 150ms ease, color 150ms ease, box-shadow 150ms ease',
          userSelect: 'none',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.borderColor = 'rgba(212,160,68,0.7)';
          el.style.color = '#d4a044';
          el.style.boxShadow = '0 0 6px rgba(212,160,68,0.2)';
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.borderColor = 'rgba(212,160,68,0.28)';
          el.style.color = 'rgba(212,160,68,0.55)';
          el.style.boxShadow = 'none';
        }}
      >
        ?
      </span>
    </Tooltip>
  );
}
