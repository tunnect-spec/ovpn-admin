'use client';

import * as React from 'react';

interface LogoProps {
  /** Rendered size in px (square). */
  size?: number;
  /** Eyes follow the cursor. Default true. */
  interactive?: boolean;
  className?: string;
  title?: string;
}

/**
 * OVPN brand mascot: the letter "O" as a flat, single-color ring with two eyes
 * that blink and (optionally) track the cursor. Flat style — no gradients,
 * glows, or shading. The ring uses `currentColor` (defaults to the cyan brand
 * accent) so it can be recolored via CSS.
 */
export function Logo({ size = 40, interactive = true, className, title = 'OVPN' }: LogoProps) {
  const ref = React.useRef<SVGSVGElement>(null);
  const [pupil, setPupil] = React.useState({ x: 0, y: 0 });

  React.useEffect(() => {
    if (!interactive) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    const onMove = (e: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const max = 3; // max pupil travel in viewBox units
      const k = Math.min(1, dist / 240);
      setPupil({ x: (dx / dist) * max * k, y: (dy / dist) * max * k });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [interactive]);

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title}
      className={className}
      style={{ color: 'var(--brand-from, #22d3ee)' }}
    >
      <title>{title}</title>

      {/* Flat ring (the "O") */}
      <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" strokeWidth="11" />

      {/* Flat eyes */}
      <g className="logo-eyelid" style={{ transformOrigin: '50px 47px' }}>
        <circle cx="39" cy="47" r="8" fill="#ffffff" />
        <circle cx="61" cy="47" r="8" fill="#ffffff" />
        <circle
          className="logo-pupil"
          cx="39"
          cy="48"
          r="3.8"
          fill="#0b1220"
          style={{ transform: `translate(${pupil.x}px, ${pupil.y}px)` }}
        />
        <circle
          className="logo-pupil"
          cx="61"
          cy="48"
          r="3.8"
          fill="#0b1220"
          style={{ transform: `translate(${pupil.x}px, ${pupil.y}px)` }}
        />
      </g>
    </svg>
  );
}
