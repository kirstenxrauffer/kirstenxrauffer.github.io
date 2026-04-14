import { useId, useMemo } from 'react';

interface Props {
  width: number;
  height: number;
  color: string;
}

type Wave = 'sine' | 'damped';
const WAVES: Wave[] = ['sine', 'damped'];

// Sample a wave at high resolution. The Catmull-Rom→bezier conversion below
// turns these samples into a smooth, kink-free curve.
function buildPath(width: number, height: number): Array<[number, number]> {
  const wave  = WAVES[Math.floor(Math.random() * WAVES.length)];
  const amp   = 1.6 + Math.random() * 1.8;          // 1.6 – 3.4 px
  const freq  = 1.4 + Math.random() * 1.8;          // cycles across width
  const phase = Math.random() * Math.PI * 2;
  const yMid  = height / 2;
  const padX  = 4;
  const steps = 48;

  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = padX + t * (width - padX * 2);
    let y = yMid;
    if (wave === 'sine') {
      y += Math.sin(t * Math.PI * 2 * freq + phase) * amp;
    } else {
      const env = Math.sin(t * Math.PI); // 0 → 1 → 0
      y += Math.sin(t * Math.PI * 2 * freq + phase) * amp * env;
    }
    pts.push([x, y]);
  }
  return pts;
}

// Catmull-Rom (uniform, tension 0.5) → cubic Bezier. Produces a path that
// passes through every sample with C1 continuity — no kinks at control points,
// which is the failure mode of straight `L` segments through a wave.
function pointsToSmoothPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

// Inline SVG instead of p5.brush. The earlier p5.brush implementation created
// a fresh WEBGL context per divider; with FairyCanvas + multiple dividers all
// holding contexts, the smaller divider canvases occasionally downgraded to
// WebGL1, which silently failed p5.brush's `webglVersion === "webgl2"` gate
// and left the second divider blank ("still not working after 1st sticky
// note"). SVG sidesteps the entire multi-context problem and is essentially
// free to render at this size.
export function StickyDivider({ width, height, color }: Props) {
  const filterId = useId();
  // Re-roll the wave + filter seed each mount so every project's dividers
  // look slightly different. useMemo with no deps pins them for the lifetime
  // of one mount, so the line doesn't re-randomize on every render.
  const { d, seed } = useMemo(() => ({
    d: pointsToSmoothPath(buildPath(width, height)),
    seed: Math.floor(Math.random() * 1000),
  }), [width, height]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', overflow: 'visible' }}
      aria-hidden="true"
    >
      <defs>
        {/* feTurbulence + feDisplacementMap nudges every point of the path
            along a low-frequency noise field, giving the bezier an organic,
            hand-drawn wobble without the kinks of per-point random jitter. */}
        <filter id={filterId} x="-10%" y="-50%" width="120%" height="200%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="1"
            seed={seed}
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="1.3"
          />
        </filter>
      </defs>
      <path
        d={d}
        stroke={color}
        strokeWidth={1.1}
        strokeLinecap="round"
        fill="none"
        filter={`url(#${filterId})`}
      />
    </svg>
  );
}
