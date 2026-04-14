// Watercolor card-back generator.
//
// Ports the recursive-blob technique from Jared Stanley's "Watercolor blob
// generator" (https://codepen.io/jaredstanley/pen/OJvNQJN) to a deterministic,
// seeded renderer sized for a playing card. Every card in a session shares the
// same seed (so every card back is identical); `newCardBackSession()` rolls a
// fresh seed, which is how each new session gets a different design.
//
// Rendered images are cached by seed as data URLs so CardBack components can
// mount cheaply.

import { useSyncExternalStore } from 'react';

// Canvas size — 2× the CSS card footprint so the blob art stays crisp when
// scaled up. The image is applied via background-size: cover.
const W = 300;
const H = 420;

const cache = new Map<number, string>();
const listeners = new Set<() => void>();

let currentSeed = randomSeed();

// Palette sampled from the current page background (hero image). When set,
// card-back hues derive from this palette so the deck visually belongs to
// whichever scene is showing. Stored as HSL triples [h°, s%, l%] so the
// renderer can rebuild hsla() strings with its own alpha/saturation curves.
let bgHues: Array<[number, number, number]> = [];

export function setBackgroundPalette(rgbStrings: string[]): void {
  const next = rgbStrings
    .map(parseRgbToHsl)
    .filter((x): x is [number, number, number] => x !== null);
  // Skip update when the palette is effectively unchanged — avoids blowing
  // the render cache (and re-painting every mounted CardBack) on every
  // parent re-render that passes the same array through.
  if (hslListsEqual(next, bgHues)) return;
  bgHues = next;
  cache.clear();
  listeners.forEach((l) => l());
}

function hslListsEqual(a: Array<[number, number, number]>, b: Array<[number, number, number]>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1] || a[i][2] !== b[i][2]) return false;
  }
  return true;
}

function parseRgbToHsl(css: string): [number, number, number] | null {
  // Accepts `rgb(r, g, b)` and `rgb(r g b)` — the watercolor palette
  // extractor emits the comma form, but be lenient.
  const m = css.match(/rgb\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)/i);
  if (!m) return null;
  const r = +m[1] / 255;
  const g = +m[2] / 255;
  const b = +m[3] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function randomSeed(): number {
  // LCG wants a positive 32-bit-ish value; shift 0 out of the way.
  return Math.floor(Math.random() * 2_000_000) + 1;
}

export function newCardBackSession(): void {
  currentSeed = randomSeed();
  listeners.forEach((l) => l());
}

export function getCurrentCardBackSeed(): number {
  return currentSeed;
}

function subscribeCardBack(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useCardBackSeed(): number {
  return useSyncExternalStore(subscribeCardBack, getCurrentCardBackSeed, getCurrentCardBackSeed);
}

export function getCardBackDataURL(seed: number): string {
  const hit = cache.get(seed);
  if (hit) return hit;
  const url = render(seed);
  cache.set(seed, url);
  return url;
}

// ── Seeded RNG (same LCG as the reference pen) ──────────────────────────────
function makeRng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── Palette: muted watercolor washes on a paper-ish base ────────────────────
// The reference pen's blobs each use a single low-alpha color and the painter
// layers them with a blend mode to get the bleed. We pick a base tint plus a
// family of related hues so each session has a coherent look (vs the pen's
// maximally-random palette, which would clash on a card face-down pile).
// Only blend modes that reliably darken a near-white paper base regardless of
// blob hue/alpha. `soft-light` and `color-burn` were dropped: on our light
// base + low-alpha washes they frequently produced visually-empty cards
// (the "sometimes the effect doesn't load" bug).
const BLEND_MODES: GlobalCompositeOperation[] = [
  'multiply',
  'darken',
];

function pickPalette(rnd: () => number): { base: string; blobs: string[] } {
  // When a background palette has been sampled from the scene image, derive
  // card hues from it — but keep the watercolor saturation/lightness/alpha
  // curves so washes read consistently regardless of source colors.
  if (bgHues.length > 0) return paletteFromBackground(rnd);

  // Fallback: fully-synthetic palette (used before the hero image reports
  // its colors, or if palette extraction returned empty).
  const baseL = 88 + rnd() * 8; // 88–96% lightness
  const baseH = Math.floor(rnd() * 360);
  const baseS = 20 + rnd() * 25;
  const base = `hsl(${baseH}, ${baseS}%, ${baseL}%)`;

  const anchor = Math.floor(rnd() * 360);
  const blobs: string[] = [];
  for (let i = 0; i < 5; i++) {
    const h = (anchor + (rnd() - 0.5) * 80 + 360) % 360;
    const s = 60 + rnd() * 30;
    const l = 38 + rnd() * 24;
    // Keep alpha low — the watercolor bleed comes from averaging many
    // slightly-different silhouettes. Higher alpha makes the composite
    // edge crisper (harsher), not darker-in-a-good-way.
    const a = 0.010 + rnd() * 0.018;
    blobs.push(`hsla(${h}, ${s}%, ${l}%, ${a.toFixed(4)})`);
  }
  return { base, blobs };
}

function paletteFromBackground(rnd: () => number): { base: string; blobs: string[] } {
  // Paper base: nudge toward the mean hue of the sampled colors so the
  // card's "paper" reads as warmed by the scene, not a neutral cream.
  // Lightness stays near-white — a strong paper tint would fight the blobs.
  const meanH = circularMeanHue(bgHues);
  const baseL = 90 + rnd() * 5;
  const baseS = 12 + rnd() * 14;
  const base = `hsl(${meanH.toFixed(1)}, ${baseS.toFixed(1)}%, ${baseL.toFixed(1)}%)`;

  // Blobs cycle through the sampled hues in a rnd-shuffled order, so each
  // session emphasises a different pairing from the same scene palette.
  const order = shuffleIndices(bgHues.length, rnd);
  const blobs: string[] = [];
  for (let i = 0; i < 5; i++) {
    const [h] = bgHues[order[i % order.length]];
    // Small per-blob hue drift keeps stacked washes from merging into one
    // flat color. Saturation/lightness/alpha match the fallback branch so
    // the two render paths produce compatible visual weights.
    const hJ = (h + (rnd() - 0.5) * 18 + 360) % 360;
    const s = 60 + rnd() * 30;
    const l = 38 + rnd() * 24;
    const a = 0.010 + rnd() * 0.018;
    blobs.push(`hsla(${hJ.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, ${a.toFixed(4)})`);
  }
  return { base, blobs };
}

// Circular mean of hues (degrees). Straight arithmetic mean is wrong on the
// hue wheel — e.g. mean(350°, 10°) should be 0°, not 180°. We average the
// unit vectors instead.
function circularMeanHue(hsls: Array<[number, number, number]>): number {
  let sx = 0, sy = 0;
  for (const [h] of hsls) {
    const r = (h * Math.PI) / 180;
    sx += Math.cos(r);
    sy += Math.sin(r);
  }
  const ang = Math.atan2(sy, sx) * 180 / Math.PI;
  return (ang + 360) % 360;
}

function shuffleIndices(n: number, rnd: () => number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Blob construction (ported from the reference pen) ──────────────────────
type Pt = { x: number; y: number };

function createMidPoint(p1: Pt, p2: Pt, rnd: () => number, amp: number): Pt {
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  // Decoupled angle + magnitude (the reference pen coupled them, which
  // clustered displacement along certain directions and produced spiky
  // silhouettes). Amplitude is passed in so deeper subdivisions add less
  // noise — smooth silhouette, watercolor-soft edge.
  const rMag = rnd() * amp;
  const ang = rnd() * 2 * Math.PI;
  return {
    x: midX + rMag * Math.cos(ang),
    y: midY + rMag * Math.sin(ang),
  };
}

function subDivide(arr: Pt[], center: Pt, rnd: () => number, amp: number): Pt[] {
  const out: Pt[] = [];
  out.push({ ...center });
  for (let i = 1; i < arr.length; i++) {
    out.push(createMidPoint(arr[i], arr[i - 1], rnd, amp));
    out.push(arr[i]);
  }
  out.push(createMidPoint(arr[arr.length - 1], arr[0], rnd, amp));
  return out;
}

function initStartingPoints(center: Pt, radius: number, rnd: () => number): Pt[] {
  const pts: Pt[] = [];
  const num = 8;
  const step = (2 * Math.PI) / num;
  let ang = 0;
  for (let i = 0; i < num; i++) {
    pts.push({
      x: center.x + Math.cos(ang) * radius * rnd(),
      y: center.y + Math.sin(ang) * radius,
    });
    ang += step;
  }
  return pts;
}

// Jitter amplitude (px) with a GENTLE per-pass decay. We need large variance
// at every subdivision depth so stacked low-alpha layers differ from each
// other — that variance is what averages into a soft bleed. Aggressive decay
// makes the ~180 layers per blob collapse to nearly the same silhouette,
// which reads as a crisp/harsh composite edge instead of watercolor.
const BASE_AMP = 42;
const AMP_DECAY = 0.88;

function buildBaseShape(center: Pt, radius: number, rnd: () => number): Pt[] {
  // 4 subdivision passes => ~64 base points. More melts your CPU; fewer looks
  // polygonal. The pen uses the same number.
  let arr = initStartingPoints(center, radius, rnd);
  let amp = BASE_AMP;
  for (let i = 0; i < 4; i++) {
    arr = subDivide(arr, center, rnd, amp);
    amp *= AMP_DECAY;
  }
  return arr;
}

function generateLayer(base: Pt[], center: Pt, rnd: () => number): Pt[] {
  let arr = base.slice();
  // Layer-level subdivisions add very subtle bleed jitter — the base shape
  // already carries the silhouette character.
  let amp = BASE_AMP * Math.pow(AMP_DECAY, 4);
  for (let i = 0; i < 3; i++) {
    arr = subDivide(arr, center, rnd, amp);
    amp *= AMP_DECAY;
  }
  return arr;
}

// Render the point ring as a closed smooth curve: a quadratic Bézier through
// each midpoint, with the ring's points acting as control handles. This turns
// the jittered polygon into a continuously-curved silhouette, which is what
// makes the stacked washes read as bleed rather than layered jaggies.
function drawShape(ctx: CanvasRenderingContext2D, pts: Pt[], color: string) {
  if (pts.length < 3) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  const n = pts.length;
  const first = pts[0];
  const last = pts[n - 1];
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const next = pts[(i + 1) % n];
    ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  ctx.closePath();
  ctx.fill();
}

// ── Render ─────────────────────────────────────────────────────────────────
function render(seed: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const rnd = makeRng(seed);
  const palette = pickPalette(rnd);
  const blendMode = BLEND_MODES[Math.floor(rnd() * BLEND_MODES.length)];

  // Paper base.
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = palette.base;
  ctx.fillRect(0, 0, W, H);

  // A subtle paper-fiber speckle before the washes go down — keeps the card
  // from looking like a flat gradient where the blobs thin out.
  ctx.save();
  for (let i = 0; i < 600; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const a = 0.015 + rnd() * 0.03;
    ctx.fillStyle = `rgba(60, 40, 20, ${a.toFixed(3)})`;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();

  ctx.globalCompositeOperation = blendMode;
  // Canvas filter blur smooths the accumulated layer edges into a true
  // bleed. Increased to ~2.4px because the main softness here comes from
  // inter-layer silhouette variance (not blur alone), but the blur helps
  // the outer wash feather into the paper base.
  ctx.filter = 'blur(2.4px)';

  const center: Pt = { x: W / 2, y: H / 2 };
  // Radius tuned so blobs extend past the card edges for a full-bleed wash.
  const radius = Math.max(W, H) * 0.55;

  for (let c = 0; c < palette.blobs.length; c++) {
    const color = palette.blobs[c];
    const base = buildBaseShape(center, radius, rnd);

    // The pen iterates 20 "draw cycles", each generating 3 layers. Each layer
    // is the base silhouette re-subdivided with fresh jitter, so stacking
    // transparent fills produces the bleed/gradient you'd get from water
    // pooling in real paint.
    for (let j = 0; j < 20; j++) {
      for (let k = 0; k < 3; k++) {
        const layer = generateLayer(base, center, rnd);
        drawShape(ctx, layer, color);
      }
    }
  }

  // Soft vignette on top, restoring source-over + no-filter so it composites
  // cleanly (vignette shouldn't inherit the wash blur).
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(40,20,10,0.18)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  return canvas.toDataURL('image/png');
}
