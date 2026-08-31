// ── Wood-grain texture via Line Integral Convolution ──────────────────────
// LIC generates full-coverage grain in a single pass at init: for every texel,
// trace a short streamline forward+backward through the vector field and average
// a white-noise source along it. Values are correlated along flow, uncorrelated
// across it — exactly the parallel-fiber look of real wood grain.
//
// This replaces the particle-accumulation approach, which was designed for
// screen-space animation and breaks down when the canvas is tiny and upscaled.
let grainBuf     = null;
let sideGrainBuf = null;

// ── Core LIC pass ──────────────────────────────────────────────────────────
// angleAt(x, y) → radians  |  streamLen: steps per direction
function buildLIC(buf, W, H, angleAt, streamLen) {
  // Per-pixel white noise source — determines grain stripe spacing
  const wn = new Float32Array(W * H);
  for (let i = 0; i < wn.length; i++) wn[i] = Math.random();

  // Precompute angle field so the inner loop is just array lookups
  const af = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      af[y * W + x] = angleAt(x, y);

  // Integrate white noise along each streamline
  const lic = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let sum = 0, n = 0;
      for (const dir of [1, -1]) {
        let fx = px + 0.5, fy = py + 0.5;
        for (let s = 0; s < streamLen; s++) {
          const ix = fx | 0, iy = fy | 0;
          if (ix < 0 || ix >= W || iy < 0 || iy >= H) break;
          sum += wn[iy * W + ix];
          n++;
          const a = af[iy * W + ix];
          fx += Math.cos(a) * dir;
          fy += Math.sin(a) * dir;
        }
      }
      lic[py * W + px] = n > 0 ? sum / n : 0.5;
    }
  }

  // Normalize to [0,1], then map to wood color range
  let lo = 1, hi = 0;
  for (const v of lic) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;

  buf.loadPixels();
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const t = (lic[py * W + px] - lo) / span;  // 0 = dark fiber, 1 = light wood
      // Gamma < 1 biases toward lighter wood background (more wood than line)
      const u   = Math.pow(t, 0.65);
      const mix = (1 - u) * 0.7;                 // max 70% blend toward C_LINE
      const idx = 4 * (py * W + px);
      buf.pixels[idx]     = Math.round(C_WOOD[0] + (C_LINE[0] - C_WOOD[0]) * mix);
      buf.pixels[idx + 1] = Math.round(C_WOOD[1] + (C_LINE[1] - C_WOOD[1]) * mix);
      buf.pixels[idx + 2] = Math.round(C_WOOD[2] + (C_LINE[2] - C_WOOD[2]) * mix);
      buf.pixels[idx + 3] = 255;
    }
  }
  buf.updatePixels();
}

// ── Back face grain ────────────────────────────────────────────────────────
// Book-matched: center seam is vertical (angle = PI/2), grain fans symmetrically
// outward. atan gives a sigmoidal taper that matches how real wood grain spreads
// from a glue seam. Slight sin(y) term adds longitudinal waviness.
function initGrain() {
  grainBuf = createGraphics(GRAIN_BUF_W, GRAIN_BUF_H);
  grainBuf.pixelDensity(1);  // raw pixel indexing assumes 1:1, not HiDPI
  buildLIC(grainBuf, GRAIN_BUF_W, GRAIN_BUF_H,
    (x, y) => {
      const cx = (x / GRAIN_BUF_W - 0.5) * 2;  // -1..1, 0 = center seam
      return Math.PI * 0.5
             + cx * 0.10                          // gentle book-match tilt, ±5.7° at edges
             + Math.sin(y / 130) * 0.28           // primary along-grain waviness (growth rings)
             + Math.sin(y / 55 + cx * 1.5) * 0.05; // fine secondary texture
    },
    35);
}

// ── Side ribbon grain ──────────────────────────────────────────────────────
// Nearly vertical, minimal lateral drift — real bent side strips have very
// straight grain. Streamlines are longer to produce the fine parallel lines
// that read as wood across the thin ribbon width.
function initSideGrain() {
  sideGrainBuf = createGraphics(SIDE_GRAIN_BUF_W, SIDE_GRAIN_BUF_H);
  sideGrainBuf.pixelDensity(1);  // raw pixel indexing assumes 1:1, not HiDPI
  buildLIC(sideGrainBuf, SIDE_GRAIN_BUF_W, SIDE_GRAIN_BUF_H,
    (x, y) => Math.PI * 0.5
              + Math.sin(x / 12) * 0.08,
    50);
}

// LIC is computed once at init — no per-frame stepping needed
function stepGrain()     {}
function stepSideGrain() {}
