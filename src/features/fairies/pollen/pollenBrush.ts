// Registers the pollen spray brush with p5.brush.
// Called from brushSetup.ts after createCanvas(..., WEBGL) and brush.instance(p).
//
// Parameter rationale (all grounded in p5.brush/src/stroke/stroke.js):
//   type: 'spray'   → drawSpray() path; scatters individual circles
//   weight: 1       → base stroke weight (pixel multiplier)
//   scatter: 25     → vibration radius = 25 px (× weight); controls spread
//   grain: 25       → ~25 dots per drawSpray call (iterations = ceil(grain/pressure))
//   sharpness: 15   → copied from built-in 'spray' defaults at stroke.js:840
//   opacity: 200    → ONLY effective alpha for spray brushes.
//                     pollenTrail.ts mutates this on POLLEN_BRUSH_PARAMS before
//                     each stamp so fading works. The color array alpha passed to
//                     brush.set() is ignored by the fragment shader (shader.frag:28
//                     uses v_alpha from this opacity, not u_color.w).
//   spacing: 1      → 1 step per flowLine(x, y, 1, 0) call → exactly 1 drawSpray burst
//   noise: 0.3      → stroke-level noise modulation
//   pressure        → copied from built-in 'spray' at stroke.js:843-844

import * as brush from 'p5.brush';

// Exported so pollenTrail.ts can mutate .opacity per stamp for per-stamp fading.
// brush.add() stores this reference directly (stroke.js:216), and brush.set()
// reads current.p = list.get(name).param (stroke.js:381-383), so mutations are
// live — no re-registration needed.
export const POLLEN_BRUSH_PARAMS = {
  type: 'spray' as const,
  weight: 1,
  scatter: 15,  // was 25 — tighter spread
  grain: 4,     // fewer dots per burst — sparser, more delicate
  sharpness: 15,
  opacity: 100, // max opacity; pollenTrail.ts scales this per-stamp for fading
  spacing: 1,
  noise: 0.3,
  pressure: { curve: [0.2, 0.35] as [number, number], min_max: [0.85, 1] as [number, number] },
};

export function registerPollenBrush(): void {
  brush.add('pollen', POLLEN_BRUSH_PARAMS);
}
