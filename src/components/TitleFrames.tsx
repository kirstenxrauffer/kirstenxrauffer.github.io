import { useId, useMemo } from 'react';

interface Props {
  fieldWidth: number;
  fieldHeight: number;
  color: string;
  wordCount: number;
  /** Stable seed derived from the label — keeps style/jitter identical across renders */
  labelHash: number;
  /** Optional explicit frame style selector (0..NUM_STYLES-1). Falls back to labelHash. */
  styleIndex?: number;
  strokeWidth?: number;
}

export const NUM_TITLE_STYLES = 6;

// Seeded LCG RNG — deterministic per label so each card's frame is stable across renders.
function makeRng(seed: number) {
  let s = ((seed ^ 0xdeadbeef) >>> 0) || 1;
  return (): number => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Catmull-Rom (uniform, tension 0.5) → cubic Bezier. Same smoother as
// StickyDoodles/StickyDivider so these read as the same hand-drawn brush.
function smoothPath(pts: Array<[number, number]>, close = false): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? (close ? pts[pts.length - 1] : pts[i]);
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? (close ? pts[0] : p2);
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  if (close) d += ' Z';
  return d;
}

// Clean rectangle path — sharp 90° corners. Built as a literal line path
// rather than a Catmull-Rom smoothed one, because Catmull-Rom over four
// corner points interpolates them into rounded sides (cushion shape) rather
// than holding the rectangle.
function straightRectPath(
  x1: number, y1: number, x2: number, y2: number,
): string {
  return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2} L ${x1} ${y2} Z`;
}

// Rectangle perimeter with a sine wave perpendicular to each side. Integer
// `cycles` keeps sin(2π·cycles·t)=0 at t∈{0,1}, so corners land exactly on the
// nominal rect corners — no kink where two sides meet, no random jitter.
function sineRect(
  x1: number, y1: number, x2: number, y2: number,
  amp: number, cycles: number,
): Array<[number, number]> {
  const W = x2 - x1, H = y2 - y1;
  const stepsH = 32, stepsV = 24;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= stepsH; i++) {
    const t = i / stepsH;
    pts.push([x1 + t * W, y1 + Math.sin(t * Math.PI * 2 * cycles) * amp]);
  }
  for (let i = 1; i <= stepsV; i++) {
    const t = i / stepsV;
    pts.push([x2 + Math.sin(t * Math.PI * 2 * cycles) * amp, y1 + t * H]);
  }
  for (let i = 1; i <= stepsH; i++) {
    const t = i / stepsH;
    pts.push([x2 - t * W, y2 + Math.sin(t * Math.PI * 2 * cycles) * amp]);
  }
  for (let i = 1; i < stepsV; i++) {
    const t = i / stepsV;
    pts.push([x1 + Math.sin(t * Math.PI * 2 * cycles) * amp, y2 - t * H]);
  }
  return pts;
}

type FrameData =
  | { type: 'paths'; paths: string[] }
  | {
      type: 'hatch';
      boxInner: string;
      boxOuter: string;
      hatchPaths: string[];
      clipInner: { x1: number; y1: number; x2: number; y2: number };
      clipOuter: { x1: number; y1: number; x2: number; y2: number };
    };

// Inner-frame half-dimensions tuned against the CSS font sizes (3.2/2.4/1.9/1.5rem)
// — keeps the frame flush around the text without clipping descenders.
function innerHalfSize(wordCount: number): [number, number] {
  if (wordCount >= 4) return [132, 64];
  if (wordCount === 3) return [124, 57];
  if (wordCount === 2) return [114, 50];
  return [98, 44];
}

const NUM_STYLES = NUM_TITLE_STYLES;

function computeFrame(
  wordCount: number, fw: number, fh: number,
  rng: () => number, style: number,
): FrameData {
  const cx = fw / 2, cy = fh / 2;
  const [hw, hh] = innerHalfSize(wordCount);
  const ix1 = cx - hw, iy1 = cy - hh, ix2 = cx + hw, iy2 = cy + hh;
  const exp = (n: number) => ({ x1: ix1 - n, y1: iy1 - n, x2: ix2 + n, y2: iy2 + n });

  // Use the seeded rng so different labels still get different visual flavors
  // within the same style (e.g., different sine cycle counts), but every
  // generated path is itself smooth — no per-vertex random jitter.
  void rng;
  switch (((style % NUM_STYLES) + NUM_STYLES) % NUM_STYLES) {
    case 0: { // Double straight box — two concentric clean rectangles
      const o = exp(13);
      return { type: 'paths', paths: [
        straightRectPath(ix1, iy1, ix2, iy2),
        straightRectPath(o.x1, o.y1, o.x2, o.y2),
      ]};
    }
    case 1: { // Triple straight box — three concentric clean rectangles
      const m = exp(11), o = exp(21);
      return { type: 'paths', paths: [
        straightRectPath(ix1, iy1, ix2, iy2),
        straightRectPath(m.x1, m.y1, m.x2, m.y2),
        straightRectPath(o.x1, o.y1, o.x2, o.y2),
      ]};
    }
    case 2: { // Wavy outer + straight inner — gentle sine on the outer frame
      const o = exp(15);
      return { type: 'paths', paths: [
        straightRectPath(ix1, iy1, ix2, iy2),
        smoothPath(sineRect(o.x1, o.y1, o.x2, o.y2, 3, 4), true),
      ]};
    }
    case 3: { // Corner brackets — clean inner + outer L-shapes only
      const o = exp(16);
      const { x1: ox1, y1: oy1, x2: ox2, y2: oy2 } = o;
      const ilen = 24, olen = 28;
      const paths: string[] = [];
      const corners: Array<[number, number, number, number, number]> = [
        [ix1, iy1,  1,  1, ilen],
        [ix2, iy1, -1,  1, ilen],
        [ix2, iy2, -1, -1, ilen],
        [ix1, iy2,  1, -1, ilen],
        [ox1, oy1,  1,  1, olen],
        [ox2, oy1, -1,  1, olen],
        [ox2, oy2, -1, -1, olen],
        [ox1, oy2,  1, -1, olen],
      ];
      for (const [bx, by, sx, sy, len] of corners) {
        paths.push(
          `M ${(bx + sx * len).toFixed(2)},${by.toFixed(2)}` +
          ` L ${bx.toFixed(2)},${by.toFixed(2)}` +
          ` L ${bx.toFixed(2)},${(by + sy * len).toFixed(2)}`,
        );
      }
      return { type: 'paths', paths };
    }
    case 4: { // Double wavy box — both frames smooth sine, different cycle counts
      const o = exp(14);
      return { type: 'paths', paths: [
        smoothPath(sineRect(ix1, iy1, ix2, iy2, 2.5, 5), true),
        smoothPath(sineRect(o.x1, o.y1, o.x2, o.y2, 3.5, 4), true),
      ]};
    }
    case 5: { // Diagonal hatch clipped to the margin between inner and outer box
      const o = exp(15);
      const { x1: ox1, y1: oy1, x2: ox2, y2: oy2 } = o;
      const spacing = 8;
      const W = ox2 - ox1, H = oy2 - oy1;
      const hatchPaths: string[] = [];
      // Lines at 45°. Generate across the whole bounding rect — clipPath
      // (even-odd) below will keep only the segments inside the margin band.
      for (let t = -H; t <= W; t += spacing) {
        const sx = t >= 0 ? ox1 + t : ox1;
        const sy = t >= 0 ? oy1 : oy1 - t;
        hatchPaths.push(`M ${sx.toFixed(2)},${sy.toFixed(2)} L ${(sx + H).toFixed(2)},${(sy + H).toFixed(2)}`);
      }
      return {
        type: 'hatch',
        boxInner: straightRectPath(ix1, iy1, ix2, iy2),
        boxOuter: straightRectPath(ox1, oy1, ox2, oy2),
        hatchPaths,
        clipInner: { x1: ix1, y1: iy1, x2: ix2, y2: iy2 },
        clipOuter: { x1: ox1, y1: oy1, x2: ox2, y2: oy2 },
      };
    }
    default:
      return { type: 'paths', paths: [] };
  }
}

export function TitleFrames({
  fieldWidth, fieldHeight, color, wordCount, labelHash, styleIndex, strokeWidth,
}: Props) {
  const filterId = useId();
  const clipId   = useId();
  const resolvedStroke = strokeWidth ?? 1.6;

  const resolvedStyle = styleIndex ?? labelHash;

  const { frameData, noiseSeed } = useMemo(() => ({
    frameData: computeFrame(wordCount, fieldWidth, fieldHeight, makeRng(labelHash), resolvedStyle),
    noiseSeed: Math.abs(labelHash) % 256,
  }), [fieldWidth, fieldHeight, wordCount, labelHash, resolvedStyle]);

  return (
    <svg
      width={fieldWidth}
      height={fieldHeight}
      viewBox={`0 0 ${fieldWidth} ${fieldHeight}`}
      style={{ display: 'block', overflow: 'visible', opacity: 0.72 }}
      aria-hidden="true"
    >
      <defs>
        <filter id={filterId} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="1" seed={noiseSeed} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.25" />
        </filter>
        {frameData.type === 'hatch' && (
          <clipPath id={clipId}>
            {/* Even-odd donut: outer rect minus inner rect → clip to margin band. */}
            <path
              fillRule="evenodd"
              d={[
                `M ${frameData.clipOuter.x1} ${frameData.clipOuter.y1}`,
                `H ${frameData.clipOuter.x2} V ${frameData.clipOuter.y2}`,
                `H ${frameData.clipOuter.x1} Z`,
                `M ${frameData.clipInner.x1} ${frameData.clipInner.y1}`,
                `H ${frameData.clipInner.x2} V ${frameData.clipInner.y2}`,
                `H ${frameData.clipInner.x1} Z`,
              ].join(' ')}
            />
          </clipPath>
        )}
      </defs>
      <g
        filter={`url(#${filterId})`}
        stroke={color}
        strokeWidth={resolvedStroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {frameData.type === 'paths' && frameData.paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
        {frameData.type === 'hatch' && (
          <>
            <path d={frameData.boxInner} />
            <path d={frameData.boxOuter} />
            <g clipPath={`url(#${clipId})`} strokeWidth={resolvedStroke * 0.7} opacity={0.6}>
              {frameData.hatchPaths.map((d, i) => <path key={i} d={d} />)}
            </g>
          </>
        )}
      </g>
    </svg>
  );
}
