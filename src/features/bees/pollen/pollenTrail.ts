// Pollen trail: a ring buffer of timestamped spray stamps redrawn each frame.
//
// Why redraw every frame: sketch.ts calls p.clear() at the top of draw(), so
// nothing persists on the canvas. Each live stamp must be re-issued to p5.brush
// every frame with alpha scaled to its remaining lifetime.
//
// Spread-over-time: brush.set's weight arg sets State.stroke.weight, which is
// the sole multiplier on vibration spread in drawSpray (stroke.js:561-562).
// Dot SIZE is driven by current.p.weight (the brush param), independent of
// stroke weight — so we can grow spread without changing dot size.
// Because we seed identically every frame, each dot expands outward along
// its own seeded direction as spread grows — a radial bloom effect.
//
//   age01 = 1 - lifeLeft    (0 at spawn, 1 at expiry)
//   spread weight = lerp(SPREAD_MIN, SPREAD_MAX, easeInQuad(age01))
//
// easeInQuad on spread and alpha:
// the stamp starts tight and opaque, fades noticeably sooner than linear
// but decelerates toward expiry — bloom widens as the stamp slowly disappears.
//
// Color alpha path: brush.set('pollen', [r, g, b, a], weight). The alpha
// flows through createColor → p5.Color._array → Mix.blend → shader.
// Verified: Mix.blend checks _color._array[3] at color.js:268.
//
// RNG seeding: brush.seed(stamp.rngSeed) pins dot directions per stamp
// (same mechanism as bee.draw.ts:29-30).

import * as brush from 'p5.brush';
import type { PollenStamp } from './pollen.types';

// #FFE033 — bright warm yellow; reads clearly as pollen rather than amber/gold.
const POLLEN_R = 0xFF;
const POLLEN_G = 0xE0;
const POLLEN_B = 0x33;

export const TRAIL_TTL_MS = 2000;

// Stroke weight drives spread: State.stroke.weight × brush.scatter × pressure.
// SPREAD_MIN is high so stamps start visibly bloomed; linear (not easeInQuad)
// so the cloud expands immediately rather than sitting tight for most of its life.
const SPREAD_MIN = 4.0;
const SPREAD_MAX = 16.0;

// Gravity: how far (px) the stamp's render position drifts downward by expiry.
// Gentle enough to feel like floating pollen rather than a hard drop.
const GRAVITY_PX = 55;

// Horizontal drift: gentle sideways float like pollen on a breeze.
// Kept small so motion reads as falling, not as a radial burst.
const DRIFT_PX = 14;

// Minimum cursor travel (px²) before we spawn a new stamp.
const MIN_MOVE_SQ = 4; // 2 px

// Minimum ms between stamps — ~25/sec; sparser to keep the effect subtle.
const SPAWN_INTERVAL_MS = 40;

const stamps: PollenStamp[] = [];

let _lastSpawnAt = 0;
let _lastX = 0;
let _lastY = 0;

// Whether prefers-reduced-motion is active. Checked once at module init;
// re-evaluated on addStamp so HMR-reloads pick up changes.
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
 * Redraws all live stamps into the current p5.brush context.
 * Must be called after tickPollenTrail and BEFORE the bee draw loop
 * so bees render on top.
 */
export function drawPollenTrail(now: number): void {
  for (let i = 0; i < stamps.length; i++) {
    const s = stamps[i];
    const lifeLeft = 1 - (now - s.createdAt) / TRAIL_TTL_MS;
    // easeInQuad fade: fades sooner than linear, rate decelerates toward expiry.
    const alpha01 = lifeLeft * lifeLeft;
    const a = Math.round(alpha01 * 255);
    if (a <= 0) continue;

    const age01 = 1 - lifeLeft;
    // Spread widens linearly — starts bloomed, no easeInQuad delay.
    const spreadWeight = SPREAD_MIN + (SPREAD_MAX - SPREAD_MIN) * age01;
    // Gravity: render position drifts downward with easeInQuad — hangs then falls.
    const fallY = GRAVITY_PX * age01 * age01;
    // Horizontal drift: map seed to -1..+1 range so each stamp drifts its own
    // direction, like pollen caught in a gentle breeze.
    const driftDir = ((s.rngSeed % 1000) / 500) - 1; // -1 to +1
    const driftX = DRIFT_PX * driftDir * age01 * age01;

    brush.seed(s.rngSeed);
    brush.noiseSeed(s.rngSeed);
    brush.set('pollen', [POLLEN_R, POLLEN_G, POLLEN_B, a], spreadWeight*2);
    // length=1, spacing=1 → exactly 1 drawSpray call → ~grain dots at (x, y)
    brush.flowLine(s.x + driftX, s.y + fallY, 1, 0);
  }
}
