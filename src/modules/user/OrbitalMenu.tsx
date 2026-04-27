import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell, CheckSquare, BookOpen, Mic, BookMarked,
  BarChart3, MapPin, Car, Crown, Moon, Lightbulb,
  GraduationCap, X,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────
type UserTab = 'home' | 'reminders' | 'tasks' | 'memory' | 'journal' | 'analytics' | 'location' | 'commute' | 'meetings' | 'upgrade' | 'salah' | 'smarthome' | 'academy' | 'settings';

interface OrbitalItem {
  key: UserTab;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;
  ring: 0 | 1;          // 0 = inner core ring, 1 = outer lifestyle ring
  accent?: string;       // optional custom color
  badge?: number;        // notification badge count
  hidden?: boolean;      // conditionally hidden (e.g. salah when islamic off)
}

interface OrbitalMenuProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: UserTab) => void;
  islamicMode: boolean;
  reminderCount: number;
  taskCount: number;
  t: (key: string) => string;
}

// ── Module items arranged in orbital rings ────────────────────────────────────
const ORBITAL_ITEMS: OrbitalItem[] = [
  // Inner ring — core productivity (ring 0)
  { key: 'reminders', label: 'Reminders', Icon: Bell,        ring: 0 },
  { key: 'tasks',     label: 'Tasks',     Icon: CheckSquare, ring: 0 },
  { key: 'memory',    label: 'Memory',    Icon: BookOpen,    ring: 0 },
  { key: 'journal',   label: 'Journal',   Icon: BookMarked,  ring: 0 },
  { key: 'meetings',  label: 'Meetings',  Icon: Mic,         ring: 0 },

  // Outer ring — lifestyle & intelligence (ring 1)
  { key: 'analytics', label: 'Stats',     Icon: BarChart3,      ring: 1 },
  { key: 'location',  label: 'Location',  Icon: MapPin,         ring: 1 },
  { key: 'commute',   label: 'Drive',     Icon: Car,            ring: 1 },
  { key: 'salah',     label: 'Salah',     Icon: Moon,           ring: 1, accent: '#10b981' },
  { key: 'smarthome', label: 'IoT',       Icon: Lightbulb,      ring: 1 },
  { key: 'academy',   label: 'Academy',   Icon: GraduationCap,  ring: 1 },
  { key: 'upgrade',   label: 'Pro',       Icon: Crown,          ring: 1, accent: '#f59e0b' },
];

// ── Polar layout math ────────────────────────────────────────────────────────
// Items fan out in a semicircle above center.
// θ runs from π (left) to 0 (right) for a top semicircle.
function polarLayout(itemCount: number, radius: number, index: number) {
  // Distribute evenly across top semicircle (π → 0)
  const startAngle = Math.PI;
  const endAngle   = 0;
  const step       = (startAngle - endAngle) / (itemCount + 1);
  const theta      = startAngle - step * (index + 1);

  return {
    x: Math.cos(theta) * radius,
    y: -Math.sin(theta) * radius,  // negative Y = upward
  };
}

// ── Responsive radius hook ───────────────────────────────────────────────────
// Scale radii so the outermost items + icon width always fit within viewport.
const BASE_RING0 = 110;
const BASE_RING1 = 195;
const ICON_HALF_WIDTH = 40;  // half of icon button footprint (52px icon + padding)
const EDGE_PADDING = 24;     // minimum breathing room from screen edge

function useResponsiveRadii() {
  const [scale, setScale] = useState(() => {
    const maxRadius = BASE_RING1 + ICON_HALF_WIDTH + EDGE_PADDING;
    const halfScreen = (typeof window !== 'undefined' ? window.innerWidth : 420) / 2;
    return Math.min(1, halfScreen / maxRadius);
  });

  useEffect(() => {
    function recalc() {
      const maxRadius = BASE_RING1 + ICON_HALF_WIDTH + EDGE_PADDING;
      const halfScreen = window.innerWidth / 2;
      setScale(Math.min(1, halfScreen / maxRadius));
    }
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, []);

  return {
    ring0: Math.round(BASE_RING0 * scale),
    ring1: Math.round(BASE_RING1 * scale),
    iconSize: Math.max(40, Math.round(52 * scale)),
  };
}

// ── Component ────────────────────────────────────────────────────────────────
export default function OrbitalMenu({
  open, onClose, onNavigate, islamicMode, reminderCount, taskCount, t,
}: OrbitalMenuProps) {

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSelect = useCallback((tab: UserTab) => {
    onNavigate(tab);
    onClose();
  }, [onNavigate, onClose]);

  // Responsive radii based on viewport width
  const { ring0: RING0_RADIUS, ring1: RING1_RADIUS, iconSize } = useResponsiveRadii();

  // Filter items (hide salah if islamic mode off)
  const visibleItems = ORBITAL_ITEMS.filter(item => {
    if (item.key === 'salah' && !islamicMode) return false;
    return true;
  });

  // Inject badge counts
  const itemsWithBadges = visibleItems.map(item => ({
    ...item,
    badge: item.key === 'reminders' ? reminderCount
         : item.key === 'tasks'     ? taskCount
         : 0,
  }));

  // Separate by ring
  const ring0 = itemsWithBadges.filter(i => i.ring === 0);
  const ring1 = itemsWithBadges.filter(i => i.ring === 1);

  // Global index counter for stagger timing
  let globalIdx = 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="orbital-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(10, 10, 8, 0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            overflow: 'hidden',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          {/* Close button — top-right */}
          <motion.button
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ delay: 0.15 }}
            onClick={onClose}
            aria-label="Close modules"
            style={{
              position: 'absolute', top: 'max(16px, env(safe-area-inset-top, 16px))', right: 16,
              width: 44, height: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '50%',
              cursor: 'pointer', color: 'var(--text-muted)',
            }}
          >
            <X size={20} />
          </motion.button>

          {/* Category labels */}
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            style={{
              position: 'absolute',
              bottom: `calc(120px + ${RING0_RADIUS + 48}px)`,
              left: '50%', transform: 'translateX(-50%)',
              fontFamily: 'monospace', fontSize: 8, letterSpacing: '0.3em',
              textTransform: 'uppercase', color: 'rgba(212,160,68,0.4)',
            }}
          >
            Core
          </motion.span>
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
            style={{
              position: 'absolute',
              bottom: `calc(120px + ${RING1_RADIUS + 48}px)`,
              left: '50%', transform: 'translateX(-50%)',
              fontFamily: 'monospace', fontSize: 8, letterSpacing: '0.3em',
              textTransform: 'uppercase', color: 'rgba(212,160,68,0.25)',
            }}
          >
            Lifestyle
          </motion.span>

          {/* Orbital ring container — centered at bottom */}
          <div style={{
            position: 'relative',
            width: 0, height: 0,
            marginBottom: 120,  /* offset from bottom = above the bar */
          }}>
            {/* Ring 0 — inner core */}
            {ring0.map((item, i) => {
              const pos = polarLayout(ring0.length, RING0_RADIUS, i);
              const staggerDelay = 0.05 + (globalIdx++) * 0.035;
              return (
                <OrbitalIcon
                  key={item.key}
                  item={item}
                  x={pos.x}
                  y={pos.y}
                  delay={staggerDelay}
                  onSelect={handleSelect}
                  t={t}
                  iconSize={iconSize}
                />
              );
            })}

            {/* Ring 1 — outer lifestyle */}
            {ring1.map((item, i) => {
              const pos = polarLayout(ring1.length, RING1_RADIUS, i);
              const staggerDelay = 0.05 + (globalIdx++) * 0.035;
              return (
                <OrbitalIcon
                  key={item.key}
                  item={item}
                  x={pos.x}
                  y={pos.y}
                  delay={staggerDelay}
                  onSelect={handleSelect}
                  t={t}
                  iconSize={iconSize}
                />
              );
            })}

            {/* Ring guides — subtle decorative arcs */}
            <svg
              style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}
              width={RING1_RADIUS * 2 + 80}
              height={RING1_RADIUS + 60}
              viewBox={`${-(RING1_RADIUS + 40)} ${-(RING1_RADIUS + 40)} ${(RING1_RADIUS + 40) * 2} ${RING1_RADIUS + 60}`}
            >
              {/* Inner ring arc */}
              <path
                d={describeArc(0, 0, RING0_RADIUS, 170, 10)}
                fill="none"
                stroke="rgba(212,160,68,0.08)"
                strokeWidth="1"
                strokeDasharray="4 6"
              />
              {/* Outer ring arc */}
              <path
                d={describeArc(0, 0, RING1_RADIUS, 175, 5)}
                fill="none"
                stroke="rgba(212,160,68,0.05)"
                strokeWidth="1"
                strokeDasharray="4 8"
              />
            </svg>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Individual orbital icon ──────────────────────────────────────────────────
function OrbitalIcon({
  item, x, y, delay, onSelect, t, iconSize = 52,
}: {
  item: OrbitalItem & { badge?: number };
  x: number;
  y: number;
  delay: number;
  onSelect: (tab: UserTab) => void;
  t: (key: string) => string;
  iconSize?: number;
}) {
  const { key, label, Icon, accent, badge } = item;
  const color = accent ?? 'var(--amber)';
  const iconInner = Math.max(16, Math.round(iconSize * 22 / 52));

  // Try to get translated label, fall back to static label
  const labelKeyMap: Record<string, string> = {
    reminders: 'nav.remind', tasks: 'nav.tasks', memory: 'nav.memory',
    journal: 'nav.journal', meetings: 'nav.meetings', analytics: 'nav.stats',
    location: 'nav.locate', commute: 'nav.drive', salah: 'nav.salah',
    smarthome: 'nav.iot', academy: 'nav.academy', upgrade: 'nav.upgrade',
  };
  const displayLabel = labelKeyMap[key] ? t(labelKeyMap[key]) : label;

  return (
    <motion.button
      initial={{ opacity: 0, x: 0, y: 0, scale: 0.3 }}
      animate={{ opacity: 1, x, y, scale: 1 }}
      exit={{ opacity: 0, x: 0, y: 0, scale: 0.3 }}
      transition={{
        delay,
        type: 'spring',
        stiffness: 400,
        damping: 22,
        mass: 0.8,
      }}
      onClick={() => onSelect(key)}
      style={{
        position: 'absolute',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 6,
        background: 'none', border: 'none', cursor: 'pointer',
        transform: 'translate(-50%, -50%)',  /* center on polar coordinates */
        padding: 8,
        /* will be overridden by motion animate */
      }}
      whileHover={{ scale: 1.15 }}
      whileTap={{ scale: 0.9 }}
    >
      {/* Icon circle */}
      <div style={{
        position: 'relative',
        width: iconSize, height: iconSize,
        borderRadius: '50%',
        background: `${color}12`,
        border: `1.5px solid ${color}40`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 0 20px ${color}15, inset 0 0 12px ${color}08`,
        transition: 'box-shadow 200ms, border-color 200ms',
      }}>
        <Icon size={iconInner} style={{ color, transition: 'color 200ms' }} />

        {/* Badge */}
        {(badge ?? 0) > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            minWidth: 18, height: 18, borderRadius: 9,
            background: '#ef4444', color: '#fff',
            fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px',
            boxShadow: '0 0 8px rgba(239,68,68,0.5)',
          }}>
            {(badge ?? 0) > 99 ? '99+' : badge}
          </span>
        )}
      </div>

      {/* Label */}
      <span style={{
        fontFamily: 'monospace',
        fontSize: 8,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: `${color}cc`,
        whiteSpace: 'nowrap',
        textShadow: `0 0 12px ${color}40`,
      }}>
        {displayLabel}
      </span>
    </motion.button>
  );
}

// ── SVG arc path helper ──────────────────────────────────────────────────────
function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const startRad = (startDeg * Math.PI) / 180;
  const endRad   = (endDeg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy - r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy - r * Math.sin(endRad);
  const largeArc = Math.abs(startDeg - endDeg) > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 0 ${x2} ${y2}`;
}
