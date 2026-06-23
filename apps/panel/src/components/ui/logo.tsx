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
 * OVPN brand mascot: the letter "O" as a glowing cyan→violet ring with two eyes
 * that blink and (optionally) track the cursor. Purely decorative + delightful.
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
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const max = 3.2; // max pupil travel in viewBox units
      const k = Math.min(1, dist / 240);
      setPupil({ x: (dx / dist) * max * k, y: (dy / dist) * max * k });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [interactive]);

  const gid = React.useId();

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={`${gid}-ring`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="55%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <radialGradient id={`${gid}-eye`} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#dbeafe" />
        </radialGradient>
      </defs>

      {/* The O ring */}
      <circle
        cx="50"
        cy="50"
        r="35"
        fill="none"
        stroke={`url(#${gid}-ring)`}
        strokeWidth="13"
      />

      {/* Eyes */}
      <g>
        <g className="logo-eyelid" style={{ transformOrigin: '38px 47px' }}>
          <ellipse cx="38" cy="47" rx="8.5" ry="10.5" fill={`url(#${gid}-eye)`} />
          <circle
            className="logo-pupil"
            cx="38"
            cy="49"
            r="4.2"
            fill="#0b1220"
            style={{ transform: `translate(${pupil.x}px, ${pupil.y}px)` }}
          />
          <circle cx="36.3" cy="46.4" r="1.5" fill="#ffffff" />
        </g>
        <g className="logo-eyelid" style={{ transformOrigin: '62px 47px' }}>
          <ellipse cx="62" cy="47" rx="8.5" ry="10.5" fill={`url(#${gid}-eye)`} />
          <circle
            className="logo-pupil"
            cx="62"
            cy="49"
            r="4.2"
            fill="#0b1220"
            style={{ transform: `translate(${pupil.x}px, ${pupil.y}px)` }}
          />
          <circle cx="60.3" cy="46.4" r="1.5" fill="#ffffff" />
        </g>
      </g>
    </svg>
  );
}
