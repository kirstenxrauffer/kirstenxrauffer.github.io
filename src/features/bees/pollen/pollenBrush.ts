// Registers the pollen spray brush with p5.brush.
// Called from brushSetup.ts after createCanvas(..., WEBGL) and brush.instance(p).
//
// Parameter rationale (all grounded in p5.brush/src/stroke/stroke.js):
//   type: 'spray'   → drawSpray() path; scatters individual circles
//   weight: 1       → base stroke weight (pixel multiplier)
//   scatter: 25     → vibration radius = 25 px (× weight); controls spread
//   grain: 25       → ~25 dots per drawSpray call (iterations = ceil(grain/pressure))
//   sharpness: 15   → copied from built-in 'spray' defaults at stroke.js:840
//   opacity: 220    → stroke-level alpha 0-255; per-stamp fade is driven by
//                     color alpha (see pollenTrail.ts: brush.set color arg)
//   spacing: 1      → 1 step per flowLine(x, y, 1, 0) call → exactly 1 drawSpray burst
//   noise: 0.3      → stroke-level noise modulation
//   pressure        → copied from built-in 'spray' at stroke.js:843-844

import * as brush from 'p5.brush';

export function registerPollenBrush(): void {
  brush.add('pollen', {
    type: 'spray',
    weight: 2.5,
    scatter: 15,
    grain: 9,     // more dots per burst — fuller cloud
    sharpness: 15,
    opacity: 80,
    spacing: 1,
    noise: 0.3,
    pressure: { curve: [0.2, 0.35], min_max: [0.85, 1] },
  });
}
