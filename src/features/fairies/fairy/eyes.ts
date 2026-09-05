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
// Drawn as plain Canvas 2D discs via the Painter (see render/painter.ts).
//
// PERFORMANCE: the two scleras and two pupils were 30 of the fairy's ~42
// remaining draw calls per frame (8 + 8 + 7 + 7). They are now cached sprites.
//
// What makes that exact rather than approximate: every dimension below is a
// LINEAR multiple of `eye.sclera` (sclera) or `eye.pupilR` (pupil) — jitter,
// diameter and the pupil's dark core alike — while the alphas are constants and
// the LCG seed depends only on values that never change (eye.cx/cy, and
// fairy.rngSeed for the pupil). The artwork is therefore one fixed unit pattern
// under a uniform scale. Rendering it once at unit size and blitting under
// `scale(eye.sclera)` reproduces it exactly, and the eyeFlipT size cross-fade
// becomes a free transform instead of a cache invalidation.

import type { Painter } from '../render/painter';
import type { Fairy } from './fairy.types';
import { EYE_SIZES, FAIRY_SCALE, type EyeSpec } from './constants';
import { SpriteTable } from '../render/sprite';

// Lehmer LCG — identical algorithm to pollenTrail.ts's deterministic scatter.
function makeLCG(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

const scleraSprites = new SpriteTable();
const pupilSprites  = new SpriteTable();

/** Drop cached eye bitmaps (call on sketch teardown). */
export function clearEyeSprites(): void {
  scleraSprites.clear();
  pupilSprites.clear();
}

// Reach of the artwork from the eye centre, in units of the driving dimension:
//   sclera: 0.25·(1/2) jitter + 1.0/2 radius     = 0.625
//   pupil:  0.35·(1/2) jitter + 1.0/2 radius     = 0.675
const SCLERA_EXTENT = 0.66;
const PUPIL_EXTENT  = 0.70;

// Sprites are rasterised against the LARGEST size each feature ever reaches, so
// the bitmap is only ever scaled down at blit time and the key stays constant
// through the cross-fade.
const SCLERA_REF = Math.max(EYE_SIZES.A.scleraR, EYE_SIZES.B.scleraR);
const PUPIL_REF  = Math.max(EYE_SIZES.A.pupilR,  EYE_SIZES.B.pupilR);
// The eyes are the sharpest feature on the fairy, so supersample harder than
// the soft glow and wings do.
const EYE_SUPERSAMPLE = 3;

function resolution(refSize: number, fairyScale: number): number {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return Math.max(1, refSize * fairyScale * dpr * EYE_SUPERSAMPLE);
}

/** The 8 white blobs, in units where the sclera diameter is 1, centred on (0,0). */
function paintSclera(p: Painter, seed: number): void {
  const rng = makeLCG(seed);
  p.noStroke();
  const r = 0.5; // unit sclera radius
  // 8 white blobs: jitter ±25 % of radius, diameter 75–100 % of sclera.
  // Alpha 120–160 per blob; 5+ overlapping blobs bring center above 97 % opaque.
  const BLOB_N = 8;
  for (let i = 0; i < BLOB_N; i++) {
    const jx = (rng() * 2 - 1) * r * 0.25;
    const jy = (rng() * 2 - 1) * r * 0.25;
    const d  = 1 * (0.75 + rng() * 0.25);
    const a  = 120 + rng() * 40;
    p.fill(255, 255, 255, a);
    p.circle(jx, jy, d);
  }
}

/** The 6 mauve blobs plus dark core, in units where pupilR is 1, centred on (0,0). */
function paintPupil(p: Painter, seed: number): void {
  const rng = makeLCG(seed);
  p.noStroke();
  const pr = 0.5; // unit pupil radius
  // 6 mauve blobs: jitter ±35 % of pupil radius, diameter 70–100 % of pupilR.
  // Alpha 130–190 per blob; overlap builds a dense, irregular ink dot.
  const BLOB_N = 6;
  for (let i = 0; i < BLOB_N; i++) {
    const jx = (rng() * 2 - 1) * pr * 0.35;
    const jy = (rng() * 2 - 1) * pr * 0.35;
    const d  = 1 * (0.7 + rng() * 0.3);
    const a  = 130 + rng() * 60;
    p.fill(155, 112, 112, a);
    p.circle(jx, jy, d);
  }

  // Darker core: watercolor pigment pools at the center of a painted dot.
  p.fill(100, 70, 70, 160);
  p.circle(0, 0, 0.45);
}

export function drawSclera(p: Painter, eye: EyeSpec): void {
  // Seed from eye center — stable per eye position, differs for EYE_A vs EYE_B.
  const seed = Math.abs(Math.round(eye.cx * 127 + eye.cy * 31 + 9001));
  const pxPerUnit = resolution(SCLERA_REF, FAIRY_SCALE);

  const sprite = scleraSprites.get(`${seed}`);
  sprite.ensure(`${seed}|${pxPerUnit.toFixed(1)}`, SCLERA_EXTENT, pxPerUnit,
    (sp) => paintSclera(sp, seed));

  p.push();
  p.translate(eye.cx, eye.cy);
  p.scale(eye.sclera);   // unit pattern → actual size
  sprite.blit(p);
  p.pop();
}

export function drawPupil(p: Painter, fairy: Fairy, eye: EyeSpec, offset: { x: number; y: number }): void {
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
  const seed = Math.abs(Math.round(eye.cx * 251 + eye.cy * 97 + fairy.rngSeed));
  const pxPerUnit = resolution(PUPIL_REF, fairy.scale);

  const sprite = pupilSprites.get(`${seed}`);
  sprite.ensure(`${seed}|${pxPerUnit.toFixed(1)}`, PUPIL_EXTENT, pxPerUnit,
    (sp) => paintPupil(sp, seed));

  p.push();
  p.translate(px, py);
  p.scale(eye.pupilR);   // unit pattern → actual size
  sprite.blit(p);
  p.pop();
}
