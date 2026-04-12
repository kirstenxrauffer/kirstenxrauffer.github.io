// Wing drawing — hinge-rotated around each wing's pivot.
//
// Fill: native p5 — five overlapping semi-transparent blobs give the classic
// watercolor cauliflower-edge look without needing the spray-mask compositing
// pipeline that doesn't fire in ESM instance mode.

import type p5 from 'p5';
import type { Fairy } from './fairy.types';
import type { WingSpec } from './constants';

// Lehmer LCG — same algorithm as eyes.ts and fairy.draw.ts.
function makeLCG(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

export function drawWing(p: p5, fairy: Fairy, w: WingSpec): void {
  const flap = Math.sin(fairy.wingPhase) * 0.4;
  // Seed mixes pivot position with per-fairy seed — front/back wings get
  // different blotch patterns; each fairy has its own unique wing texture.
  const rng = makeLCG(Math.abs(Math.round(w.pivot.x * 113 + w.pivot.y * 97 + fairy.rngSeed)));

  p.push();
  p.translate(w.pivot.x, w.pivot.y);
  p.rotate(flap);
  p.translate(-w.pivot.x, -w.pivot.y);

  p.noStroke();
  p.push();
  p.translate(w.center.x, w.center.y);
  p.rotate(w.baseRot);
  p.scale(1, 0.67);

  // ─── Watercolor blob fill (native p5) ────────────────────────────────────
  // 5 overlapping blobs replace the original single ellipse.  At alpha ~55 avg
  // per blob, 5 overlapping blobs accumulate to ~72 % opaque at the centre
  // (matching the original 185/255 = 73 %).  The perimeter, covered by fewer
  // blobs, stays patchy — the same watercolor cauliflower-edge technique as
  // the eyes and body.
  const BLOB_N = 5;
  const r = w.r;
  for (let i = 0; i < BLOB_N; i++) {
    const jx = (rng() * 2 - 1) * r * 0.15;
    const jy = (rng() * 2 - 1) * r * 0.15;
    const d  = r * 2 * (0.85 + rng() * 0.15);
    const a  = 55 + rng() * 40;
    p.fill(252, 252, 255, a);
    p.ellipse(jx, jy, d, d);
  }

  p.pop();
  p.pop();
}
