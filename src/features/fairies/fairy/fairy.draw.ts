// Atomic fairy orb render. drawFairy(p, fairy, now, isHovered) paints into the
// current p5 transform stack. Caller pushes/pops if it needs to isolate.
//
// Body glow: 35 concentric circles with a power-curve alpha profile. Step size
// is sub-pixel at FAIRY_SCALE 0.15, so no hard ring edges are visible — the
// result looks like a true radial gradient. Hue drifts slowly over ~25 s via
// HSL math so the orb colour shifts between lavender and soft violet-pink.
//
// Hover effects (hoverT 0→1 over 300 ms, blended smoothly to avoid abrupt changes):
//   • Glow radius doubles (blooms into a large soft halo).
//   • Brightness × 3.5 (light-source intensity), ±8% slow 2.5 s breathing.
//   • Core desaturates 60 % → bright white light with a color hint at the edges.
//   • Hue cycles ~2× faster (12 s vs 25 s) — subtle, not jarring.

import type p5 from 'p5';
import type { Fairy } from './fairy.types';
import {
  BODY,
  CANONICAL_CX,
  CANONICAL_CY,
} from './constants';

// Lehmer LCG — same algorithm as eyes.ts and wings.ts.
// Seeded once per draw call; produces the same sequence every frame.
function makeLCG(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

const GLOW_LAYERS = 35;
const GLOW_MAX_R  = BODY.r * 4.95;  // outermost halo radius
const HUE_CENTER  = 270;           // degrees — lavender base
const HUE_SWING   = 50;            // ±° around base; blue-violet → rose-pink
const HUE_PERIOD  = 25000;         // ms per full cycle
const BODY_SAT_SCALE = 0.50;       // 0 = fully grey, 1 = full colour; raised from 0.35 to harden the orb

// Hover overrides — soft light-source effect: noticeably brighter, gentle halo, slow breath.
const HOVER_HUE_PERIOD   = 12000; // ms — ~2× faster hue cycle (subtle, not jarring)
const HOVER_INTENSITY    = 1.5;   // ~50% brighter at full hover
const HOVER_PULSE_AMP    = 0.08;  // ±8% gentle breathing
const HOVER_PULSE_PERIOD = 2500;  // ms — slow 2.5 s breath cycle
const HOVER_GLOW_MULT    = 1.0;   // no additional expansion — hover size is already the baseline
const HOVER_DESAT        = 0.35;  // desaturate 35% at full hover (softer white light w/ color hint)
const HOVER_LIGHTNESS    = 0.07;  // +7% lightness at full hover

// hoverT: 0.0 = not hovered, 1.0 = fully hovered; smoothly interpolated by caller.
export function drawFairy(p: p5, fairy: Fairy, now: number, hoverT: number): void {
  p.push();
  p.translate(fairy.pos.x, fairy.pos.y);
  p.scale(fairy.scale);
  p.translate(-CANONICAL_CX, -CANONICAL_CY);

  const HOVER_Y_LIFT = 30; // local units; body floats upward at full hover
  // Shift glow toward whichever eye is smaller (the back/far eye).
  // eyeFlipT=0 → facing left, small eye is EYE_B (cx≈7, close to BODY.cx=10, no shift needed).
  // eyeFlipT=1 → facing right, small eye is EYE_A (cx=-56), shift glow left toward it.
  const GLOW_SMALL_EYE_PULL = -20; // local units at full eyeFlipT=1
  const glowXOffset = GLOW_SMALL_EYE_PULL * fairy.eyeFlipT;
  p.push();
  p.translate(BODY.cx + glowXOffset, BODY.cy - HOVER_Y_LIFT * hoverT);
  p.noStroke();

  // Hue period blends gently toward 2× faster on hover — subtle speed-up only.
  const huePeriod = HUE_PERIOD + (HOVER_HUE_PERIOD - HUE_PERIOD) * hoverT;
  const hue = HUE_CENTER + Math.sin((now / huePeriod) * Math.PI * 2) * HUE_SWING;

  // Glow radius expands at hover so the orb blooms into a large soft light.
  const glowMaxR = GLOW_MAX_R * (1 + (HOVER_GLOW_MULT - 1) * hoverT);

  // Per-fairy LCG for stable per-layer positional jitter. Same sequence every
  // frame because the seed and loop order never change between draws.
  const rng = makeLCG(fairy.rngSeed);

  for (let i = 0; i < GLOW_LAYERS; i++) {
    // t=0 → outermost ring, t=1 → innermost core.
    const t = i / (GLOW_LAYERS - 1);
    const r = glowMaxR * (1 - t);

    // Watercolor jitter: outer rings wobble up to 12 % of their radius;
    // jitter fraction tapers to 0 at the core so the centre stays solid.
    const jitterFrac = (1 - t) * 0.12;
    const jx = (rng() * 2 - 1) * r * jitterFrac;
    const jy = (rng() * 2 - 1) * r * jitterFrac;

    // Light-source brightness: 3.5× peak, ±8% slow breathing. Blended via hoverT
    // so there is no abrupt jump when the pointer crosses the trigger radius.
    const pulse = Math.sin((now / HOVER_PULSE_PERIOD) * Math.PI * 2);
    const fullHoverScale = HOVER_INTENSITY * (1 + HOVER_PULSE_AMP * pulse);
    const hoverScale = 1.0 + (fullHoverScale - 1.0) * hoverT;
    // Hardened: was t^2.5 * 80 — shallower curve + higher cap makes the core
    // more opaque and gives the orb more visible substance.
    const alpha = Math.pow(t, 2.0) * 44 * hoverScale;

    // At full hover: whiter center (reduced sat) and brighter lightness — "colored light" effect.
    const sat = (100 - t * 35) / 100 * (1 - HOVER_DESAT * hoverT) * BODY_SAT_SCALE;
    const lig = Math.min(1, (62 + t * 28) / 100 + HOVER_LIGHTNESS * hoverT);

    const [rc, gc, bc] = hslToRgb(hue / 360, sat, lig);
    p.fill(rc, gc, bc, alpha);
    p.circle(jx, jy, r * 2);
  }

  p.pop();
  p.pop();
}

// ─── HSL → RGB ──────────────────────────────────────────────────────────────

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const pp = 2 * l - q;
    r = hue2rgb(pp, q, h + 1 / 3);
    g = hue2rgb(pp, q, h);
    b = hue2rgb(pp, q, h - 1 / 3);
  }
  return [r * 255, g * 255, b * 255];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
