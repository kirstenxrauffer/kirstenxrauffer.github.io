// ── Mutable geometry state ─────────────────────────────────────────────────
let bodyPts      = [];
let rightHalfPts = [];  // right-side profile (x >= 0), used for split-sides decomposition
let holePts      = [];

// Body curve parameters (set by rebuildFromParams, used by bodyWidthAt)
let G = {};

// Derived scalar state — recomputed each time slider values change
let BODY_D, NK_Y0, NK_Y1, NK_W0, NK_W1, NK_D;
let HD_W = 74;
let SH_R = 50;
let SH_CY;
let BR_Y;
let NUT_W;
let SCALE_LEN;
let FB_W_EXTRA = 2;
let FB_END_Y;

// ── Slider → geometry rebuild ──────────────────────────────────────────────

function rebuildFromParams() {
  let p = {};
  for (let k in PARAMS) p[k] = PARAMS[k].val;

  BODY_D = p.bodyDepth;
  let H = p.bodyHeight;

  G.yBot = H / 2;
  G.yTop = -H / 2;
  G.lbW  = p.lowerBoutW;
  G.ubW  = p.upperBoutW;
  G.wW   = p.waistW;

  NK_Y0 = G.yTop + p.neckOffsetY;
  NK_Y1 = NK_Y0 - p.neckLength;
  NK_W0 = p.neckWidthBody; NK_W1 = p.neckWidthNut; NK_D = p.neckDepth;
  NUT_W = NK_W1 + 2;
  G.neckW  = NK_W0 / 2;
  G.neckOX = p.neckOffsetX;
  G.neckOY = p.neckOffsetY;
  G.neckOZ = p.neckOffsetZ;
  HD_W     = p.headstockW;
  SH_R     = p.soundHoleR;
  FB_W_EXTRA = p.fretboardExtra;

  G.yLBmax = G.yBot - H * p.lowerBoutH * 0.55;
  G.yWaist = G.yBot - H * p.waistPos;
  // waistHeight = gap from waist to upper bout max
  // upperBoutPos scales it: 1.0 = full waistHeight, lower = closer to waist
  G.yUBmax = G.yWaist - p.waistHeight * p.upperBoutPos;

  G.arcPwr      = 1.5 - p.bottomRound * 1.0;
  G.shoulderK   = p.shoulderSharp;
  G.waistSharp  = p.waistSharp;
  G.lbSharp     = p.lowerBoutSharp;
  G.shoulderFade = p.shoulderSmooth;
  // Neck junction: controls how phase is warped in the cosine taper
  G.njExp = 1.0 + p.neckJunction * 1.5;

  SH_CY    = G.yWaist + (G.yUBmax - G.yWaist) * 0.3;
  BR_Y     = G.yLBmax + (G.yBot - G.yLBmax) * 0.15;
  FB_END_Y = G.yTop + 15;
  SCALE_LEN = Math.abs(NK_Y1 - BR_Y);

  buildBody();
}

// ── Body outline ───────────────────────────────────────────────────────────

/** Direct body half-width at y — piecewise smooth, no spline.
 *  Each section is a closed-form curve with zero derivatives at its
 *  endpoints, guaranteeing C1 continuity at every junction. */
function bodyWidthAt(y) {
  if (y >= G.yBot) return 0;
  if (y <= G.yTop) return G.neckW;

  // ── Bottom arc (yBot → yLBmax): superellipse ──
  if (y > G.yLBmax) {
    let u = (y - G.yLBmax) / (G.yBot - G.yLBmax);
    return G.lbW * Math.pow(Math.max(0, 1 - u * u), G.arcPwr);
  }

  // ── Lower bout max → waist: phase-warped cosine ease ──
  // waistSharp > 1 = stays at bout width longer, sharper drop to waist
  if (y > G.yWaist) {
    let t = (G.yLBmax - y) / (G.yLBmax - G.yWaist);
    let phase = Math.pow(t, G.waistSharp) * Math.PI;
    return G.lbW + (G.wW - G.lbW) * (1 - Math.cos(phase)) / 2;
  }

  // ── Waist → upper bout max: rise from wW to ubW ──
  // lowerBoutSharp > 1 = stays at waist width longer before climbing to the bout
  if (y > G.yUBmax) {
    let t = (G.yWaist - y) / (G.yWaist - G.yUBmax);
    let phase = Math.pow(t, G.njExp * G.lbSharp) * Math.PI;
    return G.wW + (G.ubW - G.wW) * (1 - Math.cos(phase)) / 2;
  }

  // ── Upper bout max → top: quarter-ellipse shoulder to flat top at topW ──
  // shoulderSharp sets the ellipse aspect: higher = topW clamps to neckW sooner,
  // producing a longer, gentler shoulder slope. Clamp at neckW so it never inverts.
  let shoulderH = Math.abs(G.yTop - G.yUBmax);
  let topW = Math.max(G.neckW, G.ubW - G.shoulderK * shoulderH);
  let s = (G.yUBmax - y) / (G.yUBmax - G.yTop);
  let w = topW + (G.ubW - topW) * Math.sqrt(Math.max(0, 1 - s * s));
  // shoulderSmooth: smoothstep fade to neckW over the last fraction of the
  // shoulder, softening the corner where the body meets the neck.
  if (G.shoulderFade > 0 && s > 1 - G.shoulderFade) {
    let f = (s - (1 - G.shoulderFade)) / G.shoulderFade;
    f = f * f * (3 - 2 * f);
    w += (G.neckW - w) * f;
  }
  return w;
}

function buildBody() {
  bodyPts = [];
  const N = BODY_SAMPLES;
  let right = [];
  for (let i = 0; i <= N; i++) {
    let y = G.yBot - (G.yBot - G.yTop) * (i / N);
    right.push({ x: bodyWidthAt(y), y });
  }
  rightHalfPts = right;
  let left = [];
  for (let i = N; i >= 0; i--) left.push({ x: -right[i].x, y: right[i].y });
  // Keep left[0] so the polygon has an explicit flat top edge at yTop.
  // Drop left[N] — duplicates right[0] at the bottom.
  bodyPts = [...right, ...left.slice(0, -1)];
}

function buildHole() {
  holePts = [];
  for (let i = 0; i < HOLE_SEGS; i++) {
    let a = (i / HOLE_SEGS) * TWO_PI;
    holePts.push({ x: SH_R * cos(a), y: SH_CY + SH_R * sin(a) });
  }
}

// ── Neck / fretboard helpers ───────────────────────────────────────────────

function fretY(n) {
  return NK_Y1 + SCALE_LEN * (1 - 1 / Math.pow(2, n / 12));
}

function pegWorldPos(i) {
  const hw = HD_W / 2, hd = HD_D / 2;
  const { px: lx, py: ly } = pegLocalPos(i, hw);
  const lz = hd + 1;
  const cosA = Math.cos(HD_ANG), sinA = Math.sin(HD_ANG);
  return { x: lx, y: NK_Y1 + ly * cosA - lz * sinA, z: ly * sinA + lz * cosA };
}

function neckDims() {
  return { w0: NK_W0 / 2, w1: NK_W1 / 2, d0: NK_D / 2, d1: HD_D / 2 };
}

function fretboardDims() {
  const { w0, w1, d0, d1 } = neckDims();
  const tFBc = constrain((FB_END_Y - NK_Y0) / (NK_Y1 - NK_Y0), 0, 1);
  const dFB  = lerp(d0, d1, tFBc);
  return {
    d0, d1, dFB,
    fbZFB: dFB + FB_THICK,
    fbZNt: d1 + FB_THICK,
    wFB:   lerp(w0, w1, tFBc) + FB_W_EXTRA,
    wNt:   w1 + FB_W_EXTRA,
  };
}

// Lay out peg i (0–5) in headstock-local XY. Returns {px, py}.
function pegLocalPos(i, hw) {
  const frac  = i / (N_STR - 1);
  const xNut  = lerp(-STR_SP_NT / 2, STR_SP_NT / 2, frac);
  const side   = i < 3 ? -1 : 1;
  const pegRow = i < 3 ? 2 - i : i - 3;
  return { px: lerp(xNut, side * (hw - 8), 0.7), py: -25 - pegRow * 35 };
}

// Draw a filled circle polygon on the main (global) p5 canvas.
function circlePoly(r, segs = PEG_SEGS) {
  beginShape();
  for (let j = 0; j <= segs; j++) { const a = j / segs * TWO_PI; vertex(r * cos(a), r * sin(a)); }
  endShape(CLOSE);
}

