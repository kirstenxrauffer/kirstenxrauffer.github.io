// ── Hover highlight colors ─────────────────────────────────────────────────
const HL_STROKE = [130, 200, 255];
const HL_FILL   = [130, 200, 255, 100];
const HL_DARK   = [30, 100, 180];  // darker shade for outlines on hover

// ── Explode offsets per component ─────────────────────────────────────────
// Applied in component's parent frame (world for body/strings, neck-group for
// neck/fretboard/etc.). tuning_pegs is applied inside the headstock-local frame
// (+Z is perpendicular to the headstock face).
const EXPLODE_MS = 650;
const EXPLODE = {
  soundboard:  [0,   0,  28],
  back:        [0,   0, -28],
  sides:       [0,   0,   0],  // split handled inside compSides (±X from seam)
  bridge:      [0,   0,  28],  // matches soundboard so bridge stays seated on the face
  neck:        [0, -22,   0],
  fretboard:   [0,   0,  16],
  frets:       [0,   0,  24],
  nut:         [0, -10,   0],
  headstock:   [0, -38,   0],
  tuning_pegs: [0,   0,  14],  // headstock-local Z
  strings:     [0,   0,  34],
};

// ── Explode animation state ────────────────────────────────────────────────
let explodeT = 0;

// ── Highlight helpers ──────────────────────────────────────────────────────
function hlStroke(hl, base, wt) {
  stroke(...(hl ? HL_DARK : base));
  strokeWeight(wt);
}
function hlFill(hl, r, g, b, a) {
  if (hl) fill(...HL_FILL);
  else fill(r, g, b, a);
}

// ── Explode animation ──────────────────────────────────────────────────────
function updateExplodeT() {
  // Explode is a heavy 3D animation — gate it on the committed zoom target
  // (not the instant hover) so brief cursor slips across thin parts don't
  // trigger a half-explode. Instant highlight still uses hoveredId (below).
  const target = zoomTargetId ? 1 : 0;
  const dt = (typeof deltaTime === 'number' && deltaTime > 0) ? deltaTime : 16;
  const step = dt / EXPLODE_MS;
  explodeT = constrain(explodeT + Math.sign(target - explodeT) * step, 0, 1);
}

function easedT() {
  const t = explodeT;
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function explodeOffset(id) {
  const off = EXPLODE[id] || [0, 0, 0];
  const t = easedT();
  return [off[0] * t, off[1] * t, off[2] * t];
}

function applyExplode(id) {
  const [dx, dy, dz] = explodeOffset(id);
  translate(dx, dy, dz);
}

function applyExplodePick(g, id) {
  const [dx, dy, dz] = explodeOffset(id);
  g.translate(dx, dy, dz);
}

function isHl(id) { return hoveredId === id; }
