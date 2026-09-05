// Wing drawing — hinge-rotated around each wing's pivot.
//
// Watercolor look via layered translucent discs:
//   1. 18 outer membrane ellipses — lavender-white, heavily jittered, very
//      transparent. Accumulated opacity reads as a soft translucent wash.
//   2. 10 inner highlight ellipses — white, less jitter, slightly brighter.
//      Simulates how light pools at the centre of a drying watercolour wash.
//   3. 24 edge granulation dots — small circles placed near the wing perimeter
//      at random angles, suggesting the pigment granulation of real watercolour.
//
// Lehmer LCG seeded from fairy.rngSeed XOR wing-center gives stable, per-wing
// jitter (same sequence → no flicker).
//
// PERFORMANCE: those 52 shapes are *static in the wing's local space* — the LCG
// is re-seeded identically on every call and none of the geometry reads time.
// The flap is a rotation applied around the pivot before any of it is drawn. So
// they are rendered once into an offscreen sprite and blitted inside the same
// transform stack, which is pixel-equivalent. That took the two wings from 104
// draw calls per frame to 2.

import type { Fairy } from './fairy.types';
import type { WingSpec } from './constants';
import type { Painter } from '../render/painter';
import { SpriteTable } from '../render/sprite';

// Lehmer LCG — identical algorithm to eyes.ts and fairy.draw.ts.
function makeLCG(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

const wingSprites = new SpriteTable();

/** Drop cached wing bitmaps (call on sketch teardown). */
export function clearWingSprites(): void { wingSprites.clear(); }

// Bound on how far the artwork reaches from the wing's local origin:
//   outer membrane  0.18r jitter + 1.12r radius = 1.30r   ← the binding case
//   inner highlight 0.07r        + 0.75r        = 0.82r
//   granulation     1.08r        + 3px dot radius
// 1.35r + 4 leaves margin without wasting texture.
const EXTENT = (r: number) => r * 1.35 + 4;

function paintWing(p: Painter, seed: number, r: number): void {
  const rng = makeLCG(seed);
  p.noStroke();

  // ── Outer membrane wash ───────────────────────────────────────────────────
  // 18 jittered gray-white ellipses. Tone varies subtly per layer (195–228)
  // so the wing reads as a soft grayscale wash rather than a glowing shape.
  for (let i = 0; i < 18; i++) {
    const jx   = (rng() * 2 - 1) * r * 0.18;
    const jy   = (rng() * 2 - 1) * r * 0.18;
    const sr   = r * (0.82 + rng() * 0.30);
    const a    = 6 + rng() * 9;     // 6–15 / 255 — much duller
    const tone = 195 + rng() * 33;  // 195–228: light-to-mid gray
    p.fill(tone, tone, tone, a);
    p.ellipse(jx, jy, sr * 2, sr * 2);
  }

  // ── Inner highlight ───────────────────────────────────────────────────────
  // 10 near-white ellipses, tighter jitter. Slightly brighter than the outer
  // wash but still muted — no glow, just a pale pooling at centre.
  for (let i = 0; i < 10; i++) {
    const jx   = (rng() * 2 - 1) * r * 0.07;
    const jy   = (rng() * 2 - 1) * r * 0.07;
    const sr   = r * (0.55 + rng() * 0.20);
    const a    = 8 + rng() * 10;    // 8–18 / 255
    const tone = 220 + rng() * 35;  // 220–255: near-white
    p.fill(tone, tone, tone, a);
    p.ellipse(jx, jy, sr * 2, sr * 2);
  }

  // ── Edge granulation ─────────────────────────────────────────────────────
  // 24 tiny dots at the wing perimeter. Darker gray (140–185) so they read
  // as dried pigment at the tide line rather than glowing highlights.
  for (let i = 0; i < 24; i++) {
    const angle = rng() * Math.PI * 2;
    const dist  = r * (0.72 + rng() * 0.36);
    const ex    = Math.cos(angle) * dist;
    const ey    = Math.sin(angle) * dist;
    const dotD  = 2 + rng() * 4;
    const a     = 5 + rng() * 12;   // 5–17 / 255
    const tone  = 140 + rng() * 45; // 140–185: medium gray
    p.fill(tone, tone, tone, a);
    p.circle(ex, ey, dotD);
  }
}

export function drawWing(p: Painter, fairy: Fairy, w: WingSpec): void {
  const flap = Math.sin(fairy.wingPhase) * 0.4;

  // Unique seed per wing so front and back wings differ.
  const seed = fairy.rngSeed ^ (Math.abs(w.center.x * 1000) | 0);
  const r = w.r;
  const halfExtent = EXTENT(r);

  // Supersample above the on-screen rate: the wing spans ~2·1.3·r local units,
  // which at fairy.scale on a DPR-2 display is well under 100 device px.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pxPerUnit = Math.max(0.25, fairy.scale * dpr * 1.5);

  const sprite = wingSprites.get(`${seed}`);
  // Key omits `flap` on purpose — it is a transform below, not artwork.
  sprite.ensure(
    `${seed}|${r}|${pxPerUnit.toFixed(2)}`,
    halfExtent,
    pxPerUnit,
    (sp) => paintWing(sp, seed, r),
  );

  p.push();
  p.translate(w.pivot.x, w.pivot.y);
  p.rotate(flap);
  p.translate(-w.pivot.x, -w.pivot.y);

  p.push();
  p.translate(w.center.x, w.center.y);
  p.rotate(w.baseRot);
  p.scale(1, 0.67);  // flatten into wing ellipse shape

  sprite.blit(p);

  p.pop();
  p.pop();
}
