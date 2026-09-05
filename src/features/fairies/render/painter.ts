// Painter — the tiny 2D drawing surface the fairy layer actually needs.
//
// This replaces p5. The fairy feature only ever used ~27 p5 identifiers, all of
// which are thin wrappers over Canvas 2D: filled circles and ellipses, a
// transform stack, and a few utilities. p5 core costs 1,103 kB raw / 322 kB
// gzipped for that — over half the site's JavaScript — so it is implemented
// here instead, in a form the draw code can consume unchanged.
//
// Coordinate space: CSS pixels. The context is pre-scaled by devicePixelRatio in
// createCanvasPainter, so callers never think about DPR.
//
// Note on fidelity vs p5's WEBGL mode: both composite with standard source-over
// alpha blending, so the many-overlapping-translucent-discs watercolor technique
// accumulates identically. Canvas 2D additionally antialiases path edges, which
// p5's WEBGL immediate mode does not — discs come out marginally smoother.

/** The drawing surface the fairy/pollen render code draws through. */
export interface Painter {
  push(): void;
  pop(): void;
  translate(x: number, y: number): void;
  /** One argument scales uniformly, matching p5's scale(). */
  scale(sx: number, sy?: number): void;
  rotate(radians: number): void;
  /** RGB 0-255, alpha 0-255 (p5 convention), defaulting to opaque. */
  fill(r: number, g: number, b: number, a?: number): void;
  /** Present for call-site compatibility; nothing in this feature strokes. */
  noStroke(): void;
  /** `d` is a diameter, matching p5's circle(). */
  circle(x: number, y: number, d: number): void;
  /** `w`/`h` are diameters, matching p5's ellipse(). */
  ellipse(x: number, y: number, w: number, h: number): void;
  /** Blit a pre-rendered sprite into the current transform. */
  image(src: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  /** Multiplies into subsequent draws, like ctx.globalAlpha. */
  setAlpha(a: number): void;
  /** Escape hatch for batched paths (see pollenTrail). */
  readonly ctx: CanvasRenderingContext2D;
}

const TAU = Math.PI * 2;

export class Canvas2DPainter implements Painter {
  readonly ctx: CanvasRenderingContext2D;

  // fillStyle is a string property, so a naive fill() would allocate a new
  // template string on every call. The pollen trail alone can issue >1000
  // fills per frame, so remember the last colour and skip identical writes.
  private lr = -1;
  private lg = -1;
  private lb = -1;
  private la = -1;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  push(): void { this.ctx.save(); }

  pop(): void {
    this.ctx.restore();
    // restore() reverts fillStyle too, so the colour memo is no longer valid.
    this.lr = -1;
  }

  /**
   * Forget the memoised fill colour.
   *
   * Required whenever the context's fillStyle is changed behind the painter's
   * back — most importantly by assigning canvas.width/height, which resets the
   * entire 2D context state. Without this the next fill() would compare against
   * a colour the context no longer has and skip the write.
   */
  resetStyleMemo(): void { this.lr = -1; }

  translate(x: number, y: number): void { this.ctx.translate(x, y); }

  scale(sx: number, sy: number = sx): void { this.ctx.scale(sx, sy); }

  rotate(radians: number): void { this.ctx.rotate(radians); }

  fill(r: number, g: number, b: number, a = 255): void {
    // Round so near-identical float colours collapse onto the same memo entry.
    const ri = r | 0, gi = g | 0, bi = b | 0, ai = a | 0;
    if (ri === this.lr && gi === this.lg && bi === this.lb && ai === this.la) return;
    this.lr = ri; this.lg = gi; this.lb = bi; this.la = ai;
    this.ctx.fillStyle = `rgba(${ri},${gi},${bi},${ai / 255})`;
  }

  noStroke(): void { /* nothing in this feature strokes */ }

  circle(x: number, y: number, d: number): void {
    const c = this.ctx;
    c.beginPath();
    c.arc(x, y, d / 2, 0, TAU);
    c.fill();
  }

  ellipse(x: number, y: number, w: number, h: number): void {
    const c = this.ctx;
    c.beginPath();
    c.ellipse(x, y, w / 2, h / 2, 0, 0, TAU);
    c.fill();
  }

  image(src: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void {
    this.ctx.drawImage(src, dx, dy, dw, dh);
  }

  setAlpha(a: number): void { this.ctx.globalAlpha = a; }
}

export type CanvasPainter = {
  painter: Canvas2DPainter;
  canvas: HTMLCanvasElement;
  /** CSS-pixel size. */
  width: number;
  height: number;
  resize(cssW: number, cssH: number): void;
  clear(): void;
};

/**
 * Creates a canvas sized to `cssW × cssH` at the device pixel ratio, with the
 * context pre-scaled so all drawing happens in CSS pixels.
 *
 * DPR is capped at 2 deliberately. p5's `pixelDensity(displayDensity())` was
 * uncapped, so a DPR-3 phone rendered 2.25× the fragments of a DPR-2 one for no
 * visible benefit on a soft watercolor sprite.
 */
export function createCanvasPainter(cssW: number, cssH: number): CanvasPainter {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('2D context unavailable');
  const painter = new Canvas2DPainter(ctx);

  const state: CanvasPainter = {
    painter,
    canvas,
    width: cssW,
    height: cssH,
    resize(w: number, h: number) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.width = w;
      state.height = h;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      // setTransform (not scale) so repeated resizes don't compound.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    clear() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      painter.setAlpha(1);
    },
  };

  state.resize(cssW, cssH);
  return state;
}
