import { useId, useMemo } from 'react';

interface Props {
  fieldWidth: number;
  fieldHeight: number;
  color: string;
  count?: number;
  /** [minPx, maxPx] for each doodle's bounding size. Defaults to [14, 42]. */
  sizeRange?: [number, number];
  /** SVG stroke width. Defaults to 1.1. */
  strokeWidth?: number;
}

// Catmull-Rom (uniform, tension 0.5) → cubic Bezier — same smoother used by
// StickyDivider so the doodles read as the same hand-drawn "brush".
function pointsToSmoothPath(pts: Array<[number, number]>, close = false): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? (close ? pts[pts.length - 1] : pts[i]);
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? (close ? pts[0] : p2);
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  if (close) d += ' Z';
  return d;
}

// ─── Doodle generators ────────────────────────────────────────────────────────
// Each returns points in a local coordinate space centred on (0,0). The caller
// translates+rotates the resulting path into place inside the note.

function spiral(size: number): Array<[number, number]> {
  const turns = 2.2 + Math.random() * 1.0;        // 2.2 – 3.2 turns
  const maxR  = size / 2;
  // Non-zero inner radius. With r=0 at center, the displacement filter
  // mangles the tight inner loops into a blob — keeping a small inner
  // ring preserves the spiral silhouette through the wobble.
  const minR  = Math.max(2.5, maxR * 0.18);
  const steps = Math.ceil(turns * 40);
  const phase = Math.random() * Math.PI * 2;
  const dir   = Math.random() < 0.5 ? 1 : -1;     // CW or CCW
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const theta = t * turns * Math.PI * 2 * dir + phase;
    const r = minR + t * (maxR - minR);
    pts.push([Math.cos(theta) * r, Math.sin(theta) * r]);
  }
  return pts;
}

// 5-pointed star drawn as a single continuous polyline (closed). Skip-2
// vertex order produces the classic star outline.
function star(size: number): Array<[number, number]> {
  const r = size / 2;
  const points = 5;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= points; i++) {
    const idx = (i * 2) % points; // 0, 2, 4, 1, 3, 0
    const angle = (idx / points) * Math.PI * 2 - Math.PI / 2;
    pts.push([Math.cos(angle) * r, Math.sin(angle) * r]);
  }
  return pts;
}

// Rose curve r = a·cos(k·θ). 3-petal flower; even k draws 2k petals, odd k
// draws k. Sticking to k=3 keeps it tidy at this scale.
function flower(size: number): Array<[number, number]> {
  const a = size / 2;
  const k = 3 + Math.floor(Math.random() * 3); // 3 – 5
  const phase = Math.random() * Math.PI * 2;
  const steps = 96;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2 + phase;
    const r = a * Math.cos(k * theta);
    pts.push([Math.cos(theta) * r, Math.sin(theta) * r]);
  }
  return pts;
}

function zigzag(size: number): Array<[number, number]> {
  const segments = 4 + Math.floor(Math.random() * 3); // 4 – 6
  const amp = size * 0.25;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = -size / 2 + t * size;
    const y = i % 2 === 0 ? -amp : amp;
    pts.push([x, y]);
  }
  return pts;
}

type DoodleKind = 'spiral' | 'star' | 'flower' | 'zigzag';

// Spiral is always guaranteed; the remaining two slots pull from the other
// kinds so every note has variety without repetitive sine-wave shapes.
const OTHER_KINDS: DoodleKind[] = ['star', 'flower', 'zigzag'];
const CATEGORIES: Array<() => DoodleKind> = [
  () => 'spiral',
  () => OTHER_KINDS[Math.floor(Math.random() * OTHER_KINDS.length)],
  () => OTHER_KINDS[Math.floor(Math.random() * OTHER_KINDS.length)],
];

interface DoodleSpec {
  cx: number;
  cy: number;
  rotation: number;
  d: string;
}

function makeDoodle(kind: DoodleKind, size: number): { pts: Array<[number, number]>; close: boolean } {
  switch (kind) {
    case 'spiral':   return { pts: spiral(size),   close: false };
    case 'star':     return { pts: star(size),     close: true  };
    case 'flower':   return { pts: flower(size),   close: false };
    case 'zigzag':   return { pts: zigzag(size),   close: false };
  }
}

function generateDoodles(
  fieldW: number, fieldH: number, count: number,
  sizeRange: [number, number],
): DoodleSpec[] {
  const specs: DoodleSpec[] = [];
  // Reject sample placement to avoid heavy overlap. Each doodle's bounding box
  // is a rough size×size square; nudge until we find a spot at least 8px clear
  // of any existing doodle. After 40 attempts, give up and place anyway.
  const placed: Array<{ cx: number; cy: number; r: number }> = [];

  // Sample categories without replacement so a 3-doodle note always has one
  // of each (squiggle + spiral + other). For count<3, shuffle and take the
  // first `count` — still guarantees variety, never duplicates a category.
  const categoryOrder = [...CATEGORIES];
  for (let i = categoryOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [categoryOrder[i], categoryOrder[j]] = [categoryOrder[j], categoryOrder[i]];
  }

  for (let i = 0; i < count; i++) {
    const kind = categoryOrder[i % categoryOrder.length]();
    const size = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
    const rotation = (Math.random() - 0.5) * 0.7; // ±0.35 rad ≈ ±20°
    const margin = size / 2 + 4;
    const r = size / 2;

    let cx = 0, cy = 0;
    for (let attempt = 0; attempt < 40; attempt++) {
      cx = margin + Math.random() * Math.max(1, fieldW - margin * 2);
      cy = margin + Math.random() * Math.max(1, fieldH - margin * 2);
      const clash = placed.some(p =>
        Math.hypot(p.cx - cx, p.cy - cy) < (p.r + r + 8),
      );
      if (!clash) break;
    }
    placed.push({ cx, cy, r });

    const { pts, close } = makeDoodle(kind, size);
    specs.push({ cx, cy, rotation, d: pointsToSmoothPath(pts, close) });
  }
  return specs;
}

// 1–3 hand-drawn doodles scattered across the note. Same SVG/turbulence
// approach as StickyDivider so they read as the same brush.
export function StickyDoodles({ fieldWidth, fieldHeight, color, count, sizeRange, strokeWidth }: Props) {
  const filterId = useId();
  const resolvedSizeRange = sizeRange ?? [14, 42];
  const resolvedStrokeWidth = strokeWidth ?? 1.1;
  const { doodles, seed } = useMemo(() => {
    const c = count ?? (1 + Math.floor(Math.random() * 3)); // 1–3 unless caller specifies
    return {
      doodles: generateDoodles(fieldWidth, fieldHeight, c, resolvedSizeRange),
      seed: Math.floor(Math.random() * 1000),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldWidth, fieldHeight, count, sizeRange?.[0], sizeRange?.[1]]);

  return (
    <svg
      width={fieldWidth}
      height={fieldHeight}
      viewBox={`0 0 ${fieldWidth} ${fieldHeight}`}
      style={{ display: 'block', overflow: 'visible', opacity: 0.5 }}
      aria-hidden="true"
    >
      <defs>
        <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.6"
            numOctaves="1"
            seed={seed}
            result="noise"
          />
          {/* Lower scale than the divider — tight spiral / flower turns
              get mangled by anything above ~0.9. */}
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.8" />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`}>
        {doodles.map((doodle, i) => (
          <g
            key={i}
            transform={`translate(${doodle.cx.toFixed(2)} ${doodle.cy.toFixed(2)}) rotate(${(doodle.rotation * 57.2958).toFixed(2)})`}
          >
            <path
              d={doodle.d}
              stroke={color}
              strokeWidth={resolvedStrokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>
        ))}
      </g>
    </svg>
  );
}
