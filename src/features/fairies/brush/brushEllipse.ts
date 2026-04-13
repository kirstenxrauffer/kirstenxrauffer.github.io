import * as brush from 'p5.brush';

// p5.brush has no ellipse primitive — brush.arc with full sweep is equivalent.
// rx/ry are radii; arc takes width/height (diameters).
export function brushEllipse(x: number, y: number, rx: number, ry: number): void {
  brush.arc(x, y, rx * 2, ry * 2, 0, Math.PI * 2);
}
