// One-time p5.brush configuration for the fairies feature.
// Called from sketch.ts AFTER createCanvas(..., WEBGL) and brush.instance(p).

import { registerPollenBrush } from '../pollen';

export function registerBrushes(): void {
  registerPollenBrush();
}
