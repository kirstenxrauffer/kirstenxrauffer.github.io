// Wing drawing — hinge-rotated around each wing's pivot.
//
// Watercolor simulation using NATIVE p5 only.
//
// Why not p5.brush fill: p5.brush's fill pipeline composites via an off-screen
// glMask flushed by a postdraw hook that only registers in global mode. In ESM
// instance mode (this project) the hook is never installed, so brush fills
// produce nothing. See pollenTrail.ts for the full explanation.
//
// Watercolor look via layered native p5:
//   1. 18 outer membrane ellipses — lavender-white, heavily jittered, very
//      transparent. Accumulated opacity reads as a soft translucent wash.
//   2. 10 inner highlight ellipses — white, less jitter, slightly brighter.
//      Simulates how light pools at the centre of a drying watercolour wash.
//   3. 24 edge granulation dots — small circles placed near the wing perimeter
//      at random angles, suggesting the pigment granulation of real watercolour.
//
// Lehmer LCG seeded from fairy.rngSeed XOR wing-center gives stable, per-wing
// jitter every frame (same sequence → no flicker).

import type p5 from 'p5';
import type { Fairy } from './fairy.types';
import type { WingSpec } from './constants';

// Lehmer LCG — identical algorithm to eyes.ts and fairy.draw.ts.
function makeLCG(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

export function drawWing(p: p5, fairy: Fairy, w: WingSpec): void {
  const flap = Math.sin(fairy.wingPhase) * 0.4;

  // Unique seed per wing so front and back wings differ.
  const rng = makeLCG(fairy.rngSeed ^ (Math.abs(w.center.x * 1000) | 0));

  p.push();
  p.translate(w.pivot.x, w.pivot.y);
  p.rotate(flap);
  p.translate(-w.pivot.x, -w.pivot.y);

  p.push();
  p.translate(w.center.x, w.center.y);
  p.rotate(w.baseRot);
  p.scale(1, 0.67);  // flatten into wing ellipse shape

  const r = w.r;
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

  p.pop();
  p.pop();
}
