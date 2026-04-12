// Eye drawing. Split into drawSclera / drawPupil so z-order can match
// the SVG: sclera A → sclera B → pupil B → pupil A.
//
// Both functions use a multi-blob watercolor technique instead of a single
// crisp circle. N overlapping semi-transparent discs, each with a jittered
// center and slightly varied diameter, are drawn from a deterministic LCG
// seeded by the eye's position. The center where all blobs overlap accumulates
// to near-opaque; the perimeter, covered by fewer blobs, stays patchy —
// producing the classic watercolor cauliflower-edge blotch.
//
// NOTE: p5.brush fills cannot be used here. p5.brush's spray mask is flushed
// via a postdraw hook that only registers in global (non-ESM) mode; in this
// ESM instance-mode sketch the hook never fires and nothing would appear.
// (See pollenTrail.ts §"Why native p5" for the full explanation.)

import type p5 from 'p5';
import type { Fairy } from './fairy.types';
import type { EyeSpec } from './constants';

// Lehmer LCG — identical algorithm to pollenTrail.ts's deterministic scatter.
// Seeded once per draw call; produces the same sequence every frame.
function makeLCG(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

export function drawSclera(p: p5, eye: EyeSpec): void {
  // Seed from eye center — stable per eye position, differs for EYE_A vs EYE_B.
  const rng = makeLCG(Math.abs(Math.round(eye.cx * 127 + eye.cy * 31 + 9001)));
  p.noStroke();

  const r = eye.sclera / 2;
  // 8 white blobs: jitter ±25 % of radius, diameter 75–100 % of sclera.
  // Alpha 120–160 per blob; 5+ overlapping blobs bring center above 97 % opaque.
  const BLOB_N = 8;
  for (let i = 0; i < BLOB_N; i++) {
    const jx = (rng() * 2 - 1) * r * 0.25;
    const jy = (rng() * 2 - 1) * r * 0.25;
    const d  = eye.sclera * (0.75 + rng() * 0.25);
    const a  = 120 + rng() * 40;
    p.fill(255, 255, 255, a);
    p.circle(eye.cx + jx, eye.cy + jy, d);
  }
}

export function drawPupil(p: p5, fairy: Fairy, eye: EyeSpec, offset: { x: number; y: number }): void {
  // Clamp the COMBINED (renderOffset + gaze offset) vector so the pupil always
  // stays inside the sclera in every direction equally.
  // Clamping the raw gaze offset alone excluded renderOffset from the budget,
  // which caused the pupil to clip outside the sclera on one side and have
  // artificially less travel on the other.
  //
  // sclera and pupilR are diameters, so divide by 2 for radii.
  // maxDistance: how far the pupil CENTER can be from the sclera CENTER.
  const maxDistance = Math.max(0, eye.sclera / 2 - eye.pupilR / 2 - 16);
  const cx = eye.renderOffset.x + offset.x;
  const cy = eye.renderOffset.y + offset.y;
  const dist = Math.hypot(cx, cy);
  const scale = dist > maxDistance && dist > 0 ? maxDistance / dist : 1;

  const px = eye.cx + cx * scale;
  const py = eye.cy + cy * scale;

  // Seed mixes eye position with per-fairy seed so each fairy has unique blotches.
  const rng = makeLCG(Math.abs(Math.round(eye.cx * 251 + eye.cy * 97 + fairy.rngSeed)));
  p.noStroke();

  const pr = eye.pupilR / 2;
  // 6 mauve blobs: jitter ±35 % of pupil radius, diameter 70–100 % of pupilR.
  // Alpha 130–190 per blob; overlap builds a dense, irregular ink dot.
  const BLOB_N = 6;
  for (let i = 0; i < BLOB_N; i++) {
    const jx = (rng() * 2 - 1) * pr * 0.35;
    const jy = (rng() * 2 - 1) * pr * 0.35;
    const d  = eye.pupilR * (0.7 + rng() * 0.3);
    const a  = 130 + rng() * 60;
    p.fill(155, 112, 112, a);
    p.circle(px + jx, py + jy, d);
  }

  // Darker core: watercolor pigment pools at the center of a painted dot.
  p.fill(100, 70, 70, 160);
  p.circle(px, py, eye.pupilR * 0.45);
}
