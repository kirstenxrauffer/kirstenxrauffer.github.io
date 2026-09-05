// Pollen trail: a ring buffer of timestamped stamps redrawn each frame.
//
// Why redraw every frame: sketch.ts calls p.clear() at the top of draw(), so
// nothing persists on the canvas. Each live stamp must be re-drawn every frame
// with alpha scaled to its remaining lifetime.
//
// Spread-over-time: scatter radius grows with age (easeInQuad), so each stamp
// starts tight at the cursor and blooms open as it fades.
//
//   age01 = 1 - lifeLeft    (0 at spawn, 1 at expiry)
//   scatterRadius = lerp(SPREAD_MIN, SPREAD_MAX, easeInQuad(age01)) × SCATTER_PX
//
// Deterministic scatter: we advance a Lehmer LCG from the stamp's rngSeed to
// produce the same dot positions every frame — no per-frame flicker.
//
// BATCHING: a saturated trail is ~360 live stamps × 4 dots, plus a sparkle pass
// on the ~19 % of stamps above the twinkle threshold — north of 2,000 individual
// fills per frame if each dot is drawn on its own. Instead, dots are bucketed by
// quantised colour and alpha and accumulated into one Path2D per bucket, then
// filled once. Bucket counts are capped (see *_BUCKETS below), so the per-frame
// fill count is bounded by ~256 regardless of how dense the trail gets.

import type { Painter } from '../render/painter';
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

// Minimum ms between stamps.
//
// This used to be 3 ms, which never actually bound: addPollenStamp is called
// once per draw frame, and a frame is ~16.7 ms at 60 Hz. That made trail density
// a function of frame rate — a 120 Hz display spawned twice as many stamps as a
// 60 Hz one (720 live vs 360), so the machines best able to render the trail got
// the heaviest one, and slow machines silently got a sparser trail.
//
// 16 ms pins the rate at ~62 stamps/sec: identical to the old behaviour at 60 Hz,
// but no longer doubling on high-refresh displays.
const SPAWN_INTERVAL_MS = 16;

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

// Separate rate-limit state for fairy-sourced stamps so navi's trail never
// suppresses cursor stamps (they share the same ring buffer but tick independently).
let _lastFairySpawnAt = 0;

// addPollenStamp / addFairyPollenStamp are both called once per draw frame, so
// this used to construct a fresh MediaQueryList 1–2× per frame. Build the query
// once and read `.matches` off it — the object stays live, so a mid-session
// change to the OS setting is still picked up.
const reducedMotionQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

function reducedMotion(): boolean {
  return reducedMotionQuery?.matches ?? false;
}

/**
 * Called from sketch.ts when navi is in the zoom state.
 * Uses its own rate-limit clock so navi's trail never suppresses cursor stamps.
 */
export function addFairyPollenStamp(x: number, y: number, now: number): void {
  if (reducedMotion()) return;
  if (now - _lastFairySpawnAt < SPAWN_INTERVAL_MS) return;

  stamps.push({
    x,
    y,
    createdAt: now,
    rngSeed: Math.floor(Math.random() * 1e9),
    sparklePhase: Math.random() * Math.PI * 2,
  });

  _lastFairySpawnAt = now;
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
// ── Batching buckets ────────────────────────────────────────────────────────
// Quantisation levels. These bound the per-frame fill count: the dot pass emits
// at most ALPHA_BUCKETS × G_BUCKETS × B_BUCKETS fills, the sparkle pass at most
// ALPHA_BUCKETS × SPARKLE_LAYERS. Both are small and independent of trail size.
const ALPHA_BUCKETS   = 16;
const G_BUCKETS       = 4;
const B_BUCKETS       = 2;
const SPARKLE_LAYERS  = 8;

// Reused across frames so a saturated trail does not churn the allocator.
const dotPaths = new Map<number, Path2D>();
const sparklePaths = new Map<number, Path2D>();

const TAU = Math.PI * 2;

/** Bucket index → representative value at the centre of the bucket. */
function bucketCentre(bucket: number, buckets: number, min: number, max: number): number {
  return min + ((bucket + 0.5) / buckets) * (max - min);
}

// The eight sparkle layers, in draw order: [colour, alpha multiplier].
// Indices 0/1 are the cross-flare arms, which are ellipses rather than circles
// and so are emitted separately below.
const SPARKLE_SPEC: [number, number, number, number][] = [
  [255, 255, 255, 230], // 0 inner core
  [255, 255, 255, 120], // 1 mid glow
  [255, 255, 255,  60], // 2 soft outer halo
  [255, 240, 160,  30], // 3 extended glow ring 1
  [255, 220, 120,  16], // 4 extended glow ring 2
  [255, 200,  80,   8], // 5 extended glow ring 3
  [255, 180,  60,   4], // 6 outermost bloom
  [255, 255, 255, 200], // 7 cross-flare arms (ellipses)
];
const SPARKLE_DIAM = [SPARKLE_INNER_D, SPARKLE_MID_D, SPARKLE_OUTER_D,
                      SPARKLE_GLOW_D1, SPARKLE_GLOW_D2, SPARKLE_GLOW_D3, SPARKLE_GLOW_D4];

/**
 * Draws all live stamps. Must be called after tickPollenTrail and BEFORE the
 * fairy draw loop.
 *
 * Dots are accumulated into per-bucket Path2Ds and filled in bulk rather than
 * one fill per dot — see the BATCHING note at the top of this file.
 */
export function drawPollenTrail(p: Painter, now: number): void {
  const ctx = p.ctx;
  dotPaths.clear();
  sparklePaths.clear();

  // ── Pass 1: gold dots ─────────────────────────────────────────────────────
  for (let i = 0; i < stamps.length; i++) {
    const s = stamps[i];
    const lifeLeft = 1 - (now - s.createdAt) / TRAIL_TTL_MS;
    // easeInQuad: fades sooner than linear, decelerates toward expiry.
    const alpha01 = lifeLeft * lifeLeft;
    const alpha = alpha01 * 200 * POLLEN_OPACITY;
    if (alpha < 1) continue;

    const aB = Math.min(ALPHA_BUCKETS - 1, (alpha / 255 * ALPHA_BUCKETS) | 0);

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
    let seed = s.rngSeed;
    for (let j = 0; j < DOT_COUNT; j++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const dx = ((seed / 0xFFFFFFFF) * 2 - 1) * scatterRadius;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const dy = ((seed / 0xFFFFFFFF) * 2 - 1) * scatterRadius;
      const shimmer = (seed & 0xFF) / 255;         // brightness: G channel
      const tint    = ((seed >> 8) & 0xFF) / 255;  // warmth: B channel

      const gB = Math.min(G_BUCKETS - 1, (shimmer * G_BUCKETS) | 0);
      const bB = Math.min(B_BUCKETS - 1, (tint    * B_BUCKETS) | 0);
      const key = (aB * G_BUCKETS + gB) * B_BUCKETS + bB;

      let path = dotPaths.get(key);
      if (!path) { path = new Path2D(); dotPaths.set(key, path); }
      path.moveTo(cx + dx + DOT_DIAMETER / 2, cy + dy);
      path.arc(cx + dx, cy + dy, DOT_DIAMETER / 2, 0, TAU);
    }
  }

  for (const [key, path] of dotPaths) {
    const bB = key % B_BUCKETS;
    const gB = ((key / B_BUCKETS) | 0) % G_BUCKETS;
    const aB = (key / (B_BUCKETS * G_BUCKETS)) | 0;
    const pg = bucketCentre(gB, G_BUCKETS, POLLEN_G_MIN, POLLEN_G_MAX);
    const pb = bucketCentre(bB, B_BUCKETS, 0, POLLEN_B_MAX);
    const pa = bucketCentre(aB, ALPHA_BUCKETS, 0, 255) / 255;
    ctx.fillStyle = `rgba(255,${pg | 0},${pb | 0},${pa})`;
    ctx.fill(path);
  }

  // ── Pass 2: sparkle glints ────────────────────────────────────────────────
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
    const lifeAlpha = lifeLeft * lifeLeft; // same easeInQuad as the dot pass
    const sparkleAlpha = sparkleIntensity * lifeAlpha;
    if (sparkleAlpha < 0.01) continue;

    // Re-derive center with gravity/drift (identical formula to the dot pass).
    const age01 = 1 - lifeLeft;
    const fallY  = GRAVITY_PX * age01 * age01;
    const driftDir = ((s.rngSeed % 1000) / 500) - 1;
    const driftX   = DRIFT_PX * driftDir * age01 * age01;
    const cx = s.x + driftX;
    const cy = s.y + fallY;

    const aB = Math.min(ALPHA_BUCKETS - 1, (sparkleAlpha * ALPHA_BUCKETS) | 0);

    // Layered glow circles: inner bright core → mid → soft outer halo → blooms.
    for (let layer = 0; layer < SPARKLE_DIAM.length; layer++) {
      const key = aB * SPARKLE_LAYERS + layer;
      let path = sparklePaths.get(key);
      if (!path) { path = new Path2D(); sparklePaths.set(key, path); }
      const rad = SPARKLE_DIAM[layer] / 2;
      path.moveTo(cx + rad, cy);
      path.arc(cx, cy, rad, 0, TAU);
    }

    // Cross-flare arms: two thin ellipses at 0° and 90°.
    const flareDim = SPARKLE_FLARE_LEN * 2 * sparkleAlpha;
    const flareKey = aB * SPARKLE_LAYERS + 7;
    let flare = sparklePaths.get(flareKey);
    if (!flare) { flare = new Path2D(); sparklePaths.set(flareKey, flare); }
    flare.moveTo(cx + flareDim / 2, cy);
    flare.ellipse(cx, cy, flareDim / 2, 1, 0, 0, TAU);
    flare.moveTo(cx + 1, cy);
    flare.ellipse(cx, cy, 1, flareDim / 2, 0, 0, TAU);
  }

  for (const [key, path] of sparklePaths) {
    const layer = key % SPARKLE_LAYERS;
    const aB    = (key / SPARKLE_LAYERS) | 0;
    const [r, g, b, mult] = SPARKLE_SPEC[layer];
    const sa = bucketCentre(aB, ALPHA_BUCKETS, 0, 1);
    ctx.fillStyle = `rgba(${r},${g},${b},${(sa * mult * POLLEN_OPACITY) / 255})`;
    ctx.fill(path);
  }
}
