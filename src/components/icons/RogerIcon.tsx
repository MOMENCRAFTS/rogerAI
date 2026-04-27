// ─── Roger AI — Custom Icon Component ────────────────────────────────────────
// Replaces all native Unicode emojis with styled Lucide SVG icons.
// Falls back to raw text if the icon name is not in the registry.
//
// Usage:
//   <RogerIcon name="mode-active" size={16} color="var(--amber)" />
//   <RogerIcon name="hazard-police" size={20} />
//   <RogerIcon name="check" size={12} color="var(--green)" />

import { ICON_MAP, type RogerIconName } from './iconMap';
import type { CSSProperties } from 'react';

export interface RogerIconProps {
  /** Icon name from the registry (e.g. 'mode-active', 'hazard-police') */
  name: RogerIconName | string;
  /** Icon size in pixels (default 16) */
  size?: number;
  /** Icon color — inherits currentColor if not set */
  color?: string;
  /** Additional CSS class */
  className?: string;
  /** Inline style overrides */
  style?: CSSProperties;
  /** Stroke width (default 2) */
  strokeWidth?: number;
  /** Whether to render the icon filled (for status dots like REC) */
  fill?: string;
}

export function RogerIcon({
  name,
  size = 16,
  color,
  className,
  style,
  strokeWidth = 2,
  fill,
}: RogerIconProps) {
  const Icon = ICON_MAP[name];

  // Fallback: if the name isn't in the registry, render it as raw text
  // This handles cases where emojis are still used temporarily during migration
  if (!Icon) {
    return (
      <span
        className={className}
        style={{
          fontSize: size,
          lineHeight: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          color,
          ...style,
        }}
      >
        {name}
      </span>
    );
  }

  return (
    <Icon
      size={size}
      color={color}
      className={className}
      style={{ flexShrink: 0, ...style }}
      strokeWidth={strokeWidth}
      fill={fill ?? 'none'}
    />
  );
}

export default RogerIcon;
