// Pollen trail: a ring buffer of timestamped stamps redrawn each frame.
//
// Why redraw every frame: sketch.ts calls p.clear() at the top of draw(), so
// nothing persists on the canvas. Each live stamp must be re-drawn every frame
// with alpha scaled to its remaining lifetime.
//
// Why native p5 (not p5.brush): p5.brush's spray pipeline draws into an
// off-screen glMask and composites it to the canvas via a postdraw lifecycle
// hook. That hook is registered by registerP5Addon(), which p5.brush only runs
// when typeof p5 !== "undefined" (global mode). In ESM instance mode, p5 is
// never a global, so the hook is never registered and the mask is never
// flushed — nothing would appear. Native p5 draws directly to the WEBGL
// framebuffer, no flush step needed.
//
// Spread-over-time: scatter radius grows with age (easeInQuad), so each stamp
// starts tight at the cursor and blooms open as it fades.
//
//   age01 = 1 - lifeLeft    (0 at spawn, 1 at expiry)
//   scatterRadius = lerp(SPREAD_MIN, SPREAD_MAX, easeInQuad(age01)) × SCATTER_PX
//
// Deterministic scatter: we advance a Lehmer LCG from the stamp's rngSeed to
// produce the same dot positions every frame — no per-frame flicker.

import type p5 from 'p5';
import type { PollenStamp } from './pollen.types';

// Glitter color range per dot — amber-gold → yellow-gold → champagne rose-gold.
// R is fixed at 255; G and B are varied per-dot from two independent bit-slices
// of the LCG seed so each particle catches light differently.
const POLLEN_G_MIN = 175; // warmest: orange-amber gold
const POLLEN_G_MAX = 235; // brightest: pale yellow gold
const POLLEN_B_MAX = 100; // max blue tint → champagne/rose warmth

export const TRAIL_TTL_MS = 6000;

// Scatter radius at min/max age (px), before × SCATTER_PX multiplier.
// SPREAD_MIN is high so stamps start visibly bloomed from birth.
const SPREAD_MIN = 0.5;
const SPREAD_MAX = 10.0;
// Base scatter distance in px.
const SCATTER_PX = 15;

// Gravity: how far (px) the stamp's render position drifts downward by expiry.
const GRAVITY_PX = 55;

// Horizontal drift: gentle sideways float like pollen on a breeze.
const DRIFT_PX = 14;

// Global opacity scale — 1.0 = full, 0.5 = half opacity for all pollen & sparkle.
const POLLEN_OPACITY = 0.5;

// Dots drawn per stamp per frame.
const DOT_COUNT = 4;

// Dot rendered diameter in px.
const DOT_DIAMETER = 3;

// Minimum cursor travel (px²) before we spawn a new stamp.
const MIN_MOVE_SQ = 4; // 2 px

// Minimum ms between stamps — ~31/sec; 25% more than the original 40ms interval.
const SPAWN_INTERVAL_MS = 3;

// Sparkle: bright white glints that pulse independently on each stamp.
// Period = 2π / SPARKLE_FREQ ≈ 3.5 s → each stamp sees ~1–2 peaks in its 6 s life.
// Random sparklePhase staggers them so they don't all flash at once.
const SPARKLE_FREQ      = 1.8;  // rad/s
const SPARKLE_THRESHOLD = 0.82; // sin() must exceed this to show a glint
const SPARKLE_FLARE_LEN = 6;    // half-length (px) of cross arms at full intensity
const SPARKLE_INNER_D   = 2;    // bright core diameter (px)
const SPARKLE_MID_D     = 6;    // mid glow diameter (px)
const SPARKLE_OUTER_D   = 12;   // soft halo diameter (px)
const SPARKLE_GLOW_D1   = 26;   // first extended glow ring (px)
const SPARKLE_GLOW_D2   = 46;   // second extended glow ring (px)
const SPARKLE_GLOW_D3   = 72;   // third glow ring (px)
const SPARKLE_GLOW_D4   = 110;  // outermost bloom (px)

const stamps: PollenStamp[] = [];

let _lastSpawnAt = 0;
let _lastX = 0;
let _lastY = 0;

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Called from sketch.ts draw() when the pointer is seen and moving.
 * Respects reduced-motion, minimum travel distance, and spawn rate cap.
 */
export function addPollenStamp(x: number, y: number, now: number): void {
  if (reducedMotion()) return;

  const dx = x - _lastX;
  const dy = y - _lastY;
  if (dx * dx + dy * dy < MIN_MOVE_SQ) return;
  if (now - _lastSpawnAt < SPAWN_INTERVAL_MS) return;

  stamps.push({
    x,
    y,
    createdAt: now,
    rngSeed: Math.floor(Math.random() * 1e9),
    sparklePhase: Math.random() * Math.PI * 2,
  });

  _lastX = x;
  _lastY = y;
  _lastSpawnAt = now;
}

/**
 * Evicts expired stamps. In-place compaction avoids Array.filter garbage.
 */
export function tickPollenTrail(now: number): void {
  let write = 0;
  for (let i = 0; i < stamps.length; i++) {
    if (now - stamps[i].createdAt < TRAIL_TTL_MS) {
      stamps[write++] = stamps[i];
    }
  }
  stamps.length = write;
}

/**
 * Draws all live stamps into the current p5 context using native circle calls.
 * Must be called after tickPollenTrail and BEFORE the fairy draw loop.
 *
 * Uses native p5 (not p5.brush) because p5.brush's spray mask requires a
 * postdraw flush that is never registered in ESM instance mode.
 */
export function drawPollenTrail(p: p5, now: number): void {
  p.noStroke();
  for (let i = 0; i < stamps.length; i++) {
    const s = stamps[i];
    const lifeLeft = 1 - (now - s.createdAt) / TRAIL_TTL_MS;
    // easeInQuad: fades sooner than linear, decelerates toward expiry.
    const alpha01 = lifeLeft * lifeLeft;
    const alpha = Math.round(alpha01 * 200 * POLLEN_OPACITY);
    if (alpha <= 0) continue;

    const age01 = 1 - lifeLeft;
    // Scatter radius grows linearly with age — no easeInQuad delay at birth.
    const spread = SPREAD_MIN + (SPREAD_MAX - SPREAD_MIN) * age01;
    const scatterRadius = spread * SCATTER_PX;
    // Gravity: render position drifts downward (hangs then falls).
    const fallY = GRAVITY_PX * age01 * age01;
    // Horizontal drift: map seed to -1..+1 so each stamp drifts its own way.
    const driftDir = ((s.rngSeed % 1000) / 500) - 1; // -1 to +1
    const driftX = DRIFT_PX * driftDir * age01 * age01;

    const cx = s.x + driftX;
    const cy = s.y + fallY;

    // Lehmer LCG — deterministic per stamp, same positions every frame.
    // Per-dot color varies using two independent bit-slices of the post-dy seed
    // so each particle catches light differently (amber-gold → champagne rose-gold).
    let seed = s.rngSeed;
    for (let j = 0; j < DOT_COUNT; j++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const dx = ((seed / 0xFFFFFFFF) * 2 - 1) * scatterRadius;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const dy = ((seed / 0xFFFFFFFF) * 2 - 1) * scatterRadius;
      const shimmer = (seed & 0xFF) / 255;         // brightness: G channel
      const tint    = ((seed >> 8) & 0xFF) / 255;  // warmth: B channel
      const pg = Math.round(POLLEN_G_MIN + shimmer * (POLLEN_G_MAX - POLLEN_G_MIN));
      const pb = Math.round(tint * POLLEN_B_MAX);
      p.fill(255, pg, pb, alpha);
      p.circle(cx + dx, cy + dy, DOT_DIAMETER);
    }
  }

  // Sparkle pass — white glints pulsing independently on each stamp.
  // sin() oscillates with period ≈ 3.5 s; random sparklePhase staggers stamps
  // so they twinkle at different times rather than all at once.
  for (let i = 0; i < stamps.length; i++) {
    const s = stamps[i];
    const lifeLeft = 1 - (now - s.createdAt) / TRAIL_TTL_MS;
    const t = (now - s.createdAt) / 1000; // seconds since birth
    const sinVal = Math.sin(t * SPARKLE_FREQ + s.sparklePhase);
    if (sinVal < SPARKLE_THRESHOLD) continue;

    // Normalise to 0–1 above the threshold, then gate by stamp's own fade.
    const sparkleIntensity = (sinVal - SPARKLE_THRESHOLD) / (1 - SPARKLE_THRESHOLD);
    const lifeAlpha = lifeLeft * lifeLeft; // same easeInQuad as yellow pass
    const sparkleAlpha = sparkleIntensity * lifeAlpha;
    if (sparkleAlpha < 0.01) continue;

    // Re-derive center with gravity/drift (identical formula to yellow pass).
    const age01 = 1 - lifeLeft;
    const fallY  = GRAVITY_PX * age01 * age01;
    const driftDir = ((s.rngSeed % 1000) / 500) - 1;
    const driftX   = DRIFT_PX * driftDir * age01 * age01;
    const cx = s.x + driftX;
    const cy = s.y + fallY;

    // Cross-flare arms: two thin ellipses at 0° and 90°.
    const flareDim = SPARKLE_FLARE_LEN * 2 * sparkleAlpha;
    const flareAlpha = Math.round(sparkleAlpha * 200 * POLLEN_OPACITY);
    p.fill(255, 255, 255, flareAlpha);
    p.ellipse(cx, cy, flareDim, 2);  // horizontal arm
    p.ellipse(cx, cy, 2, flareDim);  // vertical arm

    // Layered glow circles: inner bright core → mid → soft outer halo.
    p.fill(255, 255, 255, Math.round(sparkleAlpha * 230 * POLLEN_OPACITY));
    p.circle(cx, cy, SPARKLE_INNER_D);
    p.fill(255, 255, 255, Math.round(sparkleAlpha * 120 * POLLEN_OPACITY));
    p.circle(cx, cy, SPARKLE_MID_D);
    p.fill(255, 255, 255, Math.round(sparkleAlpha * 60 * POLLEN_OPACITY));
    p.circle(cx, cy, SPARKLE_OUTER_D);

    // Extended soft glow — larger rings with a warm amber tint that bleeds into
    // the surrounding pollen gold, making the sparkle feel embedded in the dust.
    p.fill(255, 240, 160, Math.round(sparkleAlpha * 30 * POLLEN_OPACITY));
    p.circle(cx, cy, SPARKLE_GLOW_D1);
    p.fill(255, 220, 120, Math.round(sparkleAlpha * 16 * POLLEN_OPACITY));
    p.circle(cx, cy, SPARKLE_GLOW_D2);
    p.fill(255, 200, 80, Math.round(sparkleAlpha * 8 * POLLEN_OPACITY));
    p.circle(cx, cy, SPARKLE_GLOW_D3);
    p.fill(255, 180, 60, Math.round(sparkleAlpha * 4 * POLLEN_OPACITY));
    p.circle(cx, cy, SPARKLE_GLOW_D4);
  }
}
