/**
 * Roger AI Admin — Tooltip Component
 * ─────────────────────────────────────────────────────────────────────────────
 * A reusable tooltip that renders in a React Portal so it's never clipped by
 * overflow:hidden parents. It auto-flips when near viewport edges and uses the
 * amber-military design system.
 *
 * Usage:
 *   <Tooltip content="What this button does">
 *     <button>Hover me</button>
 *   </Tooltip>
 */

import { useState, useRef, useCallback, useEffect, cloneElement } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  /** Text or JSX to display in the tooltip */
  content: React.ReactNode;
  children: React.ReactElement;
  /** Preferred placement. Auto-flips if near viewport edge. */
  placement?: 'top' | 'bottom' | 'right' | 'left';
  /** Hover delay in ms (default 280) */
  delay?: number;
  /** Max-width of the bubble in px (default 240) */
  maxWidth?: number;
}

interface TipPos { x: number; y: number }

function computePos(anchor: DOMRect, tipW: number, tipH: number, placement: string): TipPos {
  const GAP = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let x = 0, y = 0;

  if (placement === 'top') {
    x = anchor.left + anchor.width / 2 - tipW / 2;
    y = anchor.top - tipH - GAP;
    if (y < 8) y = anchor.bottom + GAP; // flip to bottom
  } else if (placement === 'bottom') {
    x = anchor.left + anchor.width / 2 - tipW / 2;
    y = anchor.bottom + GAP;
    if (y + tipH > vh - 8) y = anchor.top - tipH - GAP; // flip to top
  } else if (placement === 'right') {
    x = anchor.right + GAP;
    y = anchor.top + anchor.height / 2 - tipH / 2;
    if (x + tipW > vw - 8) x = anchor.left - tipW - GAP; // flip to left
  } else {
    x = anchor.left - tipW - GAP;
    y = anchor.top + anchor.height / 2 - tipH / 2;
    if (x < 8) x = anchor.right + GAP; // flip to right
  }

  // Clamp inside viewport with padding
  x = Math.max(8, Math.min(x, vw - tipW - 8));
  y = Math.max(8, Math.min(y, vh - tipH - 8));

  return { x, y };
}

export default function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 280,
  maxWidth = 240,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos]         = useState<TipPos>({ x: -9999, y: -9999 });
  const tipRef    = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const timer     = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reposition = useCallback(() => {
    if (!anchorRef.current || !tipRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const tipH = tipRef.current.offsetHeight || 36;
    const tipW = tipRef.current.offsetWidth  || maxWidth;
    setPos(computePos(rect, tipW, tipH, placement));
  }, [placement, maxWidth]);

  const handleShow = useCallback((el: HTMLElement) => {
    anchorRef.current = el;
    timer.current = setTimeout(() => {
      setVisible(true);
      // position after render
      requestAnimationFrame(reposition);
    }, delay);
  }, [delay, reposition]);

  const handleHide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  }, []);

  // Keep tooltip positioned on scroll/resize
  useEffect(() => {
    if (!visible) return;
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [visible, reposition]);

  // Inject event handlers onto the single child
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const child = children as React.ReactElement<any>;
  const withHandlers = cloneElement(child, {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      handleShow(e.currentTarget);
      child.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      handleHide();
      child.props.onMouseLeave?.(e);
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      handleShow(e.currentTarget as HTMLElement);
      child.props.onFocus?.(e);
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      handleHide();
      child.props.onBlur?.(e);
    },
  });

  return (
    <>
      {withHandlers}
      {createPortal(
        <div
          ref={tipRef}
          role="tooltip"
          aria-hidden={!visible}
          style={{
            position:  'fixed',
            left:      pos.x,
            top:       pos.y,
            zIndex:    99999,
            maxWidth,
            pointerEvents: 'none',
            // animate
            opacity:   visible ? 1 : 0,
            transform: visible ? 'translateY(0) scale(1)' : 'translateY(-4px) scale(0.96)',
            transition: 'opacity 130ms ease, transform 130ms ease',
            // amber-military design
            background: 'rgba(16,20,19,0.97)',
            border:     '1px solid rgba(212,160,68,0.35)',
            padding:    '6px 10px 7px',
            fontFamily: "'JetBrains Mono','Space Mono',monospace",
            fontSize:   10,
            lineHeight: 1.55,
            color:      '#e8e5d8',
            letterSpacing: '0.03em',
            boxShadow:  '0 6px 24px rgba(0,0,0,0.55), 0 0 10px rgba(212,160,68,0.06)',
            whiteSpace: 'pre-line',
          }}
        >
          {/* Amber gradient top accent */}
          <div style={{
            position: 'absolute', top: 0, left: 8, right: 8, height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(212,160,68,0.5), transparent)',
          }} />
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
